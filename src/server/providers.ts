/**
 * LLM Provider Factory Module.
 *
 * Provides factory functions for creating different LLM providers:
 * - OpenRouter (access to Claude, GPT-4, Llama, Mistral via single API)
 * - Anthropic (direct Claude API)
 * - OpenAI (direct OpenAI API)
 * - Ollama (local open-source models)
 * - Custom (any OpenAI-compatible API)
 * - Mock (for testing)
 */

import type { LLMProvider, LLMCompletionParams } from '../agent/types';

/**
 * Supported LLM provider types.
 */
export type ProviderType =
  | 'openrouter'
  | 'anthropic'
  | 'claude'
  | 'openai'
  | 'chatgpt'
  | 'ollama'
  | 'custom'
  | 'local'
  | 'mock';

/**
 * Configuration for creating an LLM provider.
 */
export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Site URL for OpenRouter rankings (optional) */
  siteUrl?: string;
  /** Site name for OpenRouter rankings (optional) */
  siteName?: string;
}

/**
 * Model configuration for per-power assignment.
 */
export interface ModelConfig {
  /** Default model for all powers */
  defaultModel?: string;
  /** Default provider type */
  defaultProvider?: ProviderType;
  /** Per-power model overrides */
  powerModels?: Record<string, {
    provider?: ProviderType;
    model: string;
  }>;
}

/**
 * Creates an OpenRouter LLM provider.
 * OpenRouter provides access to multiple models via a single API.
 *
 * Supported models include:
 * - anthropic/claude-3.5-sonnet
 * - anthropic/claude-3-opus
 * - openai/gpt-4o
 * - openai/gpt-4o-mini
 * - meta-llama/llama-3.1-70b-instruct
 * - mistralai/mistral-large
 * - And many more: https://openrouter.ai/models
 */
export function createOpenRouterProvider(
  apiKey: string,
  defaultModel: string = 'anthropic/claude-3-haiku',
  options?: { siteUrl?: string; siteName?: string }
): LLMProvider {
  const baseUrl = 'https://openrouter.ai/api/v1';

  return {
    async complete(params: LLMCompletionParams) {
      const model = params.model || defaultModel;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': options?.siteUrl || 'https://github.com/agents-of-treachery',
        'X-Title': options?.siteName || 'Agents of Treachery',
      };

      const response = await fetch(`${baseUrl}/chat/completions`, {
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
        throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
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
 * Creates an Anthropic LLM provider for direct Claude API access.
 */
export function createAnthropicProvider(apiKey: string, defaultModel: string = 'claude-3-haiku-20240307'): LLMProvider {
  return {
    async complete(params: LLMCompletionParams) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: params.model || defaultModel,
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
export function createOpenAICompatibleProvider(
  baseUrl: string,
  apiKey: string | null,
  defaultModel: string
): LLMProvider {
  return {
    async complete(params: LLMCompletionParams) {
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
export function createOpenAIProvider(apiKey: string, defaultModel: string = 'gpt-4o-mini'): LLMProvider {
  return createOpenAICompatibleProvider('https://api.openai.com', apiKey, defaultModel);
}

/**
 * Creates an Ollama LLM provider for local open-source models.
 */
export function createOllamaProvider(baseUrl: string = 'http://localhost:11434', model: string = 'llama3.2'): LLMProvider {
  console.log(`  Ollama Model: ${model}`);
  console.log(`  Ollama URL: ${baseUrl}`);
  return createOpenAICompatibleProvider(baseUrl, null, model);
}

/**
 * Creates an LLM provider from configuration.
 */
export function createProviderFromConfig(config: ProviderConfig): LLMProvider {
  switch (config.type.toLowerCase() as ProviderType) {
    case 'openrouter':
      if (!config.apiKey) {
        throw new Error('OPENROUTER_API_KEY is required for OpenRouter provider');
      }
      return createOpenRouterProvider(
        config.apiKey,
        config.model || 'anthropic/claude-3-haiku',
        { siteUrl: config.siteUrl, siteName: config.siteName }
      );

    case 'anthropic':
    case 'claude':
      if (!config.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for Anthropic provider');
      }
      return createAnthropicProvider(config.apiKey, config.model);

    case 'openai':
    case 'chatgpt':
      if (!config.apiKey) {
        throw new Error('OPENAI_API_KEY is required for OpenAI provider');
      }
      return createOpenAIProvider(config.apiKey, config.model);

    case 'ollama':
      return createOllamaProvider(
        config.baseUrl || 'http://localhost:11434',
        config.model || 'llama3.2'
      );

    case 'custom':
    case 'local':
      if (!config.baseUrl) {
        throw new Error('LLM_BASE_URL is required for custom provider');
      }
      return createOpenAICompatibleProvider(
        config.baseUrl,
        config.apiKey || null,
        config.model || 'default'
      );

    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}

/**
 * Creates a multi-model provider that routes requests to different providers
 * based on the model specified in the request.
 *
 * This allows running games with different models per power for comparison.
 */
export function createMultiModelProvider(
  providers: Map<string, LLMProvider>,
  defaultProvider: LLMProvider
): LLMProvider {
  return {
    async complete(params: LLMCompletionParams) {
      const model = params.model;
      const provider = model ? providers.get(model) || defaultProvider : defaultProvider;
      return provider.complete(params);
    },
  };
}

/**
 * Token usage tracker for model comparison experiments.
 */
export interface TokenUsageStats {
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
  averageInputTokens: number;
  averageOutputTokens: number;
}

/**
 * Creates a provider wrapper that tracks token usage per model.
 */
export function createUsageTrackingProvider(
  provider: LLMProvider,
  onUsage?: (model: string, inputTokens: number, outputTokens: number) => void
): LLMProvider & { getStats: () => Map<string, TokenUsageStats> } {
  const stats = new Map<string, TokenUsageStats>();

  const updateStats = (model: string, inputTokens: number, outputTokens: number) => {
    const existing = stats.get(model) || {
      model,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      requestCount: 0,
      averageInputTokens: 0,
      averageOutputTokens: 0,
    };

    existing.totalInputTokens += inputTokens;
    existing.totalOutputTokens += outputTokens;
    existing.requestCount += 1;
    existing.averageInputTokens = existing.totalInputTokens / existing.requestCount;
    existing.averageOutputTokens = existing.totalOutputTokens / existing.requestCount;

    stats.set(model, existing);
    onUsage?.(model, inputTokens, outputTokens);
  };

  return {
    async complete(params: LLMCompletionParams) {
      const result = await provider.complete(params);
      const model = params.model || 'default';
      updateStats(
        model,
        result.usage?.inputTokens || 0,
        result.usage?.outputTokens || 0
      );
      return result;
    },
    getStats() {
      return new Map(stats);
    },
  };
}
