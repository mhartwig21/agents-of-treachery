/**
 * LLM call retry logic with exponential backoff, fallback model support,
 * and retry metrics tracking.
 */

import type {
  LLMProvider,
  LLMCompletionParams,
  LLMCompletionResult,
} from './types';

/**
 * Configuration for LLM retry behavior.
 */
export interface LLMRetryConfig {
  /** Maximum number of retry attempts. Default: 3 */
  maxRetries: number;
  /** Base delay in ms for exponential backoff. Default: 1000 */
  baseDelayMs: number;
  /** Fallback model ID to try when primary model exhausts retries. */
  fallbackModel?: string;
}

export const DEFAULT_RETRY_CONFIG: LLMRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
};

/**
 * Metrics tracked per LLM call attempt.
 */
export interface LLMRetryMetrics {
  /** Total calls attempted (including retries) */
  totalAttempts: number;
  /** Calls that succeeded on first try */
  firstTrySuccesses: number;
  /** Calls that succeeded after retry */
  retrySuccesses: number;
  /** Calls that fell back to fallback model */
  fallbackSuccesses: number;
  /** Calls that failed completely (degraded to HOLD) */
  totalFailures: number;
  /** Per-error-type counts */
  errorCounts: Map<string, number>;
}

/**
 * Creates a fresh metrics object.
 */
export function createRetryMetrics(): LLMRetryMetrics {
  return {
    totalAttempts: 0,
    firstTrySuccesses: 0,
    retrySuccesses: 0,
    fallbackSuccesses: 0,
    totalFailures: 0,
    errorCounts: new Map(),
  };
}

/**
 * Format retry metrics for logging.
 */
export function formatRetryMetrics(metrics: LLMRetryMetrics): string {
  const total = metrics.firstTrySuccesses + metrics.retrySuccesses +
    metrics.fallbackSuccesses + metrics.totalFailures;
  if (total === 0) return 'LLM Retry Metrics: No calls made';

  const lines = [
    `LLM Retry Metrics:`,
    `  Total calls: ${total} (${metrics.totalAttempts} attempts)`,
    `  First-try success: ${metrics.firstTrySuccesses}`,
    `  Retry success: ${metrics.retrySuccesses}`,
    `  Fallback success: ${metrics.fallbackSuccesses}`,
    `  Total failures: ${metrics.totalFailures}`,
  ];

  if (metrics.errorCounts.size > 0) {
    lines.push(`  Error types:`);
    for (const [type, count] of metrics.errorCounts) {
      lines.push(`    ${type}: ${count}`);
    }
  }

  return lines.join('\n');
}

/**
 * Classify an error for metrics tracking.
 */
function classifyError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('429')) return 'rate_limit';
    if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
    if (msg.includes('500') || msg.includes('internal server')) return 'server_error';
    if (msg.includes('502') || msg.includes('bad gateway')) return 'bad_gateway';
    if (msg.includes('503') || msg.includes('service unavailable')) return 'service_unavailable';
    if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('econnreset')) return 'network_error';
    return 'unknown';
  }
  return 'unknown';
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Result of an LLM call with retry, including whether fallback was used.
 */
export interface LLMRetryResult {
  result: LLMCompletionResult;
  usedFallback: boolean;
  attempts: number;
}

/**
 * Call an LLM provider with retry logic and optional fallback model.
 *
 * Strategy:
 * 1. Try primary model up to maxRetries times with exponential backoff.
 * 2. If all retries fail and fallbackModel is set, try fallback model once.
 * 3. If everything fails, throw the last error (caller handles HOLD degradation).
 */
export async function callLLMWithRetry(
  provider: LLMProvider,
  params: LLMCompletionParams,
  config: LLMRetryConfig,
  metrics: LLMRetryMetrics,
): Promise<LLMRetryResult> {
  let lastError: unknown;
  let totalAttempts = 0;

  // Try primary model with retries
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    totalAttempts++;
    metrics.totalAttempts++;

    try {
      const result = await provider.complete(params);
      if (attempt === 0) {
        metrics.firstTrySuccesses++;
      } else {
        metrics.retrySuccesses++;
      }
      return { result, usedFallback: false, attempts: totalAttempts };
    } catch (error) {
      lastError = error;
      const errorType = classifyError(error);
      metrics.errorCounts.set(errorType, (metrics.errorCounts.get(errorType) ?? 0) + 1);

      if (attempt < config.maxRetries - 1) {
        // Exponential backoff: base * 2^attempt with jitter
        const delay = config.baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        console.warn(
          `  LLM retry ${attempt + 1}/${config.maxRetries - 1} after ${errorType} error, ` +
          `waiting ${Math.round(delay)}ms...`
        );
        await sleep(delay);
      }
    }
  }

  // Try fallback model if configured
  if (config.fallbackModel) {
    totalAttempts++;
    metrics.totalAttempts++;

    try {
      const fallbackParams = { ...params, model: config.fallbackModel };
      console.warn(`  Trying fallback model: ${config.fallbackModel}`);
      const result = await provider.complete(fallbackParams);
      metrics.fallbackSuccesses++;
      return { result, usedFallback: true, attempts: totalAttempts };
    } catch (error) {
      lastError = error;
      const errorType = classifyError(error);
      metrics.errorCounts.set(errorType, (metrics.errorCounts.get(errorType) ?? 0) + 1);
    }
  }

  // All attempts exhausted
  metrics.totalFailures++;
  throw lastError;
}
