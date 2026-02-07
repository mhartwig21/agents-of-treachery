/**
 * Model Registry - Multi-model management with tier-level budget tracking.
 *
 * Provides model definitions with cost/capability metadata, per-power model
 * assignment, and tier-aware token budget tracking. The OpenAI free tier shares
 * budgets across ALL models in a tier (250K/day for premium, 2.5M/day for mini),
 * so budget tracking operates at the tier level, not per-model.
 */

import type { Power } from '../engine/types';

/**
 * Model quality tier for routing and budget decisions.
 */
export type ModelTier = 'premium' | 'standard' | 'mini';

/**
 * Definition of an LLM model with its capabilities and cost structure.
 */
export interface ModelDefinition {
  /** Unique model identifier (e.g. "gpt-4o", "gpt-4o-mini") */
  id: string;
  /** Provider name (e.g. "openai", "anthropic", "openrouter") */
  provider: string;
  /** Human-readable display name */
  displayName: string;
  /** Cost per input token in USD */
  costPerInputToken: number;
  /** Cost per output token in USD */
  costPerOutputToken: number;
  /** Maximum context window in tokens */
  maxContextTokens: number;
  /** Model quality tier for routing decisions */
  tier: ModelTier;
}

/**
 * Tier-level budget configuration. Free-tier budgets are shared across
 * all models in the same tier (e.g., all premium models share 250K/day).
 */
export interface TierBudgetConfig {
  /** Tier name */
  tier: ModelTier;
  /** Daily token limit shared across all models in this tier (0 = unlimited) */
  dailyTokenLimit: number;
}

/**
 * Tier-level token budget state for tracking daily usage against shared limits.
 */
export interface TierBudget {
  tier: ModelTier;
  dailyLimit: number;
  tokensUsedToday: number;
  lastResetDate: string;
  /** Per-model breakdown within this tier */
  usageByModel: Map<string, number>;
}

/**
 * Per-power model assignment with optional fallback.
 */
export interface PowerModelConfig {
  power: Power;
  modelId: string;
  /** Model to route to when primary model's tier budget is exhausted */
  fallbackModelId?: string;
}

/**
 * OpenAI free-tier budget configuration.
 */
export const OPENAI_FREE_TIER_BUDGETS: TierBudgetConfig[] = [
  { tier: 'premium', dailyTokenLimit: 250_000 },
  { tier: 'mini', dailyTokenLimit: 2_500_000 },
];

/**
 * Built-in model definitions. Costs are per-token in USD as of early 2026.
 *
 * OpenAI premium tier (250K shared tokens/day free):
 *   gpt-5.2, gpt-5.1, gpt-5.1-codex, gpt-5, gpt-5-codex,
 *   gpt-5-chat-latest, gpt-4.1, gpt-4o, o1, o3
 *
 * OpenAI mini tier (2.5M shared tokens/day free):
 *   gpt-5.1-codex-mini, gpt-5-mini, gpt-5-nano, gpt-4.1-mini,
 *   gpt-4.1-nano, gpt-4o-mini, o1-mini, o3-mini, o4-mini, codex-mini-latest
 */
