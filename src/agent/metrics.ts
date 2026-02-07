/**
 * Metrics Collector - Per-model quality, cost, and performance tracking.
 *
 * Tracks token usage, costs, order validity rates, response times, and
 * supply center performance per model and per power. Generates comparative
 * reports for analyzing model effectiveness.
 */

import type { Power } from '../engine/types';
import type { ModelRegistry } from './model-registry';

/**
 * Aggregated metrics for a single model.
 */
export interface ModelMetrics {
  modelId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  requestCount: number;
  totalOrders: number;
  validOrders: number;
  invalidOrders: number;
  orderValidityRate: number;
  averageResponseTimeMs: number;
  totalResponseTimeMs: number;
}

/**
 * Per-power performance metrics.
 */
export interface PowerMetrics {
  power: Power;
  modelId: string;
  supplyCenters: number;
  totalOrders: number;
  validOrders: number;
  orderValidityRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

/**
 * Summary of cost across all models.
 */
export interface CostReport {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  costByModel: Record<string, number>;
  tokensByModel: Record<string, { input: number; output: number }>;
}

/**
 * A single recorded LLM call for detailed tracking.
 */
interface LLMCallRecord {
  modelId: string;
  power: Power;
  inputTokens: number;
  outputTokens: number;
  responseTimeMs: number;
  timestamp: Date;
}

/**
 * A single recorded order result.
 */
interface OrderRecord {
  modelId: string;
  power: Power;
  totalOrders: number;
  validOrders: number;
  timestamp: Date;
}

/**
 * Collects and aggregates metrics for multi-model game analysis.
 */
export class MetricsCollector {
  private llmCalls: LLMCallRecord[] = [];
  private orderRecords: OrderRecord[] = [];
  private supplyCenterCounts = new Map<Power, number>();
  private powerModelMap = new Map<Power, string>();
  private registry: ModelRegistry | null;

  constructor(registry?: ModelRegistry) {
    this.registry = registry ?? null;
  }

  /**
   * Set the model ID used by a power (for cost calculations).
   */
  setPowerModel(power: Power, modelId: string): void {
    this.powerModelMap.set(power, modelId);
  }

  /**
   * Record an LLM API call with usage and timing data.
   */
  recordLLMCall(
    modelId: string,
    power: Power,
    inputTokens: number,
    outputTokens: number,
    responseTimeMs: number
  ): void {
    this.llmCalls.push({
      modelId,
      power,
      inputTokens,
      outputTokens,
      responseTimeMs,
      timestamp: new Date(),
    });
  }

  /**
   * Record order submission results for validity tracking.
   */
  recordOrderResult(
    modelId: string,
    power: Power,
    totalOrders: number,
    validOrders: number
  ): void {
    this.orderRecords.push({
      modelId,
      power,
      totalOrders,
      validOrders,
      timestamp: new Date(),
    });
  }

  /**
   * Update the current supply center count for a power.
   */
  updateSupplyCenters(power: Power, count: number): void {
    this.supplyCenterCounts.set(power, count);
  }

  /**
   * Get aggregated metrics for each model.
   */
  getModelMetrics(): Map<string, ModelMetrics> {
    const metrics = new Map<string, ModelMetrics>();

    // Aggregate LLM call data
    for (const call of this.llmCalls) {
      let m = metrics.get(call.modelId);
      if (!m) {
        m = {
          modelId: call.modelId,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostUsd: 0,
          requestCount: 0,
          totalOrders: 0,
          validOrders: 0,
          invalidOrders: 0,
          orderValidityRate: 0,
          averageResponseTimeMs: 0,
          totalResponseTimeMs: 0,
        };
        metrics.set(call.modelId, m);
      }
      m.totalInputTokens += call.inputTokens;
      m.totalOutputTokens += call.outputTokens;
      m.requestCount++;
      m.totalResponseTimeMs += call.responseTimeMs;
    }

    // Aggregate order data
    for (const record of this.orderRecords) {
      let m = metrics.get(record.modelId);
      if (!m) {
        m = {
          modelId: record.modelId,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostUsd: 0,
          requestCount: 0,
          totalOrders: 0,
          validOrders: 0,
          invalidOrders: 0,
          orderValidityRate: 0,
          averageResponseTimeMs: 0,
          totalResponseTimeMs: 0,
        };
        metrics.set(record.modelId, m);
      }
      m.totalOrders += record.totalOrders;
      m.validOrders += record.validOrders;
    }

    // Calculate derived fields
    for (const m of metrics.values()) {
      m.invalidOrders = m.totalOrders - m.validOrders;
      m.orderValidityRate = m.totalOrders > 0 ? m.validOrders / m.totalOrders : 0;
      m.averageResponseTimeMs = m.requestCount > 0 ? m.totalResponseTimeMs / m.requestCount : 0;
      if (this.registry) {
        m.totalCostUsd = this.registry.calculateCost(
          m.modelId,
          m.totalInputTokens,
          m.totalOutputTokens
        );
      }
    }

    return metrics;
  }

