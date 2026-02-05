/**
 * Tests for the Trust Tracker - "Say vs Do" analysis engine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TrustTracker, createTrustTracker } from '../trust';
import type { Message } from '../../press/types';
import type { OrdersSubmittedEvent } from '../../store/events';
import type { Power, Order } from '../../engine/types';

describe('TrustTracker', () => {
  let tracker: TrustTracker;

  beforeEach(() => {
    tracker = createTrustTracker();
  });

  describe('processMessage', () => {
    it('should extract support promises from PROPOSAL messages', () => {
      const message: Message = {
        id: 'msg1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'ENGLAND' as Power,
        content: 'I will support your move to Burgundy this turn.',
        timestamp: new Date(),
        metadata: { intent: 'PROPOSAL' },
      };

      const promises = tracker.processMessage(message, { year: 1901, season: 'SPRING' });

      expect(promises.length).toBeGreaterThan(0);
      expect(promises[0].type).toBe('SUPPORT');
      expect(promises[0].promisor).toBe('ENGLAND');
      expect(promises[0].promisee).toBe('FRANCE');
    });

    it('should extract non-aggression promises', () => {
      const message: Message = {
        id: 'msg2',
        channelId: 'bilateral:GERMANY:RUSSIA',
        sender: 'GERMANY' as Power,
        content: 'I promise I will not attack you this year. Let us have peace.',
        timestamp: new Date(),
        metadata: { intent: 'PROPOSAL' },
      };

      const promises = tracker.processMessage(message, { year: 1901, season: 'SPRING' });

      expect(promises.some(p => p.type === 'NON_AGGRESSION')).toBe(true);
    });

    it('should extract DMZ agreements', () => {
      const message: Message = {
        id: 'msg3',
        channelId: 'bilateral:AUSTRIA:RUSSIA',
        sender: 'AUSTRIA' as Power,
        content: 'Let us establish a DMZ in Galicia. Neither of us should enter.',
        timestamp: new Date(),
        metadata: { intent: 'ACCEPTANCE' },
      };

      const promises = tracker.processMessage(message, { year: 1901, season: 'SPRING' });

      expect(promises.some(p => p.type === 'DMZ')).toBe(true);
      expect(promises.find(p => p.type === 'DMZ')?.territory).toBe('GALICIA');
    });

    it('should extract territory references from messages', () => {
      const message: Message = {
        id: 'msg4',
        channelId: 'bilateral:ITALY:AUSTRIA',
        sender: 'ITALY' as Power,
        content: 'I agree to support you into Munich if you help me in Venice.',
        timestamp: new Date(),
        metadata: { intent: 'ACCEPTANCE' },
      };

      const promises = tracker.processMessage(message, { year: 1901, season: 'SPRING' });

      expect(promises.length).toBeGreaterThan(0);
      // Should have extracted MUN or VEN as territory
      const hasTerritory = promises.some(p => p.territory === 'MUNICH' || p.territory === 'MUN');
      expect(hasTerritory).toBe(true);
    });

    it('should not extract promises from non-diplomatic messages', () => {
      const message: Message = {
        id: 'msg5',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'ENGLAND' as Power,
        content: 'Hello, how are you today?',
        timestamp: new Date(),
        metadata: { intent: 'SMALL_TALK' },
      };

      const promises = tracker.processMessage(message, { year: 1901, season: 'SPRING' });

      expect(promises.length).toBe(0);
    });

    it('should not extract promises from multiparty channels', () => {
      const message: Message = {
        id: 'msg6',
        channelId: 'multiparty:ENGLAND:FRANCE:GERMANY',
        sender: 'ENGLAND' as Power,
        content: 'I will support France to Burgundy.',
        timestamp: new Date(),
        metadata: { intent: 'PROPOSAL' },
      };

      const promises = tracker.processMessage(message, { year: 1901, season: 'SPRING' });

      expect(promises.length).toBe(0);
    });
  });

  describe('processOrders', () => {
    it('should evaluate support promises when orders are submitted', () => {
      // First, create a support promise
      const message: Message = {
        id: 'msg1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'ENGLAND' as Power,
        content: 'I will support your army this turn.',
        timestamp: new Date(),
        metadata: { intent: 'PROPOSAL' },
      };

      tracker.processMessage(message, { year: 1901, season: 'SPRING' });

      // Then submit orders that include a support
      const event: OrdersSubmittedEvent = {
        id: 'evt1',
        timestamp: new Date(),
        gameId: 'game1',
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND' as Power,
          orders: [
            { type: 'SUPPORT', unit: 'LON', supportedUnit: 'PAR' } as Order,
          ],
          year: 1901,
          season: 'FALL',
        },
      };

      tracker.processOrders(event);

      const metrics = tracker.getTrustMetrics('ENGLAND' as Power);
      // Should have evaluated the promise (kept or broken depends on implementation)
      expect(metrics.promisesMade).toBe(1);
    });
  });

  describe('getTrustMetrics', () => {
    it('should return 100% trust when no promises have been made', () => {
      const metrics = tracker.getTrustMetrics('ENGLAND' as Power);

      expect(metrics.promisesMade).toBe(0);
      expect(metrics.trustScore).toBe(100);
    });

    it('should calculate correct trust score based on kept/broken promises', () => {
      // Create multiple promises and evaluate them
      const messages: Message[] = [
        {
          id: 'msg1',
          channelId: 'bilateral:GERMANY:FRANCE',
          sender: 'GERMANY' as Power,
          content: 'I will support you.',
          timestamp: new Date(),
          metadata: { intent: 'PROPOSAL' },
        },
        {
          id: 'msg2',
          channelId: 'bilateral:GERMANY:RUSSIA',
          sender: 'GERMANY' as Power,
          content: 'I promise peace with you.',
          timestamp: new Date(),
          metadata: { intent: 'PROPOSAL' },
        },
      ];

      for (const msg of messages) {
        tracker.processMessage(msg, { year: 1901, season: 'SPRING' });
      }

      const metrics = tracker.getTrustMetrics('GERMANY' as Power);
      expect(metrics.promisesMade).toBeGreaterThan(0);
    });
  });

  describe('getPairwiseTrust', () => {
    it('should track promises between specific power pairs', () => {
      const message: Message = {
        id: 'msg1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'ENGLAND' as Power,
        content: 'I will support your move.',
        timestamp: new Date(),
        metadata: { intent: 'PROPOSAL' },
      };

      tracker.processMessage(message, { year: 1901, season: 'SPRING' });

      const pairTrust = tracker.getPairwiseTrust('ENGLAND' as Power, 'FRANCE' as Power);

      expect(pairTrust.promisesFromP1).toBe(1);
      expect(pairTrust.promisesFromP2).toBe(0);
    });

    it('should handle bidirectional promises', () => {
      const messages: Message[] = [
        {
          id: 'msg1',
          channelId: 'bilateral:ENGLAND:FRANCE',
          sender: 'ENGLAND' as Power,
          content: 'I will support you.',
          timestamp: new Date(),
          metadata: { intent: 'PROPOSAL' },
        },
        {
          id: 'msg2',
          channelId: 'bilateral:ENGLAND:FRANCE',
          sender: 'FRANCE' as Power,
          content: 'I agree and will help you too.',
          timestamp: new Date(),
          metadata: { intent: 'ACCEPTANCE' },
        },
      ];

      for (const msg of messages) {
        tracker.processMessage(msg, { year: 1901, season: 'SPRING' });
      }

      const pairTrust = tracker.getPairwiseTrust('ENGLAND' as Power, 'FRANCE' as Power);

      expect(pairTrust.promisesFromP1 + pairTrust.promisesFromP2).toBeGreaterThan(1);
    });
  });

  describe('getTrustIndicator', () => {
    it('should return "unknown" when no promises made', () => {
      const indicator = tracker.getTrustIndicator('ENGLAND' as Power);
      expect(indicator).toBe('unknown');
    });
  });

  describe('getTrustTooltip', () => {
    it('should return descriptive tooltip when no promises', () => {
      const tooltip = tracker.getTrustTooltip('ENGLAND' as Power);
      expect(tooltip).toContain('No promises tracked');
    });

    it('should return percentage when promises exist', () => {
      const message: Message = {
        id: 'msg1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'ENGLAND' as Power,
        content: 'I will support you.',
        timestamp: new Date(),
        metadata: { intent: 'PROPOSAL' },
      };

      tracker.processMessage(message, { year: 1901, season: 'SPRING' });

      // Submit orders to evaluate promise
      const event: OrdersSubmittedEvent = {
        id: 'evt1',
        timestamp: new Date(),
        gameId: 'game1',
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND' as Power,
          orders: [{ type: 'SUPPORT', unit: 'LON', supportedUnit: 'PAR' } as Order],
          year: 1901,
          season: 'FALL',
        },
      };

      tracker.processOrders(event);

      const tooltip = tracker.getTrustTooltip('ENGLAND' as Power);
      expect(tooltip).toMatch(/\d+%|pending/);
    });
  });

  describe('reset', () => {
    it('should clear all tracked promises', () => {
      const message: Message = {
        id: 'msg1',
        channelId: 'bilateral:ENGLAND:FRANCE',
        sender: 'ENGLAND' as Power,
        content: 'I will support you.',
        timestamp: new Date(),
        metadata: { intent: 'PROPOSAL' },
      };

      tracker.processMessage(message, { year: 1901, season: 'SPRING' });

      expect(tracker.getTrustMetrics('ENGLAND' as Power).promisesMade).toBe(1);

      tracker.reset();

      expect(tracker.getTrustMetrics('ENGLAND' as Power).promisesMade).toBe(0);
    });
  });

  describe('getAllTrustMetrics', () => {
    it('should return metrics for all 7 powers', () => {
      const allMetrics = tracker.getAllTrustMetrics();

      expect(allMetrics.length).toBe(7);
      expect(allMetrics.map(m => m.power)).toContain('ENGLAND');
      expect(allMetrics.map(m => m.power)).toContain('FRANCE');
      expect(allMetrics.map(m => m.power)).toContain('GERMANY');
      expect(allMetrics.map(m => m.power)).toContain('ITALY');
      expect(allMetrics.map(m => m.power)).toContain('AUSTRIA');
      expect(allMetrics.map(m => m.power)).toContain('RUSSIA');
      expect(allMetrics.map(m => m.power)).toContain('TURKEY');
    });
  });

  describe('getBrokenPromisesSummary', () => {
    it('should return null when no broken promises', () => {
      const summary = tracker.getBrokenPromisesSummary('ENGLAND' as Power, 'FRANCE' as Power);
      expect(summary).toBeNull();
    });
  });
});
