/**
 * Per-Model Token Tracking Module.
 *
 * Tracks token usage per agent (power) per phase per model.
 * Supports budget enforcement with graceful degradation and
 * cost analysis per game.
 */

import type { Season, Phase } from '../engine/types';

/**
 * Pricing per model (cost per million tokens).
 */
export interface ModelPricing {
  model: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

/**
 * Default pricing table for known models.
 * Prices in USD per million tokens.
 */
export const DEFAULT_MODEL_PRICING: ModelPricing[] = [
  // Anthropic Claude models
  { model: 'claude-3-opus', inputCostPerMillion: 15, outputCostPerMillion: 75 },
  { model: 'claude-3-sonnet', inputCostPerMillion: 3, outputCostPerMillion: 15 },
  { model: 'claude-3-haiku', inputCostPerMillion: 0.25, outputCostPerMillion: 1.25 },
  { model: 'claude-3.5-sonnet', inputCostPerMillion: 3, outputCostPerMillion: 15 },
  { model: 'claude-3.5-haiku', inputCostPerMillion: 0.8, outputCostPerMillion: 4 },
  // OpenAI models
  { model: 'gpt-4o', inputCostPerMillion: 2.5, outputCostPerMillion: 10 },
  { model: 'gpt-4o-mini', inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
  { model: 'gpt-4-turbo', inputCostPerMillion: 10, outputCostPerMillion: 30 },
  // OpenRouter prefixed models
  { model: 'anthropic/claude-3-opus', inputCostPerMillion: 15, outputCostPerMillion: 75 },
  { model: 'anthropic/claude-3-sonnet', inputCostPerMillion: 3, outputCostPerMillion: 15 },
  { model: 'anthropic/claude-3-haiku', inputCostPerMillion: 0.25, outputCostPerMillion: 1.25 },
  { model: 'anthropic/claude-3.5-sonnet', inputCostPerMillion: 3, outputCostPerMillion: 15 },
  { model: 'openai/gpt-4o', inputCostPerMillion: 2.5, outputCostPerMillion: 10 },
  { model: 'openai/gpt-4o-mini', inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
  // Meta Llama (typically free or very cheap via OpenRouter)
  { model: 'meta-llama/llama-3.1-70b-instruct', inputCostPerMillion: 0.52, outputCostPerMillion: 0.75 },
  // Mistral
  { model: 'mistralai/mistral-large', inputCostPerMillion: 2, outputCostPerMillion: 6 },
];

/**
 * Individual token usage record for a single LLM call.
 */
export interface TokenRecord {
  power: string;
  model: string;
  phase: Phase;
  season: Season;
  year: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: Date;
}

/**
 * Budget configuration for token usage.
 */
export interface TokenBudgetConfig {
  /** Max total cost (USD) per game. 0 = unlimited. */
  maxGameCostUsd?: number;
  /** Max total cost (USD) per agent per game. 0 = unlimited. */
  maxAgentCostUsd?: number;
  /** Max tokens (input + output) per agent per turn. 0 = unlimited. */
  maxTokensPerTurn?: number;
  /** Warning threshold as fraction of budget (0-1). Default: 0.8. */
  warningThreshold?: number;
  /** Custom pricing overrides (merged with defaults). */
  customPricing?: ModelPricing[];
}

/**
 * Budget status for an agent or game.
 */
export type BudgetStatus = 'OK' | 'WARNING' | 'EXCEEDED';

/**
 * Budget check result before an LLM call.
 */
export interface BudgetCheckResult {
  allowed: boolean;
  agentStatus: BudgetStatus;
  gameStatus: BudgetStatus;
  agentCostUsd: number;
  agentBudgetUsd: number;
  gameCostUsd: number;
  gameBudgetUsd: number;
  message?: string;
}

/**
 * Aggregated usage per power.
 */
export interface PowerUsageSummary {
  power: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
  byModel: Map<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  byPhase: Map<Phase, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
}

/**
 * Aggregated usage per model across all powers.
 */
export interface ModelUsageSummary {
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
  averageInputTokens: number;
  averageOutputTokens: number;
}

/**
 * Full game cost report.
 */
export interface GameCostReport {
  gameId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  totalRequests: number;
  byPower: PowerUsageSummary[];
  byModel: ModelUsageSummary[];
  /** Power with highest cost */
  mostExpensivePower?: { power: string; costUsd: number };
  /** Power with highest request count */
  chattiestPower?: { power: string; requests: number };
  /** Phase with highest cost */
  mostExpensivePhase?: { phase: Phase; costUsd: number };
}

/**
 * Tracks token usage per agent per phase per model with budget enforcement.
 */
export class TokenTracker {
  private gameId: string;
  private records: TokenRecord[] = [];
  private pricingMap: Map<string, ModelPricing>;
  private budgetConfig: TokenBudgetConfig;
  private budgetCallbacks: ((power: string, status: BudgetStatus, costUsd: number) => void)[] = [];

  constructor(gameId: string, budgetConfig?: TokenBudgetConfig) {
    this.gameId = gameId;
    this.budgetConfig = budgetConfig ?? {};
    this.pricingMap = new Map();

    // Load default pricing
    for (const p of DEFAULT_MODEL_PRICING) {
      this.pricingMap.set(p.model, p);
    }

    // Override with custom pricing
    if (budgetConfig?.customPricing) {
      for (const p of budgetConfig.customPricing) {
        this.pricingMap.set(p.model, p);
      }
    }
  }

  /**
   * Register a callback for budget status changes.
   */
  onBudgetStatus(callback: (power: string, status: BudgetStatus, costUsd: number) => void): void {
    this.budgetCallbacks.push(callback);
  }

  /**
   * Calculate cost for given token usage.
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = this.findPricing(model);
    if (!pricing) return 0;

    const inputCost = (inputTokens / 1_000_000) * pricing.inputCostPerMillion;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputCostPerMillion;
    return inputCost + outputCost;
  }

  /**
   * Find pricing for a model. Tries exact match then substring match.
   */
  private findPricing(model: string): ModelPricing | undefined {
    // Exact match
    const exact = this.pricingMap.get(model);
    if (exact) return exact;

    // Substring match (e.g., 'claude-3-haiku-20240307' matches 'claude-3-haiku')
    for (const [key, pricing] of this.pricingMap) {
      if (model.includes(key) || key.includes(model)) {
        return pricing;
      }
    }

    return undefined;
  }

  /**
   * Record token usage from an LLM call.
   */
  record(
    power: string,
    model: string,
    phase: Phase,
    season: Season,
    year: number,
    inputTokens: number,
    outputTokens: number
  ): TokenRecord {
    const costUsd = this.calculateCost(model, inputTokens, outputTokens);

    const record: TokenRecord = {
      power,
      model,
      phase,
      season,
      year,
      inputTokens,
      outputTokens,
      costUsd,
      timestamp: new Date(),
    };

    this.records.push(record);

    // Check budgets and emit callbacks
    const agentCost = this.getAgentTotalCost(power);
    const agentStatus = this.getAgentBudgetStatus(power);
    if (agentStatus !== 'OK') {
      for (const cb of this.budgetCallbacks) {
        cb(power, agentStatus, agentCost);
      }
    }

    return record;
  }

  /**
   * Check budget before making an LLM call.
   */
  checkBudget(power: string): BudgetCheckResult {
    const agentCost = this.getAgentTotalCost(power);
    const gameCost = this.getGameTotalCost();
    const agentBudget = this.budgetConfig.maxAgentCostUsd ?? 0;
    const gameBudget = this.budgetConfig.maxGameCostUsd ?? 0;
    const threshold = this.budgetConfig.warningThreshold ?? 0.8;

    const agentStatus = this.getStatusForBudget(agentCost, agentBudget, threshold);
    const gameStatus = this.getStatusForBudget(gameCost, gameBudget, threshold);

    const exceeded = agentStatus === 'EXCEEDED' || gameStatus === 'EXCEEDED';

    let message: string | undefined;
    if (agentStatus === 'EXCEEDED') {
      message = `Agent ${power} exceeded budget: $${agentCost.toFixed(4)} / $${agentBudget.toFixed(4)}`;
    } else if (gameStatus === 'EXCEEDED') {
      message = `Game exceeded budget: $${gameCost.toFixed(4)} / $${gameBudget.toFixed(4)}`;
    } else if (agentStatus === 'WARNING') {
      message = `Agent ${power} approaching budget: $${agentCost.toFixed(4)} / $${agentBudget.toFixed(4)}`;
    } else if (gameStatus === 'WARNING') {
      message = `Game approaching budget: $${gameCost.toFixed(4)} / $${gameBudget.toFixed(4)}`;
    }

    return {
      allowed: !exceeded,
      agentStatus,
      gameStatus,
      agentCostUsd: agentCost,
      agentBudgetUsd: agentBudget,
      gameCostUsd: gameCost,
      gameBudgetUsd: gameBudget,
      message,
    };
  }

  private getStatusForBudget(cost: number, budget: number, threshold: number): BudgetStatus {
    if (budget <= 0) return 'OK'; // No budget = unlimited
    if (cost >= budget) return 'EXCEEDED';
    if (cost >= budget * threshold) return 'WARNING';
    return 'OK';
  }

  /**
   * Get total cost for a specific agent.
   */
  getAgentTotalCost(power: string): number {
    return this.records
      .filter(r => r.power === power)
      .reduce((sum, r) => sum + r.costUsd, 0);
  }

  /**
   * Get total cost for the game.
   */
  getGameTotalCost(): number {
    return this.records.reduce((sum, r) => sum + r.costUsd, 0);
  }

  /**
   * Get budget status for an agent.
   */
  getAgentBudgetStatus(power: string): BudgetStatus {
    const cost = this.getAgentTotalCost(power);
    const budget = this.budgetConfig.maxAgentCostUsd ?? 0;
    const threshold = this.budgetConfig.warningThreshold ?? 0.8;
    return this.getStatusForBudget(cost, budget, threshold);
  }

  /**
   * Get usage summary for a specific power.
   */
  getPowerUsage(power: string): PowerUsageSummary {
    const powerRecords = this.records.filter(r => r.power === power);

    const byModel = new Map<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>();
    const byPhase = new Map<Phase, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>();

    for (const r of powerRecords) {
      // Aggregate by model
      const modelEntry = byModel.get(r.model) ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 };
      modelEntry.inputTokens += r.inputTokens;
      modelEntry.outputTokens += r.outputTokens;
      modelEntry.costUsd += r.costUsd;
      modelEntry.requests += 1;
      byModel.set(r.model, modelEntry);

      // Aggregate by phase
      const phaseEntry = byPhase.get(r.phase) ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 };
      phaseEntry.inputTokens += r.inputTokens;
      phaseEntry.outputTokens += r.outputTokens;
      phaseEntry.costUsd += r.costUsd;
      phaseEntry.requests += 1;
      byPhase.set(r.phase, phaseEntry);
    }

    const totalInput = powerRecords.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutput = powerRecords.reduce((s, r) => s + r.outputTokens, 0);

    return {
      power,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      totalCostUsd: powerRecords.reduce((s, r) => s + r.costUsd, 0),
      requestCount: powerRecords.length,
      byModel,
      byPhase,
    };
  }

  /**
   * Generate a full game cost report.
   */
  generateReport(): GameCostReport {
    const powers = [...new Set(this.records.map(r => r.power))];
    const models = [...new Set(this.records.map(r => r.model))];

    // Per-power summaries
    const byPower = powers.map(p => this.getPowerUsage(p));

    // Per-model summaries
    const byModel: ModelUsageSummary[] = models.map(model => {
      const modelRecords = this.records.filter(r => r.model === model);
      const totalInput = modelRecords.reduce((s, r) => s + r.inputTokens, 0);
      const totalOutput = modelRecords.reduce((s, r) => s + r.outputTokens, 0);
      const count = modelRecords.length;
      return {
        model,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalTokens: totalInput + totalOutput,
        totalCostUsd: modelRecords.reduce((s, r) => s + r.costUsd, 0),
        requestCount: count,
        averageInputTokens: count > 0 ? totalInput / count : 0,
        averageOutputTokens: count > 0 ? totalOutput / count : 0,
      };
    });

    const totalInput = this.records.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutput = this.records.reduce((s, r) => s + r.outputTokens, 0);

    // Find most expensive and chattiest
    const mostExpensivePower = byPower.length > 0
      ? byPower.reduce((max, p) => p.totalCostUsd > max.totalCostUsd ? p : max)
      : undefined;

    const chattiestPower = byPower.length > 0
      ? byPower.reduce((max, p) => p.requestCount > max.requestCount ? p : max)
      : undefined;

    // Phase costs across all powers
    const phaseCosts = new Map<Phase, number>();
    for (const r of this.records) {
      phaseCosts.set(r.phase, (phaseCosts.get(r.phase) ?? 0) + r.costUsd);
    }
    let mostExpensivePhase: { phase: Phase; costUsd: number } | undefined;
    for (const [phase, cost] of phaseCosts) {
      if (!mostExpensivePhase || cost > mostExpensivePhase.costUsd) {
        mostExpensivePhase = { phase, costUsd: cost };
      }
    }

    return {
      gameId: this.gameId,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      totalCostUsd: this.records.reduce((s, r) => s + r.costUsd, 0),
      totalRequests: this.records.length,
      byPower,
      byModel,
      mostExpensivePower: mostExpensivePower
        ? { power: mostExpensivePower.power, costUsd: mostExpensivePower.totalCostUsd }
        : undefined,
      chattiestPower: chattiestPower
        ? { power: chattiestPower.power, requests: chattiestPower.requestCount }
        : undefined,
      mostExpensivePhase,
    };
  }

  /**
   * Get all records (for serialization/logging).
   */
  getRecords(): TokenRecord[] {
    return [...this.records];
  }

  /**
   * Get the game ID.
   */
  getGameId(): string {
    return this.gameId;
  }
}

/**
 * Format a game cost report for console output.
 */
export function formatGameCostReport(report: GameCostReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('='.repeat(70));
  lines.push('TOKEN USAGE & COST REPORT');
  lines.push('='.repeat(70));
  lines.push('');
  lines.push(`Game: ${report.gameId}`);
  lines.push(`Total Requests: ${report.totalRequests}`);
  lines.push(`Total Tokens: ${report.totalTokens.toLocaleString()} (${report.totalInputTokens.toLocaleString()} in / ${report.totalOutputTokens.toLocaleString()} out)`);
  lines.push(`Total Cost: $${report.totalCostUsd.toFixed(4)}`);
  lines.push('');

  if (report.mostExpensivePower) {
    lines.push(`Most Expensive Agent: ${report.mostExpensivePower.power} ($${report.mostExpensivePower.costUsd.toFixed(4)})`);
  }
  if (report.chattiestPower) {
    lines.push(`Chattiest Agent: ${report.chattiestPower.power} (${report.chattiestPower.requests} requests)`);
  }
  if (report.mostExpensivePhase) {
    lines.push(`Most Expensive Phase: ${report.mostExpensivePhase.phase} ($${report.mostExpensivePhase.costUsd.toFixed(4)})`);
  }

  // Per-model breakdown
  if (report.byModel.length > 0) {
    lines.push('');
    lines.push('-'.repeat(70));
    lines.push('BY MODEL');
    lines.push('-'.repeat(70));
    for (const m of report.byModel.sort((a, b) => b.totalCostUsd - a.totalCostUsd)) {
      lines.push(`  ${m.model}`);
      lines.push(`    Requests: ${m.requestCount} | Tokens: ${m.totalTokens.toLocaleString()} (avg ${Math.round(m.averageInputTokens)} in / ${Math.round(m.averageOutputTokens)} out)`);
      lines.push(`    Cost: $${m.totalCostUsd.toFixed(4)}`);
    }
  }

  // Per-power breakdown
  if (report.byPower.length > 0) {
    lines.push('');
    lines.push('-'.repeat(70));
    lines.push('BY AGENT (POWER)');
    lines.push('-'.repeat(70));
    for (const p of report.byPower.sort((a, b) => b.totalCostUsd - a.totalCostUsd)) {
      lines.push(`  ${p.power}`);
      lines.push(`    Requests: ${p.requestCount} | Tokens: ${p.totalTokens.toLocaleString()} | Cost: $${p.totalCostUsd.toFixed(4)}`);

      // Phase breakdown for this power
      for (const [phase, data] of p.byPhase) {
        lines.push(`    ${phase}: ${data.requests} req, ${(data.inputTokens + data.outputTokens).toLocaleString()} tok, $${data.costUsd.toFixed(4)}`);
      }
    }
  }

  lines.push('');
  lines.push('='.repeat(70));

  return lines.join('\n');
}
