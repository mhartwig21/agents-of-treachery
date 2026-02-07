/**
 * Tests for orchestrator.ts — Game master / phase management.
 *
 * Covers: GameOrchestrator (startPhase, recordSubmission, resolvePhase,
 * agent management, event emission, deadline/nudge timers, pause/resume,
 * getActivePowers, configuration)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GameState } from '../../engine/types';
import { POWERS } from '../../engine/types';
import { createInitialState, submitOrders } from '../../engine/game';
import { GameOrchestrator } from '../orchestrator';
import type { GameEvent, AgentHandle, OrchestratorConfig } from '../types';

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): Partial<OrchestratorConfig> {
  return {
    diplomacyPhaseDuration: 5000,
    movementPhaseDuration: 2000,
    retreatPhaseDuration: 1000,
    buildPhaseDuration: 1000,
    nudgeBeforeDeadline: 1000,
    maxMissedDeadlines: 3,
    autoHoldOnTimeout: true,
    autoResolveOnComplete: true,
    minPhaseDuration: 100,
    ...overrides,
  };
}

describe('GameOrchestrator', () => {
  let orchestrator: GameOrchestrator;
  let state: GameState;
  let events: GameEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    state = createInitialState();
    events = [];
    orchestrator = new GameOrchestrator('test-game', makeConfig());
    orchestrator.onEvent((e) => events.push(e));
  });

  afterEach(() => {
    orchestrator.clearTimers();
    vi.useRealTimers();
  });

  describe('startPhase', () => {
    it('should emit PHASE_STARTED event', () => {
      orchestrator.startPhase(state);
      const event = events.find((e) => e.type === 'PHASE_STARTED');
      expect(event).toBeTruthy();
    });

    it('should set phase status', () => {
      orchestrator.startPhase(state);
      const status = orchestrator.getPhaseStatus();
      expect(status).toBeTruthy();
      expect(status!.phase).toBe('DIPLOMACY');
      expect(status!.submissions).toHaveLength(7);
    });

    it('should include active powers in the event', () => {
      orchestrator.startPhase(state);
      const event = events.find((e) => e.type === 'PHASE_STARTED');
      if (event?.type === 'PHASE_STARTED') {
        expect(event.activePowers).toHaveLength(7);
      }
    });

    it('should set correct deadline', () => {
      orchestrator.startPhase(state);
      const status = orchestrator.getPhaseStatus()!;
      expect(status.deadline.getTime()).toBe(Date.now() + 5000);
    });
  });

  describe('getActivePowers', () => {
    it('should return all powers with units in DIPLOMACY phase', () => {
      const powers = orchestrator.getActivePowers(state);
      expect(powers).toHaveLength(7);
    });

    it('should return only powers with pending retreats in RETREAT phase', () => {
      state.phase = 'RETREAT';
      state.pendingRetreats = [
        { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
      ];
      const powers = orchestrator.getActivePowers(state);
      expect(powers).toEqual(['FRANCE']);
    });

    it('should return only powers with builds/disbands in BUILD phase', () => {
      state.phase = 'BUILD';
      state.pendingBuilds.set('ENGLAND', 1);
      state.pendingBuilds.set('FRANCE', -1);
      state.pendingBuilds.set('GERMANY', 0); // No builds needed
      const powers = orchestrator.getActivePowers(state);
      expect(powers).toContain('ENGLAND');
      expect(powers).toContain('FRANCE');
      expect(powers).not.toContain('GERMANY');
    });
  });

  describe('recordSubmission', () => {
    it('should emit ORDERS_SUBMITTED event', () => {
      orchestrator.startPhase(state);
      orchestrator.recordSubmission(state, 'ENGLAND', 3);

      const event = events.find((e) => e.type === 'ORDERS_SUBMITTED');
      expect(event).toBeTruthy();
      if (event?.type === 'ORDERS_SUBMITTED') {
        expect(event.power).toBe('ENGLAND');
        expect(event.orderCount).toBe(3);
      }
    });

    it('should mark submission as complete', () => {
      orchestrator.startPhase(state);
      orchestrator.recordSubmission(state, 'ENGLAND', 3);

      const status = orchestrator.getPhaseStatus()!;
      const engSubmission = status.submissions.find((s) => s.power === 'ENGLAND');
      expect(engSubmission!.submitted).toBe(true);
      expect(engSubmission!.orderCount).toBe(3);
    });

    it('should reset missed deadlines on submission', () => {
      const agent: AgentHandle = {
        power: 'ENGLAND',
        agentId: 'test',
        isResponsive: false,
        lastActivity: new Date(),
        missedDeadlines: 2,
      };
      orchestrator.registerAgent(agent);
      orchestrator.startPhase(state);
      orchestrator.recordSubmission(state, 'ENGLAND', 3);

      expect(orchestrator.getAgent('ENGLAND')!.missedDeadlines).toBe(0);
      expect(orchestrator.getAgent('ENGLAND')!.isResponsive).toBe(true);
    });

    it('should emit ALL_ORDERS_RECEIVED when all powers submit', () => {
      orchestrator.startPhase(state);
      for (const power of POWERS) {
        submitOrders(state, power, state.units.filter(u => u.power === power).map(u => ({ type: 'HOLD', unit: u.province })));
        orchestrator.recordSubmission(state, power, state.units.filter(u => u.power === power).length);
      }

      const allEvent = events.find((e) => e.type === 'ALL_ORDERS_RECEIVED');
      expect(allEvent).toBeTruthy();
    });
  });

  describe('deadline handling', () => {
    it('should emit PHASE_ENDING_SOON before deadline', () => {
      orchestrator.startPhase(state);

      // Advance to nudge time (4s into 5s phase)
      vi.advanceTimersByTime(4000);

      const nudge = events.find((e) => e.type === 'PHASE_ENDING_SOON');
      expect(nudge).toBeTruthy();
    });

    it('should emit AGENT_NUDGED for each pending power', () => {
      orchestrator.startPhase(state);
      vi.advanceTimersByTime(4000);

      const nudges = events.filter((e) => e.type === 'AGENT_NUDGED');
      expect(nudges).toHaveLength(7);
    });

    it('should not nudge powers that already submitted', () => {
      orchestrator.startPhase(state);
      submitOrders(state, 'ENGLAND', [{ type: 'HOLD', unit: 'LON' }]);
      orchestrator.recordSubmission(state, 'ENGLAND', 1);

      vi.advanceTimersByTime(4000);

      const nudges = events.filter((e) => e.type === 'AGENT_NUDGED');
      expect(nudges).toHaveLength(6); // 7 - 1 submitted
    });

    it('should emit AGENT_TIMEOUT on deadline expiry', () => {
      orchestrator.startPhase(state);
      vi.advanceTimersByTime(5000);

      const timeouts = events.filter((e) => e.type === 'AGENT_TIMEOUT');
      expect(timeouts).toHaveLength(7);
    });

    it('should emit PHASE_ENDED after deadline', () => {
      orchestrator.startPhase(state);
      vi.advanceTimersByTime(5000);

      const ended = events.find((e) => e.type === 'PHASE_ENDED');
      expect(ended).toBeTruthy();
    });

    it('should track missed deadlines per agent', () => {
      const agent: AgentHandle = {
        power: 'GERMANY',
        agentId: 'test',
        isResponsive: true,
        lastActivity: new Date(),
        missedDeadlines: 0,
      };
      orchestrator.registerAgent(agent);
      orchestrator.startPhase(state);

      vi.advanceTimersByTime(5000);

      expect(orchestrator.getAgent('GERMANY')!.missedDeadlines).toBe(1);
      expect(orchestrator.getAgent('GERMANY')!.isResponsive).toBe(false);
    });

    it('should emit AGENT_INACTIVE after max missed deadlines', () => {
      const agent: AgentHandle = {
        power: 'GERMANY',
        agentId: 'test',
        isResponsive: true,
        lastActivity: new Date(),
        missedDeadlines: 2,
      };
      orchestrator.registerAgent(agent);
      orchestrator.startPhase(state);

      vi.advanceTimersByTime(5000);

      const inactive = events.find((e) => e.type === 'AGENT_INACTIVE');
      expect(inactive).toBeTruthy();
      if (inactive?.type === 'AGENT_INACTIVE') {
        expect(inactive.power).toBe('GERMANY');
      }
    });
  });

  describe('resolvePhase', () => {
    it('should emit ORDERS_RESOLVED event', () => {
      orchestrator.startPhase(state);
      for (const power of POWERS) {
        submitOrders(state, power, state.units.filter(u => u.power === power).map(u => ({ type: 'HOLD', unit: u.province })));
      }

      orchestrator.resolvePhase(state);
      const resolved = events.find((e) => e.type === 'ORDERS_RESOLVED');
      expect(resolved).toBeTruthy();
    });

    it('should return resolution summary with move counts', () => {
      orchestrator.startPhase(state);
      submitOrders(state, 'ENGLAND', [
        { type: 'MOVE', unit: 'EDI', destination: 'NTH' },
        { type: 'HOLD', unit: 'LON' },
        { type: 'HOLD', unit: 'LVP' },
      ]);
      for (const power of POWERS.filter(p => p !== 'ENGLAND')) {
        submitOrders(state, power, state.units.filter(u => u.power === power).map(u => ({ type: 'HOLD', unit: u.province })));
      }

      const summary = orchestrator.resolvePhase(state);
      expect(summary.successfulMoves).toBe(1); // EDI -> NTH
      expect(summary.failedMoves).toBe(0);
    });

    it('should clear phase status after resolution', () => {
      orchestrator.startPhase(state);
      for (const power of POWERS) {
        submitOrders(state, power, state.units.filter(u => u.power === power).map(u => ({ type: 'HOLD', unit: u.province })));
      }

      orchestrator.resolvePhase(state);
      expect(orchestrator.getPhaseStatus()).toBeNull();
    });
  });

  describe('agent management', () => {
    it('should register and retrieve agents', () => {
      const agent: AgentHandle = {
        power: 'FRANCE',
        agentId: 'agent-france',
        isResponsive: true,
        lastActivity: new Date(),
        missedDeadlines: 0,
      };
      orchestrator.registerAgent(agent);

      expect(orchestrator.getAgent('FRANCE')).toBe(agent);
    });

    it('should mark agent as active', () => {
      const agent: AgentHandle = {
        power: 'FRANCE',
        agentId: 'agent-france',
        isResponsive: false,
        lastActivity: new Date(0),
        missedDeadlines: 1,
      };
      orchestrator.registerAgent(agent);
      orchestrator.markAgentActive('FRANCE');

      expect(agent.isResponsive).toBe(true);
      expect(agent.lastActivity.getTime()).toBeGreaterThan(0);
    });

    it('should return undefined for unregistered agent', () => {
      expect(orchestrator.getAgent('TURKEY')).toBeUndefined();
    });
  });

  describe('event subscription', () => {
    it('should support multiple listeners', () => {
      const events2: GameEvent[] = [];
      orchestrator.onEvent((e) => events2.push(e));

      orchestrator.startPhase(state);

      expect(events.length).toBeGreaterThan(0);
      expect(events2.length).toBeGreaterThan(0);
      expect(events.length).toBe(events2.length);
    });

    it('should support unsubscribing', () => {
      const events2: GameEvent[] = [];
      const unsub = orchestrator.onEvent((e) => events2.push(e));

      orchestrator.startPhase(state);
      const countBefore = events2.length;

      unsub();

      // Trigger more events
      vi.advanceTimersByTime(5000);

      expect(events2.length).toBe(countBefore);
    });
  });

  describe('pause / resume', () => {
    it('should stop timers on pause', () => {
      orchestrator.startPhase(state);
      orchestrator.pause();

      // Advance past deadline - no events should fire
      vi.advanceTimersByTime(10000);

      const timeouts = events.filter((e) => e.type === 'AGENT_TIMEOUT');
      expect(timeouts).toHaveLength(0);
    });

    it('should resume with remaining time', () => {
      orchestrator.startPhase(state);

      // Advance 2 seconds
      vi.advanceTimersByTime(2000);
      orchestrator.pause();

      // Advance while paused
      vi.advanceTimersByTime(10000);
      const timeoutsBefore = events.filter((e) => e.type === 'AGENT_TIMEOUT').length;

      // Resume
      orchestrator.resume(state);

      // Should still need ~3s to reach deadline
      vi.advanceTimersByTime(3000);

      const timeoutsAfter = events.filter((e) => e.type === 'AGENT_TIMEOUT').length;
      expect(timeoutsAfter).toBeGreaterThan(timeoutsBefore);
    });
  });

  describe('configuration', () => {
    it('should return config copy', () => {
      const config = orchestrator.getConfig();
      config.diplomacyPhaseDuration = 999999;
      // Original should be unchanged
      expect(orchestrator.getConfig().diplomacyPhaseDuration).toBe(5000);
    });

    it('should allow runtime config updates', () => {
      orchestrator.updateConfig({ diplomacyPhaseDuration: 10000 });
      expect(orchestrator.getConfig().diplomacyPhaseDuration).toBe(10000);
    });
  });

  describe('auto-resolution', () => {
    it('should auto-resolve when all submitted and min time passed', () => {
      let autoResolved = false;
      orchestrator.setAutoResolveCallback(() => { autoResolved = true; });
      orchestrator.startPhase(state);

      // Submit all orders
      for (const power of POWERS) {
        submitOrders(state, power, state.units.filter(u => u.power === power).map(u => ({ type: 'HOLD', unit: u.province })));
        orchestrator.recordSubmission(state, power, state.units.filter(u => u.power === power).length);
      }

      // Advance past min phase duration
      vi.advanceTimersByTime(200);

      expect(autoResolved).toBe(true);
    });

    it('should respect minPhaseDuration before resolving', () => {
      let autoResolved = false;
      const orch = new GameOrchestrator('test', makeConfig({ minPhaseDuration: 1000 }));
      orch.onEvent((e) => events.push(e));
      orch.setAutoResolveCallback(() => { autoResolved = true; });
      orch.startPhase(state);

      // Submit all orders immediately
      for (const power of POWERS) {
        submitOrders(state, power, state.units.filter(u => u.power === power).map(u => ({ type: 'HOLD', unit: u.province })));
        orch.recordSubmission(state, power, 3);
      }

      // Not yet resolved
      expect(autoResolved).toBe(false);

      // Advance past min
      vi.advanceTimersByTime(1100);
      expect(autoResolved).toBe(true);

      orch.clearTimers();
    });
  });
});
