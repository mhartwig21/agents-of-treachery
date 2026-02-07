/**
 * Model Registry - Abstraction layer for multi-model management.
 *
 * Provides model definitions with cost/capability metadata, per-power model
 * assignment, token budget tracking (for free-tier daily limits), and
 * token-aware routing that falls back to cheaper models when budgets exhaust.
 */

import type { Power } from '../engine/types';

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
  /** Daily token limit (input + output combined), 0 = unlimited */
  dailyTokenLimit: number;
  /** Model quality tier for routing decisions */
  tier: 'premium' | 'standard' | 'mini';
}

/**
 * Token budget state for tracking daily usage against limits.
 */
export interface TokenBudget {
  modelId: string;
  dailyLimit: number;
  tokensUsedToday: number;
  lastResetDate: string;
}

/**
 * Per-power model assignment with optional fallback.
 */
export interface PowerModelConfig {
  power: Power;
  modelId: string;
  /** Model to route to when primary model's budget is exhausted */
  fallbackModelId?: string;
}

/**
 * Built-in model definitions for common models.
 * Costs are approximate as of early 2026.
 */
export const BUILTIN_MODELS: ModelDefinition[] = [
  {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    costPerInputToken: 0.0000025,
    costPerOutputToken: 0.00001,
    maxContextTokens: 128000,
    dailyTokenLimit: 250000,
    tier: 'premium',
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    costPerInputToken: 0.00000015,
    costPerOutputToken: 0.0000006,
    maxContextTokens: 128000,
    dailyTokenLimit: 2500000,
    tier: 'mini',
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.5',
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
    maxContextTokens: 200000,
    dailyTokenLimit: 0,
    tier: 'premium',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    costPerInputToken: 0.0000008,
    costPerOutputToken: 0.000004,
    maxContextTokens: 200000,
    dailyTokenLimit: 0,
    tier: 'mini',
  },
  {
    id: 'openai/gpt-4o',
    provider: 'openrouter',
    displayName: 'GPT-4o (OpenRouter)',
    costPerInputToken: 0.0000025,
    costPerOutputToken: 0.00001,
    maxContextTokens: 128000,
    dailyTokenLimit: 0,
    tier: 'premium',
  },
  {
    id: 'openai/gpt-4o-mini',
    provider: 'openrouter',
    displayName: 'GPT-4o Mini (OpenRouter)',
    costPerInputToken: 0.00000015,
    costPerOutputToken: 0.0000006,
    maxContextTokens: 128000,
    dailyTokenLimit: 0,
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
 * token budgets, and token-aware routing.
 */
export class ModelRegistry {
  private models = new Map<string, ModelDefinition>();
  private budgets = new Map<string, TokenBudget>();
  private powerAssignments = new Map<Power, PowerModelConfig>();

  constructor() {
    // Register built-in models
    for (const model of BUILTIN_MODELS) {
      this.registerModel(model);
    }
  }

  /**
   * Register a model definition. Overwrites if model ID already exists.
   */
  registerModel(def: ModelDefinition): void {
    this.models.set(def.id, def);
    // Initialize budget if model has a daily limit
    if (def.dailyTokenLimit > 0 && !this.budgets.has(def.id)) {
      this.budgets.set(def.id, {
        modelId: def.id,
        dailyLimit: def.dailyTokenLimit,
        tokensUsedToday: 0,
        lastResetDate: todayDateString(),
      });
    }
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
   * Resolve the effective model ID for a power, considering budget constraints.
   * Returns the assigned model if within budget, or the fallback model if not.
   * Returns undefined if no assignment exists for this power.
   */
  resolveModelForPower(power: Power): string | undefined {
    const assignment = this.powerAssignments.get(power);
    if (!assignment) return undefined;

    if (this.isWithinBudget(assignment.modelId)) {
      return assignment.modelId;
    }

    // Budget exhausted - use fallback if available
    if (assignment.fallbackModelId) {
      return assignment.fallbackModelId;
    }

    // No fallback - still use primary model (caller will handle the overage)
    return assignment.modelId;
  }

  /**
   * Record token usage for a model, updating budget tracking.
   */
  recordUsage(modelId: string, inputTokens: number, outputTokens: number): void {
    const budget = this.budgets.get(modelId);
    if (!budget) return;

    const today = todayDateString();
    if (budget.lastResetDate !== today) {
      budget.tokensUsedToday = 0;
      budget.lastResetDate = today;
    }

    budget.tokensUsedToday += inputTokens + outputTokens;
  }

  /**
   * Check if a model is within its daily token budget.
   * Models without a daily limit always return true.
   */
  isWithinBudget(modelId: string): boolean {
    const budget = this.budgets.get(modelId);
    if (!budget) return true;

    const today = todayDateString();
    if (budget.lastResetDate !== today) {
      return true; // New day, budget resets
    }

    return budget.tokensUsedToday < budget.dailyLimit;
  }

  /**
   * Get the budget status for a model.
   * Returns undefined for models without daily limits.
   */
  getBudgetStatus(modelId: string): TokenBudget | undefined {
    const budget = this.budgets.get(modelId);
    if (!budget) return undefined;

    const today = todayDateString();
    if (budget.lastResetDate !== today) {
      return { ...budget, tokensUsedToday: 0, lastResetDate: today };
    }
    return { ...budget };
  }

  /**
   * Get budget status for all tracked models.
   */
  getAllBudgets(): TokenBudget[] {
    const today = todayDateString();
    return Array.from(this.budgets.values()).map(budget => {
      if (budget.lastResetDate !== today) {
        return { ...budget, tokensUsedToday: 0, lastResetDate: today };
      }
      return { ...budget };
    });
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
   * Reset all budget counters.
   */
  resetBudgets(): void {
    for (const budget of this.budgets.values()) {
      budget.tokensUsedToday = 0;
      budget.lastResetDate = todayDateString();
    }
  }
}

/**
 * Create a ModelRegistry pre-configured for OpenAI free-tier optimization.
 * Assigns GPT-4o as primary with GPT-4o-mini as fallback for all powers.
 */
export function createOpenAIFreeRegistry(powers: Power[]): ModelRegistry {
  const registry = new ModelRegistry();
  for (const power of powers) {
    registry.assignModelToPower(power, 'gpt-4o', 'gpt-4o-mini');
  }
  return registry;
}
