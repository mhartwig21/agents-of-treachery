/**
 * Flexible Model Assignment Syntax Parser.
 *
 * Parses model specification strings in the format:
 *   [provider:]model[@base_url][#api_key]
 *
 * Examples:
 *   openai:gpt-4o                                    → OpenAI, gpt-4o
 *   anthropic:claude-sonnet-4-5-20250929              → Anthropic, claude-sonnet-4-5-20250929
 *   openrouter:openai/gpt-4o                          → OpenRouter, openai/gpt-4o
 *   ollama:llama3.2@http://gpu-server:11434            → Ollama at custom URL
 *   custom:mymodel@https://api.example.com#sk-xxx      → Custom endpoint with API key
 *   gpt-4o                                            → Auto-detect: OpenAI
 *   claude-sonnet-4-5-20250929                        → Auto-detect: Anthropic
 *   openai/gpt-4o                                     → Auto-detect: OpenRouter (has slash)
 *   mock                                              → Mock provider
 */

import type { ModelConfig } from './types';

/**
 * Known provider prefixes.
 */
const KNOWN_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'claude',
  'openrouter',
  'ollama',
  'custom',
  'local',
  'mock',
]);

/**
 * Result of parsing a model specification string.
 */
export interface ParsedModelSpec {
  /** LLM provider */
  provider: ModelConfig['provider'];
  /** Model name/identifier */
  model: string;
  /** Optional custom base URL */
  baseUrl?: string;
  /** Optional API key */
  apiKey?: string;
  /** Original spec string */
  raw: string;
}

/**
 * Parse a model specification string.
 *
 * Format: [provider:]model[@base_url][#api_key]
 *
 * Parsing order:
 * 1. Split on '#' to extract API key (last '#' wins)
 * 2. Split on '@' to extract base URL
 * 3. Split on first ':' to extract provider prefix (if known)
 * 4. Auto-detect provider from model name if no prefix
 */
export function parseModelSpec(spec: string): ParsedModelSpec {
  if (!spec || !spec.trim()) {
    throw new Error('Model spec cannot be empty');
  }

  const raw = spec.trim();
  let remaining = raw;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;

  // Step 1: Extract API key (split on last '#')
  const hashIdx = remaining.lastIndexOf('#');
  if (hashIdx !== -1) {
    apiKey = remaining.slice(hashIdx + 1);
    remaining = remaining.slice(0, hashIdx);
    if (!apiKey) {
      throw new Error(`Invalid model spec: trailing '#' with no API key: ${raw}`);
    }
  }

  // Step 2: Extract base URL (split on '@')
  // Find '@' that's followed by something that looks like a URL (http/https or host:port)
  const atIdx = remaining.indexOf('@');
  if (atIdx !== -1) {
    baseUrl = remaining.slice(atIdx + 1);
    remaining = remaining.slice(0, atIdx);
    if (!baseUrl) {
      throw new Error(`Invalid model spec: trailing '@' with no base URL: ${raw}`);
    }
  }

  // Step 3: Extract provider prefix
  const colonIdx = remaining.indexOf(':');
  let providerStr: string | undefined;
  let model: string;

  if (colonIdx !== -1) {
    const candidate = remaining.slice(0, colonIdx).toLowerCase();
    if (KNOWN_PROVIDERS.has(candidate)) {
      providerStr = candidate;
      model = remaining.slice(colonIdx + 1);
    } else {
      // Not a known provider — treat entire remaining as model name
      model = remaining;
    }
  } else {
    model = remaining;
  }

  if (!model) {
    throw new Error(`Invalid model spec: no model name found: ${raw}`);
  }

  // Step 4: Resolve provider
  const provider = resolveProvider(providerStr, model);

  return { provider, model, baseUrl, apiKey, raw };
}

/**
 * Resolve the provider from an explicit prefix or by auto-detecting from model name.
 */
function resolveProvider(
  explicitProvider: string | undefined,
  model: string
): ModelConfig['provider'] {
  if (explicitProvider) {
    return normalizeProvider(explicitProvider);
  }
  return inferProvider(model);
}

/**
 * Normalize provider aliases to canonical names.
 */
function normalizeProvider(provider: string): ModelConfig['provider'] {
  switch (provider.toLowerCase()) {
    case 'anthropic':
    case 'claude':
      return 'anthropic';
    case 'openai':
    case 'chatgpt':
      return 'openai';
    case 'openrouter':
      return 'openrouter';
    case 'ollama':
      return 'ollama';
    case 'custom':
    case 'local':
      return 'custom';
    case 'mock':
      return 'mock';
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Infer the provider from a model name.
 *
 * Rules:
 * - 'claude-*' → anthropic
 * - 'gpt-*', 'o1*', 'o3*', 'o4*', 'chatgpt-*' → openai
 * - Contains '/' (org/model format) → openrouter
 * - 'mock' → mock
 * - Otherwise → error (require explicit prefix)
 */
export function inferProvider(model: string): ModelConfig['provider'] {
  const lower = model.toLowerCase();

  if (lower === 'mock') {
    return 'mock';
  }

  if (lower.startsWith('claude-') || lower.startsWith('claude3') || lower.startsWith('claude4')) {
    return 'anthropic';
  }

  if (
    lower.startsWith('gpt-') ||
    lower.startsWith('chatgpt-') ||
    /^o[134]\b/.test(lower) ||
    /^o[134]-/.test(lower)
  ) {
    return 'openai';
  }

  if (model.includes('/')) {
    return 'openrouter';
  }

  throw new Error(
    `Cannot auto-detect provider for model '${model}'. ` +
    `Use explicit prefix: openai:${model}, anthropic:${model}, openrouter:${model}, ollama:${model}, or custom:${model}`
  );
}

/**
 * Convert a parsed model spec to a ModelConfig suitable for the experiment runner.
 */
export function specToModelConfig(spec: ParsedModelSpec, id?: string): ModelConfig {
  return {
    id: id || spec.raw,
    provider: spec.provider,
    model: spec.model,
    baseUrl: spec.baseUrl,
    apiKey: spec.apiKey,
  };
}

/**
 * Parse a model spec string directly into a ModelConfig.
 */
export function parseModelConfigFromSpec(spec: string, id?: string): ModelConfig {
  return specToModelConfig(parseModelSpec(spec), id);
}

/**
 * Parse per-power model assignment strings.
 *
 * Accepts a map of power → model spec string and returns ModelConfigs
 * and a mapping of power → model config ID.
 *
 * @param assignments Map of power name to model spec string (e.g., "ENGLAND=openai:gpt-4o")
 * @param defaultSpec Default model spec for unassigned powers
 * @returns Object with models array and powerAssignments array
 */
export function parsePowerAssignments(
  assignments: Record<string, string>,
  defaultSpec?: string
): {
  models: ModelConfig[];
  powerModelMap: Map<string, string>; // power → modelConfig ID
} {
  const models = new Map<string, ModelConfig>(); // spec string → config
  const powerModelMap = new Map<string, string>(); // power → config ID

  // Parse default first
  if (defaultSpec) {
    const config = parseModelConfigFromSpec(defaultSpec);
    models.set(config.id, config);
  }

  // Parse per-power assignments
  for (const [power, spec] of Object.entries(assignments)) {
    const config = parseModelConfigFromSpec(spec);
    models.set(config.id, config);
    powerModelMap.set(power.toUpperCase(), config.id);
  }

  return {
    models: Array.from(models.values()),
    powerModelMap,
  };
}
