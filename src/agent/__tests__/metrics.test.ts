/**
 * Tests for the Metrics Collector module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../metrics';
import { ModelRegistry } from '../model-registry';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
    collector = new MetricsCollector(registry);
  });

  describe('LLM call recording', () => {
    it('should record and aggregate LLM calls per model', () => {
      collector.recordLLMCall('gpt-4o', 'ENGLAND', 1000, 500, 2000);
      collector.recordLLMCall('gpt-4o', 'FRANCE', 1200, 600, 2500);
      collector.recordLLMCall('gpt-4o-mini', 'GERMANY', 800, 400, 1000);

      const metrics = collector.getModelMetrics();
      expect(metrics.size).toBe(2);

      const gpt4o = metrics.get('gpt-4o')!;
      expect(gpt4o.requestCount).toBe(2);
      expect(gpt4o.totalInputTokens).toBe(2200);
      expect(gpt4o.totalOutputTokens).toBe(1100);
      expect(gpt4o.averageResponseTimeMs).toBe(2250);

      const mini = metrics.get('gpt-4o-mini')!;
      expect(mini.requestCount).toBe(1);
      expect(mini.totalInputTokens).toBe(800);
      expect(mini.totalOutputTokens).toBe(400);
    });

    it('should calculate costs with registry', () => {
      collector.recordLLMCall('gpt-4o', 'ENGLAND', 10000, 5000, 2000);

      const metrics = collector.getModelMetrics();
      const gpt4o = metrics.get('gpt-4o')!;
      // 10000 * 0.0000025 + 5000 * 0.00001 = 0.075
      expect(gpt4o.totalCostUsd).toBeCloseTo(0.075, 4);
    });
  });

  describe('order result recording', () => {
    it('should track order validity per model', () => {
      collector.recordOrderResult('gpt-4o', 'ENGLAND', 3, 3);
      collector.recordOrderResult('gpt-4o', 'FRANCE', 3, 2);
      collector.recordOrderResult('gpt-4o-mini', 'GERMANY', 3, 1);

      const metrics = collector.getModelMetrics();

      const gpt4o = metrics.get('gpt-4o')!;
      expect(gpt4o.totalOrders).toBe(6);
      expect(gpt4o.validOrders).toBe(5);
      expect(gpt4o.invalidOrders).toBe(1);
      expect(gpt4o.orderValidityRate).toBeCloseTo(5 / 6, 4);

      const mini = metrics.get('gpt-4o-mini')!;
      expect(mini.totalOrders).toBe(3);
      expect(mini.validOrders).toBe(1);
      expect(mini.orderValidityRate).toBeCloseTo(1 / 3, 4);
    });
  });

  describe('power metrics', () => {
    it('should aggregate per-power metrics', () => {
      collector.setPowerModel('ENGLAND', 'gpt-4o');
      collector.setPowerModel('GERMANY', 'gpt-4o-mini');

      collector.recordLLMCall('gpt-4o', 'ENGLAND', 1000, 500, 2000);
      collector.recordLLMCall('gpt-4o', 'ENGLAND', 1200, 600, 2500);
      collector.recordLLMCall('gpt-4o-mini', 'GERMANY', 800, 400, 1000);

      collector.recordOrderResult('gpt-4o', 'ENGLAND', 3, 3);
      collector.recordOrderResult('gpt-4o-mini', 'GERMANY', 3, 1);

      collector.updateSupplyCenters('ENGLAND', 5);
      collector.updateSupplyCenters('GERMANY', 3);

      const powerMetrics = collector.getPowerMetrics();

      const england = powerMetrics.get('ENGLAND')!;
      expect(england.modelId).toBe('gpt-4o');
      expect(england.supplyCenters).toBe(5);
      expect(england.requestCount).toBe(2);
      expect(england.totalOrders).toBe(3);
      expect(england.validOrders).toBe(3);
      expect(england.orderValidityRate).toBe(1.0);

      const germany = powerMetrics.get('GERMANY')!;
      expect(germany.modelId).toBe('gpt-4o-mini');
      expect(germany.supplyCenters).toBe(3);
      expect(germany.requestCount).toBe(1);
    });
  });

  describe('cost report', () => {
    it('should generate cost summary', () => {
      collector.recordLLMCall('gpt-4o', 'ENGLAND', 10000, 5000, 2000);
      collector.recordLLMCall('gpt-4o-mini', 'GERMANY', 10000, 5000, 1000);

      const report = collector.getCostReport();
      expect(report.totalInputTokens).toBe(20000);
      expect(report.totalOutputTokens).toBe(10000);
      expect(report.costByModel['gpt-4o']).toBeGreaterThan(0);
      expect(report.costByModel['gpt-4o-mini']).toBeGreaterThan(0);
      // gpt-4o should cost more than mini
      expect(report.costByModel['gpt-4o']).toBeGreaterThan(report.costByModel['gpt-4o-mini']);
      expect(report.totalCostUsd).toBeCloseTo(
        report.costByModel['gpt-4o'] + report.costByModel['gpt-4o-mini'],
        6
      );
    });

    it('should return zeros when no data collected', () => {
      const report = collector.getCostReport();
      expect(report.totalCostUsd).toBe(0);
      expect(report.totalInputTokens).toBe(0);
      expect(report.totalOutputTokens).toBe(0);
    });
  });

  describe('comparative report formatting', () => {
    it('should format a readable report', () => {
      collector.setPowerModel('ENGLAND', 'gpt-4o');
      collector.setPowerModel('GERMANY', 'gpt-4o-mini');

      collector.recordLLMCall('gpt-4o', 'ENGLAND', 10000, 5000, 2000);
      collector.recordLLMCall('gpt-4o-mini', 'GERMANY', 10000, 5000, 1000);
      collector.recordOrderResult('gpt-4o', 'ENGLAND', 3, 3);
      collector.recordOrderResult('gpt-4o-mini', 'GERMANY', 3, 2);
      collector.updateSupplyCenters('ENGLAND', 5);
      collector.updateSupplyCenters('GERMANY', 3);

      const report = collector.formatComparativeReport();
      expect(report).toContain('Multi-Model Comparative Report');
      expect(report).toContain('Model Performance');
      expect(report).toContain('Power Performance');
      expect(report).toContain('Cost Summary');
      expect(report).toContain('gpt-4o');
      expect(report).toContain('gpt-4o-mini');
      expect(report).toContain('ENGLAND');
      expect(report).toContain('GERMANY');
    });
  });

  describe('without registry', () => {
    it('should work without a registry (costs will be 0)', () => {
      const noRegistryCollector = new MetricsCollector();
      noRegistryCollector.recordLLMCall('some-model', 'ENGLAND', 1000, 500, 2000);

      const metrics = noRegistryCollector.getModelMetrics();
      const m = metrics.get('some-model')!;
      expect(m.requestCount).toBe(1);
      expect(m.totalCostUsd).toBe(0);
    });
  });

  describe('clear', () => {
    it('should reset all collected data', () => {
      collector.recordLLMCall('gpt-4o', 'ENGLAND', 1000, 500, 2000);
      collector.recordOrderResult('gpt-4o', 'ENGLAND', 3, 3);
      collector.updateSupplyCenters('ENGLAND', 5);

      collector.clear();

      expect(collector.getModelMetrics().size).toBe(0);
      expect(collector.getPowerMetrics().size).toBe(0);
      expect(collector.getCostReport().totalCostUsd).toBe(0);
    });
  });
});
