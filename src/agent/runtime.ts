/**
 * Agent Runtime Coordinator.
 *
 * Orchestrates the game loop: presenting state to agents, collecting orders,
 * managing press, and handling phase transitions.
 */

import type { Power, GameState, Order, Season, Phase } from '../engine/types';
import { POWERS } from '../engine/types';
import {
  createInitialState,
  submitOrders,
  resolveMovement,
  submitRetreats,
  resolveRetreats,
  submitBuilds,
  resolveBuilds,
  cloneState,
} from '../engine/game';

import { PressSystem } from '../press/press-system';
import { AgentPressAPI, createAgentAPIs } from '../press/agent-api';

import type {
  AgentRuntimeConfig,
  AgentTurnResult,
  RuntimeStatus,
  LLMProvider,
} from './types';
import { DEFAULT_RUNTIME_CONFIG } from './types';

import { AgentSessionManager } from './session';
import { InMemoryStore, MemoryStore, updateMemoryTimestamp } from './memory';
import { buildSystemPrompt, buildTurnPrompt } from './prompts';
import { createAgentGameView, createStrategicSummary } from './game-view';
import { parseAgentResponse, validateOrders, fillDefaultOrders } from './order-parser';

/**
 * Event types emitted by the runtime.
 */
export type RuntimeEventType =
  | 'game_started'
  | 'phase_started'
  | 'agent_turn_started'
  | 'agent_turn_completed'
  | 'orders_submitted'
  | 'phase_resolved'
  | 'game_ended';

/**
 * Event data for runtime events.
 */
export interface RuntimeEvent {
  type: RuntimeEventType;
  timestamp: Date;
  data: {
    year?: number;
    season?: Season;
    phase?: Phase;
    power?: Power;
    orders?: Order[];
    winner?: Power;
    draw?: boolean;
    durationMs?: number;
  };
}

/**
 * Callback for runtime events.
 */
export type RuntimeEventCallback = (event: RuntimeEvent) => void;

/**
 * The main agent runtime that coordinates AI players.
 */
export class AgentRuntime {
  private config: AgentRuntimeConfig;
  private sessionManager: AgentSessionManager;
  private pressSystem: PressSystem;
  private pressAPIs: Map<Power, AgentPressAPI>;
  private gameState: GameState;
  private eventCallbacks: RuntimeEventCallback[] = [];
  private isRunning: boolean = false;
  private turnNumber: number = 0;

  constructor(
    config: AgentRuntimeConfig,
    llmProvider: LLMProvider,
    memoryStore?: MemoryStore
  ) {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config } as AgentRuntimeConfig;

    // Initialize memory store
    const store = memoryStore ?? new InMemoryStore();

    // Initialize session manager
    this.sessionManager = new AgentSessionManager(
      this.config.gameId,
      store,
      llmProvider
    );

    // Initialize game state
    this.gameState = createInitialState();

    // Initialize press system
    this.pressSystem = new PressSystem({
      gameId: this.config.gameId,
      year: this.gameState.year,
      season: this.gameState.season,
      phase: this.gameState.phase,
    });

