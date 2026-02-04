#!/usr/bin/env npx tsx
/**
 * Run a full Diplomacy game simulation with AI agents.
 *
 * Usage:
 *   npx tsx scripts/run-game.ts              # Run with real AI (Claude)
 *   npx tsx scripts/run-game.ts --mock       # Run with mock AI
 *   npx tsx scripts/run-game.ts --ollama     # Run with Ollama (local models)
 *   npx tsx scripts/run-game.ts --model qwen2.5:7b  # Specify Ollama model
 *   npx tsx scripts/run-game.ts --turns 10   # Limit to 10 turns
 *   npx tsx scripts/run-game.ts --output game.json  # Save game state
 *
 * Requires ANTHROPIC_API_KEY environment variable (unless --mock or --ollama).
 */

import * as fs from 'fs';
import { AgentRuntime, type RuntimeEvent } from '../src/agent/runtime';
import type { LLMProvider, LLMCompletionParams, LLMCompletionResult, AgentRuntimeConfig } from '../src/agent/types';
import { POWERS, type Power, type GameState } from '../src/engine/types';

/**
 * Claude LLM Provider implementation.
 */
class ClaudeLLMProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
    const model = params.model || 'claude-sonnet-4-20250514';
    const maxTokens = params.maxTokens || 4096;
    const temperature = params.temperature ?? 0.7;

    // Convert messages to Anthropic format
    const systemMessage = params.messages.find(m => m.role === 'system');
    const otherMessages = params.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const body = {
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemMessage?.content || '',
      messages: otherMessages,
    };

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const result = await response.json();
    const content = result.content?.[0]?.text || '';

    return {
      content,
      usage: {
        inputTokens: result.usage?.input_tokens || 0,
        outputTokens: result.usage?.output_tokens || 0,
      },
      stopReason: result.stop_reason === 'end_turn' ? 'end_turn' : 'max_tokens',
    };
  }
}

/**
 * Simple mock LLM for testing without API calls.
 */
class MockLLMProvider implements LLMProvider {
  private turnCount = 0;

  async complete(_params: LLMCompletionParams): Promise<LLMCompletionResult> {
    this.turnCount++;

    // Generate simple HOLD orders for testing
    const content = `
REASONING: This is turn ${this.turnCount}. I'll hold my positions for now.

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
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * OpenAI-compatible LLM Provider.
 * Works with OpenAI, Ollama, and other compatible APIs.
 * Includes exponential backoff for rate limits.
 */
class OpenAICompatibleProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string | null;
  private maxRetries: number;
  private baseDelay: number;

  constructor(baseUrl: string, model: string, apiKey: string | null = null, maxRetries = 5, baseDelay = 5000) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.apiKey = apiKey;
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
  }

  async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
    const maxTokens = params.maxTokens || 2048;
    const temperature = params.temperature ?? 0.7;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body = JSON.stringify({
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: params.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    });

    // Retry loop with exponential backoff for rate limits and network errors
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body,
        });
      } catch (networkError) {
        // Handle network errors (ECONNRESET, timeout, etc.)
        if (attempt === this.maxRetries) {
          throw new Error(`Network error after ${this.maxRetries} retries: ${networkError}`);
        }
        const waitTime = this.baseDelay * Math.pow(2, attempt);
        console.log(`  ⏳ Network error. Waiting ${Math.round(waitTime / 1000)}s before retry ${attempt + 1}/${this.maxRetries}...`);
        await sleep(waitTime);
        continue;
      }

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const finishReason = data.choices?.[0]?.finish_reason;

        return {
          content,
          usage: {
            inputTokens: data.usage?.prompt_tokens || 0,
            outputTokens: data.usage?.completion_tokens || 0,
          },
          stopReason: finishReason === 'stop' ? 'end_turn' : 'max_tokens',
        };
      }

      // Handle rate limits (429) and server errors (5xx) with exponential backoff
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        if (attempt === this.maxRetries) {
          const error = await response.text();
          const errorType = response.status === 429 ? 'Rate limit' : 'Server error';
          throw new Error(`${errorType} (${response.status}) after ${this.maxRetries} retries: ${error}`);
        }

        // Parse retry-after header or use exponential backoff
        const retryAfter = response.headers.get('retry-after');
        let waitTime: number;
        if (retryAfter) {
          waitTime = parseInt(retryAfter, 10) * 1000;
        } else {
          // Exponential backoff: 5s, 10s, 20s, 40s, 80s
          waitTime = this.baseDelay * Math.pow(2, attempt);
        }

        const errorType = response.status === 429 ? 'Rate limited' : `Server error (${response.status})`;
        console.log(`  ⏳ ${errorType}. Waiting ${Math.round(waitTime / 1000)}s before retry ${attempt + 1}/${this.maxRetries}...`);
        await sleep(waitTime);
        continue;
      }

      // Other errors (4xx except 429) are not retried
      const error = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${error}`);
    }

    throw new Error('Unexpected end of retry loop');
  }
}

