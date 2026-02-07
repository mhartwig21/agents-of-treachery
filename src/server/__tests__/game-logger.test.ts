/**
 * Tests for game-logger.ts — Structured game logging.
 *
 * Covers: GameLogger (constructor, log methods, enable/disable, getLogPath),
 * getGameLogger, removeGameLogger, getActiveGameIds,
 * readGameLogs, readRecentGameLogs, listGameLogs, filterLogsByType,
 * getGameErrors, getInvalidOrderStats, formatModelStatsReport,
 * getLieStats, formatLieStatsReport, createLoggingLLMProvider
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'fs';
import {
  GameLogger,
  getGameLogger,
  removeGameLogger,
  getActiveGameIds,
  readGameLogs,
  readRecentGameLogs,
  listGameLogs,
  filterLogsByType,
  getGameErrors,
  getInvalidOrderStats,
  formatModelStatsReport,
  getLieStats,
  formatLieStatsReport,
  createLoggingLLMProvider,
} from '../game-logger';

const TEST_LOGS_DIR = '/tmp/saliba-test-logs';

function cleanTestDir(): void {
  if (existsSync(TEST_LOGS_DIR)) {
    rmSync(TEST_LOGS_DIR, { recursive: true, force: true });
  }
}

describe('GameLogger', () => {
  beforeEach(() => {
    cleanTestDir();
  });

  afterEach(() => {
    cleanTestDir();
  });

  describe('constructor', () => {
    it('should create logger and ensure log directory exists', () => {
      const logger = new GameLogger('test-game-1', TEST_LOGS_DIR);
      expect(existsSync(TEST_LOGS_DIR)).toBe(true);
      expect(logger.getLogPath()).toContain('test-game-1.jsonl');
    });
  });

  describe('log', () => {
    it('should write JSONL entries to file', () => {
      const logger = new GameLogger('log-test', TEST_LOGS_DIR);
      logger.log({ type: 'debug', message: 'hello' });

      const content = readFileSync(logger.getLogPath(), 'utf-8');
      const entry = JSON.parse(content.trim());
      expect(entry.gameId).toBe('log-test');
      expect(entry.event.type).toBe('debug');
      expect(entry.event.message).toBe('hello');
      expect(entry.timestamp).toBeDefined();
    });

    it('should append multiple entries', () => {
      const logger = new GameLogger('multi-log', TEST_LOGS_DIR);
      logger.log({ type: 'debug', message: 'first' });
      logger.log({ type: 'debug', message: 'second' });

      const content = readFileSync(logger.getLogPath(), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
    });

    it('should not write when disabled', () => {
      const logger = new GameLogger('disabled-log', TEST_LOGS_DIR);
      logger.disable();
      logger.log({ type: 'debug', message: 'should not appear' });

      expect(existsSync(logger.getLogPath())).toBe(false);
    });

    it('should resume writing after re-enable', () => {
      const logger = new GameLogger('reenable-log', TEST_LOGS_DIR);
      logger.disable();
      logger.log({ type: 'debug', message: 'skipped' });
      logger.enable();
      logger.log({ type: 'debug', message: 'written' });

      const content = readFileSync(logger.getLogPath(), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]).event.message).toBe('written');
    });
  });

  describe('convenience methods', () => {
    it('should log gameStarted', () => {
      const logger = new GameLogger('conv-test', TEST_LOGS_DIR);
      logger.gameStarted('Test Game', ['ENGLAND', 'FRANCE']);

      const logs = readGameLogs('conv-test', TEST_LOGS_DIR);
      expect(logs[0].event.type).toBe('game_started');
    });

    it('should log gameEnded', () => {
      const logger = new GameLogger('conv-test2', TEST_LOGS_DIR);
      logger.gameEnded('ENGLAND', false, 'solo victory');

      const logs = readGameLogs('conv-test2', TEST_LOGS_DIR);
      const event = logs[0].event;
      expect(event.type).toBe('game_ended');
      if (event.type === 'game_ended') {
        expect(event.winner).toBe('ENGLAND');
      }
    });

    it('should log phaseStarted and phaseResolved', () => {
      const logger = new GameLogger('phase-log', TEST_LOGS_DIR);
      logger.phaseStarted('DIPLOMACY', 1901, 'SPRING');
      logger.phaseResolved('DIPLOMACY', 1901, 'SPRING');

      const logs = readGameLogs('phase-log', TEST_LOGS_DIR);
      expect(logs[0].event.type).toBe('phase_started');
      expect(logs[1].event.type).toBe('phase_resolved');
    });

    it('should log agentTurnStarted and agentTurnCompleted', () => {
      const logger = new GameLogger('turn-log', TEST_LOGS_DIR);
      logger.agentTurnStarted('ENGLAND');
      logger.agentTurnCompleted('ENGLAND', 1500);

      const logs = readGameLogs('turn-log', TEST_LOGS_DIR);
      expect(logs[0].event.type).toBe('agent_turn_started');
      expect(logs[1].event.type).toBe('agent_turn_completed');
      if (logs[1].event.type === 'agent_turn_completed') {
        expect(logs[1].event.durationMs).toBe(1500);
      }
    });

    it('should log LLM request/response/error', () => {
      const logger = new GameLogger('llm-log', TEST_LOGS_DIR);
      logger.llmRequest('FRANCE', 'gpt-4', 5, 1000);
      logger.llmResponse('FRANCE', 2500, 'gpt-4', { inputTokens: 500, outputTokens: 200 });
      logger.llmError('FRANCE', 'Rate limited', 'gpt-4');

      const logs = readGameLogs('llm-log', TEST_LOGS_DIR);
      expect(logs).toHaveLength(3);
      expect(logs[0].event.type).toBe('llm_request');
      expect(logs[1].event.type).toBe('llm_response');
      expect(logs[2].event.type).toBe('llm_error');
    });

    it('should log orders parsed and submitted', () => {
      const logger = new GameLogger('orders-log', TEST_LOGS_DIR);
      logger.ordersParsed('ENGLAND', ['LON HOLD', 'EDI -> NTH']);
      logger.ordersSubmitted('ENGLAND', ['LON HOLD', 'EDI -> NTH'], true);

      const logs = readGameLogs('orders-log', TEST_LOGS_DIR);
      expect(logs[0].event.type).toBe('orders_parsed');
      expect(logs[1].event.type).toBe('orders_submitted');
    });

    it('should log invalidOrder', () => {
      const logger = new GameLogger('invalid-log', TEST_LOGS_DIR);
      logger.invalidOrder('ENGLAND', 'gpt-4', 'LON -> PAR', 'Not adjacent', 1901, 'SPRING', 'MOVEMENT');

      const logs = readGameLogs('invalid-log', TEST_LOGS_DIR);
      expect(logs[0].event.type).toBe('invalid_order');
    });

    it('should log messageSent', () => {
      const logger = new GameLogger('msg-log', TEST_LOGS_DIR);
      logger.messageSent('ENGLAND', 'FRANCE', 'Let us ally!');

      const logs = readGameLogs('msg-log', TEST_LOGS_DIR);
      expect(logs[0].event.type).toBe('message_sent');
    });

    it('should log diaryEntry', () => {
      const logger = new GameLogger('diary-log', TEST_LOGS_DIR);
      logger.diaryEntry('ENGLAND', 'gpt-4', 1901, 'SPRING', 'DIPLOMACY', 'Hold all', 'Defensive strategy', 'No threats');

      const logs = readGameLogs('diary-log', TEST_LOGS_DIR);
      expect(logs[0].event.type).toBe('diary_entry');
    });

    it('should log deceptionDetected', () => {
      const logger = new GameLogger('deception-log', TEST_LOGS_DIR);
      logger.deceptionDetected('ITALY', 'gpt-4', 'INTENTIONAL_LIE', ['AUSTRIA'], 1901, 'SPRING', 'Said hold but moved', 0.85);

      const logs = readGameLogs('deception-log', TEST_LOGS_DIR);
      const event = logs[0].event;
      expect(event.type).toBe('deception_detected');
      if (event.type === 'deception_detected') {
        expect(event.confidence).toBe(0.85);
      }
    });

    it('should log error and warning', () => {
      const logger = new GameLogger('err-log', TEST_LOGS_DIR);
      logger.error('Something broke', 'context', 'stack trace');
      logger.warning('Watch out', 'context');

      const logs = readGameLogs('err-log', TEST_LOGS_DIR);
      expect(logs[0].event.type).toBe('error');
      expect(logs[1].event.type).toBe('warning');
    });
  });
});

describe('Logger registry', () => {
  beforeEach(() => {
    cleanTestDir();
    // Clean up any leftover loggers from other tests
    for (const id of getActiveGameIds()) {
      if (id.startsWith('registry-')) {
        removeGameLogger(id);
      }
    }
  });

  afterEach(() => {
    cleanTestDir();
  });

  it('should get or create a logger', () => {
    const l1 = getGameLogger('registry-test1', TEST_LOGS_DIR);
    const l2 = getGameLogger('registry-test1', TEST_LOGS_DIR);
    expect(l1).toBe(l2);
    removeGameLogger('registry-test1');
  });

  it('should remove a logger', () => {
    getGameLogger('registry-test2', TEST_LOGS_DIR);
    expect(getActiveGameIds()).toContain('registry-test2');
    removeGameLogger('registry-test2');
    expect(getActiveGameIds()).not.toContain('registry-test2');
  });

  it('should list active game IDs', () => {
    getGameLogger('registry-test3', TEST_LOGS_DIR);
    getGameLogger('registry-test4', TEST_LOGS_DIR);
    const ids = getActiveGameIds();
    expect(ids).toContain('registry-test3');
    expect(ids).toContain('registry-test4');
    removeGameLogger('registry-test3');
    removeGameLogger('registry-test4');
  });
});

describe('readGameLogs', () => {
  beforeEach(() => cleanTestDir());
  afterEach(() => cleanTestDir());

  it('should read all log entries', () => {
    const logger = new GameLogger('read-test', TEST_LOGS_DIR);
    logger.gameStarted('Test', ['ENGLAND']);
    logger.phaseStarted('DIPLOMACY', 1901, 'SPRING');
    logger.gameEnded('ENGLAND');

    const logs = readGameLogs('read-test', TEST_LOGS_DIR);
    expect(logs).toHaveLength(3);
  });

  it('should return empty for non-existent game', () => {
    const logs = readGameLogs('nonexistent', TEST_LOGS_DIR);
    expect(logs).toEqual([]);
  });
});

describe('readRecentGameLogs', () => {
  beforeEach(() => cleanTestDir());
  afterEach(() => cleanTestDir());

  it('should return last N entries', () => {
    const logger = new GameLogger('recent-test', TEST_LOGS_DIR);
    for (let i = 0; i < 10; i++) {
      logger.debug(`Message ${i}`);
    }

    const recent = readRecentGameLogs('recent-test', 3, TEST_LOGS_DIR);
    expect(recent).toHaveLength(3);
    if (recent[0].event.type === 'debug') {
      expect(recent[0].event.message).toBe('Message 7');
    }
  });
});

describe('listGameLogs', () => {
  beforeEach(() => cleanTestDir());
  afterEach(() => cleanTestDir());

  it('should list all game log files', () => {
    new GameLogger('list-1', TEST_LOGS_DIR).debug('test');
    new GameLogger('list-2', TEST_LOGS_DIR).debug('test');

    const list = listGameLogs(TEST_LOGS_DIR);
    expect(list.length).toBe(2);
    expect(list.map(l => l.gameId)).toContain('list-1');
    expect(list.map(l => l.gameId)).toContain('list-2');
    expect(list[0].size).toBeGreaterThan(0);
  });

  it('should return empty for non-existent directory', () => {
    const list = listGameLogs('/tmp/nonexistent-log-dir-xyz');
    expect(list).toEqual([]);
  });
});

describe('filterLogsByType', () => {
  beforeEach(() => cleanTestDir());
  afterEach(() => cleanTestDir());

  it('should filter by event type', () => {
    const logger = new GameLogger('filter-test', TEST_LOGS_DIR);
    logger.gameStarted('Test', ['ENGLAND']);
    logger.phaseStarted('DIPLOMACY', 1901, 'SPRING');
    logger.error('oops');

    const logs = readGameLogs('filter-test', TEST_LOGS_DIR);
    const errors = filterLogsByType(logs, ['error']);
    expect(errors).toHaveLength(1);
  });

  it('should filter by multiple types', () => {
    const logger = new GameLogger('filter-multi', TEST_LOGS_DIR);
    logger.gameStarted('Test', ['ENGLAND']);
    logger.error('err');
    logger.llmError('ENGLAND', 'err');
    logger.debug('msg');

    const logs = readGameLogs('filter-multi', TEST_LOGS_DIR);
    const errorsAndLlm = filterLogsByType(logs, ['error', 'llm_error']);
    expect(errorsAndLlm).toHaveLength(2);
  });
});

describe('getGameErrors', () => {
  beforeEach(() => cleanTestDir());
  afterEach(() => cleanTestDir());

  it('should return only error and llm_error events', () => {
    const logger = new GameLogger('err-test', TEST_LOGS_DIR);
    logger.debug('not an error');
    logger.error('real error');
    logger.llmError('FRANCE', 'llm broke');

    const errors = getGameErrors('err-test', TEST_LOGS_DIR);
    expect(errors).toHaveLength(2);
  });
});

describe('getInvalidOrderStats', () => {
  beforeEach(() => cleanTestDir());
  afterEach(() => cleanTestDir());

  it('should return empty report for no logs', () => {
    const report = getInvalidOrderStats('nonexistent', TEST_LOGS_DIR);
    expect(report.totalOrders).toBe(0);
    expect(report.totalInvalidOrders).toBe(0);
    expect(report.byModel).toHaveLength(0);
  });

  it('should aggregate invalid orders by model', () => {
    const logger = new GameLogger('stats-test', TEST_LOGS_DIR);

    // Simulate LLM responses to set model per power
    logger.log({ type: 'llm_response', power: 'ENGLAND', model: 'gpt-4', durationMs: 100, usage: { inputTokens: 100, outputTokens: 50 } });
    logger.log({ type: 'llm_response', power: 'FRANCE', model: 'claude-3', durationMs: 100, usage: { inputTokens: 100, outputTokens: 50 } });

    // Simulate submitted orders
    logger.ordersSubmitted('ENGLAND', ['LON HOLD', 'EDI -> NTH'], true);
    logger.ordersSubmitted('FRANCE', ['PAR HOLD', 'MAR HOLD'], true);

    // Simulate invalid orders
    logger.invalidOrder('ENGLAND', 'gpt-4', 'LON -> PAR', 'Not adjacent', 1901, 'SPRING', 'MOVEMENT');
    logger.invalidOrder('ENGLAND', 'gpt-4', 'EDI SUPPORT BRE', 'Invalid support', 1901, 'SPRING', 'MOVEMENT');

    const report = getInvalidOrderStats('stats-test', TEST_LOGS_DIR);
    expect(report.totalInvalidOrders).toBe(2);
    expect(report.byModel.length).toBeGreaterThan(0);

    const gpt4Stats = report.byModel.find(m => m.model === 'gpt-4');
    expect(gpt4Stats).toBeDefined();
    expect(gpt4Stats!.invalidOrders).toBe(2);
  });
});

describe('formatModelStatsReport', () => {
  it('should format an empty report', () => {
    const report = formatModelStatsReport({
      gameId: 'test',
      totalOrders: 0,
      totalInvalidOrders: 0,
      overallInvalidRate: 0,
      byModel: [],
    });

    expect(report).toContain('INVALID ORDER STATISTICS');
    expect(report).toContain('No model data available');
  });

  it('should format a report with model data', () => {
    const report = formatModelStatsReport({
      gameId: 'test',
      totalOrders: 100,
      totalInvalidOrders: 10,
      overallInvalidRate: 0.1,
      byModel: [{
        model: 'gpt-4',
        totalOrders: 100,
        invalidOrders: 10,
        invalidRate: 0.1,
        errorTypes: { 'INVALID_MOVE_TARGET': 5, 'PARSE_ERROR': 5 },
        samples: [{ power: 'ENGLAND', orderText: 'LON -> PAR', error: 'Not adjacent', phase: 'S1901M' }],
      }],
    });

    expect(report).toContain('gpt-4');
    expect(report).toContain('10.00%');
    expect(report).toContain('INVALID_MOVE_TARGET');
  });
});

describe('getLieStats', () => {
  beforeEach(() => cleanTestDir());
  afterEach(() => cleanTestDir());

  it('should return empty report for no logs', () => {
    const report = getLieStats('nonexistent', TEST_LOGS_DIR);
    expect(report.totalDeceptions).toBe(0);
    expect(report.totalDiaryEntries).toBe(0);
  });

  it('should aggregate deception stats', () => {
    const logger = new GameLogger('lie-test', TEST_LOGS_DIR);

    logger.diaryEntry('ITALY', 'gpt-4', 1901, 'SPRING', 'DIPLOMACY', 'intentions', 'reasoning', 'analysis');
    logger.diaryEntry('ITALY', 'gpt-4', 1901, 'FALL', 'DIPLOMACY', 'intentions', 'reasoning', 'analysis');
    logger.deceptionDetected('ITALY', 'gpt-4', 'INTENTIONAL_LIE', ['AUSTRIA'], 1901, 'SPRING', 'Said hold but attacked', 0.9);

    const report = getLieStats('lie-test', TEST_LOGS_DIR);
    expect(report.totalDiaryEntries).toBe(2);
    expect(report.totalDeceptions).toBe(1);
    expect(report.overallDeceptionRate).toBe(0.5);

    const italyStats = report.byPower.find(p => p.power === 'ITALY');
    expect(italyStats).toBeDefined();
    expect(italyStats!.deceptionCount).toBe(1);
    expect(italyStats!.topTargets[0].power).toBe('AUSTRIA');
  });
});

describe('formatLieStatsReport', () => {
  it('should format empty report', () => {
    const report = formatLieStatsReport({
      gameId: 'test',
      totalDiaryEntries: 0,
      totalDeceptions: 0,
      overallDeceptionRate: 0,
      byModel: [],
      byPower: [],
    });

    expect(report).toContain('LIE DETECTION');
    expect(report).toContain('No diary entries found');
  });

  it('should format report with data', () => {
    const report = formatLieStatsReport({
      gameId: 'test',
      totalDiaryEntries: 10,
      totalDeceptions: 2,
      overallDeceptionRate: 0.2,
      byModel: [{
        model: 'gpt-4',
        totalDiaryEntries: 10,
        deceptionCount: 2,
        deceptionRate: 0.2,
        byType: { INTENTIONAL_LIE: 1, CONTRADICTORY_CLAIM: 1, BROKEN_PROMISE: 0, MISDIRECTION: 0 },
        samples: [{
          power: 'ITALY',
          targets: ['AUSTRIA'],
          type: 'INTENTIONAL_LIE',
          evidence: 'Promised support but attacked instead',
          confidence: 0.9,
          phase: 'SPRING 1901',
        }],
      }],
      byPower: [{
        power: 'ITALY',
        totalDiaryEntries: 5,
        deceptionCount: 2,
        deceptionRate: 0.4,
        byType: { INTENTIONAL_LIE: 1, CONTRADICTORY_CLAIM: 1, BROKEN_PROMISE: 0, MISDIRECTION: 0 },
        topTargets: [{ power: 'AUSTRIA', count: 2 }],
      }],
    });

    expect(report).toContain('DECEPTION BY MODEL');
    expect(report).toContain('DECEPTION BY POWER');
    expect(report).toContain('gpt-4');
    expect(report).toContain('ITALY');
    expect(report).toContain('AUSTRIA');
  });
});

describe('createLoggingLLMProvider', () => {
  beforeEach(() => cleanTestDir());
  afterEach(() => cleanTestDir());

  it('should wrap LLM calls with logging', async () => {
    const logger = new GameLogger('llm-wrap', TEST_LOGS_DIR);
    const mockProvider = {
      complete: async (_params: { messages: { role: string; content: string }[] }) => ({
        content: 'test response',
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    };

    const wrapped = createLoggingLLMProvider(mockProvider, logger);
    await wrapped.complete({ messages: [{ role: 'user', content: 'hello' }] });

    const logs = readGameLogs('llm-wrap', TEST_LOGS_DIR);
    const types = logs.map(l => l.event.type);
    expect(types).toContain('llm_request');
    expect(types).toContain('llm_response');
  });

  it('should log errors on LLM failure', async () => {
    const logger = new GameLogger('llm-err', TEST_LOGS_DIR);
    const mockProvider = {
      complete: async (_params: { messages: { role: string; content: string }[] }): Promise<never> => { throw new Error('API down'); },
    };

    const wrapped = createLoggingLLMProvider(mockProvider, logger);
    await expect(wrapped.complete({ messages: [] })).rejects.toThrow('API down');

    const logs = readGameLogs('llm-err', TEST_LOGS_DIR);
    const types = logs.map(l => l.event.type);
    expect(types).toContain('llm_request');
    expect(types).toContain('llm_error');
  });

  it('should extract power from system message', async () => {
    const logger = new GameLogger('llm-power', TEST_LOGS_DIR);
    const mockProvider = {
      complete: async (_params: { messages: { role: string; content: string }[] }) => ({
        content: 'response',
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    };

    const wrapped = createLoggingLLMProvider(mockProvider, logger);
    await wrapped.complete({
      messages: [
        { role: 'system', content: 'You are playing as England in Diplomacy.' },
        { role: 'user', content: 'Your turn.' },
      ],
    });

    const logs = readGameLogs('llm-power', TEST_LOGS_DIR);
    if (logs[0].event.type === 'llm_request') {
      expect(logs[0].event.power).toBe('ENGLAND');
    }
  });
});
