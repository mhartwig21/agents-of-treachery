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
 *     - "anthropic" or "claude" - Anthropic Claude API (default)
 *     - "openai" or "chatgpt" - OpenAI ChatGPT API
 *     - "ollama" - Local Ollama server (free, open-source models)
 *     - "custom" or "local" - Any OpenAI-compatible API
 *     - "mock" - Mock responses for testing
 *
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
 */

import { GameServer, createMockLLMProvider } from './game-server';
import type { LLMProvider } from '../agent/types';

const PORT = parseInt(process.env.PORT || '3001', 10);
const USE_MOCK = process.env.USE_MOCK_LLM === 'true';
const LLM_PROVIDER = process.env.LLM_PROVIDER || (USE_MOCK ? 'mock' : 'anthropic');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const LLM_BASE_URL = process.env.LLM_BASE_URL; // For custom OpenAI-compatible servers
const LLM_MODEL = process.env.LLM_MODEL;

/**
 * Creates an Anthropic LLM provider.
 */
function createAnthropicProvider(apiKey: string): LLMProvider {
  return {
    async complete(params) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: params.model || 'claude-3-haiku-20240307',
          max_tokens: params.maxTokens || 1024,
          temperature: params.temperature ?? 0.7,
          messages: params.messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
              role: m.role,
              content: m.content,
            })),
          system: params.messages.find((m) => m.role === 'system')?.content,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || '';

      return {
        content,
        usage: {
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
        },
        stopReason: data.stop_reason === 'end_turn' ? 'end_turn' : 'max_tokens',
      };
    },
  };
}

/**
 * Creates an OpenAI-compatible LLM provider.
 * Works with OpenAI, Ollama, LM Studio, LocalAI, and other compatible servers.
 */
function createOpenAICompatibleProvider(
  baseUrl: string,
  apiKey: string | null,
  defaultModel: string
): LLMProvider {
  return {
    async complete(params) {
      // Map model names - allow Claude-style names to be passed through
      let model = params.model || defaultModel;
      if (model.startsWith('claude-')) {
        model = defaultModel;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          max_tokens: params.maxTokens || 1024,
          temperature: params.temperature ?? 0.7,
          messages: params.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stop: params.stopSequences,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`LLM API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const finishReason = data.choices?.[0]?.finish_reason;

      return {
        content,
        usage: {
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0,
        },
        stopReason: finishReason === 'stop' ? 'end_turn' :
                    finishReason === 'length' ? 'max_tokens' : 'end_turn',
      };
    },
  };
}

/**
 * Creates an OpenAI LLM provider.
 */
function createOpenAIProvider(apiKey: string): LLMProvider {
  return createOpenAICompatibleProvider('https://api.openai.com', apiKey, 'gpt-4o-mini');
}

/**
 * Creates an Ollama LLM provider for local open-source models.
 * Ollama exposes an OpenAI-compatible API.
 */
function createOllamaProvider(baseUrl: string, model: string): LLMProvider {
  console.log(`  Model: ${model}`);
  console.log(`  URL: ${baseUrl}`);
  return createOpenAICompatibleProvider(baseUrl, null, model);
}

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

    case 'openai':
    case 'chatgpt':
      if (!OPENAI_API_KEY) {
        console.error('Error: OPENAI_API_KEY environment variable is required');
        console.error('Set LLM_PROVIDER=mock to use mock LLM for testing');
        process.exit(1);
      }
      console.log('Using OpenAI ChatGPT API');
      llmProvider = createOpenAIProvider(OPENAI_API_KEY);
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
        console.error('Or set LLM_PROVIDER=openai with OPENAI_API_KEY');
        console.error('Or set LLM_PROVIDER=ollama to use local Ollama models');
        process.exit(1);
      }
      console.log('Using Anthropic Claude API');
      llmProvider = createAnthropicProvider(ANTHROPIC_API_KEY);
      break;
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
