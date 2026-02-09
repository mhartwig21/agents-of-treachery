#!/usr/bin/env npx tsx
/**
 * Run batch game simulations with different model configurations.
 *
 * Usage:
 *   npx tsx scripts/run-experiment.ts --config experiment.json
 *   npx tsx scripts/run-experiment.ts --mock --games 3 --name "Test Experiment"
 *   npx tsx scripts/run-experiment.ts --model claude-sonnet-4-20250514 --games 5
 *   npx tsx scripts/run-experiment.ts --ollama --model qwen2.5:7b --games 2
 *
 * Options:
 *   --config FILE      Load experiment config from JSON file
 *   --mock             Use mock LLM (for testing)
 *   --ollama           Use Ollama for local models
 *   --model NAME       Model to use (default: claude-sonnet-4-20250514)
 *   --games N          Number of games to run (default: 1)
 *   --concurrent N     Max concurrent games (default: 1)
 *   --turns N          Max turns per game (0 = unlimited, default: 50)
 *   --name NAME        Experiment name
 *   --output DIR       Output directory
 *   --verbose          Enable verbose logging
 *   --no-analysis      Skip post-game analysis
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ExperimentRunner,
  createExperimentConfig,
  type ExperimentConfig,
  type ModelConfig,
  type ExperimentEvent,
  type PowerModelAssignment,
  parseModelConfigFromSpec,
} from '../src/experiment';
import { POWERS, type Power } from '../src/engine/types';

interface CliArgs {
  configFile?: string;
  useMock: boolean;
  useOllama: boolean;
  model: string;
  gameCount: number;
  maxConcurrent: number;
  maxTurns: number;
  name: string;
  outputDir?: string;
  verbose: boolean;
  runAnalysis: boolean;
  /** Per-power model assignments: POWER=model_spec */
  powerAssignments: string[];
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    useMock: false,
    useOllama: false,
    model: 'claude-sonnet-4-20250514',
    gameCount: 1,
    maxConcurrent: 1,
    maxTurns: 50,
    name: `experiment-${Date.now()}`,
    verbose: false,
    runAnalysis: true,
    powerAssignments: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--config':
        result.configFile = args[++i];
        break;
      case '--mock':
        result.useMock = true;
        break;
      case '--ollama':
        result.useOllama = true;
        break;
      case '--model':
        result.model = args[++i];
        break;
      case '--games':
        result.gameCount = parseInt(args[++i], 10);
        break;
      case '--concurrent':
        result.maxConcurrent = parseInt(args[++i], 10);
        break;
      case '--turns':
        result.maxTurns = parseInt(args[++i], 10);
        break;
      case '--name':
        result.name = args[++i];
        break;
      case '--output':
        result.outputDir = args[++i];
        break;
      case '--verbose':
        result.verbose = true;
        break;
      case '--no-analysis':
        result.runAnalysis = false;
        break;
      case '--assign':
        result.powerAssignments.push(args[++i]);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
Run batch game simulations with different model configurations.

Usage:
  npx tsx scripts/run-experiment.ts [options]

Options:
  --config FILE            Load experiment config from JSON file
  --mock                   Use mock LLM (for testing)
  --ollama                 Use Ollama for local models
  --model SPEC             Model spec for all powers (default: claude-sonnet-4-20250514)
  --assign POWER=SPEC      Assign a model spec to a specific power (repeatable)
  --games N                Number of games to run (default: 1)
  --concurrent N           Max concurrent games (default: 1)
  --turns N                Max turns per game (0 = unlimited, default: 50)
  --name NAME              Experiment name
  --output DIR             Output directory
  --verbose                Enable verbose logging
  --no-analysis            Skip post-game analysis
  --help, -h               Show this help message

