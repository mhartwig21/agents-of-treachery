/**
 * Experiment Runner - Batch game simulation orchestrator.
 *
 * Runs multiple games in parallel with different model configurations,
 * gathers artifacts, and runs analysis after completion.
 */

import 'dotenv/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';

import { AgentRuntime } from '../agent/runtime';
import type { AgentRuntimeConfig, LLMProvider, LLMCompletionParams, LLMCompletionResult, AgentConfig, AgentPersonality } from '../agent/types';
import { DEFAULT_PERSONALITY } from '../agent/types';
import { POWERS, type Power } from '../engine/types';
import { SnapshotManager } from '../store/snapshot-manager';
import {
  GameLogger,
  removeGameLogger,
  getInvalidOrderStats,
  getLieStats,
} from '../server/game-logger';
import { fetchWithRetry } from '../server/providers';

import type {
  ExperimentConfig,
  ExperimentResults,
  ExperimentStats,
  GameConfig,
  GameResult,
  ModelConfig,
  ExperimentEvent,
  ExperimentEventCallback,
  ExperimentProgress,
  ResumeOptions,
} from './types';
import { parseModelConfigFromSpec } from './model-spec';

/**
 * Claude/Anthropic LLM Provider.
 */
class AnthropicLLMProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;

  constructor(config: ModelConfig) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    this.model = config.model;
    this.defaultTemperature = config.temperature ?? 0.7;
    this.defaultMaxTokens = config.maxTokens ?? 2048;

    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY required for Anthropic provider');
    }
  }

  async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
    const temperature = params.temperature ?? this.defaultTemperature;
    const maxTokens = params.maxTokens ?? this.defaultMaxTokens;

    const systemMessage = params.messages.find(m => m.role === 'system');
    const otherMessages = params.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const response = await fetchWithRetry(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: params.model || this.model,
        max_tokens: maxTokens,
        temperature,
        system: systemMessage?.content || '',
        messages: otherMessages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const result = await response.json();
    return {
      content: result.content?.[0]?.text || '',
      usage: {
        inputTokens: result.usage?.input_tokens || 0,
        outputTokens: result.usage?.output_tokens || 0,
      },
      stopReason: result.stop_reason === 'end_turn' ? 'end_turn' : 'max_tokens',
    };
  }
}

/**
 * OpenAI-compatible LLM Provider (OpenAI, Ollama, OpenRouter, custom).
 */
class OpenAICompatibleLLMProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;

  constructor(config: ModelConfig) {
    this.model = config.model;
    this.defaultTemperature = config.temperature ?? 0.7;
    this.defaultMaxTokens = config.maxTokens ?? 2048;

    switch (config.provider) {
      case 'openai':
        this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
        this.baseUrl = config.baseUrl || 'https://api.openai.com';
        if (!this.apiKey) throw new Error('OPENAI_API_KEY required');
        break;
      case 'openrouter':
        this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || '';
        this.baseUrl = config.baseUrl || 'https://openrouter.ai/api';
        if (!this.apiKey) throw new Error('OPENROUTER_API_KEY required');
        break;
      case 'ollama':
        this.apiKey = ''; // Ollama doesn't need API key
        this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        break;
      case 'custom':
        this.apiKey = config.apiKey || '';
        this.baseUrl = config.baseUrl || '';
        if (!this.baseUrl) throw new Error('baseUrl required for custom provider');
        break;
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
    const temperature = params.temperature ?? this.defaultTemperature;
    const maxTokens = params.maxTokens ?? this.defaultMaxTokens;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const model = params.model || this.model;
    // gpt-5.x and o-series models require max_completion_tokens instead of max_tokens
    const useMaxCompletionTokens = /^(gpt-5|o[1-4])/.test(model);
    // o-series and gpt-5 base (not gpt-5.1/5.2) only support temperature=1
    const omitTemperature = /^(o[1-4]|gpt-5($|-))/.test(model);

    const body: Record<string, unknown> = {
      model,
      messages: params.messages.map(m => ({ role: m.role, content: m.content })),
    };

    if (useMaxCompletionTokens) {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
    }

    if (!omitTemperature) {
      body.temperature = temperature;
    }

    const response = await fetchWithRetry(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const finishReason = data.choices?.[0]?.finish_reason;

    return {
      content: data.choices?.[0]?.message?.content || '',
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      stopReason: finishReason === 'stop' ? 'end_turn' : 'max_tokens',
    };
  }
}

/**
 * Mock LLM Provider for testing.
 */
class MockLLMProvider implements LLMProvider {
  private turnCount = 0;

  async complete(_params: LLMCompletionParams): Promise<LLMCompletionResult> {
    this.turnCount++;
    const content = `
REASONING: This is turn ${this.turnCount}. Holding positions.

ORDERS:
A Paris HOLD
A Marseilles HOLD
F Brest HOLD
`;
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50 },
      stopReason: 'end_turn',
    };
  }
}

