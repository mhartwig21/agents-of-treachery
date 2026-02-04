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
} from '../src/experiment';
import { POWERS } from '../src/engine/types';

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
  --config FILE      Load experiment config from JSON file
  --mock             Use mock LLM (for testing)
  --ollama           Use Ollama for local models
  --model NAME       Model to use (default: claude-sonnet-4-20250514)
  --games N          Number of games to run (default: 1)
  --concurrent N     Max concurrent games (default: 1)
  --turns N          Max turns per game (0 = unlimited, default: 50)
  --name NAME        Experiment name
  --output DIR       Output directory
  --verbose          Enable verbose logging
  --no-analysis      Skip post-game analysis
  --help, -h         Show this help message

Examples:
  # Run 3 mock games for testing
  npx tsx scripts/run-experiment.ts --mock --games 3

  # Run 5 games with Claude, max 2 concurrent
  npx tsx scripts/run-experiment.ts --games 5 --concurrent 2

  # Run with Ollama local model
  npx tsx scripts/run-experiment.ts --ollama --model llama3.2 --games 2

  # Load config from file
  npx tsx scripts/run-experiment.ts --config my-experiment.json

Environment Variables:
  ANTHROPIC_API_KEY    Required for Claude models
  OPENAI_API_KEY       Required for OpenAI models
  OPENROUTER_API_KEY   Required for OpenRouter
  OLLAMA_BASE_URL      Ollama server URL (default: http://localhost:11434)
`);
}

async function loadConfigFromFile(filePath: string): Promise<ExperimentConfig> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

function createConfigFromArgs(args: CliArgs): ExperimentConfig {
  const experimentId = args.name.replace(/\s+/g, '-').toLowerCase();

  // Create model config
  let modelConfig: ModelConfig;
  if (args.useMock) {
    modelConfig = {
      id: 'mock',
      provider: 'mock',
      model: 'mock',
    };
  } else if (args.useOllama) {
    modelConfig = {
      id: 'ollama',
      provider: 'ollama',
      model: args.model,
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    };
  } else {
    // Default to Claude
    modelConfig = {
      id: 'claude',
      provider: 'anthropic',
      model: args.model,
    };
  }

  return createExperimentConfig({
    experimentId,
    name: args.name,
    description: `Experiment with ${args.gameCount} games using ${modelConfig.model}`,
    models: [modelConfig],
    gameCount: args.gameCount,
    maxConcurrent: args.maxConcurrent,
    maxTurnsPerGame: args.maxTurns,
    defaultModelConfigId: modelConfig.id,
    runAnalysis: args.runAnalysis,
    outputDir: args.outputDir || path.join(process.cwd(), 'experiments', experimentId),
    verbose: args.verbose,
    phaseDelayMs: args.useMock ? 10 : 100,
  });
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Validate API key if not using mock or ollama
  if (!args.useMock && !args.useOllama && !process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required.');
    console.error('Set it with: export ANTHROPIC_API_KEY=your-key');
    console.error('Or use --mock for testing without API calls.');
    console.error('Or use --ollama for local Ollama models.');
    process.exit(1);
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
  console.log(`Models: ${config.models.map(m => m.model).join(', ')}`);
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
