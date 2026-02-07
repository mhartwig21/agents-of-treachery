/**
 * Tests for game orchestration.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GameSession } from '../session';
import { GameEvent, AgentHandle } from '../types';
import { POWERS } from '../../engine/types';

describe('GameOrchestrator', () => {
  let session: GameSession;
  let events: GameEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];

    session = new GameSession({
      orchestratorConfig: {
        diplomacyPhaseDuration: 5000, // 5 seconds
        movementPhaseDuration: 2000,
        retreatPhaseDuration: 1000,
        buildPhaseDuration: 1000,
        nudgeBeforeDeadline: 1000, // 1 second before
        maxMissedDeadlines: 3,
        autoHoldOnTimeout: true,
        autoResolveOnComplete: true,
        minPhaseDuration: 100,
      },
    });

    session.onEvent((event) => {
      events.push(event);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Game Lifecycle', () => {
    it('should create a game in PENDING status', () => {
      expect(session.getStatus()).toBe('PENDING');
      expect(session.getGameId()).toBeTruthy();
    });

    it('should start a game and transition to ACTIVE', () => {
      session.start();

      expect(session.getStatus()).toBe('ACTIVE');
      expect(session.getYear()).toBe(1901);
      expect(session.getSeason()).toBe('SPRING');
      expect(session.getPhase()).toBe('DIPLOMACY');
    });

    it('should emit GAME_CREATED and GAME_STARTED events', () => {
      session.start();

      // GAME_CREATED is emitted before callback registration, so check history
      const history = session.getEventHistory();
      const createdEvent = history.find((e) => e.type === 'GAME_CREATED');
      const startedEvent = events.find((e) => e.type === 'GAME_STARTED');

      expect(createdEvent).toBeTruthy();
      expect(startedEvent).toBeTruthy();
      if (startedEvent?.type === 'GAME_STARTED') {
        expect(startedEvent.year).toBe(1901);
        expect(startedEvent.season).toBe('SPRING');
        expect(startedEvent.phase).toBe('DIPLOMACY');
      }
    });

    it('should pause and resume a game', () => {
      session.start();
      session.pause('Testing');

      expect(session.getStatus()).toBe('PAUSED');

      session.resume();

      expect(session.getStatus()).toBe('ACTIVE');
    });

    it('should abandon a game', () => {
      session.start();
      session.abandon('Player left');

      expect(session.getStatus()).toBe('ABANDONED');

      const abandonedEvent = events.find((e) => e.type === 'GAME_ABANDONED');
      expect(abandonedEvent).toBeTruthy();
    });

    it('should not allow starting an already started game', () => {
      session.start();
      expect(() => session.start()).toThrow();
    });

    it('should not allow pausing a non-active game', () => {
      expect(() => session.pause()).toThrow();
    });
  });

  describe('Phase Management', () => {
    it('should emit PHASE_STARTED when game starts', () => {
      session.start();

      const phaseEvent = events.find((e) => e.type === 'PHASE_STARTED');
      expect(phaseEvent).toBeTruthy();
      if (phaseEvent?.type === 'PHASE_STARTED') {
        expect(phaseEvent.phase).toBe('DIPLOMACY');
        expect(phaseEvent.activePowers).toHaveLength(7);
      }
    });

    it('should track phase status', () => {
      session.start();

      const status = session.getPhaseStatus();
      expect(status).toBeTruthy();
      expect(status?.phase).toBe('DIPLOMACY');
      expect(status?.submissions).toHaveLength(7);
    });

    it('should emit PHASE_ENDING_SOON before deadline', () => {
      session.start();

      // Advance to nudge time (4 seconds into 5 second phase)
      vi.advanceTimersByTime(4000);

      const nudgeEvent = events.find((e) => e.type === 'PHASE_ENDING_SOON');
      expect(nudgeEvent).toBeTruthy();
      if (nudgeEvent?.type === 'PHASE_ENDING_SOON') {
        expect(nudgeEvent.pendingPowers).toHaveLength(7);
      }
    });

    it('should emit AGENT_NUDGED for each pending power', () => {
      session.start();

      vi.advanceTimersByTime(4000);

      const nudgeEvents = events.filter((e) => e.type === 'AGENT_NUDGED');
      expect(nudgeEvents).toHaveLength(7);
    });
  });

  describe('Order Submission', () => {
    it('should accept movement orders', () => {
      session.start();

      session.submitMovementOrders('ENGLAND', [
        { type: 'HOLD', unit: 'LON' },
        { type: 'HOLD', unit: 'EDI' },
        { type: 'HOLD', unit: 'LVP' },
      ]);

      expect(session.hasSubmitted('ENGLAND')).toBe(true);
      expect(session.hasSubmitted('FRANCE')).toBe(false);
    });

    it('should emit ORDERS_SUBMITTED event', () => {
      session.start();

      session.submitMovementOrders('ENGLAND', [
        { type: 'HOLD', unit: 'LON' },
      ]);

      const submitEvent = events.find((e) => e.type === 'ORDERS_SUBMITTED');
      expect(submitEvent).toBeTruthy();
      if (submitEvent?.type === 'ORDERS_SUBMITTED') {
        expect(submitEvent.power).toBe('ENGLAND');
        expect(submitEvent.orderCount).toBe(1);
      }
    });

    it('should track pending powers', () => {
      session.start();

      session.submitMovementOrders('ENGLAND', [{ type: 'HOLD', unit: 'LON' }]);
      session.submitMovementOrders('FRANCE', [{ type: 'HOLD', unit: 'PAR' }]);

      const pending = session.getPendingPowers();
      expect(pending).not.toContain('ENGLAND');
      expect(pending).not.toContain('FRANCE');
      expect(pending).toContain('GERMANY');
    });

    it('should emit ALL_ORDERS_RECEIVED when complete', () => {
      session.start();

      // Submit orders for all powers
      submitAllHoldOrders(session);

      const allReceivedEvent = events.find(
        (e) => e.type === 'ALL_ORDERS_RECEIVED'
      );
      expect(allReceivedEvent).toBeTruthy();
    });
  });

  describe('Auto-Resolution', () => {
    it('should auto-resolve when all orders received and min time passed', () => {
      session.start();

      // Submit all orders
      submitAllHoldOrders(session);

      // Advance past minimum phase duration
      vi.advanceTimersByTime(200);

      // Should have resolved and started next phase
      const resolvedEvent = events.find((e) => e.type === 'ORDERS_RESOLVED');
      expect(resolvedEvent).toBeTruthy();

      // Should be in FALL now
      expect(session.getSeason()).toBe('FALL');
    });

    it('should include resolution summary', () => {
      session.start();
      submitAllHoldOrders(session);
      vi.advanceTimersByTime(200);

      const resolvedEvent = events.find((e) => e.type === 'ORDERS_RESOLVED');
      if (resolvedEvent?.type === 'ORDERS_RESOLVED') {
        expect(resolvedEvent.summary).toBeDefined();
        expect(resolvedEvent.summary.successfulMoves).toBe(0);
        expect(resolvedEvent.summary.failedMoves).toBe(0);
      }
    });
  });

  describe('Deadline Enforcement', () => {
    it('should auto-submit HOLD orders on timeout', () => {
      session.start();

      // Submit orders for some powers but not all
      session.submitMovementOrders('ENGLAND', [{ type: 'HOLD', unit: 'LON' }]);
      session.submitMovementOrders('FRANCE', [{ type: 'HOLD', unit: 'PAR' }]);

      // Advance past deadline
      vi.advanceTimersByTime(6000);

      // Should have emitted timeout events
      const timeoutEvents = events.filter((e) => e.type === 'AGENT_TIMEOUT');
      expect(timeoutEvents.length).toBe(5); // 7 total - 2 submitted

      // Should have phase ended event
      const phaseEndedEvent = events.find((e) => e.type === 'PHASE_ENDED');
      expect(phaseEndedEvent).toBeTruthy();
      if (phaseEndedEvent?.type === 'PHASE_ENDED') {
        expect(phaseEndedEvent.timeoutPowers).toHaveLength(5);
      }
    });

    it('should track missed deadlines per agent', () => {
      const agentHandle: AgentHandle = {
        power: 'GERMANY',
        agentId: 'agent-germany',
        isResponsive: true,
        lastActivity: new Date(),
        missedDeadlines: 0,
      };
      session.registerAgent(agentHandle);
      session.start();

      // Let deadline pass without submitting
      vi.advanceTimersByTime(6000);

      const agent = session.getOrchestrator().getAgent('GERMANY');
      expect(agent?.missedDeadlines).toBe(1);
      expect(agent?.isResponsive).toBe(false);
    });

    it('should emit AGENT_INACTIVE after max missed deadlines', () => {
      const agentHandle: AgentHandle = {
        power: 'GERMANY',
        agentId: 'agent-germany',
        isResponsive: true,
        lastActivity: new Date(),
        missedDeadlines: 2, // Already missed 2
      };
      session.registerAgent(agentHandle);
      session.start();

      // Let deadline pass (3rd miss)
      vi.advanceTimersByTime(6000);

      const inactiveEvent = events.find((e) => e.type === 'AGENT_INACTIVE');
      expect(inactiveEvent).toBeTruthy();
      if (inactiveEvent?.type === 'AGENT_INACTIVE') {
        expect(inactiveEvent.power).toBe('GERMANY');
        expect(inactiveEvent.missedDeadlines).toBe(3);
      }
    });

    it('should reset missed deadline counter on successful submission', () => {
      const agentHandle: AgentHandle = {
        power: 'GERMANY',
        agentId: 'agent-germany',
        isResponsive: false,
        lastActivity: new Date(Date.now() - 10000),
        missedDeadlines: 2,
      };
      session.registerAgent(agentHandle);
      session.start();

      // Submit orders
      session.submitMovementOrders('GERMANY', [{ type: 'HOLD', unit: 'KIE' }]);

      const agent = session.getOrchestrator().getAgent('GERMANY');
      expect(agent?.missedDeadlines).toBe(0);
      expect(agent?.isResponsive).toBe(true);
    });
  });

  describe('Turn Progression', () => {
    it('should progress from SPRING to FALL', () => {
      session.start();
      submitAllHoldOrders(session);
      vi.advanceTimersByTime(200);

      expect(session.getSeason()).toBe('FALL');
      expect(session.getPhase()).toBe('DIPLOMACY');
    });

    it('should progress through a full year', () => {
      session.start();

      // Spring
      submitAllHoldOrders(session);
      vi.advanceTimersByTime(200);
      expect(session.getSeason()).toBe('FALL');

      // Fall (no builds needed since all HOLD)
      submitAllHoldOrders(session);
      vi.advanceTimersByTime(200);

      // Should be next year SPRING
      expect(session.getYear()).toBe(1902);
      expect(session.getSeason()).toBe('SPRING');
    });
  });

  describe('Snapshot and Restore', () => {
    it('should create a snapshot of game state', () => {
      session.start();
      submitAllHoldOrders(session);

      const snapshot = session.snapshot();

      expect(snapshot.gameId).toBe(session.getGameId());
      expect(snapshot.status).toBe('ACTIVE');
      expect(snapshot.gameState.year).toBe(1901);
      expect(snapshot.eventHistory.length).toBeGreaterThan(0);
    });

    it('should restore a game from snapshot', () => {
      session.start();
      const originalId = session.getGameId();
      submitAllHoldOrders(session);
      vi.advanceTimersByTime(200);

      const snapshot = session.snapshot();

      // Create new session from snapshot
      const restored = GameSession.fromSnapshot(snapshot);

      expect(restored.getGameId()).toBe(originalId);
      expect(restored.getYear()).toBe(snapshot.gameState.year);
      expect(restored.getSeason()).toBe(snapshot.gameState.season);
    });
  });

  describe('Press Integration', () => {
    it('should have press system available', () => {
      session.start();

      const press = session.getPressSystem();
      expect(press).toBeTruthy();

      // Should be able to send messages
      press.sendMessage('ENGLAND', {
        channelId: 'bilateral:ENGLAND:FRANCE',
        content: 'Hello France!',
      });

      const messages = press.queryMessages({
        channelId: 'bilateral:ENGLAND:FRANCE',
      });
      expect(messages.messages).toHaveLength(1);
    });

    it('should update press context on phase change', () => {
      session.start();

      const press = session.getPressSystem();
      let context = press.getContext();
      expect(context.season).toBe('SPRING');

      // Progress to next phase
      submitAllHoldOrders(session);
      vi.advanceTimersByTime(200);

      context = press.getContext();
      expect(context.season).toBe('FALL');
    });
  });

  describe('Retreat Order Submission', () => {
    it('should reject retreat orders when not in RETREAT phase', () => {
      session.start();
      // Game starts in DIPLOMACY phase
      expect(() =>
        session.submitRetreatOrders('ENGLAND', [{ unit: 'LON', destination: 'YOR' }])
      ).toThrow('Cannot submit retreat orders');
    });

    it('should reject retreat orders when game is not active', () => {
      // Game is in PENDING state
      expect(() =>
        session.submitRetreatOrders('ENGLAND', [{ unit: 'LON', destination: 'YOR' }])
      ).toThrow('Game is not active');
    });
  });

  describe('Build Order Submission', () => {
    it('should reject build orders when not in BUILD phase', () => {
      session.start();
      expect(() =>
        session.submitBuildOrders('ENGLAND', [
          { type: 'BUILD', province: 'LON', unitType: 'FLEET' },
        ])
      ).toThrow('Cannot submit build orders');
    });

    it('should reject build orders when game is not active', () => {
      expect(() =>
        session.submitBuildOrders('ENGLAND', [
          { type: 'BUILD', province: 'LON', unitType: 'FLEET' },
        ])
      ).toThrow('Game is not active');
    });
  });

  describe('Game Outcome', () => {
    it('should return undefined winner before game ends', () => {
      session.start();
      expect(session.getWinner()).toBeUndefined();
    });

    it('should report no draw before game ends', () => {
      session.start();
      expect(session.isDraw()).toBe(false);
    });
  });

  describe('Manual Phase Resolution', () => {
    it('should manually resolve a phase', () => {
      session.start();
      submitAllHoldOrders(session);

      const continues = session.resolvePhase();
      expect(continues).toBe(true);
      expect(session.getSeason()).toBe('FALL');
    });

    it('should throw when resolving on non-active game', () => {
      expect(() => session.resolvePhase()).toThrow('Game is not active');
    });
  });
});

/**
 * Helper to submit HOLD orders for all powers.
 */
function submitAllHoldOrders(session: GameSession): void {
  const state = session.getGameState();

  for (const power of POWERS) {
    const units = state.units.filter((u) => u.power === power);
    if (units.length > 0) {
      session.submitMovementOrders(
        power,
        units.map((u) => ({ type: 'HOLD', unit: u.province }))
      );
    }
  }
}
