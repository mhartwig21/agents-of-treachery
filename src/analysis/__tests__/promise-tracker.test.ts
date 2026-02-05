/**
 * Tests for Promise Tracker and Action Reconciler.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '../../press/types';
import type { Order, Power } from '../../engine/types';
import {
  extractPromisesFromMessage,
  extractPromisesFromTurn,
  reconcilePromise,
  reconcileAllPromises,
  generatePromiseSummary,
  createPromiseTracker,
  PromiseTracker,
} from '../promise-tracker';

describe('Promise Tracker', () => {
  describe('extractPromisesFromMessage', () => {
    it('should extract support promises', () => {
      const message: Message = {
        id: 'msg1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'ENGLAND',
        content: 'I will support your move to BEL.',
        timestamp: new Date(),
      };

      const promises = extractPromisesFromMessage(message, 'FRANCE');

      expect(promises).toHaveLength(1);
      expect(promises[0].type).toBe('SUPPORT');
      expect(promises[0].promiser).toBe('ENGLAND');
      expect(promises[0].promisee).toBe('FRANCE');
      expect(promises[0].territory).toBe('BEL');
    });

    it('should extract non-aggression promises', () => {
      const message: Message = {
        id: 'msg2',
        channelId: 'bilateral:GERMANY:RUSSIA',
        sender: 'GERMANY',
        content: "I won't attack your territories this turn.",
        timestamp: new Date(),
      };

      const promises = extractPromisesFromMessage(message, 'RUSSIA');

      expect(promises).toHaveLength(1);
      expect(promises[0].type).toBe('NON_AGGRESSION');
      expect(promises[0].expectedAction).toBe('NOT_ATTACK');
    });

    it('should extract coordination promises', () => {
      const message: Message = {
        id: 'msg3',
        channelId: 'bilateral:FRANCE:ITALY',
        sender: 'FRANCE',
        content: 'Let us join forces against Austria!',
        timestamp: new Date(),
      };

      const promises = extractPromisesFromMessage(message, 'ITALY');

      // May match multiple patterns (coordination and alliance)
      expect(promises.length).toBeGreaterThanOrEqual(1);
      const coordPromise = promises.find((p) => p.type === 'COORDINATION');
      expect(coordPromise).toBeDefined();
    });

    it('should extract alliance proposals', () => {
      const message: Message = {
        id: 'msg4',
        channelId: 'bilateral:TURKEY:RUSSIA',
        sender: 'TURKEY',
        content: 'Shall we form an alliance?',
        timestamp: new Date(),
      };

      const promises = extractPromisesFromMessage(message, 'RUSSIA');

      expect(promises).toHaveLength(1);
      expect(promises[0].type).toBe('ALLIANCE_PROPOSAL');
    });

    it('should extract territory deals', () => {
      const message: Message = {
        id: 'msg5',
        channelId: 'bilateral:ENGLAND:GERMANY',
        sender: 'ENGLAND',
        content: 'You take HOL, I take BEL. We can split the low countries.',
        timestamp: new Date(),
      };

      const promises = extractPromisesFromMessage(message, 'GERMANY');

      expect(promises.length).toBeGreaterThanOrEqual(1);
      // Should detect at least the territory deal
      const territoryDeal = promises.find((p) => p.type === 'TERRITORY_DEAL');
      expect(territoryDeal).toBeDefined();
    });

    it('should return empty array for messages without promises', () => {
      const message: Message = {
        id: 'msg6',
        channelId: 'bilateral:AUSTRIA:ITALY',
        sender: 'AUSTRIA',
        content: 'How is the weather in Rome?',
        timestamp: new Date(),
      };

      const promises = extractPromisesFromMessage(message, 'ITALY');

      expect(promises).toHaveLength(0);
    });

    it('should handle proposal intent metadata', () => {
      const message: Message = {
        id: 'msg7',
        channelId: 'bilateral:AUSTRIA:GERMANY',
        sender: 'AUSTRIA',
        content: 'Let me think about that.',
        timestamp: new Date(),
        metadata: { intent: 'PROPOSAL' },
      };

      const promises = extractPromisesFromMessage(message, 'GERMANY');

      expect(promises).toHaveLength(1);
      expect(promises[0].type).toBe('ALLIANCE_PROPOSAL');
    });
  });

  describe('extractPromisesFromTurn', () => {
    it('should extract promises from multiple messages', () => {
      const messages: Message[] = [
        {
          id: 'msg1',
          channelId: 'bilateral:ENGLAND:FRANCE',
          sender: 'ENGLAND',
          content: 'I will support you in Belgium.',
          timestamp: new Date(),
        },
        {
          id: 'msg2',
          channelId: 'bilateral:GERMANY:RUSSIA',
          sender: 'GERMANY',
          content: "I won't attack Warsaw.",
          timestamp: new Date(),
        },
      ];

      const promises = extractPromisesFromTurn(messages, 1901, 'SPRING');

      expect(promises).toHaveLength(2);
      expect(promises[0].year).toBe(1901);
      expect(promises[0].season).toBe('SPRING');
    });

    it('should only process bilateral channels', () => {
      const messages: Message[] = [
        {
          id: 'msg1',
          channelId: 'global',
          sender: 'ENGLAND',
          content: 'I will support everyone!',
          timestamp: new Date(),
        },
      ];

      const promises = extractPromisesFromTurn(messages, 1901, 'SPRING');

      expect(promises).toHaveLength(0);
    });
  });

  describe('reconcilePromise', () => {
    const unitOwners = new Map<string, Power>([
      ['LON', 'ENGLAND'],
      ['EDI', 'ENGLAND'],
      ['PAR', 'FRANCE'],
      ['MAR', 'FRANCE'],
      ['BER', 'GERMANY'],
      ['MUN', 'GERMANY'],
    ]);

    it('should detect kept support promises', () => {
      const promise = {
        id: 'p1',
        promiser: 'ENGLAND' as Power,
        promisee: 'FRANCE' as Power,
        year: 1901,
        season: 'SPRING' as const,
        messageContent: 'I will support your move.',
        type: 'SUPPORT' as const,
        expectedAction: 'SUPPORT' as const,
      };

      const orders = new Map<Power, Order[]>([
        [
          'ENGLAND',
          [
            {
              type: 'SUPPORT',
              unit: 'LON',
              supportedUnit: 'PAR',
              destination: 'BUR',
            } as Order,
          ],
        ],
      ]);

      const result = reconcilePromise(promise, orders, unitOwners);

      expect(result.kept).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should detect broken support promises', () => {
      const promise = {
        id: 'p1',
        promiser: 'ENGLAND' as Power,
        promisee: 'FRANCE' as Power,
        year: 1901,
        season: 'SPRING' as const,
        messageContent: 'I will support your move.',
        type: 'SUPPORT' as const,
        expectedAction: 'SUPPORT' as const,
      };

      const orders = new Map<Power, Order[]>([
        ['ENGLAND', [{ type: 'HOLD', unit: 'LON' } as Order]],
      ]);

      const result = reconcilePromise(promise, orders, unitOwners);

      expect(result.kept).toBe(false);
    });

    it('should detect kept non-aggression promises', () => {
      const promise = {
        id: 'p2',
        promiser: 'GERMANY' as Power,
        promisee: 'FRANCE' as Power,
        year: 1901,
        season: 'SPRING' as const,
        messageContent: "I won't attack you.",
        type: 'NON_AGGRESSION' as const,
        expectedAction: 'NOT_ATTACK' as const,
      };

      const orders = new Map<Power, Order[]>([
        ['GERMANY', [{ type: 'HOLD', unit: 'BER' } as Order]],
      ]);

      const result = reconcilePromise(promise, orders, unitOwners);

      expect(result.kept).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('should detect broken non-aggression promises (betrayal)', () => {
      const promise = {
        id: 'p2',
        promiser: 'GERMANY' as Power,
        promisee: 'FRANCE' as Power,
        year: 1901,
        season: 'SPRING' as const,
        messageContent: "I won't attack you.",
        type: 'NON_AGGRESSION' as const,
        expectedAction: 'NOT_ATTACK' as const,
      };

      const orders = new Map<Power, Order[]>([
        [
          'GERMANY',
          [{ type: 'MOVE', unit: 'MUN', destination: 'PAR' } as Order],
        ],
      ]);

      const result = reconcilePromise(promise, orders, unitOwners);

      expect(result.kept).toBe(false);
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('reconcileAllPromises', () => {
    const unitOwners = new Map<string, Power>([
      ['LON', 'ENGLAND'],
      ['PAR', 'FRANCE'],
      ['BER', 'GERMANY'],
    ]);

    it('should generate memory updates for broken promises', () => {
      const promises = [
        {
          id: 'p1',
          promiser: 'GERMANY' as Power,
          promisee: 'FRANCE' as Power,
          year: 1901,
          season: 'SPRING' as const,
          messageContent: "I won't attack you.",
          type: 'NON_AGGRESSION' as const,
          expectedAction: 'NOT_ATTACK' as const,
        },
      ];

      const orders = new Map<Power, Order[]>([
        [
          'GERMANY',
          [{ type: 'MOVE', unit: 'BER', destination: 'PAR' } as Order],
        ],
      ]);

      const updates = reconcileAllPromises(
        promises,
        orders,
        unitOwners,
        1901,
        'SPRING'
      );

      expect(updates).toHaveLength(1);
      expect(updates[0].power).toBe('FRANCE');
      expect(updates[0].aboutPower).toBe('GERMANY');
      expect(updates[0].eventType).toBe('BETRAYAL');
      expect(updates[0].trustDelta).toBeLessThan(0);
    });

    it('should generate memory updates for kept promises', () => {
      const promises = [
        {
          id: 'p1',
          promiser: 'ENGLAND' as Power,
          promisee: 'FRANCE' as Power,
          year: 1901,
          season: 'SPRING' as const,
          messageContent: 'I will support you.',
          type: 'SUPPORT' as const,
          expectedAction: 'SUPPORT' as const,
        },
      ];

      const orders = new Map<Power, Order[]>([
        [
          'ENGLAND',
          [
            {
              type: 'SUPPORT',
              unit: 'LON',
              supportedUnit: 'PAR',
              destination: 'BUR',
            } as Order,
          ],
        ],
      ]);

      const updates = reconcileAllPromises(
        promises,
        orders,
        unitOwners,
        1901,
        'SPRING'
      );

      expect(updates).toHaveLength(1);
      expect(updates[0].eventType).toBe('PROMISE_KEPT');
      expect(updates[0].trustDelta).toBeGreaterThan(0);
    });
  });

  describe('generatePromiseSummary', () => {
    it('should generate summary for relevant power', () => {
      const updates = [
        {
          power: 'FRANCE' as Power,
          aboutPower: 'GERMANY' as Power,
          trustDelta: -0.3,
          memoryPrompt: 'GERMANY broke their promise: Attacked your territory',
          eventType: 'BETRAYAL' as const,
          year: 1901,
          season: 'SPRING' as const,
        },
      ];

      const summary = generatePromiseSummary(updates, 'FRANCE');

      expect(summary).toContain('PROMISE RECONCILIATION');
      expect(summary).toContain('BETRAYAL');
      expect(summary).toContain('GERMANY');
    });

    it('should return empty string for irrelevant power', () => {
      const updates = [
        {
          power: 'FRANCE' as Power,
          aboutPower: 'GERMANY' as Power,
          trustDelta: -0.3,
          memoryPrompt: 'GERMANY broke their promise',
          eventType: 'BETRAYAL' as const,
          year: 1901,
          season: 'SPRING' as const,
        },
      ];

      const summary = generatePromiseSummary(updates, 'ENGLAND');

      expect(summary).toBe('');
    });
  });

  describe('PromiseTracker', () => {
    let tracker: PromiseTracker;

    beforeEach(() => {
      tracker = createPromiseTracker();
    });

    it('should record promises from a turn', () => {
      const messages: Message[] = [
        {
          id: 'msg1',
          channelId: 'bilateral:ENGLAND:FRANCE',
          sender: 'ENGLAND',
          content: 'I will support your move to Belgium.',
          timestamp: new Date(),
        },
      ];

      const promises = tracker.recordTurnPromises(messages, 1901, 'SPRING');

      expect(promises).toHaveLength(1);
    });

    it('should reconcile promises against orders', () => {
      const messages: Message[] = [
        {
          id: 'msg1',
          channelId: 'bilateral:ENGLAND:FRANCE',
          sender: 'ENGLAND',
          content: 'I will support your move.',
          timestamp: new Date(),
        },
      ];

      // Record promises in SPRING
      tracker.recordTurnPromises(messages, 1901, 'SPRING');

      // Reconcile in FALL (checking SPRING promises)
      const unitOwners = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['PAR', 'FRANCE'],
      ]);
      const orders = new Map<Power, Order[]>([
        ['ENGLAND', [{ type: 'HOLD', unit: 'LON' } as Order]],
      ]);

      const updates = tracker.reconcileTurn(1901, 'FALL', orders, unitOwners);

      expect(updates).toHaveLength(1);
      expect(updates[0].eventType).toBe('PROMISE_BROKEN');
    });

    it('should track promises by promiser', () => {
      const messages: Message[] = [
        {
          id: 'msg1',
          channelId: 'bilateral:ENGLAND:FRANCE',
          sender: 'ENGLAND',
          content: 'I will support your move.',
          timestamp: new Date(),
        },
        {
          id: 'msg2',
          channelId: 'bilateral:ENGLAND:GERMANY',
          sender: 'ENGLAND',
          content: "I won't attack you.",
          timestamp: new Date(),
        },
      ];

      tracker.recordTurnPromises(messages, 1901, 'SPRING');

      const englandPromises = tracker.getPromisesBy('ENGLAND');
      expect(englandPromises).toHaveLength(2);
    });

    it('should track promises by promisee', () => {
      const messages: Message[] = [
        {
          id: 'msg1',
          channelId: 'bilateral:ENGLAND:FRANCE',
          sender: 'ENGLAND',
          content: 'I will support your move.',
          timestamp: new Date(),
        },
        {
          id: 'msg2',
          channelId: 'bilateral:GERMANY:FRANCE',
          sender: 'GERMANY',
          content: "I won't attack you.",
          timestamp: new Date(),
        },
      ];

      tracker.recordTurnPromises(messages, 1901, 'SPRING');

      const promisesToFrance = tracker.getPromisesTo('FRANCE');
      expect(promisesToFrance).toHaveLength(2);
    });

    it('should clear all data', () => {
      const messages: Message[] = [
        {
          id: 'msg1',
          channelId: 'bilateral:ENGLAND:FRANCE',
          sender: 'ENGLAND',
          content: 'I will support your move.',
          timestamp: new Date(),
        },
      ];

      tracker.recordTurnPromises(messages, 1901, 'SPRING');
      tracker.clear();

      expect(tracker.getPromisesBy('ENGLAND')).toHaveLength(0);
    });
  });
});