Model Spec Format:
  [provider:]model[@base_url][#api_key]

  Providers: openai, anthropic, openrouter, ollama, custom, mock
  Auto-detect: claude-* → anthropic, gpt-*/o1/o3 → openai, org/model → openrouter

Examples:
  # Run 3 mock games for testing
  npx tsx scripts/run-experiment.ts --mock --games 3

  # Run 5 games with Claude, max 2 concurrent
  npx tsx scripts/run-experiment.ts --games 5 --concurrent 2

  # Run with Ollama local model
  npx tsx scripts/run-experiment.ts --model ollama:llama3.2 --games 2

  # Mix cloud and local models in same game
  npx tsx scripts/run-experiment.ts --model openai:gpt-4o \\
    --assign ENGLAND=anthropic:claude-sonnet-4-5-20250929 \\
    --assign FRANCE=openrouter:meta-llama/llama-3.1-70b-instruct

  # Use OpenRouter for all with custom API key
  npx tsx scripts/run-experiment.ts --model "openrouter:openai/gpt-4o#sk-or-xxx"

  # Ollama on remote GPU server
  npx tsx scripts/run-experiment.ts --model "ollama:qwen2.5:7b@http://gpu-server:11434"

  # Load config from file
  npx tsx scripts/run-experiment.ts --config my-experiment.json

Environment Variables:
  ANTHROPIC_API_KEY    Required for Anthropic models (unless in spec)
  OPENAI_API_KEY       Required for OpenAI models (unless in spec)
  OPENROUTER_API_KEY   Required for OpenRouter (unless in spec)
  OLLAMA_BASE_URL      Ollama server URL (default: http://localhost:11434)
`);
}

async function loadConfigFromFile(filePath: string): Promise<ExperimentConfig> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

function createConfigFromArgs(args: CliArgs): ExperimentConfig {
  const experimentId = args.name.replace(/\s+/g, '-').toLowerCase();

  // Create default model config
  let defaultModelConfig: ModelConfig;
  if (args.useMock) {
    defaultModelConfig = {
      id: 'mock',
      provider: 'mock',
      model: 'mock',
    };
  } else if (args.useOllama) {
    // Legacy --ollama flag: wrap in spec format
    defaultModelConfig = parseModelConfigFromSpec(
      `ollama:${args.model}@${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}`,
      'ollama'
    );
  } else {
    // Try parsing as a model spec (supports "openai:gpt-4o", "gpt-4o", etc.)
    try {
      defaultModelConfig = parseModelConfigFromSpec(args.model);
    } catch {
      // Fallback: treat as plain Anthropic model name for backward compat
      defaultModelConfig = {
        id: 'claude',
        provider: 'anthropic',
        model: args.model,
      };
    }
  }

  const models: ModelConfig[] = [defaultModelConfig];

  // Parse per-power assignments
  let powerAssignments: PowerModelAssignment[] | undefined;
  if (args.powerAssignments.length > 0) {
    powerAssignments = [];
    for (const assignment of args.powerAssignments) {
      const eqIdx = assignment.indexOf('=');
      if (eqIdx === -1) {
        console.error(`Invalid --assign format: ${assignment}`);
        console.error('Expected: POWER=model_spec (e.g., ENGLAND=openai:gpt-4o)');
        process.exit(1);
      }

      const powerName = assignment.slice(0, eqIdx).toUpperCase() as Power;
      const spec = assignment.slice(eqIdx + 1);

      if (!POWERS.includes(powerName)) {
        console.error(`Invalid power: ${powerName}`);
        console.error(`Valid powers: ${POWERS.join(', ')}`);
        process.exit(1);
      }

      // Parse and add model config
      const modelConfig = parseModelConfigFromSpec(spec);
      if (!models.find(m => m.id === modelConfig.id)) {
        models.push(modelConfig);
      }

      powerAssignments.push({
        power: powerName,
        modelConfigId: modelConfig.id,
        modelSpec: spec,
      });
    }
  }

  // Build description listing all models
  const modelNames = [...new Set(models.map(m => m.model))];
  const description = powerAssignments
    ? `Mixed-model experiment: ${modelNames.join(', ')}`
    : `Experiment with ${args.gameCount} games using ${defaultModelConfig.model}`;

  // Generate game configs with power assignments
  const games = powerAssignments
    ? Array.from({ length: args.gameCount }, (_, i) => ({
        gameId: `${experimentId}-game-${i + 1}`,
        defaultModelConfigId: defaultModelConfig.id,
        powerAssignments,
      }))
    : undefined;

  return createExperimentConfig({
    experimentId,
    name: args.name,
    description,
    models,
    gameCount: args.gameCount,
    maxConcurrent: args.maxConcurrent,
    maxTurnsPerGame: args.maxTurns,
    defaultModelConfigId: defaultModelConfig.id,
    games,
    runAnalysis: args.runAnalysis,
    outputDir: args.outputDir || path.join(process.cwd(), 'experiments', experimentId),
    verbose: args.verbose,
    phaseDelayMs: args.useMock ? 10 : 100,
  });
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Validate API key if not using mock, ollama, or model spec with embedded key
  if (!args.useMock && !args.useOllama) {
    // Check if the model spec might handle its own auth
    const hasSpecKey = args.model.includes('#');
    const isOllamaSpec = args.model.startsWith('ollama:');
    const isMockSpec = args.model.startsWith('mock:') || args.model === 'mock';
    const isOpenRouterSpec = args.model.startsWith('openrouter:') || args.model.includes('/');
    const isOpenAISpec = args.model.startsWith('openai:') || args.model.startsWith('gpt-') || /^o[134]/.test(args.model);

    if (!hasSpecKey && !isOllamaSpec && !isMockSpec) {
      // Check for the appropriate env var
      if (isOpenRouterSpec && !process.env.OPENROUTER_API_KEY) {
        console.error('Error: OPENROUTER_API_KEY environment variable is required for OpenRouter.');
        console.error('Set it with: export OPENROUTER_API_KEY=your-key');
        console.error('Or embed in spec: openrouter:model#your-key');
        process.exit(1);
      } else if (isOpenAISpec && !process.env.OPENAI_API_KEY) {
        console.error('Error: OPENAI_API_KEY environment variable is required for OpenAI.');
        console.error('Set it with: export OPENAI_API_KEY=your-key');
        console.error('Or embed in spec: openai:model#your-key');
        process.exit(1);
      } else if (!isOpenRouterSpec && !isOpenAISpec && !process.env.ANTHROPIC_API_KEY) {
        console.error('Error: ANTHROPIC_API_KEY environment variable is required.');
        console.error('Set it with: export ANTHROPIC_API_KEY=your-key');
        console.error('Or use --mock for testing without API calls.');
        console.error('Or use model spec format: provider:model#api-key');
        process.exit(1);
      }
    }
  }

  // Load or create config
  let config: ExperimentConfig;
  if (args.configFile) {
    config = await loadConfigFromFile(args.configFile);
    console.log(`Loaded experiment config from: ${args.configFile}`);
  } else {
    config = createConfigFromArgs(args);
  }

  console.log('');
  console.log('═'.repeat(60));
  console.log('🧪 EXPERIMENT RUNNER');
  console.log('═'.repeat(60));
  console.log('');
  console.log(`Experiment: ${config.name}`);
  console.log(`ID: ${config.experimentId}`);
  console.log(`Games: ${config.gameCount}`);
  console.log(`Max Concurrent: ${config.maxConcurrent}`);
  console.log(`Max Turns: ${config.maxTurnsPerGame || 'unlimited'}`);
  console.log(`Output: ${config.outputDir}`);
  console.log(`Models: ${config.models.map(m => `${m.provider}:${m.model}`).join(', ')}`);

  // Show per-power assignments if any
  const firstGame = config.games?.[0];
  if (firstGame?.powerAssignments && firstGame.powerAssignments.length > 0) {
    console.log('');
    console.log('Power Assignments:');
    for (const pa of firstGame.powerAssignments) {
      const spec = pa.modelSpec || pa.modelConfigId;
      console.log(`  ${pa.power}: ${spec}`);
    }
    // Show default for unassigned powers
    const assignedPowers = new Set(firstGame.powerAssignments.map(a => a.power));
    const unassigned = POWERS.filter(p => !assignedPowers.has(p));
    if (unassigned.length > 0) {
      const defaultModel = config.models.find(m => m.id === config.defaultModelConfigId);
      console.log(`  ${unassigned.join(', ')}: ${defaultModel?.provider}:${defaultModel?.model} (default)`);
    }
  }

  console.log('');
  console.log('─'.repeat(60));

  // Create runner
  const runner = new ExperimentRunner(config);

  // Track progress
  let lastProgressLine = '';
  runner.onEvent((event: ExperimentEvent) => {
    const ts = event.timestamp.toLocaleTimeString();

    switch (event.type) {
      case 'experiment_started':
        console.log(`[${ts}] 🚀 Experiment started`);
        break;

      case 'game_started':
        console.log(`[${ts}] 🎮 Game ${event.gameId} started`);
        break;

      case 'game_completed': {
        const result = event.data?.result;
        if (result) {
          const winner = result.winner || (result.draw ? 'DRAW' : 'unknown');
          const duration = (result.durationMs / 1000).toFixed(1);
          console.log(`[${ts}] ✅ Game ${event.gameId} completed: ${winner} (${result.turnCount} turns, ${duration}s)`);
        }
        break;
      }

      case 'game_failed': {
        const result = event.data?.result;
        console.log(`[${ts}] ❌ Game ${event.gameId} failed: ${result?.error || 'unknown error'}`);
        break;
      }

      case 'experiment_completed': {
        const stats = event.data?.stats;
        console.log('');
        console.log('─'.repeat(60));
        console.log(`[${ts}] 🏁 Experiment completed`);
        if (stats) {
          console.log('');
          console.log('RESULTS SUMMARY');
          console.log('─'.repeat(40));
          console.log(`Completed Games: ${stats.completedGames}/${stats.totalGames}`);
          console.log(`Failed Games: ${stats.failedGames}`);
          console.log(`Draws: ${stats.drawCount}`);
          console.log(`Average Duration: ${(stats.averageDurationMs / 1000).toFixed(1)}s`);
          console.log(`Average Turns: ${stats.averageTurns.toFixed(1)}`);
          console.log('');
          console.log('Wins by Power:');
          for (const power of POWERS) {
            const wins = stats.winsByPower[power] || 0;
            if (wins > 0) {
              console.log(`  ${power}: ${wins}`);
            }
          }
          console.log('');
          console.log('Wins by Model:');
          for (const [model, wins] of Object.entries(stats.winsByModel)) {
            console.log(`  ${model}: ${wins}`);
          }
        }
        break;
      }

      case 'experiment_aborted':
        console.log(`[${ts}] ⚠️  Experiment aborted`);
        break;
    }
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n\nAborting experiment...');
    runner.abort();
  });

  try {
    const results = await runner.run();

    console.log('');
    console.log('═'.repeat(60));
    console.log(`Results saved to: ${config.outputDir}`);
    console.log('═'.repeat(60));

    process.exit(results.status === 'completed' ? 0 : 1);
  } catch (error) {
    console.error('Experiment error:', error);
    process.exit(1);
  }
}

main();
