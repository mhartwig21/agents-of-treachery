/**
 * Tests for llm-retry.ts — LLM call retry logic with exponential backoff,
 * fallback model support, and retry metrics tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  callLLMWithRetry,
  createRetryMetrics,
  formatRetryMetrics,
  type LLMRetryConfig,
  type LLMRetryMetrics,
} from '../llm-retry';
import type { LLMProvider, LLMCompletionParams, LLMCompletionResult } from '../types';

/**
 * Helper to create a mock LLM provider with configurable behavior.
 */
function createMockProvider(behavior: {
  succeedOnAttempt?: number;
  errorMessage?: string;
  fallbackSucceeds?: boolean;
}): LLMProvider & { calls: LLMCompletionParams[] } {
  let callCount = 0;
  const calls: LLMCompletionParams[] = [];

  return {
    calls,
    async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
      calls.push(params);
      callCount++;

      // If fallback model is being used and it should succeed
      if (params.model === 'fallback-model' && behavior.fallbackSucceeds) {
        return {
          content: 'REASONING: Fallback response.\n\nORDERS:\n# Hold\n',
          usage: { inputTokens: 50, outputTokens: 25 },
          stopReason: 'end_turn',
        };
      }

      if (behavior.succeedOnAttempt !== undefined && callCount >= behavior.succeedOnAttempt) {
        return {
          content: 'REASONING: Success after retry.\n\nORDERS:\n# Hold\n',
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: 'end_turn',
        };
      }

      throw new Error(behavior.errorMessage ?? 'LLM service unavailable');
    },
  };
}

function makeParams(model?: string): LLMCompletionParams {
  return {
    messages: [{ role: 'user', content: 'test', timestamp: new Date() }],
    model: model ?? 'test-model',
    temperature: 0.7,
    maxTokens: 1000,
  };
}

describe('createRetryMetrics', () => {
  it('should create zeroed metrics', () => {
    const metrics = createRetryMetrics();
    expect(metrics.totalAttempts).toBe(0);
    expect(metrics.firstTrySuccesses).toBe(0);
    expect(metrics.retrySuccesses).toBe(0);
    expect(metrics.fallbackSuccesses).toBe(0);
    expect(metrics.totalFailures).toBe(0);
    expect(metrics.errorCounts.size).toBe(0);
  });
});

describe('formatRetryMetrics', () => {
  it('should format empty metrics', () => {
    const metrics = createRetryMetrics();
    expect(formatRetryMetrics(metrics)).toContain('No calls made');
  });

  it('should format metrics with data', () => {
    const metrics = createRetryMetrics();
    metrics.totalAttempts = 5;
    metrics.firstTrySuccesses = 3;
    metrics.retrySuccesses = 1;
    metrics.totalFailures = 1;
    metrics.errorCounts.set('rate_limit', 2);

    const output = formatRetryMetrics(metrics);
    expect(output).toContain('Total calls: 5');
    expect(output).toContain('First-try success: 3');
    expect(output).toContain('Retry success: 1');
    expect(output).toContain('Total failures: 1');
    expect(output).toContain('rate_limit: 2');
  });
});

