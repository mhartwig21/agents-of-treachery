/**
 * Tests for Per-Model Token Tracking.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  TokenTracker,
  formatGameCostReport,
  DEFAULT_MODEL_PRICING,
  type TokenBudgetConfig,
} from '../token-tracker';

describe('TokenTracker', () => {
  describe('cost calculation', () => {
    it('should calculate cost for known models', () => {
      const tracker = new TokenTracker('test-game');
      // claude-3-haiku: $0.25/M input, $1.25/M output
      const cost = tracker.calculateCost('claude-3-haiku', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(0.25 + 1.25, 4);
    });

    it('should calculate cost for OpenRouter-prefixed models', () => {
      const tracker = new TokenTracker('test-game');
      // anthropic/claude-3-haiku: $0.25/M input, $1.25/M output
      const cost = tracker.calculateCost('anthropic/claude-3-haiku', 1_000_000, 500_000);
      expect(cost).toBeCloseTo(0.25 + 0.625, 4);
    });

    it('should match model names by substring', () => {
      const tracker = new TokenTracker('test-game');
      // 'claude-3-haiku-20240307' should match 'claude-3-haiku'
      const cost = tracker.calculateCost('claude-3-haiku-20240307', 1_000_000, 0);
      expect(cost).toBeCloseTo(0.25, 4);
    });

    it('should return 0 cost for unknown models', () => {
      const tracker = new TokenTracker('test-game');
      const cost = tracker.calculateCost('unknown-model-xyz', 1_000_000, 1_000_000);
      expect(cost).toBe(0);
    });

    it('should use custom pricing when provided', () => {
      const tracker = new TokenTracker('test-game', {
        customPricing: [
          { model: 'my-model', inputCostPerMillion: 10, outputCostPerMillion: 20 },
        ],
      });
      const cost = tracker.calculateCost('my-model', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(30, 4);
    });

    it('should allow custom pricing to override defaults', () => {
      const tracker = new TokenTracker('test-game', {
        customPricing: [
          { model: 'claude-3-haiku', inputCostPerMillion: 0.5, outputCostPerMillion: 2.5 },
        ],
      });
      const cost = tracker.calculateCost('claude-3-haiku', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(3, 4);
    });
  });

  describe('recording usage', () => {
    it('should record token usage', () => {
      const tracker = new TokenTracker('test-game');
      const record = tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 500, 200);

      expect(record.power).toBe('ENGLAND');
      expect(record.model).toBe('claude-3-haiku');
      expect(record.phase).toBe('DIPLOMACY');
      expect(record.inputTokens).toBe(500);
      expect(record.outputTokens).toBe(200);
      expect(record.costUsd).toBeGreaterThanOrEqual(0);

      expect(tracker.getRecords()).toHaveLength(1);
    });

    it('should accumulate records across multiple calls', () => {
      const tracker = new TokenTracker('test-game');
      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 500, 200);
      tracker.record('FRANCE', 'gpt-4o', 'DIPLOMACY', 'SPRING', 1901, 800, 300);
      tracker.record('ENGLAND', 'claude-3-haiku', 'MOVEMENT', 'SPRING', 1901, 400, 150);

      expect(tracker.getRecords()).toHaveLength(3);
    });
  });

  describe('budget enforcement', () => {
    it('should return OK when no budget configured', () => {
      const tracker = new TokenTracker('test-game');
      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 500, 200);

      const result = tracker.checkBudget('ENGLAND');
      expect(result.allowed).toBe(true);
      expect(result.agentStatus).toBe('OK');
      expect(result.gameStatus).toBe('OK');
    });

    it('should warn when approaching agent budget', () => {
      const config: TokenBudgetConfig = {
        maxAgentCostUsd: 0.001, // Very small budget
        warningThreshold: 0.5,
      };
      const tracker = new TokenTracker('test-game', config);

      // Record enough usage to exceed 50% of $0.001 budget
      // claude-3-haiku: $0.25/M input + $1.25/M output
      // 1000 input tokens = $0.00025, 200 output tokens = $0.00025 => total $0.0005
      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 1000, 200);

      const result = tracker.checkBudget('ENGLAND');
      expect(result.agentStatus).toBe('WARNING');
      expect(result.allowed).toBe(true);
    });

    it('should block when agent budget exceeded', () => {
      const config: TokenBudgetConfig = {
        maxAgentCostUsd: 0.0001, // Tiny budget
      };
      const tracker = new TokenTracker('test-game', config);

      // This should exceed the tiny budget
      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 10000, 5000);

      const result = tracker.checkBudget('ENGLAND');
      expect(result.agentStatus).toBe('EXCEEDED');
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('ENGLAND');
      expect(result.message).toContain('exceeded');
    });

    it('should enforce game-wide budget', () => {
      const config: TokenBudgetConfig = {
        maxGameCostUsd: 0.0001,
      };
      const tracker = new TokenTracker('test-game', config);

      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 10000, 5000);

      const result = tracker.checkBudget('FRANCE');
      expect(result.gameStatus).toBe('EXCEEDED');
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('Game');
    });

    it('should call budget callbacks on warning/exceeded', () => {
      const config: TokenBudgetConfig = {
        maxAgentCostUsd: 0.0001,
      };
      const tracker = new TokenTracker('test-game', config);

      const callback = vi.fn();
      tracker.onBudgetStatus(callback);

      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 10000, 5000);

      expect(callback).toHaveBeenCalledWith('ENGLAND', 'EXCEEDED', expect.any(Number));
    });

    it('should not call callback when budget is OK', () => {
      const config: TokenBudgetConfig = {
        maxAgentCostUsd: 100, // Very large budget
      };
      const tracker = new TokenTracker('test-game', config);

      const callback = vi.fn();
      tracker.onBudgetStatus(callback);

      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 100, 50);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('usage summaries', () => {
    it('should return per-power usage summary', () => {
      const tracker = new TokenTracker('test-game');
      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 500, 200);
      tracker.record('ENGLAND', 'claude-3-haiku', 'MOVEMENT', 'SPRING', 1901, 400, 150);
      tracker.record('ENGLAND', 'gpt-4o', 'DIPLOMACY', 'FALL', 1901, 600, 250);

      const summary = tracker.getPowerUsage('ENGLAND');
      expect(summary.power).toBe('ENGLAND');
      expect(summary.totalInputTokens).toBe(1500);
      expect(summary.totalOutputTokens).toBe(600);
      expect(summary.totalTokens).toBe(2100);
      expect(summary.requestCount).toBe(3);
      expect(summary.byModel.size).toBe(2);
      expect(summary.byPhase.size).toBe(2);
    });

    it('should return empty summary for unknown power', () => {
      const tracker = new TokenTracker('test-game');
      const summary = tracker.getPowerUsage('UNKNOWN');
      expect(summary.totalTokens).toBe(0);
      expect(summary.requestCount).toBe(0);
    });

    it('should track agent total cost', () => {
      const tracker = new TokenTracker('test-game');
      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 1_000_000, 0);
      // $0.25 for 1M input tokens on haiku

      const cost = tracker.getAgentTotalCost('ENGLAND');
      expect(cost).toBeCloseTo(0.25, 4);
    });

    it('should track game total cost', () => {
      const tracker = new TokenTracker('test-game');
      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 1_000_000, 0);
      tracker.record('FRANCE', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 1_000_000, 0);

      const cost = tracker.getGameTotalCost();
      expect(cost).toBeCloseTo(0.50, 4);
    });
  });

  describe('game cost report', () => {
    function createPopulatedTracker(): TokenTracker {
      const tracker = new TokenTracker('game-001');
      // England uses Claude Haiku
      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 5000, 2000);
      tracker.record('ENGLAND', 'claude-3-haiku', 'MOVEMENT', 'SPRING', 1901, 3000, 1500);
      // France uses GPT-4o
      tracker.record('FRANCE', 'gpt-4o', 'DIPLOMACY', 'SPRING', 1901, 4000, 1800);
      tracker.record('FRANCE', 'gpt-4o', 'MOVEMENT', 'SPRING', 1901, 3500, 1200);
      // Germany uses Claude Haiku (same as England)
      tracker.record('GERMANY', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 4500, 1900);
      return tracker;
    }

    it('should generate a complete report', () => {
      const tracker = createPopulatedTracker();
      const report = tracker.generateReport();

      expect(report.gameId).toBe('game-001');
      expect(report.totalRequests).toBe(5);
      expect(report.totalInputTokens).toBe(20000);
      expect(report.totalOutputTokens).toBe(8400);
      expect(report.totalTokens).toBe(28400);
      expect(report.totalCostUsd).toBeGreaterThan(0);
      expect(report.byPower).toHaveLength(3);
      expect(report.byModel).toHaveLength(2);
    });

    it('should identify the most expensive power', () => {
      const tracker = createPopulatedTracker();
      const report = tracker.generateReport();
      // GPT-4o is much more expensive per token than Haiku, so France should be most expensive
      expect(report.mostExpensivePower?.power).toBe('FRANCE');
    });

    it('should identify the chattiest power', () => {
      const tracker = createPopulatedTracker();
      const report = tracker.generateReport();
      // England and France both have 2 requests, Germany has 1
      expect(['ENGLAND', 'FRANCE']).toContain(report.chattiestPower?.power);
      expect(report.chattiestPower?.requests).toBe(2);
    });

    it('should identify the most expensive phase', () => {
      const tracker = createPopulatedTracker();
      const report = tracker.generateReport();
      // DIPLOMACY has 3 requests, MOVEMENT has 2 - DIPLOMACY should be more expensive
      expect(report.mostExpensivePhase?.phase).toBe('DIPLOMACY');
    });

    it('should handle empty tracker', () => {
      const tracker = new TokenTracker('empty-game');
      const report = tracker.generateReport();

      expect(report.totalRequests).toBe(0);
      expect(report.totalCostUsd).toBe(0);
      expect(report.byPower).toHaveLength(0);
      expect(report.byModel).toHaveLength(0);
      expect(report.mostExpensivePower).toBeUndefined();
      expect(report.chattiestPower).toBeUndefined();
      expect(report.mostExpensivePhase).toBeUndefined();
    });
  });

  describe('formatGameCostReport', () => {
    it('should produce readable output', () => {
      const tracker = new TokenTracker('game-fmt');
      tracker.record('ENGLAND', 'claude-3-haiku', 'DIPLOMACY', 'SPRING', 1901, 5000, 2000);
      tracker.record('FRANCE', 'gpt-4o', 'MOVEMENT', 'SPRING', 1901, 3000, 1000);

      const report = tracker.generateReport();
      const output = formatGameCostReport(report);

      expect(output).toContain('TOKEN USAGE & COST REPORT');
      expect(output).toContain('game-fmt');
      expect(output).toContain('ENGLAND');
      expect(output).toContain('FRANCE');
      expect(output).toContain('claude-3-haiku');
      expect(output).toContain('gpt-4o');
      expect(output).toContain('BY MODEL');
      expect(output).toContain('BY AGENT');
    });

    it('should handle empty report', () => {
      const tracker = new TokenTracker('empty');
      const report = tracker.generateReport();
      const output = formatGameCostReport(report);

      expect(output).toContain('TOKEN USAGE & COST REPORT');
      expect(output).toContain('Total Requests: 0');
    });
  });

  describe('DEFAULT_MODEL_PRICING', () => {
    it('should contain pricing for major models', () => {
      const models = DEFAULT_MODEL_PRICING.map(p => p.model);
      expect(models).toContain('claude-3-haiku');
      expect(models).toContain('claude-3-opus');
      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
    });

    it('should have positive pricing for all models', () => {
      for (const pricing of DEFAULT_MODEL_PRICING) {
        expect(pricing.inputCostPerMillion).toBeGreaterThan(0);
        expect(pricing.outputCostPerMillion).toBeGreaterThan(0);
      }
    });
  });
});
