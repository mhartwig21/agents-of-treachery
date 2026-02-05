/**
 * Tests for the Experiment Runner.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

import {
  ExperimentRunner,
  createExperimentConfig,
  type ExperimentEvent,
  type ModelConfig,
} from '../index';
import { POWERS } from '../../engine/types';

describe('ExperimentRunner', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = path.join(tmpdir(), `aot-experiment-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createExperimentConfig', () => {
    it('should create a valid config with required fields', () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'test-exp',
        name: 'Test Experiment',
        models: [mockModel],
        defaultModelConfigId: 'mock',
      });

      expect(config.experimentId).toBe('test-exp');
      expect(config.name).toBe('Test Experiment');
      expect(config.gameCount).toBe(1);
      expect(config.maxConcurrent).toBe(1);
      expect(config.runAnalysis).toBe(true);
    });

    it('should use provided optional values', () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'test-exp',
        name: 'Test Experiment',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 5,
        maxConcurrent: 2,
        maxTurnsPerGame: 10,
        verbose: true,
      });

      expect(config.gameCount).toBe(5);
      expect(config.maxConcurrent).toBe(2);
      expect(config.maxTurnsPerGame).toBe(10);
      expect(config.verbose).toBe(true);
    });
  });

  describe('ExperimentRunner basic operations', () => {
    it('should initialize with valid config', () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'test-exp',
        name: 'Test Experiment',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        outputDir: testDir,
      });

      const runner = new ExperimentRunner(config);

      expect(runner.getIsRunning()).toBe(false);
      expect(runner.getResults().status).toBe('running');
      expect(runner.getResults().games).toHaveLength(0);
    });

    it('should generate game configs when runner normalizes config', () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'test-exp',
        name: 'Test Experiment',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 3,
        outputDir: testDir,
      });

      // Create runner which normalizes the config
      const runner = new ExperimentRunner(config);
      const results = runner.getResults();

      // The runner normalizes the config and generates games
      expect(results.config.games).toBeDefined();
      expect(results.config.games).toHaveLength(3);
      expect(results.config.games![0].gameId).toBe('test-exp-game-1');
      expect(results.config.games![1].gameId).toBe('test-exp-game-2');
      expect(results.config.games![2].gameId).toBe('test-exp-game-3');
    });

    it('should emit events during execution', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'event-test',
        name: 'Event Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 1,
        maxTurnsPerGame: 1,
        outputDir: testDir,
        phaseDelayMs: 1,
        pressPeriodMinutes: 0,
      });

      const runner = new ExperimentRunner(config);
      const events: ExperimentEvent[] = [];

      runner.onEvent((event) => {
        events.push(event);
      });

      await runner.run();

      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain('experiment_started');
      expect(eventTypes).toContain('game_started');
      // Game should complete or fail
      expect(
        eventTypes.includes('game_completed') || eventTypes.includes('game_failed')
      ).toBe(true);
      expect(eventTypes).toContain('experiment_completed');
    });

    it('should track stats correctly', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'stats-test',
        name: 'Stats Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 1,
        maxTurnsPerGame: 2,
        outputDir: testDir,
        phaseDelayMs: 1,
        pressPeriodMinutes: 0,
      });

      const runner = new ExperimentRunner(config);
      const results = await runner.run();

      expect(results.stats.totalGames).toBe(1);
      expect(results.stats.completedGames + results.stats.failedGames).toBe(1);
    });
  });

  describe('ExperimentRunner with mock games', () => {
    it('should run a single mock game to completion', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'single-game-test',
        name: 'Single Game Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 1,
        maxTurnsPerGame: 3,
        outputDir: testDir,
        phaseDelayMs: 1,
        pressPeriodMinutes: 0,
        runAnalysis: false,
      });

      const runner = new ExperimentRunner(config);
      const results = await runner.run();

      expect(results.status).toBe('completed');
      expect(results.games).toHaveLength(1);
      expect(results.games[0].status).toBe('completed');
      expect(results.games[0].turnCount).toBeGreaterThan(0);
    }, 30000);

    it('should run multiple mock games in sequence', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'multi-game-test',
        name: 'Multi Game Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 2,
        maxConcurrent: 1,
        maxTurnsPerGame: 2,
        outputDir: testDir,
        phaseDelayMs: 1,
        pressPeriodMinutes: 0,
        runAnalysis: false,
      });

      const runner = new ExperimentRunner(config);
      const results = await runner.run();

      expect(results.status).toBe('completed');
      expect(results.games).toHaveLength(2);
      expect(results.games[0].gameId).not.toBe(results.games[1].gameId);
    }, 60000);

    it('should respect max concurrent limit', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'concurrent-test',
        name: 'Concurrent Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 4,
        maxConcurrent: 2,
        maxTurnsPerGame: 1,
        outputDir: testDir,
        phaseDelayMs: 1,
        pressPeriodMinutes: 0,
        runAnalysis: false,
      });

      const runner = new ExperimentRunner(config);
      let maxActive = 0;

      runner.onEvent((event) => {
        if (event.data?.progress) {
          maxActive = Math.max(maxActive, event.data.progress.inProgressGames);
        }
      });

      await runner.run();

      // Max active should not exceed maxConcurrent
      expect(maxActive).toBeLessThanOrEqual(2);
    }, 60000);
  });

  describe('ExperimentRunner output', () => {
    it('should save config.json', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'output-test',
        name: 'Output Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 1,
        maxTurnsPerGame: 1,
        outputDir: testDir,
        phaseDelayMs: 1,
        pressPeriodMinutes: 0,
        runAnalysis: false,
      });

      const runner = new ExperimentRunner(config);
      await runner.run();

      const configPath = path.join(testDir, 'config.json');
      const savedConfig = JSON.parse(await fs.readFile(configPath, 'utf-8'));

      expect(savedConfig.experimentId).toBe('output-test');
      expect(savedConfig.name).toBe('Output Test');
    }, 30000);

    it('should save results.json', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'results-test',
        name: 'Results Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 1,
        maxTurnsPerGame: 1,
        outputDir: testDir,
        phaseDelayMs: 1,
        pressPeriodMinutes: 0,
        runAnalysis: false,
      });

      const runner = new ExperimentRunner(config);
      await runner.run();

      const resultsPath = path.join(testDir, 'results.json');
      const savedResults = JSON.parse(await fs.readFile(resultsPath, 'utf-8'));

      expect(savedResults.status).toBe('completed');
      expect(savedResults.games).toHaveLength(1);
      expect(savedResults.stats).toBeDefined();
    }, 30000);

    it('should create game logs directory', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'logs-test',
        name: 'Logs Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 1,
        maxTurnsPerGame: 1,
        outputDir: testDir,
        phaseDelayMs: 1,
        pressPeriodMinutes: 0,
        runAnalysis: false,
      });

      const runner = new ExperimentRunner(config);
      await runner.run();

      const gamesDir = path.join(testDir, 'games');
      const stat = await fs.stat(gamesDir);
      expect(stat.isDirectory()).toBe(true);
    }, 30000);

    it('should run analysis when enabled', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'analysis-test',
        name: 'Analysis Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 1,
        maxTurnsPerGame: 1,
        outputDir: testDir,
        phaseDelayMs: 1,
        pressPeriodMinutes: 0,
        runAnalysis: true,
      });

      const runner = new ExperimentRunner(config);
      await runner.run();

      const analysisDir = path.join(testDir, 'analysis');
      const stat = await fs.stat(analysisDir);
      expect(stat.isDirectory()).toBe(true);

      // Check for analysis files
      const summaryPath = path.join(analysisDir, 'summary.json');
      const summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
      expect(summary.experimentId).toBe('analysis-test');
    }, 30000);
  });

  describe('ExperimentRunner abort', () => {
    it('should handle abort gracefully', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock',
      };

      const config = createExperimentConfig({
        experimentId: 'abort-test',
        name: 'Abort Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 5,
        maxTurnsPerGame: 100, // Long games
        outputDir: testDir,
        phaseDelayMs: 100,
        pressPeriodMinutes: 0,
        runAnalysis: false,
      });

      const runner = new ExperimentRunner(config);

      // Abort after a short delay
      setTimeout(() => {
        runner.abort();
      }, 500);

      const results = await runner.run();

      expect(results.status).toBe('aborted');
      // Some games may have completed before abort
      expect(results.games.length).toBeLessThanOrEqual(5);
    }, 15000);
  });

  describe('ExperimentRunner model stats', () => {
    it('should track model usage per power', async () => {
      const mockModel: ModelConfig = {
        id: 'mock',
        provider: 'mock',
        model: 'mock-model-v1',
      };

      const config = createExperimentConfig({
        experimentId: 'model-stats-test',
        name: 'Model Stats Test',
        models: [mockModel],
        defaultModelConfigId: 'mock',
        gameCount: 1,
        maxTurnsPerGame: 1,
        outputDir: testDir,
        phaseDelayMs: 1,
        pressPeriodMinutes: 0,
        runAnalysis: false,
      });

      const runner = new ExperimentRunner(config);
      const results = await runner.run();

      expect(results.games[0].modelsByPower).toBeDefined();
      for (const power of POWERS) {
        expect(results.games[0].modelsByPower[power]).toBe('mock-model-v1');
      }
    }, 30000);
  });
});