describe('callLLMWithRetry', () => {
  let metrics: LLMRetryMetrics;
  const baseConfig: LLMRetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1, // 1ms for fast tests
  };

  beforeEach(() => {
    metrics = createRetryMetrics();
  });

  it('should succeed on first try', async () => {
    const provider = createMockProvider({ succeedOnAttempt: 1 });

    const result = await callLLMWithRetry(provider, makeParams(), baseConfig, metrics);

    expect(result.result.content).toContain('Success after retry');
    expect(result.usedFallback).toBe(false);
    expect(result.attempts).toBe(1);
    expect(metrics.firstTrySuccesses).toBe(1);
    expect(metrics.retrySuccesses).toBe(0);
    expect(metrics.totalAttempts).toBe(1);
  });

  it('should retry and succeed on second attempt', async () => {
    const provider = createMockProvider({ succeedOnAttempt: 2 });

    const result = await callLLMWithRetry(provider, makeParams(), baseConfig, metrics);

    expect(result.result.content).toContain('Success after retry');
    expect(result.usedFallback).toBe(false);
    expect(result.attempts).toBe(2);
    expect(metrics.firstTrySuccesses).toBe(0);
    expect(metrics.retrySuccesses).toBe(1);
    expect(metrics.totalAttempts).toBe(2);
  });

  it('should retry and succeed on third attempt', async () => {
    const provider = createMockProvider({ succeedOnAttempt: 3 });

    const result = await callLLMWithRetry(provider, makeParams(), baseConfig, metrics);

    expect(result.result.content).toContain('Success after retry');
    expect(result.attempts).toBe(3);
    expect(metrics.retrySuccesses).toBe(1);
    expect(metrics.totalAttempts).toBe(3);
  });

  it('should fall back to fallback model after all retries fail', async () => {
    const provider = createMockProvider({
      errorMessage: 'rate limit exceeded (429)',
      fallbackSucceeds: true,
    });
    const config: LLMRetryConfig = {
      ...baseConfig,
      fallbackModel: 'fallback-model',
    };

    const result = await callLLMWithRetry(provider, makeParams(), config, metrics);

    expect(result.result.content).toContain('Fallback response');
    expect(result.usedFallback).toBe(true);
    expect(result.attempts).toBe(4); // 3 retries + 1 fallback
    expect(metrics.fallbackSuccesses).toBe(1);
    expect(metrics.totalFailures).toBe(0);
    expect(metrics.errorCounts.get('rate_limit')).toBe(3);
  });

  it('should throw after all retries and fallback fail', async () => {
    const provider = createMockProvider({
      errorMessage: 'service unavailable (503)',
    });
    const config: LLMRetryConfig = {
      ...baseConfig,
      fallbackModel: 'fallback-model',
    };

    await expect(
      callLLMWithRetry(provider, makeParams(), config, metrics)
    ).rejects.toThrow('service unavailable');

    expect(metrics.totalFailures).toBe(1);
    expect(metrics.totalAttempts).toBe(4); // 3 + 1 fallback
    expect(metrics.errorCounts.get('service_unavailable')).toBe(4);
  });

  it('should throw after all retries fail with no fallback', async () => {
    const provider = createMockProvider({
      errorMessage: 'network error econnrefused',
    });

    await expect(
      callLLMWithRetry(provider, makeParams(), baseConfig, metrics)
    ).rejects.toThrow('network error');

    expect(metrics.totalFailures).toBe(1);
    expect(metrics.totalAttempts).toBe(3);
    expect(metrics.errorCounts.get('network_error')).toBe(3);
  });

  it('should classify different error types', async () => {
    // Test rate limit classification
    const provider1 = createMockProvider({ errorMessage: 'rate limit exceeded', succeedOnAttempt: 2 });
    await callLLMWithRetry(provider1, makeParams(), baseConfig, metrics);
    expect(metrics.errorCounts.get('rate_limit')).toBe(1);

    // Test timeout classification
    const metrics2 = createRetryMetrics();
    const provider2 = createMockProvider({ errorMessage: 'request timed out', succeedOnAttempt: 2 });
    await callLLMWithRetry(provider2, makeParams(), baseConfig, metrics2);
    expect(metrics2.errorCounts.get('timeout')).toBe(1);

    // Test 500 classification
    const metrics3 = createRetryMetrics();
    const provider3 = createMockProvider({ errorMessage: '500 internal server error', succeedOnAttempt: 2 });
    await callLLMWithRetry(provider3, makeParams(), baseConfig, metrics3);
    expect(metrics3.errorCounts.get('server_error')).toBe(1);
  });

  it('should pass fallback model parameter to provider', async () => {
    const provider = createMockProvider({
      errorMessage: 'error',
      fallbackSucceeds: true,
    });
    const config: LLMRetryConfig = {
      ...baseConfig,
      fallbackModel: 'fallback-model',
    };

    await callLLMWithRetry(provider, makeParams('primary-model'), config, metrics);

    // First 3 calls should use original model, 4th should use fallback
    expect(provider.calls).toHaveLength(4);
    expect(provider.calls[0].model).toBe('primary-model');
    expect(provider.calls[1].model).toBe('primary-model');
    expect(provider.calls[2].model).toBe('primary-model');
    expect(provider.calls[3].model).toBe('fallback-model');
  });

  it('should accumulate metrics across multiple calls', async () => {
    // First call: succeeds first try
    const provider1 = createMockProvider({ succeedOnAttempt: 1 });
    await callLLMWithRetry(provider1, makeParams(), baseConfig, metrics);

    // Second call: succeeds on retry
    const provider2 = createMockProvider({ succeedOnAttempt: 2 });
    await callLLMWithRetry(provider2, makeParams(), baseConfig, metrics);

    // Third call: fails completely
    const provider3 = createMockProvider({ errorMessage: 'total failure' });
    try {
      await callLLMWithRetry(provider3, makeParams(), baseConfig, metrics);
    } catch { /* expected */ }

    expect(metrics.firstTrySuccesses).toBe(1);
    expect(metrics.retrySuccesses).toBe(1);
    expect(metrics.totalFailures).toBe(1);
    expect(metrics.totalAttempts).toBe(1 + 2 + 3);
  });

  it('should work with maxRetries of 1 (no retries)', async () => {
    const provider = createMockProvider({ errorMessage: 'error' });
    const config: LLMRetryConfig = { maxRetries: 1, baseDelayMs: 1 };

    await expect(
      callLLMWithRetry(provider, makeParams(), config, metrics)
    ).rejects.toThrow('error');

    expect(metrics.totalAttempts).toBe(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('should use exponential backoff timing', async () => {
    // We can't easily test exact timing, but we can verify the provider
    // is called the expected number of times
    const provider = createMockProvider({ succeedOnAttempt: 3 });

    const start = Date.now();
    await callLLMWithRetry(provider, makeParams(), { ...baseConfig, baseDelayMs: 10 }, metrics);
    const elapsed = Date.now() - start;

    // With baseDelayMs=10: attempt 1 fails, wait ~10ms, attempt 2 fails, wait ~20ms, attempt 3 succeeds
    // Total wait should be at least 15ms (with 0.5 jitter factor: 5ms + 10ms minimum)
    expect(elapsed).toBeGreaterThanOrEqual(10);
    expect(provider.calls).toHaveLength(3);
  });
});
