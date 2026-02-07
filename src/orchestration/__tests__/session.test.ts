/**
 * Tests for orchestration/session.ts — Game session management.
 *
 * Covers: GameSession (constructor, lifecycle, order submission,
 * phase resolution, event system, pause/resume/abandon, snapshot/restore,
 * state getters, submission tracking)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Power } from '../../engine/types';
import { POWERS } from '../../engine/types';
import { GameSession } from '../session';
import type { GameEvent, AgentHandle } from '../types';

function makeAgent(power: Power): AgentHandle {
  return {
    power,
    agentId: `agent-${power.toLowerCase()}`,
    isResponsive: true,
    lastActivity: new Date(),
    missedDeadlines: 0,
  };
}

describe('GameSession', () => {
  let session: GameSession;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (session) {
      try { session.abandon('test cleanup'); } catch { /* ignore */ }
    }
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create a session with default game ID', () => {
      session = new GameSession();
      expect(session.getGameId()).toMatch(/^game_/);
    });

    it('should create a session with custom game ID', () => {
      session = new GameSession({ gameId: 'my-game' });
      expect(session.getGameId()).toBe('my-game');
    });

    it('should start in PENDING status', () => {
      session = new GameSession();
      expect(session.getStatus()).toBe('PENDING');
    });

    it('should have initial game state', () => {
      session = new GameSession();
      const state = session.getGameState();
      expect(state.year).toBe(1901);
      expect(state.season).toBe('SPRING');
      expect(state.phase).toBe('DIPLOMACY');
      expect(state.units.length).toBe(22);
    });

    it('should emit GAME_CREATED event', () => {
      session = new GameSession({ gameId: 'test' });
      // GAME_CREATED is emitted in constructor, before we can subscribe
      // Check event history instead
      const history = session.getEventHistory();
      const created = history.find(e => e.type === 'GAME_CREATED');
      expect(created).toBeTruthy();
    });
  });

  describe('getters', () => {
    it('should return game state clone', () => {
      session = new GameSession();
      const s1 = session.getGameState();
      const s2 = session.getGameState();
      expect(s1).not.toBe(s2);
    });

    it('should return press system', () => {
      session = new GameSession();
      expect(session.getPressSystem()).toBeDefined();
    });

    it('should return orchestrator', () => {
      session = new GameSession();
      expect(session.getOrchestrator()).toBeDefined();
    });

    it('should return year/season/phase', () => {
      session = new GameSession();
      expect(session.getYear()).toBe(1901);
      expect(session.getSeason()).toBe('SPRING');
      expect(session.getPhase()).toBe('DIPLOMACY');
    });

    it('should return no winner initially', () => {
      session = new GameSession();
      expect(session.getWinner()).toBeUndefined();
      expect(session.isDraw()).toBe(false);
    });
  });

  describe('start', () => {
    it('should transition to ACTIVE status', () => {
      session = new GameSession();
      session.start();
      expect(session.getStatus()).toBe('ACTIVE');
    });

    it('should emit GAME_STARTED event', () => {
      session = new GameSession();
      const events: GameEvent[] = [];
      session.onEvent(e => events.push(e));
      session.start();

      const started = events.find(e => e.type === 'GAME_STARTED');
      expect(started).toBeTruthy();
    });

    it('should throw if already started', () => {
      session = new GameSession();
      session.start();
      expect(() => session.start()).toThrow(/Cannot start/);
    });

    it('should set phase status', () => {
      session = new GameSession();
      session.start();
      expect(session.getPhaseStatus()).toBeTruthy();
    });
  });

  describe('event system', () => {
    it('should support multiple listeners', () => {
      session = new GameSession();
      const e1: GameEvent[] = [];
      const e2: GameEvent[] = [];
      session.onEvent(e => e1.push(e));
      session.onEvent(e => e2.push(e));

      session.start();

      expect(e1.length).toBeGreaterThan(0);
      expect(e2.length).toBeGreaterThan(0);
    });

    it('should support unsubscribing', () => {
      session = new GameSession();
      const events: GameEvent[] = [];
      const unsub = session.onEvent(e => events.push(e));

      session.start();
      const countAfterStart = events.length;

      unsub();

      // Trigger more events via timer
      vi.advanceTimersByTime(10000);
      expect(events.length).toBe(countAfterStart);
    });

    it('should record events in history', () => {
      session = new GameSession();
      session.start();

      const history = session.getEventHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it('should return a copy of event history', () => {
      session = new GameSession();
      const h1 = session.getEventHistory();
      const h2 = session.getEventHistory();
      expect(h1).not.toBe(h2);
    });
  });

  describe('agent registration', () => {
    it('should register a single agent', () => {
      session = new GameSession();
      session.registerAgent(makeAgent('ENGLAND'));

      const orch = session.getOrchestrator();
      expect(orch.getAgent('ENGLAND')).toBeDefined();
    });

    it('should register multiple agents', () => {
      session = new GameSession();
      session.registerAgents(POWERS.map(makeAgent));

      const orch = session.getOrchestrator();
      for (const power of POWERS) {
        expect(orch.getAgent(power)).toBeDefined();
      }
    });
  });

  describe('submitMovementOrders', () => {
    it('should accept orders when active', () => {
      session = new GameSession();
      session.start();

      session.submitMovementOrders('ENGLAND', [
        { type: 'HOLD', unit: 'LON' },
        { type: 'HOLD', unit: 'EDI' },
        { type: 'HOLD', unit: 'LVP' },
      ]);

      expect(session.hasSubmitted('ENGLAND')).toBe(true);
    });

    it('should reject orders when not active', () => {
      session = new GameSession();
      expect(() => {
        session.submitMovementOrders('ENGLAND', []);
      }).toThrow(/not active/);
    });
  });

  describe('hasSubmitted / getPendingPowers', () => {
    it('should track submissions', () => {
      session = new GameSession();
      session.start();

      expect(session.hasSubmitted('ENGLAND')).toBe(false);
      expect(session.getPendingPowers().length).toBe(7);

      session.submitMovementOrders('ENGLAND', [
        { type: 'HOLD', unit: 'LON' },
      ]);

      expect(session.hasSubmitted('ENGLAND')).toBe(true);
      expect(session.getPendingPowers().length).toBe(6);
      expect(session.getPendingPowers()).not.toContain('ENGLAND');
    });

    it('should return false when no phase status', () => {
      session = new GameSession();
      expect(session.hasSubmitted('ENGLAND')).toBe(false);
      expect(session.getPendingPowers()).toEqual([]);
    });
  });

  describe('resolvePhase', () => {
    it('should resolve when all orders submitted', () => {
      session = new GameSession();
      session.start();

      // Submit hold orders for all powers
      for (const power of POWERS) {
        const state = session.getGameState();
        const orders = state.units
          .filter(u => u.power === power)
          .map(u => ({ type: 'HOLD' as const, unit: u.province }));
        session.submitMovementOrders(power, orders);
      }

      const continues = session.resolvePhase();
      expect(continues).toBe(true);
    });

    it('should throw when not active', () => {
      session = new GameSession();
      expect(() => session.resolvePhase()).toThrow(/not active/);
    });
  });

  describe('pause / resume', () => {
    it('should pause an active game', () => {
      session = new GameSession();
      session.start();
      session.pause('testing');
      expect(session.getStatus()).toBe('PAUSED');
    });

    it('should emit GAME_PAUSED event', () => {
      session = new GameSession();
      session.start();
      const events: GameEvent[] = [];
      session.onEvent(e => events.push(e));

      session.pause();

      const paused = events.find(e => e.type === 'GAME_PAUSED');
      expect(paused).toBeTruthy();
    });

    it('should resume a paused game', () => {
      session = new GameSession();
      session.start();
      session.pause();
      session.resume();
      expect(session.getStatus()).toBe('ACTIVE');
    });

    it('should emit GAME_RESUMED event', () => {
      session = new GameSession();
      session.start();
      session.pause();

      const events: GameEvent[] = [];
      session.onEvent(e => events.push(e));
      session.resume();

      const resumed = events.find(e => e.type === 'GAME_RESUMED');
      expect(resumed).toBeTruthy();
    });

    it('should throw if pausing a non-active game', () => {
      session = new GameSession();
      expect(() => session.pause()).toThrow(/Cannot pause/);
    });

    it('should throw if resuming a non-paused game', () => {
      session = new GameSession();
      session.start();
      expect(() => session.resume()).toThrow(/Cannot resume/);
    });
  });

  describe('abandon', () => {
    it('should abandon a pending game', () => {
      session = new GameSession();
      session.abandon('no longer needed');
      expect(session.getStatus()).toBe('ABANDONED');
    });

    it('should abandon an active game', () => {
      session = new GameSession();
      session.start();
      session.abandon('testing');
      expect(session.getStatus()).toBe('ABANDONED');
    });

    it('should emit GAME_ABANDONED event', () => {
      session = new GameSession();
      session.start();
      const events: GameEvent[] = [];
      session.onEvent(e => events.push(e));

      session.abandon('test reason');

      const abandoned = events.find(e => e.type === 'GAME_ABANDONED');
      expect(abandoned).toBeTruthy();
    });

    it('should throw if already completed', () => {
      session = new GameSession();
      session.abandon('first');
      expect(() => session.abandon('second')).toThrow(/already ended/);
    });
  });

  describe('snapshot / restore', () => {
    it('should create a snapshot', () => {
      session = new GameSession({ gameId: 'snap-test' });
      session.start();

      const snap = session.snapshot();
      expect(snap.gameId).toBe('snap-test');
      expect(snap.status).toBe('ACTIVE');
      expect(snap.gameState.year).toBe(1901);
      expect(snap.createdAt).toBeInstanceOf(Date);
      expect(snap.startedAt).toBeInstanceOf(Date);
    });

    it('should include agents in snapshot', () => {
      session = new GameSession();
      session.registerAgents([makeAgent('ENGLAND'), makeAgent('FRANCE')]);
      session.start();

      const snap = session.snapshot();
      expect(snap.agents.length).toBe(2);
    });

    it('should include event history in snapshot', () => {
      session = new GameSession();
      session.start();

      const snap = session.snapshot();
      expect(snap.eventHistory.length).toBeGreaterThan(0);
    });

    it('should restore from snapshot', () => {
      session = new GameSession({ gameId: 'restore-test' });
      session.registerAgent(makeAgent('ENGLAND'));
      session.start();

      const snap = session.snapshot();

      // Restore
      const restored = GameSession.fromSnapshot(snap);
      expect(restored.getGameId()).toBe('restore-test');
      expect(restored.getYear()).toBe(1901);

      // Cleanup restored session
      try { restored.abandon('cleanup'); } catch { /* ignore */ }
    });
  });

  describe('forceDeadline', () => {
    it('should clear timers', () => {
      session = new GameSession();
      session.start();
      // Should not throw
      session.forceDeadline();
    });

    it('should throw when not active', () => {
      session = new GameSession();
      expect(() => session.forceDeadline()).toThrow(/not active/);
    });
  });
});