/**
 * Ollama LLM Provider for local open-source models.
 */
class OllamaLLMProvider extends OpenAICompatibleProvider {
  constructor(model: string, baseUrl = 'http://localhost:11434') {
    super(baseUrl, model, null);
  }
}

/**
 * OpenAI LLM Provider with rate limit handling.
 */
class OpenAILLMProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, model = 'gpt-4o-mini') {
    // Use longer delays for OpenAI rate limits (15s base, up to 8 retries)
    // This handles the 200k TPM limit more gracefully
    super('https://api.openai.com', model, apiKey, 8, 15000);
  }
}

function parseArgs(): {
  useMock: boolean;
  useOllama: boolean;
  useOpenAI: boolean;
  ollamaModel: string;
  openaiModel: string;
  maxTurns: number;
  maxYears: number;
  outputFile?: string
} {
  const args = process.argv.slice(2);
  let useMock = false;
  let useOllama = false;
  let useOpenAI = false;
  let ollamaModel = 'qwen2.5:7b'; // Default to best-performing model
  let openaiModel = 'gpt-4o-mini';
  let maxTurns = 0; // 0 means unlimited
  let maxYears = 0; // 0 means unlimited
  let outputFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mock') useMock = true;
    if (args[i] === '--ollama') useOllama = true;
    if (args[i] === '--openai') useOpenAI = true;
    if (args[i] === '--model' && args[i + 1]) {
      ollamaModel = args[i + 1];
      openaiModel = args[i + 1];
      i++;
    }
    if (args[i] === '--turns' && args[i + 1]) {
      maxTurns = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === '--years' && args[i + 1]) {
      maxYears = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    }
  }

  return { useMock, useOllama, useOpenAI, ollamaModel, openaiModel, maxTurns, maxYears, outputFile };
}

// Game state snapshots for export
interface GameSnapshot {
  year: number;
  season: string;
  phase: string;
  units: { power: string; type: string; province: string }[];
  supplyCenters: Record<string, string>;
  orders: { power: string; order: string }[];
  messages: { from: string; to: string[]; content: string; timestamp: string }[];
}

