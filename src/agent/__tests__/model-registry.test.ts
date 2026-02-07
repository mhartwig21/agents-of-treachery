/**
 * Tests for the Model Registry module.
 *
 * Covers: model registration, tier-level budget tracking, per-power assignment,
 * budget-aware routing with fallback, and factory functions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ModelRegistry,
  createOpenAIFreeTierRegistry,
  createDiverseOpenAIRegistry,
  createUniformOpenAIRegistry,
  BUILTIN_MODELS,
  OPENAI_FREE_TIER_BUDGETS,
} from '../model-registry';
import type { ModelDefinition, TierBudgetConfig } from '../model-registry';
import { POWERS } from '../../engine/types';
import type { Power } from '../../engine/types';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry(OPENAI_FREE_TIER_BUDGETS);
  });

  describe('model registration', () => {
    it('should have all 24 built-in models registered', () => {
      const models = registry.getAllModels();
      expect(models.length).toBe(BUILTIN_MODELS.length);
      expect(models.length).toBe(24);
    });

    it('should have all 10 OpenAI premium models', () => {
      const premiumOpenAI = registry.getModelsByTier('premium')
        .filter(m => m.provider === 'openai');
      expect(premiumOpenAI.length).toBe(10);
      const ids = premiumOpenAI.map(m => m.id).sort();
      expect(ids).toEqual([
        'gpt-4.1', 'gpt-4o', 'gpt-5', 'gpt-5-chat-latest',
        'gpt-5-codex', 'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.2',
        'o1', 'o3',
      ]);
    });

    it('should have all 10 OpenAI mini models', () => {
      const miniOpenAI = registry.getModelsByTier('mini')
        .filter(m => m.provider === 'openai');
      expect(miniOpenAI.length).toBe(10);
      const ids = miniOpenAI.map(m => m.id).sort();
      expect(ids).toEqual([
        'codex-mini-latest', 'gpt-4.1-mini', 'gpt-4.1-nano',
        'gpt-4o-mini', 'gpt-5-mini', 'gpt-5-nano',
        'gpt-5.1-codex-mini', 'o1-mini', 'o3-mini', 'o4-mini',
      ]);
    });

    it('should register a custom model', () => {
      const custom: ModelDefinition = {
        id: 'test-model',
        provider: 'custom',
        displayName: 'Test Model',
        costPerInputToken: 0.001,
        costPerOutputToken: 0.002,
        maxContextTokens: 4096,
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
        tier: 'premium',
      };
      registry.registerModel(updated);
      expect(registry.getModel('gpt-4o')!.displayName).toBe('GPT-4o Updated');
    });

    it('should return undefined for unknown models', () => {
      expect(registry.getModel('nonexistent')).toBeUndefined();
    });

    it('should filter models by provider', () => {
      const anthropic = registry.getModelsByProvider('anthropic');
      expect(anthropic.length).toBe(2);
      expect(anthropic.every(m => m.provider === 'anthropic')).toBe(true);
    });

    it('should filter models by tier', () => {
      const premium = registry.getModelsByTier('premium');
      expect(premium.every(m => m.tier === 'premium')).toBe(true);
      expect(premium.length).toBeGreaterThanOrEqual(10); // At least 10 OpenAI premium
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
      registry.assignModelToPower('FRANCE', 'gpt-5.1', 'gpt-5-mini');
      const assignment = registry.getAssignment('FRANCE');
      expect(assignment!.modelId).toBe('gpt-5.1');
      expect(assignment!.fallbackModelId).toBe('gpt-5-mini');
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
      registry.assignModelToPower('FRANCE', 'gpt-5.1');
      registry.clearAssignments();
      expect(registry.getAssignment('ENGLAND')).toBeUndefined();
      expect(registry.getAssignment('FRANCE')).toBeUndefined();
    });
  });

  describe('tier-level budget tracking', () => {
    it('should track usage at the tier level across models', () => {
      // Both gpt-5.1 and gpt-4o are premium - usage should aggregate
      registry.recordUsage('gpt-5.1', 10000, 5000);
      registry.recordUsage('gpt-4o', 20000, 10000);

      const tierBudget = registry.getTierBudget('premium');
      expect(tierBudget).toBeDefined();
      expect(tierBudget!.tokensUsedToday).toBe(45000); // 15K + 30K
    });

    it('should track per-model breakdown within tier', () => {
      registry.recordUsage('gpt-5.1', 10000, 5000);
      registry.recordUsage('gpt-4o', 20000, 10000);

      const tierBudget = registry.getTierBudget('premium');
      expect(tierBudget!.usageByModel.get('gpt-5.1')).toBe(15000);
      expect(tierBudget!.usageByModel.get('gpt-4o')).toBe(30000);
    });

    it('should track mini tier separately from premium', () => {
      registry.recordUsage('gpt-4o', 50000, 20000);       // premium
      registry.recordUsage('gpt-4o-mini', 100000, 50000);  // mini

      const premiumBudget = registry.getTierBudget('premium');
      const miniBudget = registry.getTierBudget('mini');
      expect(premiumBudget!.tokensUsedToday).toBe(70000);
      expect(miniBudget!.tokensUsedToday).toBe(150000);
    });

    it('should report within budget when under shared limit', () => {
      // Use gpt-5.1 for some, gpt-4o for some — both premium
      registry.recordUsage('gpt-5.1', 50000, 25000);
      registry.recordUsage('gpt-4o', 50000, 25000);
      // Total: 150K out of 250K premium limit
      expect(registry.isTierWithinBudget('gpt-5.1')).toBe(true);
      expect(registry.isTierWithinBudget('gpt-4o')).toBe(true);
    });

    it('should report over budget when shared tier limit exceeded', () => {
      // Exhaust premium tier using multiple models
      registry.recordUsage('gpt-5.1', 80000, 40000);  // 120K
      registry.recordUsage('gpt-4o', 80000, 40000);   // 120K
      registry.recordUsage('o3', 10000, 5000);         // 15K
      // Total: 255K > 250K premium limit

      // ALL premium models should be over budget
      expect(registry.isTierWithinBudget('gpt-5.1')).toBe(false);
      expect(registry.isTierWithinBudget('gpt-4o')).toBe(false);
      expect(registry.isTierWithinBudget('o3')).toBe(false);
      expect(registry.isTierWithinBudget('gpt-5.2')).toBe(false);

      // Mini tier should still be fine
      expect(registry.isTierWithinBudget('gpt-4o-mini')).toBe(true);
    });

    it('should count all premium models against shared tier budget including non-OpenAI', () => {
      // Claude Sonnet is premium tier — counts against the shared premium budget
      registry.recordUsage('claude-sonnet-4-5-20250929', 200000, 60000);
      // 260K > 250K premium limit
      expect(registry.isTierWithinBudget('claude-sonnet-4-5-20250929')).toBe(false);
      expect(registry.isTierWithinBudget('gpt-4o')).toBe(false); // Same tier, shared budget
    });

    it('should always be within budget for unknown models', () => {
      expect(registry.isTierWithinBudget('nonexistent')).toBe(true);
    });

    it('should silently ignore recordUsage for unknown models', () => {
      // Should not throw
      registry.recordUsage('nonexistent', 1000, 500);
      expect(registry.getTierBudget('premium')!.tokensUsedToday).toBe(0);
    });

    it('should return undefined for tiers without budgets', () => {
      expect(registry.getTierBudget('standard')).toBeUndefined();
    });

    it('should return all tier budgets', () => {
      const budgets = registry.getAllTierBudgets();
      expect(budgets.length).toBe(2); // premium + mini
      const tiers = budgets.map(b => b.tier).sort();
      expect(tiers).toEqual(['mini', 'premium']);
    });

    it('should calculate usage percentage', () => {
      registry.recordUsage('gpt-4o', 100000, 25000); // 125K of 250K = 50%
      expect(registry.getTierUsagePercent('premium')).toBeCloseTo(0.5, 2);
    });

    it('should return 0 usage percent for unlimited tiers', () => {
      expect(registry.getTierUsagePercent('standard')).toBe(0);
    });

    it('should reset all budgets', () => {
      registry.recordUsage('gpt-4o', 100000, 50000);
      registry.recordUsage('gpt-4o-mini', 200000, 100000);
      registry.resetBudgets();

      const premiumBudget = registry.getTierBudget('premium');
      const miniBudget = registry.getTierBudget('mini');
      expect(premiumBudget!.tokensUsedToday).toBe(0);
      expect(miniBudget!.tokensUsedToday).toBe(0);
      expect(premiumBudget!.usageByModel.size).toBe(0);
    });

    it('should allow setting tier budget after construction', () => {
      const plainRegistry = new ModelRegistry();
      expect(plainRegistry.getTierBudget('premium')).toBeUndefined();

      plainRegistry.setTierBudget({ tier: 'premium', dailyTokenLimit: 100000 });
      const budget = plainRegistry.getTierBudget('premium');
      expect(budget).toBeDefined();
      expect(budget!.dailyLimit).toBe(100000);
    });

    it('should preserve usage when updating tier budget config', () => {
      registry.recordUsage('gpt-4o', 50000, 25000);
      registry.setTierBudget({ tier: 'premium', dailyTokenLimit: 500000 });

      const budget = registry.getTierBudget('premium');
      expect(budget!.dailyLimit).toBe(500000);
      expect(budget!.tokensUsedToday).toBe(75000); // Usage preserved
    });
  });

  describe('model resolution with tier budgets', () => {
    it('should resolve assigned model when tier is within budget', () => {
      registry.assignModelToPower('ENGLAND', 'gpt-5.1', 'gpt-5-mini');
      expect(registry.resolveModelForPower('ENGLAND')).toBe('gpt-5.1');
    });

    it('should fall back when premium tier budget exhausted', () => {
      registry.assignModelToPower('ENGLAND', 'gpt-5.1', 'gpt-5-mini');

      // Exhaust premium tier with a DIFFERENT model (tier is shared!)
      registry.recordUsage('gpt-4o', 200000, 60000);

      // England's gpt-5.1 should fall back because premium tier is exhausted
      expect(registry.resolveModelForPower('ENGLAND')).toBe('gpt-5-mini');
    });

    it('should return primary model when budget exhausted but no fallback', () => {
      registry.assignModelToPower('FRANCE', 'gpt-5.1');
      registry.recordUsage('gpt-4o', 200000, 60000); // Exhaust premium

      expect(registry.resolveModelForPower('FRANCE')).toBe('gpt-5.1');
    });

    it('should return undefined for unassigned power', () => {
      expect(registry.resolveModelForPower('ITALY')).toBeUndefined();
    });

    it('should not fall back if only mini tier is exhausted', () => {
      registry.assignModelToPower('ENGLAND', 'gpt-5.1', 'gpt-5-mini');

      // Exhaust mini tier
      registry.recordUsage('gpt-4o-mini', 2000000, 600000);

      // Premium is still fine
      expect(registry.resolveModelForPower('ENGLAND')).toBe('gpt-5.1');
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

    it('should calculate cost for gpt-5.2 (most expensive premium)', () => {
      const cost = registry.calculateCost('gpt-5.2', 10000, 5000);
      // 10000 * 0.00000175 + 5000 * 0.000014 = 0.0175 + 0.07 = 0.0875
      expect(cost).toBeCloseTo(0.0875, 4);
    });

    it('should calculate cost for gpt-5-nano (cheapest mini)', () => {
      const cost = registry.calculateCost('gpt-5-nano', 100000, 50000);
      // 100000 * 0.00000005 + 50000 * 0.0000004 = 0.005 + 0.02 = 0.025
      expect(cost).toBeCloseTo(0.025, 4);
    });

    it('should calculate cost for o1 (expensive reasoning)', () => {
      const cost = registry.calculateCost('o1', 10000, 5000);
      // 10000 * 0.000015 + 5000 * 0.00006 = 0.15 + 0.30 = 0.45
      expect(cost).toBeCloseTo(0.45, 4);
    });

    it('should return 0 for unknown model', () => {
      expect(registry.calculateCost('nonexistent', 10000, 5000)).toBe(0);
    });
  });

  describe('model definitions correctness', () => {
    it('all models should have positive context windows', () => {
      for (const model of BUILTIN_MODELS) {
        expect(model.maxContextTokens).toBeGreaterThan(0);
      }
    });

    it('all models should have non-negative costs', () => {
      for (const model of BUILTIN_MODELS) {
        expect(model.costPerInputToken).toBeGreaterThanOrEqual(0);
        expect(model.costPerOutputToken).toBeGreaterThanOrEqual(0);
      }
    });

    it('mini models should be cheaper than premium models on average', () => {
      const premium = BUILTIN_MODELS.filter(m => m.tier === 'premium' && m.provider === 'openai');
      const mini = BUILTIN_MODELS.filter(m => m.tier === 'mini' && m.provider === 'openai');

      const avgPremiumInput = premium.reduce((s, m) => s + m.costPerInputToken, 0) / premium.length;
      const avgMiniInput = mini.reduce((s, m) => s + m.costPerInputToken, 0) / mini.length;

      expect(avgMiniInput).toBeLessThan(avgPremiumInput);
    });

    it('gpt-4.1 family should have 1M+ context window', () => {
      const gpt41Models = BUILTIN_MODELS.filter(m => m.id.startsWith('gpt-4.1'));
      for (const model of gpt41Models) {
        expect(model.maxContextTokens).toBeGreaterThanOrEqual(1000000);
      }
    });

    it('gpt-5 family should have 400K context window', () => {
      const gpt5Models = BUILTIN_MODELS.filter(m =>
        m.id.startsWith('gpt-5') && m.provider === 'openai'
      );
      for (const model of gpt5Models) {
        expect(model.maxContextTokens).toBe(400000);
      }
    });
  });
});

describe('createOpenAIFreeTierRegistry', () => {
  it('should create registry with tier budgets configured', () => {
    const registry = createOpenAIFreeTierRegistry();

    const premium = registry.getTierBudget('premium');
    const mini = registry.getTierBudget('mini');
    expect(premium).toBeDefined();
    expect(premium!.dailyLimit).toBe(250000);
    expect(mini).toBeDefined();
    expect(mini!.dailyLimit).toBe(2500000);
  });

  it('should have all 24 built-in models', () => {
    const registry = createOpenAIFreeTierRegistry();
    expect(registry.getAllModels().length).toBe(24);
  });
});

describe('createDiverseOpenAIRegistry', () => {
  it('should assign different models to each power', () => {
    const powers = POWERS as unknown as Power[];
    const registry = createDiverseOpenAIRegistry(powers);

    const modelIds = new Set<string>();
    for (const power of powers) {
      const assignment = registry.getAssignment(power);
      expect(assignment).toBeDefined();
      expect(assignment!.fallbackModelId).toBeDefined();
      modelIds.add(assignment!.modelId);
    }

    // Should use multiple different models (at least 5 unique for 7 powers)
    expect(modelIds.size).toBeGreaterThanOrEqual(5);
  });

  it('should assign premium models as primary with mini fallbacks', () => {
    const powers = POWERS as unknown as Power[];
    const registry = createDiverseOpenAIRegistry(powers);

    for (const power of powers) {
      const assignment = registry.getAssignment(power);
      const primary = registry.getModel(assignment!.modelId);
      const fallback = registry.getModel(assignment!.fallbackModelId!);

      expect(primary!.tier).toBe('premium');
      expect(fallback!.tier).toBe('mini');
    }
  });

  it('should have tier budgets configured', () => {
    const powers = POWERS as unknown as Power[];
    const registry = createDiverseOpenAIRegistry(powers);

    expect(registry.getTierBudget('premium')!.dailyLimit).toBe(250000);
    expect(registry.getTierBudget('mini')!.dailyLimit).toBe(2500000);
  });
});

describe('createUniformOpenAIRegistry', () => {
  it('should assign same model to all powers', () => {
    const powers = POWERS as unknown as Power[];
    const registry = createUniformOpenAIRegistry(powers);

    for (const power of powers) {
      const assignment = registry.getAssignment(power);
      expect(assignment!.modelId).toBe('gpt-4o');
      expect(assignment!.fallbackModelId).toBe('gpt-4o-mini');
    }
  });

  it('should accept custom model and fallback', () => {
    const powers = POWERS as unknown as Power[];
    const registry = createUniformOpenAIRegistry(powers, 'gpt-5.1', 'gpt-5-mini');

    for (const power of powers) {
      const assignment = registry.getAssignment(power);
      expect(assignment!.modelId).toBe('gpt-5.1');
      expect(assignment!.fallbackModelId).toBe('gpt-5-mini');
    }
  });
});

describe('registry without tier budgets', () => {
  it('should work without any tier budget configuration', () => {
    const registry = new ModelRegistry();
    registry.assignModelToPower('ENGLAND', 'gpt-4o', 'gpt-4o-mini');

    // Should always resolve to primary (no budget to exhaust)
    registry.recordUsage('gpt-4o', 1000000, 500000);
    expect(registry.resolveModelForPower('ENGLAND')).toBe('gpt-4o');
    expect(registry.isTierWithinBudget('gpt-4o')).toBe(true);
  });
});