export const BUILTIN_MODELS: ModelDefinition[] = [
  // === OpenAI Premium Tier (250K shared/day) ===
  {
    id: 'gpt-5.2',
    provider: 'openai',
    displayName: 'GPT-5.2',
    costPerInputToken: 0.00000175,
    costPerOutputToken: 0.000014,
    maxContextTokens: 400000,
    tier: 'premium',
  },
  {
    id: 'gpt-5.1',
    provider: 'openai',
    displayName: 'GPT-5.1',
    costPerInputToken: 0.00000125,
    costPerOutputToken: 0.00001,
    maxContextTokens: 400000,
    tier: 'premium',
  },
  {
    id: 'gpt-5.1-codex',
    provider: 'openai',
    displayName: 'GPT-5.1 Codex',
    costPerInputToken: 0.00000125,
    costPerOutputToken: 0.00001,
    maxContextTokens: 400000,
    tier: 'premium',
  },
  {
    id: 'gpt-5',
    provider: 'openai',
    displayName: 'GPT-5',
    costPerInputToken: 0.00000125,
    costPerOutputToken: 0.00001,
    maxContextTokens: 400000,
    tier: 'premium',
  },
  {
    id: 'gpt-5-codex',
    provider: 'openai',
    displayName: 'GPT-5 Codex',
    costPerInputToken: 0.00000125,
    costPerOutputToken: 0.00001,
    maxContextTokens: 400000,
    tier: 'premium',
  },
  {
    id: 'gpt-5-chat-latest',
    provider: 'openai',
    displayName: 'GPT-5 Chat Latest',
    costPerInputToken: 0.00000125,
    costPerOutputToken: 0.00001,
    maxContextTokens: 400000,
    tier: 'premium',
  },
  {
    id: 'gpt-4.1',
    provider: 'openai',
    displayName: 'GPT-4.1',
    costPerInputToken: 0.000002,
    costPerOutputToken: 0.000008,
    maxContextTokens: 1047576,
    tier: 'premium',
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    costPerInputToken: 0.0000025,
    costPerOutputToken: 0.00001,
    maxContextTokens: 128000,
    tier: 'premium',
  },
  {
    id: 'o1',
    provider: 'openai',
    displayName: 'o1',
    costPerInputToken: 0.000015,
    costPerOutputToken: 0.00006,
    maxContextTokens: 200000,
    tier: 'premium',
  },
  {
    id: 'o3',
    provider: 'openai',
    displayName: 'o3',
    costPerInputToken: 0.000002,
    costPerOutputToken: 0.000008,
    maxContextTokens: 200000,
    tier: 'premium',
  },

  // === OpenAI Mini Tier (2.5M shared/day) ===
  {
    id: 'gpt-5.1-codex-mini',
    provider: 'openai',
    displayName: 'GPT-5.1 Codex Mini',
    costPerInputToken: 0.00000025,
    costPerOutputToken: 0.000002,
    maxContextTokens: 400000,
    tier: 'mini',
  },
  {
    id: 'gpt-5-mini',
    provider: 'openai',
    displayName: 'GPT-5 Mini',
    costPerInputToken: 0.00000025,
    costPerOutputToken: 0.000002,
    maxContextTokens: 400000,
    tier: 'mini',
  },
  {
    id: 'gpt-5-nano',
    provider: 'openai',
    displayName: 'GPT-5 Nano',
    costPerInputToken: 0.00000005,
    costPerOutputToken: 0.0000004,
    maxContextTokens: 400000,
    tier: 'mini',
  },
  {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    displayName: 'GPT-4.1 Mini',
    costPerInputToken: 0.0000004,
    costPerOutputToken: 0.0000016,
    maxContextTokens: 1047576,
    tier: 'mini',
  },
  {
    id: 'gpt-4.1-nano',
    provider: 'openai',
    displayName: 'GPT-4.1 Nano',
    costPerInputToken: 0.0000001,
    costPerOutputToken: 0.0000004,
    maxContextTokens: 1047576,
    tier: 'mini',
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    costPerInputToken: 0.00000015,
    costPerOutputToken: 0.0000006,
    maxContextTokens: 128000,
    tier: 'mini',
  },
  {
    id: 'o1-mini',
    provider: 'openai',
    displayName: 'o1 Mini',
    costPerInputToken: 0.0000011,
    costPerOutputToken: 0.0000044,
    maxContextTokens: 200000,
    tier: 'mini',
  },
  {
    id: 'o3-mini',
    provider: 'openai',
    displayName: 'o3 Mini',
    costPerInputToken: 0.0000011,
    costPerOutputToken: 0.0000044,
    maxContextTokens: 200000,
    tier: 'mini',
  },
  {
    id: 'o4-mini',
    provider: 'openai',
    displayName: 'o4 Mini',
    costPerInputToken: 0.0000011,
    costPerOutputToken: 0.0000044,
    maxContextTokens: 200000,
    tier: 'mini',
  },
  {
    id: 'codex-mini-latest',
    provider: 'openai',
    displayName: 'Codex Mini Latest',
    costPerInputToken: 0.00000025,
    costPerOutputToken: 0.000002,
    maxContextTokens: 400000,
    tier: 'mini',
  },

  // === Anthropic (no free tier, unlimited budget) ===
  {
    id: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.5',
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
    maxContextTokens: 200000,
    tier: 'premium',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    costPerInputToken: 0.0000008,
    costPerOutputToken: 0.000004,
    maxContextTokens: 200000,
    tier: 'mini',
  },

  // === OpenRouter (pass-through, no free tier) ===
  {
    id: 'openai/gpt-4o',
    provider: 'openrouter',
    displayName: 'GPT-4o (OpenRouter)',
    costPerInputToken: 0.0000025,
    costPerOutputToken: 0.00001,
    maxContextTokens: 128000,
    tier: 'premium',
  },
  {
    id: 'openai/gpt-4o-mini',
    provider: 'openrouter',
    displayName: 'GPT-4o Mini (OpenRouter)',
    costPerInputToken: 0.00000015,
    costPerOutputToken: 0.0000006,
    maxContextTokens: 128000,
    tier: 'mini',
  },
];

