/**
 * Tests for the Model Registry module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ModelRegistry,
  createOpenAIFreeRegistry,
  BUILTIN_MODELS,
} from '../model-registry';
import type { ModelDefinition } from '../model-registry';
import { POWERS } from '../../engine/types';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  describe('model registration', () => {
    it('should have built-in models registered', () => {
      for (const model of BUILTIN_MODELS) {
        expect(registry.getModel(model.id)).toBeDefined();
        expect(registry.getModel(model.id)!.id).toBe(model.id);
      }
    });

    it('should register a custom model', () => {
      const custom: ModelDefinition = {
        id: 'test-model',
        provider: 'custom',
        displayName: 'Test Model',
        costPerInputToken: 0.001,
        costPerOutputToken: 0.002,
        maxContextTokens: 4096,
        dailyTokenLimit: 0,
        tier: 'standard',
      };
      registry.registerModel(custom);
      expect(registry.getModel('test-model')).toEqual(custom);
    });

    it('should overwrite existing model on re-registration', () => {
      const updated: ModelDefinition = {
        id: 'gpt-4o',
        provider: 'openai',
        displayName: 'GPT-4o Updated',
        costPerInputToken: 0.000005,
        costPerOutputToken: 0.00002,
        maxContextTokens: 256000,
        dailyTokenLimit: 500000,
        tier: 'premium',
      };
      registry.registerModel(updated);
      expect(registry.getModel('gpt-4o')!.displayName).toBe('GPT-4o Updated');
    });

    it('should return undefined for unknown models', () => {
      expect(registry.getModel('nonexistent')).toBeUndefined();
    });

    it('should return all registered models', () => {
      const models = registry.getAllModels();
      expect(models.length).toBe(BUILTIN_MODELS.length);
    });
  });

  describe('power assignment', () => {
    it('should assign a model to a power', () => {
      registry.assignModelToPower('ENGLAND', 'gpt-4o');
      const assignment = registry.getAssignment('ENGLAND');
      expect(assignment).toBeDefined();
      expect(assignment!.modelId).toBe('gpt-4o');
    });

    it('should assign model with fallback', () => {
      registry.assignModelToPower('FRANCE', 'gpt-4o', 'gpt-4o-mini');
      const assignment = registry.getAssignment('FRANCE');
      expect(assignment!.modelId).toBe('gpt-4o');
      expect(assignment!.fallbackModelId).toBe('gpt-4o-mini');
    });

    it('should throw for unregistered model', () => {
      expect(() => registry.assignModelToPower('GERMANY', 'nonexistent'))
        .toThrow('Model not registered: nonexistent');
    });

    it('should throw for unregistered fallback model', () => {
      expect(() => registry.assignModelToPower('GERMANY', 'gpt-4o', 'nonexistent'))
        .toThrow('Fallback model not registered: nonexistent');
    });

    it('should return undefined for unassigned power', () => {
      expect(registry.getAssignment('ITALY')).toBeUndefined();
    });

    it('should clear all assignments', () => {
      registry.assignModelToPower('ENGLAND', 'gpt-4o');
      registry.assignModelToPower('FRANCE', 'gpt-4o-mini');
      registry.clearAssignments();
      expect(registry.getAssignment('ENGLAND')).toBeUndefined();
      expect(registry.getAssignment('FRANCE')).toBeUndefined();
    });
  });

  describe('model resolution with budget', () => {
    it('should resolve assigned model when within budget', () => {
      registry.assignModelToPower('ENGLAND', 'gpt-4o', 'gpt-4o-mini');
      expect(registry.resolveModelForPower('ENGLAND')).toBe('gpt-4o');
    });

    it('should fall back when primary model budget exhausted', () => {
      registry.assignModelToPower('ENGLAND', 'gpt-4o', 'gpt-4o-mini');

      // Exhaust the gpt-4o budget (250K tokens)
      registry.recordUsage('gpt-4o', 200000, 60000);

      expect(registry.resolveModelForPower('ENGLAND')).toBe('gpt-4o-mini');
    });

    it('should return primary model when budget exhausted but no fallback', () => {
      registry.assignModelToPower('FRANCE', 'gpt-4o');

      // Exhaust budget
      registry.recordUsage('gpt-4o', 200000, 60000);

      expect(registry.resolveModelForPower('FRANCE')).toBe('gpt-4o');
    });

    it('should return undefined for unassigned power', () => {
      expect(registry.resolveModelForPower('ITALY')).toBeUndefined();
    });
  });

  describe('token budget tracking', () => {
    it('should track token usage against daily limit', () => {
      registry.recordUsage('gpt-4o', 1000, 500);
      const budget = registry.getBudgetStatus('gpt-4o');
      expect(budget).toBeDefined();
      expect(budget!.tokensUsedToday).toBe(1500);
    });

    it('should accumulate usage across calls', () => {
      registry.recordUsage('gpt-4o', 1000, 500);
      registry.recordUsage('gpt-4o', 2000, 1000);
      const budget = registry.getBudgetStatus('gpt-4o');
      expect(budget!.tokensUsedToday).toBe(4500);
    });

    it('should report within budget when under limit', () => {
      registry.recordUsage('gpt-4o', 1000, 500);
      expect(registry.isWithinBudget('gpt-4o')).toBe(true);
    });

    it('should report over budget when exceeding limit', () => {
      registry.recordUsage('gpt-4o', 200000, 60000);
      expect(registry.isWithinBudget('gpt-4o')).toBe(false);
    });

    it('should always be within budget for unlimited models', () => {
      // Claude models have dailyTokenLimit: 0 (unlimited)
      registry.recordUsage('claude-sonnet-4-5-20250929', 1000000, 500000);
      expect(registry.isWithinBudget('claude-sonnet-4-5-20250929')).toBe(true);
    });

    it('should return undefined budget for models without limits', () => {
      expect(registry.getBudgetStatus('claude-sonnet-4-5-20250929')).toBeUndefined();
    });

    it('should return all budgets', () => {
      const budgets = registry.getAllBudgets();
      // gpt-4o and gpt-4o-mini have daily limits
      expect(budgets.length).toBeGreaterThanOrEqual(2);
    });

    it('should reset all budgets', () => {
      registry.recordUsage('gpt-4o', 100000, 50000);
      registry.resetBudgets();
      const budget = registry.getBudgetStatus('gpt-4o');
      expect(budget!.tokensUsedToday).toBe(0);
    });
  });

  describe('cost calculation', () => {
    it('should calculate cost for gpt-4o', () => {
      const cost = registry.calculateCost('gpt-4o', 10000, 5000);
      // 10000 * 0.0000025 + 5000 * 0.00001 = 0.025 + 0.05 = 0.075
      expect(cost).toBeCloseTo(0.075, 4);
    });

    it('should calculate cost for gpt-4o-mini', () => {
      const cost = registry.calculateCost('gpt-4o-mini', 10000, 5000);
      // 10000 * 0.00000015 + 5000 * 0.0000006 = 0.0015 + 0.003 = 0.0045
      expect(cost).toBeCloseTo(0.0045, 4);
    });

    it('should return 0 for unknown model', () => {
      expect(registry.calculateCost('nonexistent', 10000, 5000)).toBe(0);
    });
  });
});

describe('createOpenAIFreeRegistry', () => {
  it('should create registry with all powers assigned to gpt-4o with mini fallback', () => {
    const registry = createOpenAIFreeRegistry(POWERS as unknown as import('../../engine/types').Power[]);

    for (const power of POWERS) {
      const assignment = registry.getAssignment(power);
      expect(assignment).toBeDefined();
      expect(assignment!.modelId).toBe('gpt-4o');
      expect(assignment!.fallbackModelId).toBe('gpt-4o-mini');
    }
  });
});