  /**
   * Get per-power performance metrics.
   */
  getPowerMetrics(): Map<Power, PowerMetrics> {
    const metrics = new Map<Power, PowerMetrics>();

    // Aggregate LLM calls by power
    for (const call of this.llmCalls) {
      let m = metrics.get(call.power);
      if (!m) {
        m = {
          power: call.power,
          modelId: this.powerModelMap.get(call.power) ?? call.modelId,
          supplyCenters: this.supplyCenterCounts.get(call.power) ?? 0,
          totalOrders: 0,
          validOrders: 0,
          orderValidityRate: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostUsd: 0,
          requestCount: 0,
        };
        metrics.set(call.power, m);
      }
      m.totalInputTokens += call.inputTokens;
      m.totalOutputTokens += call.outputTokens;
      m.requestCount++;
    }

    // Aggregate order records by power
    for (const record of this.orderRecords) {
      let m = metrics.get(record.power);
      if (!m) {
        m = {
          power: record.power,
          modelId: this.powerModelMap.get(record.power) ?? record.modelId,
          supplyCenters: this.supplyCenterCounts.get(record.power) ?? 0,
          totalOrders: 0,
          validOrders: 0,
          orderValidityRate: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostUsd: 0,
          requestCount: 0,
        };
        metrics.set(record.power, m);
      }
      m.totalOrders += record.totalOrders;
      m.validOrders += record.validOrders;
    }

    // Calculate derived fields
    for (const m of metrics.values()) {
      m.orderValidityRate = m.totalOrders > 0 ? m.validOrders / m.totalOrders : 0;
      m.supplyCenters = this.supplyCenterCounts.get(m.power) ?? 0;
      if (this.registry) {
        m.totalCostUsd = this.registry.calculateCost(
          m.modelId,
          m.totalInputTokens,
          m.totalOutputTokens
        );
      }
    }

    return metrics;
  }

  /**
   * Get cost summary across all models.
   */
  getCostReport(): CostReport {
    const modelMetrics = this.getModelMetrics();
    const costByModel: Record<string, number> = {};
    const tokensByModel: Record<string, { input: number; output: number }> = {};
    let totalCost = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const m of modelMetrics.values()) {
      costByModel[m.modelId] = m.totalCostUsd;
      tokensByModel[m.modelId] = {
        input: m.totalInputTokens,
        output: m.totalOutputTokens,
      };
      totalCost += m.totalCostUsd;
      totalInput += m.totalInputTokens;
      totalOutput += m.totalOutputTokens;
    }

    return {
      totalCostUsd: totalCost,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      costByModel,
      tokensByModel,
    };
  }

  /**
   * Generate a formatted comparative report string.
   */
  formatComparativeReport(): string {
    const modelMetrics = this.getModelMetrics();
    const powerMetrics = this.getPowerMetrics();
    const costReport = this.getCostReport();

    const lines: string[] = [];
    lines.push('');
    lines.push('=== Multi-Model Comparative Report ===');
    lines.push('');

    // Model summary table
    lines.push('--- Model Performance ---');
    lines.push(
      padRight('Model', 25) +
      padRight('Requests', 10) +
      padRight('Tokens (in/out)', 20) +
      padRight('Cost (USD)', 12) +
      padRight('Validity', 10) +
      padRight('Avg Time', 10)
    );
    lines.push('-'.repeat(87));

    for (const m of modelMetrics.values()) {
      lines.push(
        padRight(m.modelId, 25) +
        padRight(String(m.requestCount), 10) +
        padRight(`${m.totalInputTokens}/${m.totalOutputTokens}`, 20) +
        padRight(`$${m.totalCostUsd.toFixed(4)}`, 12) +
        padRight(`${(m.orderValidityRate * 100).toFixed(1)}%`, 10) +
        padRight(`${m.averageResponseTimeMs.toFixed(0)}ms`, 10)
      );
    }

    // Power summary table
    lines.push('');
    lines.push('--- Power Performance ---');
    lines.push(
      padRight('Power', 12) +
      padRight('Model', 25) +
      padRight('SCs', 6) +
      padRight('Validity', 10) +
      padRight('Cost (USD)', 12) +
      padRight('Requests', 10)
    );
    lines.push('-'.repeat(75));

    for (const m of powerMetrics.values()) {
      lines.push(
        padRight(m.power, 12) +
        padRight(m.modelId, 25) +
        padRight(String(m.supplyCenters), 6) +
        padRight(`${(m.orderValidityRate * 100).toFixed(1)}%`, 10) +
        padRight(`$${m.totalCostUsd.toFixed(4)}`, 12) +
        padRight(String(m.requestCount), 10)
      );
    }

    // Cost summary
    lines.push('');
    lines.push('--- Cost Summary ---');
    lines.push(`Total cost: $${costReport.totalCostUsd.toFixed(4)}`);
    lines.push(`Total tokens: ${costReport.totalInputTokens} input, ${costReport.totalOutputTokens} output`);

    for (const [modelId, cost] of Object.entries(costReport.costByModel)) {
      const tokens = costReport.tokensByModel[modelId];
      lines.push(`  ${modelId}: $${cost.toFixed(4)} (${tokens.input} in / ${tokens.output} out)`);
    }

    lines.push('');
    lines.push('=== End Report ===');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Reset all collected metrics.
   */
  clear(): void {
    this.llmCalls = [];
    this.orderRecords = [];
    this.supplyCenterCounts.clear();
    this.powerModelMap.clear();
  }
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}