/**
 * Get today's date as an ISO date string (YYYY-MM-DD).
 */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Registry for managing model definitions, per-power assignments,
 * and tier-level token budget tracking with fallback routing.
 */
export class ModelRegistry {
  private models = new Map<string, ModelDefinition>();
  private tierBudgets = new Map<ModelTier, TierBudget>();
  private powerAssignments = new Map<Power, PowerModelConfig>();

  constructor(tierBudgetConfigs?: TierBudgetConfig[]) {
    // Register built-in models
    for (const model of BUILTIN_MODELS) {
      this.models.set(model.id, model);
    }
    // Initialize tier budgets if provided
    if (tierBudgetConfigs) {
      for (const config of tierBudgetConfigs) {
        this.tierBudgets.set(config.tier, {
          tier: config.tier,
          dailyLimit: config.dailyTokenLimit,
          tokensUsedToday: 0,
          lastResetDate: todayDateString(),
          usageByModel: new Map(),
        });
      }
    }
  }

  /**
   * Register a model definition. Overwrites if model ID already exists.
   */
  registerModel(def: ModelDefinition): void {
    this.models.set(def.id, def);
  }

  /**
   * Get a model definition by ID.
   */
  getModel(modelId: string): ModelDefinition | undefined {
    return this.models.get(modelId);
  }

  /**
   * Get all registered model definitions.
   */
  getAllModels(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  /**
   * Get all models in a specific tier.
   */
  getModelsByTier(tier: ModelTier): ModelDefinition[] {
    return Array.from(this.models.values()).filter(m => m.tier === tier);
  }

  /**
   * Get all models from a specific provider.
   */
  getModelsByProvider(provider: string): ModelDefinition[] {
    return Array.from(this.models.values()).filter(m => m.provider === provider);
  }

  /**
   * Configure tier-level budget. Replaces any existing budget for the tier.
   */
  setTierBudget(config: TierBudgetConfig): void {
    const existing = this.tierBudgets.get(config.tier);
    this.tierBudgets.set(config.tier, {
      tier: config.tier,
      dailyLimit: config.dailyTokenLimit,
      tokensUsedToday: existing?.tokensUsedToday ?? 0,
      lastResetDate: existing?.lastResetDate ?? todayDateString(),
      usageByModel: existing?.usageByModel ?? new Map(),
    });
  }

  /**
   * Assign a model to a power with optional fallback.
   */
  assignModelToPower(power: Power, modelId: string, fallbackModelId?: string): void {
    if (!this.models.has(modelId)) {
      throw new Error(`Model not registered: ${modelId}`);
    }
    if (fallbackModelId && !this.models.has(fallbackModelId)) {
      throw new Error(`Fallback model not registered: ${fallbackModelId}`);
    }
    this.powerAssignments.set(power, { power, modelId, fallbackModelId });
  }

  /**
   * Get the model assignment for a power (if any).
   */
  getAssignment(power: Power): PowerModelConfig | undefined {
    return this.powerAssignments.get(power);
  }

  /**
   * Resolve the effective model ID for a power, considering tier budget constraints.
   * Returns the assigned model if its tier is within budget, or the fallback if not.
   * Returns undefined if no assignment exists for this power.
   */
  resolveModelForPower(power: Power): string | undefined {
    const assignment = this.powerAssignments.get(power);
    if (!assignment) return undefined;

    if (this.isTierWithinBudget(assignment.modelId)) {
      return assignment.modelId;
    }

    // Tier budget exhausted - use fallback if available
    if (assignment.fallbackModelId) {
      return assignment.fallbackModelId;
    }

    // No fallback - still use primary model (caller will handle the overage)
    return assignment.modelId;
  }

  /**
   * Record token usage for a model, updating the tier-level budget.
   */
  recordUsage(modelId: string, inputTokens: number, outputTokens: number): void {
    const model = this.models.get(modelId);
    if (!model) return;

    const tierBudget = this.tierBudgets.get(model.tier);
    if (!tierBudget) return;

    const today = todayDateString();
    if (tierBudget.lastResetDate !== today) {
      tierBudget.tokensUsedToday = 0;
      tierBudget.lastResetDate = today;
      tierBudget.usageByModel.clear();
    }

    const totalTokens = inputTokens + outputTokens;
    tierBudget.tokensUsedToday += totalTokens;
    tierBudget.usageByModel.set(
      modelId,
      (tierBudget.usageByModel.get(modelId) ?? 0) + totalTokens,
    );
  }

  /**
   * Check if a model's tier is within its daily shared budget.
   * Models without a tier budget always return true.
   */
  isTierWithinBudget(modelId: string): boolean {
    const model = this.models.get(modelId);
    if (!model) return true;

    const tierBudget = this.tierBudgets.get(model.tier);
    if (!tierBudget) return true;
    if (tierBudget.dailyLimit === 0) return true;

    const today = todayDateString();
    if (tierBudget.lastResetDate !== today) {
      return true; // New day, budget resets
    }

    return tierBudget.tokensUsedToday < tierBudget.dailyLimit;
  }

  /**
   * Get the tier budget status. Returns undefined for tiers without budgets.
   */
  getTierBudget(tier: ModelTier): TierBudget | undefined {
    const budget = this.tierBudgets.get(tier);
    if (!budget) return undefined;

    const today = todayDateString();
    if (budget.lastResetDate !== today) {
      return {
        ...budget,
        tokensUsedToday: 0,
        lastResetDate: today,
        usageByModel: new Map(),
      };
    }
    return {
      ...budget,
      usageByModel: new Map(budget.usageByModel),
    };
  }

  /**
   * Get budget status for all configured tiers.
   */
  getAllTierBudgets(): TierBudget[] {
    const today = todayDateString();
    return Array.from(this.tierBudgets.values()).map(budget => {
      if (budget.lastResetDate !== today) {
        return {
          ...budget,
          tokensUsedToday: 0,
          lastResetDate: today,
          usageByModel: new Map(),
        };
      }
      return { ...budget, usageByModel: new Map(budget.usageByModel) };
    });
  }

  /**
   * Get the percentage of tier budget used (0-1). Returns 0 for unlimited tiers.
   */
  getTierUsagePercent(tier: ModelTier): number {
    const budget = this.getTierBudget(tier);
    if (!budget || budget.dailyLimit === 0) return 0;
    return budget.tokensUsedToday / budget.dailyLimit;
  }

  /**
   * Calculate the cost for a given token usage on a specific model.
   */
  calculateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    const model = this.models.get(modelId);
    if (!model) return 0;
    return (inputTokens * model.costPerInputToken) + (outputTokens * model.costPerOutputToken);
  }

