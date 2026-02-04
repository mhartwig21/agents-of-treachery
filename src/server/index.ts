/**
 * Game Server Entry Point.
 *
 * Starts the WebSocket game server for live AI Diplomacy games.
 *
 * Usage:
 *   npx tsx src/server/index.ts
 *
 * Environment variables:
 *   PORT - WebSocket server port (default: 3001)
 *   LLM_PROVIDER - Which LLM to use:
 *     - "openrouter" - OpenRouter API (access to Claude, GPT-4, Llama, etc.)
 *     - "anthropic" or "claude" - Anthropic Claude API (default)
 *     - "openai" or "chatgpt" - OpenAI ChatGPT API
 *     - "ollama" - Local Ollama server (free, open-source models)
 *     - "custom" or "local" - Any OpenAI-compatible API
 *     - "mock" - Mock responses for testing
 *
 *   OPENROUTER_API_KEY - API key for OpenRouter (required if LLM_PROVIDER=openrouter)
 *   ANTHROPIC_API_KEY - API key for Claude (required if LLM_PROVIDER=anthropic)
 *   OPENAI_API_KEY - API key for OpenAI (required if LLM_PROVIDER=openai)
 *
 *   OLLAMA_BASE_URL - Ollama server URL (default: http://localhost:11434)
 *   OLLAMA_MODEL - Ollama model to use (default: llama3.2)
 *
 *   LLM_BASE_URL - Custom OpenAI-compatible server URL (for LLM_PROVIDER=custom)
 *   LLM_MODEL - Model name for custom provider
 *
 *   USE_MOCK_LLM - Legacy: Set to "true" for mock (use LLM_PROVIDER=mock instead)
 *
 * OpenRouter Models (examples):
 *   - anthropic/claude-3.5-sonnet
 *   - anthropic/claude-3-opus
 *   - openai/gpt-4o
 *   - openai/gpt-4o-mini
 *   - meta-llama/llama-3.1-70b-instruct
 *   - mistralai/mistral-large
 *   See https://openrouter.ai/models for full list
 */

import { GameServer, createMockLLMProvider } from './game-server';
import type { LLMProvider } from '../agent/types';
import {
  createOpenRouterProvider,
  createAnthropicProvider,
  createOpenAIProvider,
  createOllamaProvider,
  createOpenAICompatibleProvider,
  createUsageTrackingProvider,
} from './providers';

const PORT = parseInt(process.env.PORT || '3001', 10);
const USE_MOCK = process.env.USE_MOCK_LLM === 'true';
const LLM_PROVIDER = process.env.LLM_PROVIDER || (USE_MOCK ? 'mock' : 'anthropic');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const LLM_BASE_URL = process.env.LLM_BASE_URL; // For custom OpenAI-compatible servers
const LLM_MODEL = process.env.LLM_MODEL;
const TRACK_USAGE = process.env.TRACK_USAGE === 'true';

// Provider factory functions are imported from ./providers.ts

/**
 * Main entry point.
 */
async function main() {
  console.log('Starting Agents of Treachery Game Server...');
  console.log(`Port: ${PORT}`);
  console.log(`LLM Provider: ${LLM_PROVIDER}`);

  // Create LLM provider based on configuration
  let llmProvider: LLMProvider;

  switch (LLM_PROVIDER.toLowerCase()) {
    case 'mock':
      console.log('Using mock LLM provider for testing');
      llmProvider = createMockLLMProvider();
      break;

    case 'openrouter':
      if (!OPENROUTER_API_KEY) {
        console.error('Error: OPENROUTER_API_KEY environment variable is required');
        console.error('Get your API key at https://openrouter.ai/keys');
        console.error('Set LLM_PROVIDER=mock to use mock LLM for testing');
        process.exit(1);
      }
      console.log('Using OpenRouter API (multi-model access)');
      console.log(`  Model: ${LLM_MODEL || 'anthropic/claude-3-haiku'}`);
      llmProvider = createOpenRouterProvider(
        OPENROUTER_API_KEY,
        LLM_MODEL || 'anthropic/claude-3-haiku'
      );
      break;

    case 'openai':
    case 'chatgpt':
      if (!OPENAI_API_KEY) {
        console.error('Error: OPENAI_API_KEY environment variable is required');
        console.error('Set LLM_PROVIDER=mock to use mock LLM for testing');
        process.exit(1);
      }
      console.log('Using OpenAI ChatGPT API');
      console.log(`  Model: ${LLM_MODEL || 'gpt-4o-mini'}`);
      llmProvider = createOpenAIProvider(OPENAI_API_KEY, LLM_MODEL || 'gpt-4o-mini');
      break;

    case 'ollama':
      console.log('Using Ollama (local open-source models)');
      llmProvider = createOllamaProvider(OLLAMA_BASE_URL, OLLAMA_MODEL);
      break;

    case 'custom':
    case 'local':
      if (!LLM_BASE_URL) {
        console.error('Error: LLM_BASE_URL environment variable is required for custom provider');
        console.error('Example: LLM_BASE_URL=http://localhost:8080 LLM_MODEL=mistral');
        process.exit(1);
      }
      console.log('Using custom OpenAI-compatible API');
      console.log(`  URL: ${LLM_BASE_URL}`);
      console.log(`  Model: ${LLM_MODEL || 'default'}`);
      llmProvider = createOpenAICompatibleProvider(LLM_BASE_URL, null, LLM_MODEL || 'default');
      break;

    case 'anthropic':
    case 'claude':
    default:
      if (!ANTHROPIC_API_KEY) {
        console.error('Error: ANTHROPIC_API_KEY environment variable is required');
        console.error('Set LLM_PROVIDER=mock to use mock LLM for testing');
        console.error('Or set LLM_PROVIDER=openrouter with OPENROUTER_API_KEY for multi-model access');
        console.error('Or set LLM_PROVIDER=openai with OPENAI_API_KEY');
        console.error('Or set LLM_PROVIDER=ollama to use local Ollama models');
        process.exit(1);
      }
      console.log('Using Anthropic Claude API');
      console.log(`  Model: ${LLM_MODEL || 'claude-3-haiku-20240307'}`);
      llmProvider = createAnthropicProvider(ANTHROPIC_API_KEY, LLM_MODEL);
      break;
  }

  // Optionally wrap with usage tracking
  if (TRACK_USAGE) {
    console.log('Token usage tracking enabled');
    const trackingProvider = createUsageTrackingProvider(llmProvider, (model, input, output) => {
      console.log(`[Usage] ${model}: ${input} input, ${output} output tokens`);
    });
    llmProvider = trackingProvider;

    // Log stats on shutdown
    process.on('SIGINT', () => {
      console.log('\n=== Token Usage Statistics ===');
      for (const [model, stats] of trackingProvider.getStats()) {
        console.log(`${model}:`);
        console.log(`  Total: ${stats.totalInputTokens} input, ${stats.totalOutputTokens} output`);
        console.log(`  Requests: ${stats.requestCount}`);
        console.log(`  Average: ${stats.averageInputTokens.toFixed(0)} input, ${stats.averageOutputTokens.toFixed(0)} output per request`);
      }
    });
  }

  // Create and start server
  const server = new GameServer({
    port: PORT,
    llmProvider,
  });

  server.start(PORT);

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down server...');
    server.stop();
    process.exit(0);
  });

  console.log(`\nGame server ready at ws://localhost:${PORT}`);
  console.log('Connect the spectator UI with enableLiveConnection={true}');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
