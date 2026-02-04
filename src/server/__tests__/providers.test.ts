/**
 * Tests for LLM provider factory functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createOpenRouterProvider,
  createAnthropicProvider,
  createOpenAIProvider,
  createOllamaProvider,
  createProviderFromConfig,
  createMultiModelProvider,
  createUsageTrackingProvider,
  type ProviderConfig,
} from '../providers';
import type { LLMProvider } from '../../agent/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Provider Factory Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createOpenRouterProvider', () => {
    it('should create a provider that calls OpenRouter API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from OpenRouter' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

      const provider = createOpenRouterProvider('test-api-key', 'anthropic/claude-3-haiku');
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      expect(result.content).toBe('Hello from OpenRouter');
      expect(result.usage?.inputTokens).toBe(10);
      expect(result.usage?.outputTokens).toBe(20);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'HTTP-Referer': expect.any(String),
            'X-Title': expect.any(String),
          }),
        })
      );
    });

    it('should use custom model when specified in params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 10 },
        }),
      });

      const provider = createOpenRouterProvider('test-api-key', 'default-model');
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        model: 'openai/gpt-4o',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('openai/gpt-4o');
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const provider = createOpenRouterProvider('bad-key');
      await expect(provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      })).rejects.toThrow('OpenRouter API error: 401');
    });
  });

  describe('createAnthropicProvider', () => {
    it('should create a provider that calls Anthropic API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'Hello from Claude' }],
          usage: { input_tokens: 15, output_tokens: 25 },
          stop_reason: 'end_turn',
        }),
      });

      const provider = createAnthropicProvider('anthropic-key');
      const result = await provider.complete({
        messages: [
          { role: 'system', content: 'Be helpful', timestamp: new Date() },
          { role: 'user', content: 'Hello', timestamp: new Date() },
        ],
      });

      expect(result.content).toBe('Hello from Claude');
      expect(result.usage?.inputTokens).toBe(15);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'anthropic-key',
            'anthropic-version': '2023-06-01',
          }),
        })
      );
    });

    it('should extract system message correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ text: 'Response' }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      });

      const provider = createAnthropicProvider('key');
      await provider.complete({
        messages: [
          { role: 'system', content: 'System prompt', timestamp: new Date() },
          { role: 'user', content: 'User message', timestamp: new Date() },
        ],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.system).toBe('System prompt');
      expect(callBody.messages).toHaveLength(1);
      expect(callBody.messages[0].role).toBe('user');
    });
  });

  describe('createOpenAIProvider', () => {
    it('should create a provider that calls OpenAI API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from GPT' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 18 },
        }),
      });

      const provider = createOpenAIProvider('openai-key');
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      expect(result.content).toBe('Hello from GPT');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer openai-key',
          }),
        })
      );
    });
  });

  describe('createOllamaProvider', () => {
    it('should create a provider with custom base URL', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from Ollama' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 12 },
        }),
      });

      const provider = createOllamaProvider('http://localhost:11434', 'llama3.2');
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/v1/chat/completions',
        expect.any(Object)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('createProviderFromConfig', () => {
    it('should create OpenRouter provider from config', () => {
      const config: ProviderConfig = {
        type: 'openrouter',
        apiKey: 'test-key',
        model: 'anthropic/claude-3-opus',
      };

      const provider = createProviderFromConfig(config);
      expect(provider).toBeDefined();
      expect(provider.complete).toBeInstanceOf(Function);
    });

    it('should throw error for missing API key', () => {
      const config: ProviderConfig = {
        type: 'openrouter',
      };

      expect(() => createProviderFromConfig(config)).toThrow('OPENROUTER_API_KEY is required');
    });

    it('should create Anthropic provider from config', () => {
      const config: ProviderConfig = {
        type: 'anthropic',
        apiKey: 'test-key',
      };

      const provider = createProviderFromConfig(config);
      expect(provider).toBeDefined();
    });

    it('should create Ollama provider without API key', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const config: ProviderConfig = {
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2',
      };

      const provider = createProviderFromConfig(config);
      expect(provider).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('should throw for unknown provider type', () => {
      const config: ProviderConfig = {
        type: 'unknown' as any,
      };

      expect(() => createProviderFromConfig(config)).toThrow('Unknown provider type');
    });
  });

  describe('createMultiModelProvider', () => {
    it('should route requests to correct provider based on model', async () => {
      const mockProvider1: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: 'Provider 1 response',
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
      };

      const mockProvider2: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: 'Provider 2 response',
          usage: { inputTokens: 15, outputTokens: 25 },
        }),
      };

      const defaultProvider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: 'Default response',
          usage: { inputTokens: 5, outputTokens: 10 },
        }),
      };

      const providers = new Map([
        ['model-1', mockProvider1],
        ['model-2', mockProvider2],
      ]);

      const multiProvider = createMultiModelProvider(providers, defaultProvider);

      // Request with model-1
      const result1 = await multiProvider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        model: 'model-1',
      });
      expect(result1.content).toBe('Provider 1 response');
      expect(mockProvider1.complete).toHaveBeenCalled();

      // Request with model-2
      const result2 = await multiProvider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        model: 'model-2',
      });
      expect(result2.content).toBe('Provider 2 response');
      expect(mockProvider2.complete).toHaveBeenCalled();

      // Request with unknown model falls back to default
      const result3 = await multiProvider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        model: 'unknown-model',
      });
      expect(result3.content).toBe('Default response');
      expect(defaultProvider.complete).toHaveBeenCalled();
    });
  });

  describe('createUsageTrackingProvider', () => {
    it('should track token usage per model', async () => {
      const mockProvider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: 'Response',
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
      };

      const trackingProvider = createUsageTrackingProvider(mockProvider);

      // Make some requests
      await trackingProvider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        model: 'model-a',
      });

      await trackingProvider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        model: 'model-a',
      });

      await trackingProvider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        model: 'model-b',
      });

      const stats = trackingProvider.getStats();

      expect(stats.get('model-a')).toEqual({
        model: 'model-a',
        totalInputTokens: 200,
        totalOutputTokens: 100,
        requestCount: 2,
        averageInputTokens: 100,
        averageOutputTokens: 50,
      });

      expect(stats.get('model-b')).toEqual({
        model: 'model-b',
        totalInputTokens: 100,
        totalOutputTokens: 50,
        requestCount: 1,
        averageInputTokens: 100,
        averageOutputTokens: 50,
      });
    });

    it('should call onUsage callback', async () => {
      const mockProvider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: 'Response',
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
      };

      const onUsage = vi.fn();
      const trackingProvider = createUsageTrackingProvider(mockProvider, onUsage);

      await trackingProvider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        model: 'test-model',
      });

      expect(onUsage).toHaveBeenCalledWith('test-model', 100, 50);
    });

    it('should use "default" as model name when not specified', async () => {
      const mockProvider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: 'Response',
          usage: { inputTokens: 50, outputTokens: 25 },
        }),
      };

      const trackingProvider = createUsageTrackingProvider(mockProvider);

      await trackingProvider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      const stats = trackingProvider.getStats();
      expect(stats.has('default')).toBe(true);
    });
  });
});
