/**
 * Tests for GameStore event sourcing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameStore } from '../game-store';
import type { Unit, Order, Power, RetreatOrder, BuildOrder } from '../../engine/types';

describe('GameStore', () => {
  let store: GameStore;

  const initialUnits: Unit[] = [
    { type: 'FLEET', power: 'ENGLAND', province: 'LON' },
    { type: 'FLEET', power: 'ENGLAND', province: 'EDI' },
    { type: 'ARMY', power: 'ENGLAND', province: 'LVP' },
    { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
    { type: 'ARMY', power: 'FRANCE', province: 'MAR' },
  ];

  const initialSupplyCenters = new Map<string, Power>([
    ['LON', 'ENGLAND'],
    ['EDI', 'ENGLAND'],
    ['LVP', 'ENGLAND'],
    ['PAR', 'FRANCE'],
    ['MAR', 'FRANCE'],
  ]);

  beforeEach(() => {
    store = new GameStore('test-game');
    store.initializeGame(initialUnits, initialSupplyCenters);
  });

  describe('initialization', () => {
    it('should initialize with units and supply centers', () => {
      const state = store.getState();
      expect(state.units).toHaveLength(5);
      expect(state.supplyCenters.size).toBe(5);
      expect(state.year).toBe(1901);
      expect(state.season).toBe('SPRING');
      expect(state.phase).toBe('DIPLOMACY');
    });

    it('should create GAME_CREATED event', () => {
      const events = store.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('GAME_CREATED');
    });
  });

  describe('order submission', () => {
    it('should record orders submitted', () => {
      const orders: Order[] = [
        { type: 'HOLD', unit: 'LON' },
        { type: 'MOVE', unit: 'EDI', destination: 'NTH' },
      ];

      store.submitOrders('ENGLAND', orders, 1901, 'SPRING');

      const state = store.getState();
      expect(state.orders.get('ENGLAND')).toHaveLength(2);
    });

    it('should create ORDERS_SUBMITTED event', () => {
      const orders: Order[] = [{ type: 'HOLD', unit: 'LON' }];
      store.submitOrders('ENGLAND', orders, 1901, 'SPRING');

      const events = store.getEvents();
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe('ORDERS_SUBMITTED');
    });
  });

  describe('movement resolution', () => {
    it('should apply unit moves', () => {
      store.resolveMovement(
        1901,
        'SPRING',
        [{ order: { type: 'MOVE', unit: 'EDI', destination: 'NTH' }, success: true }],
        [{ power: 'ENGLAND', from: 'EDI', to: 'NTH' }],
        []
      );

      const state = store.getState();
      const movedUnit = state.units.find(u => u.province === 'NTH');
      expect(movedUnit).toBeDefined();
      expect(movedUnit!.power).toBe('ENGLAND');
    });

    it('should handle dislodged units', () => {
      store.resolveMovement(
        1901,
        'SPRING',
        [],
        [],
        [{
          unit: { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
          dislodgedFrom: 'BUR',
          retreatOptions: ['BRE', 'GAS'],
        }]
      );

      const state = store.getState();
      expect(state.pendingRetreats).toHaveLength(1);
      expect(state.pendingRetreats[0].province).toBe('PAR');
    });

    it('should clear orders after resolution', () => {
      store.submitOrders('ENGLAND', [{ type: 'HOLD', unit: 'LON' }], 1901, 'SPRING');
      store.resolveMovement(1901, 'SPRING', [], [], []);

      const state = store.getState();
      expect(state.orders.size).toBe(0);
    });
  });

  describe('phase advancement', () => {
    it('should update year, season, and phase', () => {
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');

      const state = store.getState();
      expect(state.year).toBe(1901);
      expect(state.season).toBe('FALL');
      expect(state.phase).toBe('DIPLOMACY');
    });
  });

  describe('supply center capture', () => {
    it('should update supply center ownership', () => {
      store.captureSupplyCenters(1901, 'FALL', [
        { territory: 'BEL', from: null, to: 'ENGLAND' },
      ]);

      const state = store.getState();
      expect(state.supplyCenters.get('BEL')).toBe('ENGLAND');
    });
  });

  describe('builds resolution', () => {
    it('should add built units', () => {
      const initialCount = store.getState().units.length;

      store.resolveBuilds(
        1901,
        [{ power: 'ENGLAND', province: 'LON', unitType: 'FLEET' }],
        []
      );

      const state = store.getState();
      expect(state.units.length).toBe(initialCount + 1);
    });

    it('should remove disbanded units', () => {
      const initialCount = store.getState().units.length;

      store.resolveBuilds(
        1901,
        [],
        [{ power: 'ENGLAND', province: 'LON' }]
      );

      const state = store.getState();
      expect(state.units.length).toBe(initialCount - 1);
    });
  });

  describe('game end', () => {
    it('should record winner', () => {
      store.endGame('ENGLAND', false, 1910);

      const state = store.getState();
      expect(state.winner).toBe('ENGLAND');
      expect(state.draw).toBe(false);
    });

    it('should record draw', () => {
      store.endGame(undefined, true, 1910);

      const state = store.getState();
      expect(state.winner).toBeUndefined();
      expect(state.draw).toBe(true);
    });
  });

  describe('messages', () => {
    it('should record messages', () => {
      store.recordMessage('msg-1', 'channel-1', 'ENGLAND', 'Hello France!');

      const messages = store.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].sender).toBe('ENGLAND');
      expect(messages[0].content).toBe('Hello France!');
    });

    it('should filter messages by turn', () => {
      store.recordMessage('msg-1', 'ch-1', 'ENGLAND', 'Spring msg');
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');
      store.recordMessage('msg-2', 'ch-1', 'FRANCE', 'Fall msg');

      const springMsgs = store.getMessagesForTurn(1901, 'SPRING');
      expect(springMsgs).toHaveLength(1);
      expect(springMsgs[0].content).toBe('Spring msg');
    });
  });

  describe('event replay', () => {
    it('should rebuild state from events', () => {
      // Make some changes
      store.submitOrders('ENGLAND', [{ type: 'HOLD', unit: 'LON' }], 1901, 'SPRING');
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');

      const events = store.getEvents();
      const originalState = store.getState();

      // Create new store and replay
      const newStore = new GameStore('test-game');
      newStore.replayEvents([...events]);

      const replayedState = newStore.getState();
      expect(replayedState.season).toBe(originalState.season);
      expect(replayedState.phase).toBe(originalState.phase);
    });

    it('should get state at specific version', () => {
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');
      store.advancePhase(1901, 'FALL', 'DIPLOMACY', 1902, 'SPRING', 'DIPLOMACY');

      const stateAtV1 = store.getStateAtVersion(1);
      const stateAtV2 = store.getStateAtVersion(2);
      const stateAtV3 = store.getStateAtVersion(3);

      expect(stateAtV1!.season).toBe('SPRING');
      expect(stateAtV2!.season).toBe('FALL');
      expect(stateAtV3!.season).toBe('SPRING');
      expect(stateAtV3!.year).toBe(1902);
    });
  });

  describe('immutability', () => {
    it('should not allow external mutation of state', () => {
      const state = store.getState();
      const unitCount = state.units.length;

      // Attempt to mutate (TypeScript would prevent this, but test runtime behavior)
      (state.units as Unit[]).push({ type: 'ARMY', power: 'ENGLAND', province: 'XXX' });

      // Original state should be unchanged
      const freshState = store.getState();
      expect(freshState.units).toHaveLength(unitCount);
    });

    it('should return different object references on each call', () => {
      const state1 = store.getSnapshot();
      const state2 = store.getSnapshot();

      expect(state1).not.toBe(state2);
      expect(state1.state).not.toBe(state2.state);
      expect(state1.state.units).not.toBe(state2.state.units);
    });
  });

  describe('retreat submission', () => {
    it('should record retreat orders submitted', () => {
      const retreats: RetreatOrder[] = [
        { unit: 'PAR', destination: 'BRE' },
      ];

      const event = store.submitRetreats('FRANCE', retreats, 1901, 'SPRING');
      expect(event.type).toBe('RETREATS_SUBMITTED');
      expect(event.payload.power).toBe('FRANCE');
      expect(event.payload.retreats).toHaveLength(1);
    });

    it('should create RETREATS_SUBMITTED event', () => {
      store.submitRetreats('FRANCE', [{ unit: 'PAR', destination: 'BRE' }], 1901, 'SPRING');

      const events = store.getEvents();
      const retreatEvents = events.filter(e => e.type === 'RETREATS_SUBMITTED');
      expect(retreatEvents).toHaveLength(1);
    });

    it('should handle disband retreat (no destination)', () => {
      const retreats: RetreatOrder[] = [
        { unit: 'PAR' }, // No destination = disband
      ];

      const event = store.submitRetreats('FRANCE', retreats, 1901, 'SPRING');
      expect(event.payload.retreats[0].destination).toBeUndefined();
    });
  });

  describe('retreat resolution', () => {
    it('should process successful retreat', () => {
      // Set up dislodged unit first
      store.resolveMovement(1901, 'SPRING', [], [], [{
        unit: { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
        dislodgedFrom: 'BUR',
        retreatOptions: ['BRE', 'GAS'],
      }]);

      const event = store.resolveRetreats(1901, 'SPRING', [{
        unit: { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
        destination: 'BRE',
        success: true,
      }]);

      expect(event.type).toBe('RETREATS_RESOLVED');
      expect(event.payload.retreatResults).toHaveLength(1);
      expect(event.payload.retreatResults[0].success).toBe(true);
    });

    it('should process failed retreat (disband)', () => {
      store.resolveMovement(1901, 'SPRING', [], [], [{
        unit: { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
        dislodgedFrom: 'BUR',
        retreatOptions: [],
      }]);

      const event = store.resolveRetreats(1901, 'SPRING', [{
        unit: { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
        destination: null,
        success: false,
      }]);

      expect(event.payload.retreatResults[0].success).toBe(false);
      expect(event.payload.retreatResults[0].destination).toBeNull();
    });

    it('should create RETREATS_RESOLVED event', () => {
      store.resolveRetreats(1901, 'SPRING', []);

      const events = store.getEvents();
      const retreatResolved = events.filter(e => e.type === 'RETREATS_RESOLVED');
      expect(retreatResolved).toHaveLength(1);
    });
  });

  describe('build submission', () => {
    it('should record build orders submitted', () => {
      const builds: BuildOrder[] = [
        { type: 'BUILD', province: 'LON', unitType: 'FLEET' },
      ];

      const event = store.submitBuilds('ENGLAND', builds, 1901);
      expect(event.type).toBe('BUILDS_SUBMITTED');
      expect(event.payload.power).toBe('ENGLAND');
      expect(event.payload.builds).toHaveLength(1);
    });

    it('should create BUILDS_SUBMITTED event', () => {
      store.submitBuilds('FRANCE', [{ type: 'BUILD', province: 'PAR', unitType: 'ARMY' }], 1901);

      const events = store.getEvents();
      const buildEvents = events.filter(e => e.type === 'BUILDS_SUBMITTED');
      expect(buildEvents).toHaveLength(1);
    });

    it('should handle disband orders', () => {
      const builds: BuildOrder[] = [
        { type: 'DISBAND', province: 'LON' },
      ];

      const event = store.submitBuilds('ENGLAND', builds, 1901);
      expect(event.payload.builds[0].type).toBe('DISBAND');
    });

    it('should handle multiple builds for same power', () => {
      const builds: BuildOrder[] = [
        { type: 'BUILD', province: 'LON', unitType: 'FLEET' },
        { type: 'BUILD', province: 'EDI', unitType: 'FLEET' },
      ];

      const event = store.submitBuilds('ENGLAND', builds, 1901);
      expect(event.payload.builds).toHaveLength(2);
    });
  });

  describe('snapshot', () => {
    it('should return complete snapshot', () => {
      const snapshot = store.getSnapshot();
      expect(snapshot.gameId).toBe('test-game');
      expect(snapshot.state).toBeDefined();
      expect(snapshot.events).toBeDefined();
      expect(snapshot.state.units).toHaveLength(5);
    });

    it('should include version in snapshot', () => {
      const snapshot = store.getSnapshot();
      expect(snapshot.version).toBeGreaterThan(0);
    });

    it('should reflect state changes in snapshot', () => {
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');
      const snapshot = store.getSnapshot();
      expect(snapshot.state.season).toBe('FALL');
    });
  });

  describe('subscriptions', () => {
    it('should notify subscribers on state change', () => {
      let notified = false;
      store.subscribe(() => {
        notified = true;
      });

      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');

      expect(notified).toBe(true);
    });

    it('should allow unsubscribing', () => {
      let count = 0;
      const unsubscribe = store.subscribe(() => {
        count++;
      });

      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');
      expect(count).toBe(1);

      unsubscribe();
      store.advancePhase(1901, 'FALL', 'DIPLOMACY', 1902, 'SPRING', 'DIPLOMACY');
      expect(count).toBe(1); // Should not increase
    });
  });
});
