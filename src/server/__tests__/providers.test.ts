/**
 * Tests for LLM provider factory functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createOpenRouterProvider,
  createAnthropicProvider,
  createOpenAIProvider,
  createOpenAICompatibleProvider,
  createOllamaProvider,
  createProviderFromConfig,
  createMultiModelProvider,
  createUsageTrackingProvider,
  fetchWithRetry,
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

  describe('createOpenAICompatibleProvider model-specific params', () => {
    it('should use max_completion_tokens for gpt-5 models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

      const provider = createOpenAICompatibleProvider('https://api.openai.com', 'key', 'gpt-5');
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        maxTokens: 2048,
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.max_completion_tokens).toBe(2048);
      expect(callBody.max_tokens).toBeUndefined();
    });

    it('should use max_completion_tokens for o-series models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

      const provider = createOpenAICompatibleProvider('https://api.openai.com', 'key', 'o3-mini');
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.max_completion_tokens).toBe(1024);
      expect(callBody.max_tokens).toBeUndefined();
    });

    it('should omit temperature for o-series models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

      const provider = createOpenAICompatibleProvider('https://api.openai.com', 'key', 'o1');
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        temperature: 0.5,
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.temperature).toBeUndefined();
    });

    it('should omit temperature for gpt-5 base but not gpt-5.1', async () => {
      // gpt-5 base: omit temperature
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

      const provider5 = createOpenAICompatibleProvider('https://api.openai.com', 'key', 'gpt-5');
      await provider5.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      const body5 = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body5.temperature).toBeUndefined();

      // gpt-5.1: include temperature
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

      const provider51 = createOpenAICompatibleProvider('https://api.openai.com', 'key', 'gpt-5.1');
      await provider51.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      const body51 = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body51.temperature).toBe(0.7);
      expect(body51.max_completion_tokens).toBe(1024);
    });

    it('should use standard max_tokens and temperature for gpt-4o', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

      const provider = createOpenAICompatibleProvider('https://api.openai.com', 'key', 'gpt-4o');
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.max_tokens).toBe(1024);
      expect(callBody.max_completion_tokens).toBeUndefined();
      expect(callBody.temperature).toBe(0.7);
    });

    it('should handle gpt-5-turbo with omitted temperature', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

      const provider = createOpenAICompatibleProvider('https://api.openai.com', 'key', 'gpt-5-turbo');
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.max_completion_tokens).toBe(1024);
      expect(callBody.temperature).toBeUndefined();
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

  describe('fetchWithRetry', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should return response on success', async () => {
      const okResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValueOnce(okResponse);

      const result = await fetchWithRetry('https://api.example.com', { method: 'POST' }, 3, 1);
      expect(result).toBe(okResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on 429 rate limit and succeed', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false, status: 429,
          headers: new Headers(), text: async () => 'Rate limited',
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await fetchWithRetry('https://api.example.com', { method: 'POST' }, 3, 1);
      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 server error and succeed', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false, status: 500,
          headers: new Headers(), text: async () => 'Internal Server Error',
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await fetchWithRetry('https://api.example.com', { method: 'POST' }, 3, 1);
      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should respect Retry-After header', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false, status: 429,
          headers: new Headers({ 'retry-after': '1' }),
          text: async () => 'Rate limited',
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await fetchWithRetry('https://api.example.com', { method: 'POST' }, 3, 1);
      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw after exhausting retries on 429', async () => {
      for (let i = 0; i <= 2; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false, status: 429,
          headers: new Headers(), text: async () => 'Rate limited',
        });
      }

      await expect(
        fetchWithRetry('https://api.example.com', { method: 'POST' }, 2, 1)
      ).rejects.toThrow('API error (429) after 2 retries');
    });

    it('should not retry on 400 client errors', async () => {
      const badRequest = { ok: false, status: 400, text: async () => 'Bad Request' };
      mockFetch.mockResolvedValueOnce(badRequest);

      const result = await fetchWithRetry('https://api.example.com', { method: 'POST' }, 3, 1);
      expect(result.status).toBe(400);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on network errors', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await fetchWithRetry('https://api.example.com', { method: 'POST' }, 3, 1);
      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw after exhausting retries on network errors', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(
        fetchWithRetry('https://api.example.com', { method: 'POST' }, 1, 1)
      ).rejects.toThrow('Network error after 1 retries');
    });
  });

  describe('retry integration with providers', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('OpenRouter should retry on rate limit then succeed', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false, status: 429,
          headers: new Headers(), text: async () => 'Rate limited',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Retried OK' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 20 },
          }),
        });

      const provider = createOpenRouterProvider('test-key', 'model', { maxRetries: 3, baseDelay: 1 });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      expect(result.content).toBe('Retried OK');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('Anthropic should retry on rate limit then succeed', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false, status: 429,
          headers: new Headers(), text: async () => 'Rate limited',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ text: 'Retried OK' }],
            usage: { input_tokens: 10, output_tokens: 20 },
            stop_reason: 'end_turn',
          }),
        });

      const provider = createAnthropicProvider('test-key', undefined, { maxRetries: 3, baseDelay: 1 });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      expect(result.content).toBe('Retried OK');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('OpenAI should retry on rate limit then succeed', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false, status: 429,
          headers: new Headers(), text: async () => 'Rate limited',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Retried OK' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 20 },
          }),
        });

      const provider = createOpenAICompatibleProvider('https://api.openai.com', 'test-key', 'gpt-4o-mini', 3, 1);
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
      });

      expect(result.content).toBe('Retried OK');
      expect(mockFetch).toHaveBeenCalledTimes(2);
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