  /**
   * Clear all power assignments.
   */
  clearAssignments(): void {
    this.powerAssignments.clear();
  }

  /**
   * Reset all tier budget counters.
   */
  resetBudgets(): void {
    const today = todayDateString();
    for (const budget of this.tierBudgets.values()) {
      budget.tokensUsedToday = 0;
      budget.lastResetDate = today;
      budget.usageByModel.clear();
    }
  }
}

/**
 * Create a ModelRegistry with OpenAI free-tier budget tracking enabled.
 * All premium models share 250K/day, all mini models share 2.5M/day.
 */
export function createOpenAIFreeTierRegistry(): ModelRegistry {
  return new ModelRegistry(OPENAI_FREE_TIER_BUDGETS);
}

/**
 * Create a registry pre-configured for diverse OpenAI free-tier play.
 * Assigns different premium models to each power for personality diversity,
 * with mini-tier fallbacks when premium budget is exhausted.
 */
export function createDiverseOpenAIRegistry(powers: Power[]): ModelRegistry {
  const registry = createOpenAIFreeTierRegistry();

  // Map powers to different premium models for personality diversity
  const premiumModels = [
    'gpt-5.1',           // Sophisticated, diplomatic
    'gpt-4.1',           // Direct, efficient
    'gpt-5',             // Balanced, strategic
    'o3',                // Analytical, calculating
    'gpt-4o',            // Cooperative, conversational
    'gpt-5.2',           // Most capable, patient
    'gpt-5-chat-latest', // Conversational, cautious
  ];

  const miniModels = [
    'gpt-5-mini',
    'gpt-4.1-mini',
    'gpt-5-mini',
    'o3-mini',
    'gpt-4o-mini',
    'gpt-5.1-codex-mini',
    'gpt-4.1-mini',
  ];

  for (let i = 0; i < powers.length; i++) {
    const premiumModel = premiumModels[i % premiumModels.length];
    const miniModel = miniModels[i % miniModels.length];
    registry.assignModelToPower(powers[i], premiumModel, miniModel);
  }

  return registry;
}

/**
 * Create a basic registry with the same model for all powers (simple setup).
 * Uses OpenAI free-tier budget tracking.
 */
export function createUniformOpenAIRegistry(
  powers: Power[],
  modelId: string = 'gpt-4o',
  fallbackModelId: string = 'gpt-4o-mini',
): ModelRegistry {
  const registry = createOpenAIFreeTierRegistry();
  for (const power of powers) {
    registry.assignModelToPower(power, modelId, fallbackModelId);
  }
  return registry;
}