/**
 * Create an LLM provider from a model config.
 */
function createLLMProvider(config: ModelConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicLLMProvider(config);
    case 'openai':
    case 'openrouter':
    case 'ollama':
    case 'custom':
      return new OpenAICompatibleLLMProvider(config);
    case 'mock':
      return new MockLLMProvider();
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Experiment Runner - orchestrates batch game simulations.
 */
export class ExperimentRunner extends EventEmitter {
  private config: ExperimentConfig;
  private results: ExperimentResults;
  private llmProviders: Map<string, LLMProvider> = new Map();
  private isRunning = false;
  private aborted = false;
  private activeRuntimes: Map<string, AgentRuntime> = new Map();

  constructor(config: ExperimentConfig) {
    super();
    this.config = this.normalizeConfig(config);
    this.results = this.initializeResults();
    // Note: SnapshotManager will be used for resume functionality in future
    // For now, just ensure the snapshot directory is properly configured
    void new SnapshotManager({
      snapshotDir: path.join(this.config.outputDir, 'snapshots'),
    });
  }

  /**
   * Normalize and validate experiment config.
   * Handles defaultModelSpec by auto-generating a ModelConfig.
   */
  private normalizeConfig(config: ExperimentConfig): ExperimentConfig {
    const normalized = { ...config, models: [...config.models] };

    // Handle defaultModelSpec: parse and add to models array
    if (normalized.defaultModelSpec && !normalized.defaultModelConfigId) {
      const modelConfig = parseModelConfigFromSpec(normalized.defaultModelSpec);
      // Add to models if not already present
      if (!normalized.models.find(m => m.id === modelConfig.id)) {
        normalized.models.push(modelConfig);
      }
      normalized.defaultModelConfigId = modelConfig.id;
    }

    // Ensure output directory
    if (!normalized.outputDir) {
      normalized.outputDir = path.join(process.cwd(), 'experiments', normalized.experimentId);
    }

    // Generate game configs if not provided
    if (!normalized.games || normalized.games.length === 0) {
      normalized.games = [];
      for (let i = 0; i < normalized.gameCount; i++) {
        normalized.games.push({
          gameId: `${normalized.experimentId}-game-${i + 1}`,
          defaultModelConfigId: normalized.defaultModelConfigId,
        });
      }
    }

    return normalized;
  }

  /**
   * Initialize empty results structure.
   */
  private initializeResults(): ExperimentResults {
    return {
      config: this.config,
      startedAt: new Date(),
      games: [],
      stats: this.initializeStats(),
      status: 'running',
    };
  }

  /**
   * Initialize empty stats structure.
   */
  private initializeStats(): ExperimentStats {
    const winsByPower: Record<Power, number> = {} as Record<Power, number>;
    const avgSCByPower: Record<Power, number> = {} as Record<Power, number>;
    for (const power of POWERS) {
      winsByPower[power] = 0;
      avgSCByPower[power] = 0;
    }

    return {
      totalGames: this.config.gameCount,
      completedGames: 0,
      failedGames: 0,
      timedOutGames: 0,
      winsByPower,
      winsByModel: {},
      drawCount: 0,
      averageDurationMs: 0,
      averageTurns: 0,
      invalidOrderRateByModel: {},
      deceptionRateByModel: {},
      averageSupplyCentersByPower: avgSCByPower,
    };
  }

  /**
   * Get or create LLM provider for a model config.
   */
  private getProvider(modelConfigId: string): LLMProvider {
    let provider = this.llmProviders.get(modelConfigId);
    if (!provider) {
      const modelConfig = this.config.models.find(m => m.id === modelConfigId);
      if (!modelConfig) {
        throw new Error(`Model config not found: ${modelConfigId}`);
      }
      provider = createLLMProvider(modelConfig);
      this.llmProviders.set(modelConfigId, provider);
    }
    return provider;
  }

  /**
   * Get the model name for a model config ID.
   */
  private getModelName(modelConfigId: string): string {
    const modelConfig = this.config.models.find(m => m.id === modelConfigId);
    return modelConfig?.model || modelConfigId;
  }

  /**
   * Emit an experiment event.
   */
  private emitEvent(event: Omit<ExperimentEvent, 'timestamp' | 'experimentId'>): void {
    const fullEvent: ExperimentEvent = {
      ...event,
      timestamp: new Date(),
      experimentId: this.config.experimentId,
    };
    this.emit('event', fullEvent);
  }

  /**
   * Get current progress.
   */
  private getProgress(): ExperimentProgress {
    const completed = this.results.games.length;
    const inProgress = this.activeRuntimes.size;
    const pending = this.config.gameCount - completed - inProgress;

    return {
      experimentId: this.config.experimentId,
      totalGames: this.config.gameCount,
      completedGames: completed,
      inProgressGames: inProgress,
      pendingGames: pending,
      activeGameIds: Array.from(this.activeRuntimes.keys()),
    };
  }

  /**
   * Run the full experiment.
   */
  async run(): Promise<ExperimentResults> {
    if (this.isRunning) {
      throw new Error('Experiment is already running');
    }

    this.isRunning = true;
    this.aborted = false;

    // Create output directory
    await fs.mkdir(this.config.outputDir, { recursive: true });
    await fs.mkdir(path.join(this.config.outputDir, 'games'), { recursive: true });
    await fs.mkdir(path.join(this.config.outputDir, 'analysis'), { recursive: true });

    // Save config
    await this.saveConfig();

    this.emitEvent({
      type: 'experiment_started',
      data: { progress: this.getProgress() },
    });

    try {
      // Run games in batches
      const gameConfigs = this.config.games!;
      let gameIndex = 0;

      while (gameIndex < gameConfigs.length && !this.aborted) {
        // Start up to maxConcurrent games
        const batch: Promise<GameResult>[] = [];
        const batchSize = Math.min(
          this.config.maxConcurrent,
          gameConfigs.length - gameIndex
        );

        for (let i = 0; i < batchSize && !this.aborted; i++) {
          const gameConfig = gameConfigs[gameIndex + i];
          batch.push(this.runGame(gameConfig));
        }

        // Wait for batch to complete
        const batchResults = await Promise.all(batch);

        // Process results
        for (const result of batchResults) {
          this.results.games.push(result);
          this.updateStats(result);

          this.emitEvent({
            type: result.status === 'completed' ? 'game_completed' : 'game_failed',
            gameId: result.gameId,
            data: {
              result,
              progress: this.getProgress(),
            },
          });
        }

        gameIndex += batchSize;

        // Save intermediate results
        await this.saveResults();
      }

      // Finalize
      this.results.completedAt = new Date();
      this.results.durationMs = this.results.completedAt.getTime() - this.results.startedAt.getTime();
      this.results.status = this.aborted ? 'aborted' : 'completed';

      // Run aggregate analysis
      if (this.config.runAnalysis) {
        await this.runAggregateAnalysis();
      }

      // Save final results
      await this.saveResults();

      this.emitEvent({
        type: this.aborted ? 'experiment_aborted' : 'experiment_completed',
        data: {
          progress: this.getProgress(),
          stats: this.results.stats,
        },
      });

      return this.results;
    } finally {
      this.isRunning = false;
      this.cleanupProviders();
    }
  }

  /**
   * Resolve a power assignment to its model config, handling both
   * modelConfigId references and inline modelSpec strings.
   */
  private resolveAssignmentConfig(assignment: { modelConfigId: string; modelSpec?: string }): ModelConfig {
    // Inline model spec takes priority
    if (assignment.modelSpec) {
      const specConfig = parseModelConfigFromSpec(assignment.modelSpec);
      // Cache in models list for provider reuse
      if (!this.config.models.find(m => m.id === specConfig.id)) {
        this.config.models.push(specConfig);
      }
      return specConfig;
    }

    const modelConfig = this.config.models.find(m => m.id === assignment.modelConfigId);
    if (!modelConfig) {
      throw new Error(`Model config not found: ${assignment.modelConfigId}`);
    }
    return modelConfig;
  }

  /**
   * Run a single game.
   * Supports per-power model assignment via modelSpec strings or modelConfigId references.
   * When multiple providers are needed, creates a routing provider.
   */
  private async runGame(gameConfig: GameConfig): Promise<GameResult> {
    const startedAt = new Date();
    const logsDir = path.join(this.config.outputDir, 'games', gameConfig.gameId);
    await fs.mkdir(logsDir, { recursive: true });

    const logger = new GameLogger(gameConfig.gameId, logsDir);

    // Pass 1: Resolve model config per power and detect if routing is needed
    const modelsByPower: Record<Power, string> = {} as Record<Power, string>;
    const perPowerConfigs = new Map<Power, ModelConfig>();
    const perPowerProviders = new Map<string, { provider: LLMProvider; modelName: string }>();
    let needsRouting = false;

    const defaultModelConfig = this.resolveAssignmentConfig({
      modelConfigId: gameConfig.defaultModelConfigId,
    });
    const defaultModelConfigId = defaultModelConfig.id;

    for (const power of POWERS) {
      const assignment = gameConfig.powerAssignments?.find(a => a.power === power);

      let modelConfig: ModelConfig;
      if (assignment?.modelSpec || assignment?.modelConfigId) {
        modelConfig = this.resolveAssignmentConfig(assignment);
      } else {
        modelConfig = defaultModelConfig;
      }

      perPowerConfigs.set(power, modelConfig);
      modelsByPower[power] = modelConfig.model;

      if (modelConfig.id !== defaultModelConfigId) {
        needsRouting = true;
      }

      // Register provider for each unique config
      if (!perPowerProviders.has(modelConfig.id)) {
        perPowerProviders.set(modelConfig.id, {
          provider: this.getProvider(modelConfig.id),
          modelName: modelConfig.model,
        });
      }
    }

    // Pass 2: Build agent configs with correct model field
    const agentConfigs: AgentConfig[] = [];
    for (const power of POWERS) {
      const modelConfig = perPowerConfigs.get(power)!;
      const assignment = gameConfig.powerAssignments?.find(a => a.power === power);

      const personality: AgentPersonality = assignment?.personality
        ? { ...DEFAULT_PERSONALITY, ...assignment.personality }
        : DEFAULT_PERSONALITY;

      agentConfigs.push({
        power,
        // Use config ID as routing key when routing is needed,
        // otherwise use the actual model name
        model: needsRouting ? modelConfig.id : modelConfig.model,
        personality,
        temperature: 0.7,
        maxTokens: 2048,
      });
    }

    // Create the appropriate provider:
    // - Single provider when all powers use the same model
    // - Routing provider when powers use different models
    let gameProvider: LLMProvider;
    if (!needsRouting) {
      gameProvider = this.getProvider(defaultModelConfigId);
    } else {
      // Finalize agent model fields to use routing keys
      // (already set above when needsRouting is true)

      // Build routing provider that maps config IDs to actual providers
      gameProvider = {
        async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
          const routingKey = params.model || '';
          const entry = perPowerProviders.get(routingKey);
          if (entry) {
            // Route to the correct provider with the actual model name
            return entry.provider.complete({ ...params, model: entry.modelName });
          }
          // Fallback to default
          const defaultEntry = perPowerProviders.get(defaultModelConfigId);
          if (defaultEntry) {
            return defaultEntry.provider.complete({ ...params, model: defaultEntry.modelName });
          }
          throw new Error(`No provider found for model: ${routingKey}`);
        },
      };
    }

    const runtimeConfig: AgentRuntimeConfig = {
      gameId: gameConfig.gameId,
      agents: agentConfigs,
      parallelExecution: true,
      turnTimeout: 120000,
      persistMemory: false,
      verbose: this.config.verbose,
      pressPeriodMinutes: this.config.pressPeriodMinutes ?? 1,
    };

    const runtime = new AgentRuntime(runtimeConfig, gameProvider, undefined, logger);
    this.activeRuntimes.set(gameConfig.gameId, runtime);

    // Set up auto-snapshots if enabled
    let snapshotsPath: string | undefined;
    if (this.config.saveSnapshots) {
      snapshotsPath = path.join(this.config.outputDir, 'snapshots', gameConfig.gameId);
      // Note: Auto-snapshot would need GameStore integration here
      // For now, we'll skip auto-snapshots in the basic implementation
    }

    this.emitEvent({
      type: 'game_started',
      gameId: gameConfig.gameId,
      data: { progress: this.getProgress() },
    });

    let turnCount = 0;

    // Track turns
    runtime.onEvent(event => {
      if (event.type === 'phase_resolved') {
        turnCount++;
        // Check turn limit
        if (this.config.maxTurnsPerGame > 0 && turnCount >= this.config.maxTurnsPerGame) {
          runtime.stop();
        }
      }
    });

    try {
      await runtime.initialize();

      // Apply phase delay if configured
      if (this.config.phaseDelayMs) {
        process.env.PHASE_DELAY_MS = String(this.config.phaseDelayMs);
      }

      const gameResult = await runtime.runGame();
      const completedAt = new Date();
      const finalState = runtime.getGameState();

      // Get supply center counts
      const finalSupplyCenters: Record<Power, number> = {} as Record<Power, number>;
      for (const power of POWERS) {
        finalSupplyCenters[power] = 0;
      }
      for (const [, owner] of finalState.supplyCenters) {
        if (owner) {
          finalSupplyCenters[owner]++;
        }
      }

      // Get analysis stats
      const invalidOrderStats = getInvalidOrderStats(gameConfig.gameId, logsDir);
      const lieStats = getLieStats(gameConfig.gameId, logsDir);

      return {
        gameId: gameConfig.gameId,
        experimentId: this.config.experimentId,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        winner: gameResult.winner,
        draw: gameResult.draw,
        finalYear: finalState.year,
        finalSeason: finalState.season,
        finalSupplyCenters,
        turnCount,
        modelsByPower,
        logPath: path.join(logsDir, `${gameConfig.gameId}.jsonl`),
        snapshotsPath,
        invalidOrderStats,
        lieStats,
        status: 'completed',
      };
    } catch (error) {
      const completedAt = new Date();
      return {
        gameId: gameConfig.gameId,
        experimentId: this.config.experimentId,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        finalYear: 1901,
        finalSeason: 'SPRING',
        finalSupplyCenters: {} as Record<Power, number>,
        turnCount,
        modelsByPower,
        logPath: path.join(logsDir, `${gameConfig.gameId}.jsonl`),
        error: error instanceof Error ? error.message : String(error),
        status: 'failed',
      };
    } finally {
      this.activeRuntimes.delete(gameConfig.gameId);
      runtime.cleanup();
      removeGameLogger(gameConfig.gameId);
    }
  }

  /**
   * Update stats with a game result.
   */
  private updateStats(result: GameResult): void {
    const stats = this.results.stats;

    if (result.status === 'completed') {
      stats.completedGames++;

      if (result.winner) {
        stats.winsByPower[result.winner]++;

        // Track wins by model
        const winnerModel = result.modelsByPower[result.winner];
        stats.winsByModel[winnerModel] = (stats.winsByModel[winnerModel] || 0) + 1;
      } else if (result.draw) {
        stats.drawCount++;
      }

      // Update averages
      const completedCount = stats.completedGames;
      stats.averageDurationMs =
        ((stats.averageDurationMs * (completedCount - 1)) + result.durationMs) / completedCount;
      stats.averageTurns =
        ((stats.averageTurns * (completedCount - 1)) + result.turnCount) / completedCount;

      // Update supply center averages
      for (const power of POWERS) {
        const prevAvg = stats.averageSupplyCentersByPower[power] || 0;
        const scCount = result.finalSupplyCenters[power] || 0;
        stats.averageSupplyCentersByPower[power] =
          ((prevAvg * (completedCount - 1)) + scCount) / completedCount;
      }

      // Update invalid order rates
      if (result.invalidOrderStats) {
        for (const modelStats of result.invalidOrderStats.byModel) {
          const current = stats.invalidOrderRateByModel[modelStats.model] || 0;
          stats.invalidOrderRateByModel[modelStats.model] =
            (current + modelStats.invalidRate) / 2; // Simple rolling average
        }
      }

      // Update deception rates
      if (result.lieStats) {
        for (const modelStats of result.lieStats.byModel) {
          const current = stats.deceptionRateByModel[modelStats.model] || 0;
          stats.deceptionRateByModel[modelStats.model] =
            (current + modelStats.deceptionRate) / 2;
        }
      }
    } else if (result.status === 'failed') {
      stats.failedGames++;
    } else if (result.status === 'timeout') {
      stats.timedOutGames++;
    }
  }

  /**
   * Save experiment config.
   */
  private async saveConfig(): Promise<void> {
    const configPath = path.join(this.config.outputDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(this.config, null, 2));
  }

  /**
   * Save current results.
   */
  private async saveResults(): Promise<void> {
    const resultsPath = path.join(this.config.outputDir, 'results.json');

    // Serialize dates
    const serializedResults = JSON.parse(JSON.stringify(this.results, (_key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    }));

    await fs.writeFile(resultsPath, JSON.stringify(serializedResults, null, 2));
  }

  /**
   * Run aggregate analysis across all games.
   */
  private async runAggregateAnalysis(): Promise<void> {
    const analysisDir = path.join(this.config.outputDir, 'analysis');

    // Model comparison report
    const modelComparison = {
      winRates: {} as Record<string, number>,
      invalidOrderRates: this.results.stats.invalidOrderRateByModel,
      deceptionRates: this.results.stats.deceptionRateByModel,
      gamesPlayed: {} as Record<string, number>,
    };

    // Calculate win rates and games played per model
    const modelGames: Record<string, number> = {};
    for (const result of this.results.games) {
      for (const [_power, model] of Object.entries(result.modelsByPower)) {
        modelGames[model] = (modelGames[model] || 0) + 1;
      }
    }
    modelComparison.gamesPlayed = modelGames;

    for (const [model, wins] of Object.entries(this.results.stats.winsByModel)) {
      const games = modelGames[model] || 1;
      modelComparison.winRates[model] = wins / games;
    }

    await fs.writeFile(
      path.join(analysisDir, 'model-comparison.json'),
      JSON.stringify(modelComparison, null, 2)
    );

    // Power performance report
    const powerPerformance = {
      winRates: {} as Record<Power, number>,
      averageSupplyCenters: this.results.stats.averageSupplyCentersByPower,
    };

    for (const power of POWERS) {
      powerPerformance.winRates[power] =
        this.results.stats.winsByPower[power] / Math.max(this.results.stats.completedGames, 1);
    }

    await fs.writeFile(
      path.join(analysisDir, 'power-performance.json'),
      JSON.stringify(powerPerformance, null, 2)
    );

    // Summary report
    const summary = {
      experimentId: this.config.experimentId,
      name: this.config.name,
      totalGames: this.results.stats.totalGames,
      completedGames: this.results.stats.completedGames,
      failedGames: this.results.stats.failedGames,
      averageDurationMs: this.results.stats.averageDurationMs,
      averageTurns: this.results.stats.averageTurns,
      drawRate: this.results.stats.drawCount / Math.max(this.results.stats.completedGames, 1),
      topWinningPower: this.getTopWinner(this.results.stats.winsByPower),
      topWinningModel: this.getTopWinner(this.results.stats.winsByModel),
    };

    await fs.writeFile(
      path.join(analysisDir, 'summary.json'),
      JSON.stringify(summary, null, 2)
    );
  }

  /**
   * Get the entry with the highest value.
   */
  private getTopWinner(counts: Record<string, number>): string | null {
    let top: string | null = null;
    let topCount = 0;
    for (const [key, count] of Object.entries(counts)) {
      if (count > topCount) {
        top = key;
        topCount = count;
      }
    }
    return top;
  }

  /**
   * Abort the experiment.
   */
  abort(): void {
    this.aborted = true;
    // Stop all active runtimes
    for (const runtime of this.activeRuntimes.values()) {
      runtime.stop();
    }
  }

  /**
   * Clean up LLM providers.
   */
  private cleanupProviders(): void {
    this.llmProviders.clear();
  }

  /**
   * Register event listener.
   */
  onEvent(callback: ExperimentEventCallback): () => void {
    this.on('event', callback);
    return () => this.off('event', callback);
  }

  /**
   * Get current results.
   */
  getResults(): ExperimentResults {
    return this.results;
  }

  /**
   * Check if experiment is running.
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Resume an experiment from critical states.
   */
  static async resume(
    resultsPath: string,
    options: ResumeOptions
  ): Promise<ExperimentResults> {
    const resultsJson = await fs.readFile(resultsPath, 'utf-8');
    const previousResults: ExperimentResults = JSON.parse(resultsJson);

    // Create new runner from previous config
    const runner = new ExperimentRunner(previousResults.config);
    runner.results = previousResults;
    runner.results.status = 'running';

    // Resume from critical states
    for (const criticalState of options.criticalStates) {
      // Load snapshot and continue game
      // This is a placeholder - full implementation would restore game state
      console.log(`Resuming game ${criticalState.gameId} from phase ${criticalState.resumePhase.year} ${criticalState.resumePhase.season}`);
    }

    if (options.continueRemaining) {
      return runner.run();
    }

    return runner.results;
  }

  /**
   * Load an experiment result from disk.
   */
  static async loadResults(outputDir: string): Promise<ExperimentResults> {
    const resultsPath = path.join(outputDir, 'results.json');
    const resultsJson = await fs.readFile(resultsPath, 'utf-8');
    return JSON.parse(resultsJson);
  }
}

/**
 * Create and validate an experiment config.
 */
export function createExperimentConfig(
  partial: Partial<ExperimentConfig> & Pick<ExperimentConfig, 'experimentId' | 'name' | 'models' | 'defaultModelConfigId'>
): ExperimentConfig {
  return {
    experimentId: partial.experimentId,
    name: partial.name,
    description: partial.description,
    models: partial.models,
    gameCount: partial.gameCount ?? 1,
    maxConcurrent: partial.maxConcurrent ?? 1,
    maxTurnsPerGame: partial.maxTurnsPerGame ?? 0,
    defaultModelConfigId: partial.defaultModelConfigId,
    games: partial.games,
    runAnalysis: partial.runAnalysis ?? true,
    saveSnapshots: partial.saveSnapshots ?? false,
    outputDir: partial.outputDir ?? path.join(process.cwd(), 'experiments', partial.experimentId),
    phaseDelayMs: partial.phaseDelayMs ?? 100,
    pressPeriodMinutes: partial.pressPeriodMinutes,
    verbose: partial.verbose ?? false,
  };
}
