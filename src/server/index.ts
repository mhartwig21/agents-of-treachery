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
 *   ANTHROPIC_API_KEY - API key for Claude (required for real LLM)
 *   USE_MOCK_LLM - Set to "true" to use mock LLM for testing
 */

import { GameServer, createMockLLMProvider } from './game-server';
import type { LLMProvider } from '../agent/types';

const PORT = parseInt(process.env.PORT || '3001', 10);
const USE_MOCK = process.env.USE_MOCK_LLM === 'true';
const API_KEY = process.env.ANTHROPIC_API_KEY;

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
 * Main entry point.
 */
async function main() {
  console.log('Starting Agents of Treachery Game Server...');
  console.log(`Port: ${PORT}`);
  console.log(`LLM Mode: ${USE_MOCK ? 'Mock (testing)' : 'Anthropic Claude'}`);

  // Create LLM provider
  let llmProvider: LLMProvider;

  if (USE_MOCK) {
    console.log('Using mock LLM provider for testing');
    llmProvider = createMockLLMProvider();
  } else {
    if (!API_KEY) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      console.error('Set USE_MOCK_LLM=true to use mock LLM for testing');
      process.exit(1);
    }
    console.log('Using Anthropic Claude API');
    llmProvider = createAnthropicProvider(API_KEY);
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