async function main() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const { useMock, useOllama, useOpenAI, ollamaModel, openaiModel, maxTurns, maxYears, outputFile } = parseArgs();

  if (!anthropicKey && !openaiKey && !useMock && !useOllama && !useOpenAI) {
    console.error('Error: API key required.');
    console.error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or use --mock/--ollama.');
    console.error('\nOptions:');
    console.error('  --mock          Run with mock AI (for testing)');
    console.error('  --ollama        Use local Ollama models');
    console.error('  --openai        Use OpenAI API (requires OPENAI_API_KEY)');
    console.error('  --model NAME    Specify model name');
    console.error('  --turns N       Limit to N turns (phases)');
    console.error('  --years N       Limit to N game years');
    console.error('  --output FILE   Save game state to JSON file');
    process.exit(1);
  }

  if (useOpenAI && !openaiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is required for --openai.');
    process.exit(1);
  }

  console.log('🎯 Agents of Treachery - Game Simulation');
  console.log('========================================\n');

  let llmProvider: LLMProvider;
  let modelName: string;

  if (useMock) {
    llmProvider = new MockLLMProvider();
    modelName = 'mock';
    console.log('⚠️  Running in MOCK mode (no real AI calls)\n');
  } else if (useOpenAI) {
    llmProvider = new OpenAILLMProvider(openaiKey!, openaiModel);
    modelName = openaiModel;
    console.log(`🤖 Running with OpenAI: ${openaiModel}\n`);
  } else if (useOllama) {
    llmProvider = new OllamaLLMProvider(ollamaModel);
    modelName = ollamaModel;
    console.log(`🦙 Running with Ollama model: ${ollamaModel}\n`);
  } else {
    llmProvider = new ClaudeLLMProvider(anthropicKey!);
    modelName = 'claude-sonnet-4-20250514';
    console.log('🤖 Running with Claude AI\n');
  }

  if (maxTurns > 0) {
    console.log(`📊 Limited to ${maxTurns} turns\n`);
  }
  if (maxYears > 0) {
    console.log(`📊 Limited to ${maxYears} game years\n`);
  }

  const gameId = `game-${Date.now()}`;
  const snapshots: GameSnapshot[] = [];

  // Configure agents with varied personalities
  const agentConfigs = POWERS.map((power, i) => ({
    power,
    personality: {
      cooperativeness: 0.3 + (i * 0.1),
      aggression: 0.4 + ((7 - i) * 0.08),
      patience: 0.5,
      trustworthiness: 0.5 + (i % 2) * 0.2,
      paranoia: 0.3 + (i % 3) * 0.15,
      deceptiveness: 0.2 + (i % 4) * 0.1,
    },
    model: modelName,
    temperature: 0.7,
    maxTokens: 2048,
  }));

  // Disable parallel execution for OpenAI to avoid rate limits
  // (7 agents * ~5k tokens = 35k per batch, quickly exhausts 200k/min limit)
  const config: AgentRuntimeConfig = {
    gameId,
    agents: agentConfigs,
    parallelExecution: !useOpenAI,
    turnTimeout: 120000,
    persistMemory: false,
    verbose: true,
  };

  const runtime = new AgentRuntime(config, llmProvider);
  let turnCount = 0;
  let currentOrders: { power: string; order: string }[] = [];

  // Set up event logging
  runtime.onEvent((event: RuntimeEvent) => {
    const ts = event.timestamp.toLocaleTimeString();
    switch (event.type) {
      case 'game_started':
        console.log(`[${ts}] 🎮 Game started: ${event.data.year} ${event.data.season} ${event.data.phase}`);
        break;
      case 'phase_started':
        console.log(`\n[${ts}] 📍 Phase: ${event.data.year} ${event.data.season} ${event.data.phase}`);
        currentOrders = [];
        break;
      case 'agent_turn_started':
        console.log(`[${ts}]   🤖 ${event.data.power} thinking...`);
        break;
      case 'agent_turn_completed':
        console.log(`[${ts}]   ✓ ${event.data.power} submitted ${event.data.orders?.length || 0} orders`);
        if (event.data.orders && event.data.power) {
          for (const order of event.data.orders) {
            currentOrders.push({
              power: event.data.power,
              order: `${order.unit} ${order.type}${order.target ? ' -> ' + order.target : ''}`,
            });
          }
        }
        break;
      case 'orders_submitted':
        // Already logged above
        break;
      case 'phase_resolved': {
        console.log(`[${ts}] ✅ Phase resolved`);
        turnCount++;

        // Capture snapshot
        const state = runtime.getGameState();
        const snapshot: GameSnapshot = {
          year: state.year,
          season: state.season,
          phase: state.phase,
          units: state.units.map(u => ({ power: u.power, type: u.type, province: u.province })),
          supplyCenters: Object.fromEntries(state.supplyCenters),
          orders: [...currentOrders],
          messages: [], // TODO: capture press messages
        };
        snapshots.push(snapshot);

        // Check turn limit
        if (maxTurns > 0 && turnCount >= maxTurns) {
          console.log(`\n[${ts}] ⏱️  Turn limit reached (${maxTurns} turns)`);
          runtime.stop();
        }
        // Check year limit (game starts in 1901)
        if (maxYears > 0 && state.year >= 1901 + maxYears) {
          console.log(`\n[${ts}] ⏱️  Year limit reached (year ${state.year}, limit ${maxYears} years from 1901)`);
          runtime.stop();
        }
        break;
      }
      case 'game_ended':
        if (event.data.winner) {
          console.log(`\n[${ts}] 🏆 WINNER: ${event.data.winner}!`);
        } else if (event.data.draw) {
          console.log(`\n[${ts}] 🤝 Game ended in DRAW`);
        }
        break;
    }
  });

  console.log(`Starting game: ${gameId}`);
  console.log(`Powers: ${POWERS.join(', ')}\n`);

  try {
    await runtime.initialize();
    const result = await runtime.runGame();

    console.log('\n========================================');
    console.log('Game Complete!');
    if (result.winner) {
      console.log(`Winner: ${result.winner}`);
    } else {
      console.log('Result: Draw');
    }

    // Print final state
    const finalState = runtime.getGameState();
    console.log(`\nFinal Year: ${finalState.year} ${finalState.season}`);
    console.log('\nSupply Center Counts:');
    const scCounts = new Map<Power, number>();
    for (const [, owner] of finalState.supplyCenters) {
      if (owner) {
        scCounts.set(owner, (scCounts.get(owner) || 0) + 1);
      }
    }
    for (const [power, count] of Array.from(scCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${power}: ${count} SCs`);
    }

    // Save output if requested
    if (outputFile) {
      const output = {
        gameId,
        startedAt: new Date().toISOString(),
        result: result.winner ? { winner: result.winner } : { draw: true },
        finalState: {
          year: finalState.year,
          season: finalState.season,
          supplyCenters: Object.fromEntries(finalState.supplyCenters),
          units: finalState.units.map(u => ({ power: u.power, type: u.type, province: u.province })),
        },
        snapshots,
        turnCount,
      };
      fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
      console.log(`\n📁 Game saved to: ${outputFile}`);
    }

  } catch (error) {
    console.error('Game error:', error);
    process.exit(1);
  }
}

main();