    // Create press APIs for all powers
    this.pressAPIs = createAgentAPIs(this.pressSystem);
  }

  /**
   * Initialize all agent sessions.
   */
  async initialize(): Promise<void> {
    // Create sessions for all configured agents
    const agentConfigs: Partial<Record<Power, any>> = {};
    for (const agentConfig of this.config.agents) {
      agentConfigs[agentConfig.power] = agentConfig;
    }

    await this.sessionManager.createAllSessions(agentConfigs);

    // Initialize system prompts for each agent
    for (const power of POWERS) {
      const session = this.sessionManager.getSession(power);
      if (session) {
        const systemPrompt = buildSystemPrompt(
          power,
          session.config.personality!
        );
        this.sessionManager.addMessage(power, {
          role: 'system',
          content: systemPrompt,
        });
      }
    }

    this.emitEvent({
      type: 'game_started',
      timestamp: new Date(),
      data: {
        year: this.gameState.year,
        season: this.gameState.season,
        phase: this.gameState.phase,
      },
    });
  }

  /**
   * Run the complete game loop until victory or draw.
   */
  async runGame(): Promise<{ winner?: Power; draw?: boolean }> {
    this.isRunning = true;

    while (this.isRunning && !this.gameState.winner && !this.gameState.draw) {
      await this.runPhase();
      // Throttle game loop to prevent memory exhaustion with fast LLM providers
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.isRunning = false;

    this.emitEvent({
      type: 'game_ended',
      timestamp: new Date(),
      data: {
        winner: this.gameState.winner,
        draw: this.gameState.draw,
      },
    });

    // Save all memories
    await this.sessionManager.saveAllMemories();

    return {
      winner: this.gameState.winner,
      draw: this.gameState.draw,
    };
  }

  /**
   * Run a single phase of the game.
   */
  async runPhase(): Promise<void> {
    this.emitEvent({
      type: 'phase_started',
      timestamp: new Date(),
      data: {
        year: this.gameState.year,
        season: this.gameState.season,
        phase: this.gameState.phase,
      },
    });

    // Update press context
    this.pressSystem.updateContext({
      gameId: this.config.gameId,
      year: this.gameState.year,
      season: this.gameState.season,
      phase: this.gameState.phase,
    });

    switch (this.gameState.phase) {
      case 'DIPLOMACY':
        await this.runDiplomacyPhase();
        break;
      case 'MOVEMENT':
        await this.runMovementPhase();
        break;
      case 'RETREAT':
        await this.runRetreatPhase();
        break;
      case 'BUILD':
        await this.runBuildPhase();
        break;
    }

    this.emitEvent({
      type: 'phase_resolved',
      timestamp: new Date(),
      data: {
        year: this.gameState.year,
        season: this.gameState.season,
        phase: this.gameState.phase,
      },
    });
  }

  /**
   * Run the diplomacy phase (communication only).
   */
  private async runDiplomacyPhase(): Promise<void> {
    // Get agent responses for diplomacy
    const agentTurns = await this.runAgentTurns('diplomacy');

    // Process diplomatic messages
    for (const [power, result] of agentTurns) {
      if (result.diplomaticMessages) {
        const api = this.pressAPIs.get(power)!;
        for (const action of result.diplomaticMessages) {
          if (action.type === 'SEND_MESSAGE') {
            for (const target of action.targetPowers) {
              api.sendTo(target, action.content);
            }
          }
        }
      }
    }

    // Transition to movement phase
    this.gameState.phase = 'MOVEMENT';
  }

  /**
   * Run the movement phase (order submission and resolution).
   */
  private async runMovementPhase(): Promise<void> {
    // Get orders from all agents
    const agentTurns = await this.runAgentTurns('movement');

    // Submit orders for each power
    for (const [power, result] of agentTurns) {
      const orders = fillDefaultOrders(result.orders, this.gameState, power);
      submitOrders(this.gameState, power, orders);

      this.emitEvent({
        type: 'orders_submitted',
        timestamp: new Date(),
        data: {
          power,
          orders,
        },
      });
    }

    // Resolve movement
    resolveMovement(this.gameState);

    // Update agent memories with results
    for (const power of POWERS) {
      const session = this.sessionManager.getSession(power);
      if (session) {
        updateMemoryTimestamp(
          session.memory,
          this.gameState.year,
          this.gameState.season,
          this.gameState.phase
        );
      }
    }

    this.turnNumber++;
  }

  /**
   * Run the retreat phase.
   */
  private async runRetreatPhase(): Promise<void> {
    // Only agents with pending retreats need to act
    const powersWithRetreats = new Set(
      this.gameState.pendingRetreats.map(u => u.power)
    );

    const agentTurns = await this.runAgentTurns('retreat', powersWithRetreats);

    // Submit retreat orders
    for (const [power, result] of agentTurns) {
      if (result.retreatOrders && result.retreatOrders.length > 0) {
        submitRetreats(this.gameState, power, result.retreatOrders);
      }
    }

    // Resolve retreats
    resolveRetreats(this.gameState);
  }

  /**
   * Run the build phase.
   */
  private async runBuildPhase(): Promise<void> {
    // Only agents with pending builds/disbands need to act
    const powersWithBuilds = new Set(
      Array.from(this.gameState.pendingBuilds.entries())
        .filter(([, count]) => count !== 0)
        .map(([power]) => power)
    );

    const agentTurns = await this.runAgentTurns('build', powersWithBuilds);

    // Submit build orders
    for (const [power, result] of agentTurns) {
      if (result.buildOrders && result.buildOrders.length > 0) {
        submitBuilds(this.gameState, power, result.buildOrders);
      }
    }

    // Resolve builds
    resolveBuilds(this.gameState);
  }

  /**
   * Run agent turns for a phase.
   */
  private async runAgentTurns(
    turnType: 'diplomacy' | 'movement' | 'retreat' | 'build',
    activePowers?: Set<Power>
  ): Promise<Map<Power, AgentTurnResult>> {
    const results = new Map<Power, AgentTurnResult>();
    const powersToAct = activePowers ?? new Set(POWERS);

    if (this.config.parallelExecution) {
      // Run all agents in parallel
      const promises = Array.from(powersToAct).map(async power => {
        const result = await this.runSingleAgentTurn(power, turnType);
        return [power, result] as const;
      });

      const completed = await Promise.all(promises);
      for (const [power, result] of completed) {
        results.set(power, result);
      }
    } else {
      // Run agents sequentially
      for (const power of powersToAct) {
        const result = await this.runSingleAgentTurn(power, turnType);
        results.set(power, result);
      }
    }

    return results;
  }

  /**
   * Run a single agent's turn.
   */
  private async runSingleAgentTurn(
    power: Power,
    _turnType: 'diplomacy' | 'movement' | 'retreat' | 'build'
  ): Promise<AgentTurnResult> {
    const session = this.sessionManager.getSession(power);
    if (!session) {
      throw new Error(`No session for ${power}`);
    }

    this.emitEvent({
      type: 'agent_turn_started',
      timestamp: new Date(),
      data: { power },
    });

    // Build the game view for this agent
    const gameView = createAgentGameView(this.gameState, power);

    // Get recent messages from press
    const pressAPI = this.pressAPIs.get(power)!;
    const inbox = pressAPI.getInbox();
    const recentMessages = inbox.recentMessages.map((m: { sender: string; content: string }) =>
      `[${m.sender}]: ${m.content}`
    );

    // Build the turn prompt
    const turnPrompt = buildTurnPrompt(
      gameView,
      session.memory,
      recentMessages,
      this.gameState.phase
    );

    // Add strategic summary
    const strategicSummary = createStrategicSummary(this.gameState, power);
    const fullPrompt = `${strategicSummary}\n\n${turnPrompt}`;

    // Add user message to conversation
    this.sessionManager.addMessage(power, {
      role: 'user',
      content: fullPrompt,
    });

    // Call the LLM
    const llm = this.sessionManager.getLLMProvider();
    console.log(`[${power}] Calling LLM (${session.conversationHistory.length} messages, ~${fullPrompt.length} chars)...`);
    const startTime = Date.now();
    let response;
    try {
      response = await llm.complete({
        messages: session.conversationHistory,
        model: session.config.model,
        temperature: session.config.temperature,
        maxTokens: session.config.maxTokens,
      });
      console.log(`[${power}] LLM responded in ${((Date.now() - startTime) / 1000).toFixed(1)}s (${response.content.length} chars)`);
    } catch (error) {
      console.error(`[${power}] LLM error:`, error);
      throw error;
    }

    // Add assistant response to conversation
    this.sessionManager.addMessage(power, {
      role: 'assistant',
      content: response.content,
    });

    // Parse the response
    const parsed = parseAgentResponse(response.content);

    // Validate orders
    const { valid, errors } = validateOrders(
      parsed.orders,
      this.gameState,
      power
    );

    if (errors.length > 0 && this.config.verbose) {
      console.warn(`[${power}] Order validation errors:`, errors);
    }

    const result: AgentTurnResult = {
      power,
      orders: valid,
      retreatOrders: parsed.retreatOrders,
      buildOrders: parsed.buildOrders,
      diplomaticMessages: parsed.diplomaticMessages,
      reasoning: response.content,
    };

    const durationMs = Date.now() - startTime;
    this.emitEvent({
      type: 'agent_turn_completed',
      timestamp: new Date(),
      data: {
        power,
        orders: valid,
        durationMs,
      },
    });

    return result;
  }

  /**
   * Register an event callback.
   */
  onEvent(callback: RuntimeEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all registered callbacks.
   */
  private emitEvent(event: RuntimeEvent): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in event callback:', error);
      }
    }
  }

  /**
   * Stop the game loop.
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Get current runtime status.
   */
  getStatus(): RuntimeStatus {
    return {
      gameId: this.config.gameId,
      isRunning: this.isRunning,
      currentPhase: this.gameState.phase,
      currentSeason: this.gameState.season,
      currentYear: this.gameState.year,
      activeSessions: this.sessionManager.getAllSessions().map(s => s.id),
      lastUpdate: new Date(),
    };
  }

  /**
   * Get the current game state (clone).
   */
  getGameState(): GameState {
    return cloneState(this.gameState);
  }

  /**
   * Get the press system.
   */
  getPressSystem(): PressSystem {
    return this.pressSystem;
  }

  /**
   * Get the session manager.
   */
  getSessionManager(): AgentSessionManager {
    return this.sessionManager;
  }
}

/**
 * Create a runtime with test configuration.
 */
export function createTestRuntime(
  gameId: string,
  llmProvider: LLMProvider
): AgentRuntime {
  const config: AgentRuntimeConfig = {
    gameId,
    agents: POWERS.map(power => ({ power })),
    parallelExecution: true,
    turnTimeout: 60000,
    persistMemory: false,
    verbose: true,
  };

  return new AgentRuntime(config, llmProvider, new InMemoryStore());
}

/**
 * Quick start function to create and run a game.
 */
export async function runAutonomousGame(
  gameId: string,
  llmProvider: LLMProvider,
  config?: Partial<AgentRuntimeConfig>
): Promise<{ winner?: Power; draw?: boolean }> {
  const fullConfig: AgentRuntimeConfig = {
    gameId,
    agents: POWERS.map(power => ({ power })),
    parallelExecution: true,
    turnTimeout: 120000,
    persistMemory: true,
    verbose: false,
    ...config,
  };

  const runtime = new AgentRuntime(fullConfig, llmProvider);
  await runtime.initialize();
  return runtime.runGame();
}
