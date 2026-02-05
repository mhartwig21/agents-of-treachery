/**
 * Tests for useRelationshipHistory hook.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useRelationshipHistory,
  getPairKey,
  getHistoryForPair,
  type RelationshipHistory,
} from '../useRelationshipHistory';
import type { PowerPairRelationship } from '../../analysis/relationships';

describe('useRelationshipHistory', () => {
  describe('getPairKey', () => {
    it('returns alphabetically sorted key', () => {
      expect(getPairKey('GERMANY', 'AUSTRIA')).toBe('AUSTRIA-GERMANY');
      expect(getPairKey('AUSTRIA', 'GERMANY')).toBe('AUSTRIA-GERMANY');
      expect(getPairKey('ENGLAND', 'FRANCE')).toBe('ENGLAND-FRANCE');
    });
  });

  describe('useRelationshipHistory hook', () => {
    it('returns empty map when no relationships provided', () => {
      const { result } = renderHook(() =>
        useRelationshipHistory({
          relationships: [],
          currentYear: 1901,
          currentSeason: 'SPRING',
        })
      );

      expect(result.current.size).toBe(0);
    });

    it('builds history for relationship pairs', () => {
      const mockRelationships: PowerPairRelationship[] = [
        {
          power1: 'ENGLAND',
          power2: 'FRANCE',
          score: 15,
          status: 'ally',
          recentActions: [
            {
              year: 1901,
              season: 'SPRING',
              type: 'DIRECT_SUPPORT',
              actor: 'ENGLAND',
              target: 'FRANCE',
              points: 3,
              description: 'England supported France',
            },
            {
              year: 1901,
              season: 'FALL',
              type: 'DIRECT_SUPPORT',
              actor: 'FRANCE',
              target: 'ENGLAND',
              points: 3,
              description: 'France supported England',
            },
          ],
          betrayalDetected: false,
        },
      ];

      const { result } = renderHook(() =>
        useRelationshipHistory({
          relationships: mockRelationships,
          currentYear: 1902,
          currentSeason: 'SPRING',
        })
      );

      expect(result.current.size).toBe(1);
      const history = result.current.get('ENGLAND-FRANCE');
      expect(history).toBeDefined();
      expect(history?.timeline.length).toBeGreaterThan(0);
      expect(history?.currentStatus).toBe('ally');
    });

    it('detects alliance events', () => {
      const mockRelationships: PowerPairRelationship[] = [
        {
          power1: 'GERMANY',
          power2: 'AUSTRIA',
          score: 20,
          status: 'ally',
          recentActions: [
            {
              year: 1901,
              season: 'SPRING',
              type: 'DIRECT_SUPPORT',
              actor: 'GERMANY',
              target: 'AUSTRIA',
              points: 3,
              description: 'Germany supported Austria',
            },
          ],
          betrayalDetected: false,
        },
      ];

      const { result } = renderHook(() =>
        useRelationshipHistory({
          relationships: mockRelationships,
          currentYear: 1901,
          currentSeason: 'FALL',
        })
      );

      // Key is sorted alphabetically
      const history = result.current.get('AUSTRIA-GERMANY');
      expect(history).toBeDefined();

      // Find the turn with the support event
      const springTurn = history?.timeline.find((t) => t.turn === 'S1901');
      expect(springTurn?.keyEvent).toBe('alliance');
    });

    it('detects betrayal events', () => {
      const mockRelationships: PowerPairRelationship[] = [
        {
          power1: 'RUSSIA',
          power2: 'TURKEY',
          score: -50,
          status: 'enemy',
          recentActions: [
            {
              year: 1902,
              season: 'SPRING',
              type: 'SUPPORT_THEN_STAB',
              actor: 'RUSSIA',
              target: 'TURKEY',
              points: -10,
              description: 'Russia stabbed Turkey',
            },
          ],
          betrayalDetected: true,
          betrayalTurn: { year: 1902, season: 'SPRING' },
        },
      ];

      const { result } = renderHook(() =>
        useRelationshipHistory({
          relationships: mockRelationships,
          currentYear: 1902,
          currentSeason: 'FALL',
        })
      );

      const history = result.current.get('RUSSIA-TURKEY');
      expect(history).toBeDefined();

      // Find the turn with the betrayal
      const springTurn = history?.timeline.find((t) => t.turn === 'S1902');
      expect(springTurn?.keyEvent).toBe('betrayal');
    });

    it('detects war events from attacks', () => {
      const mockRelationships: PowerPairRelationship[] = [
        {
          power1: 'ITALY',
          power2: 'AUSTRIA',
          score: -30,
          status: 'enemy',
          recentActions: [
            {
              year: 1901,
              season: 'FALL',
              type: 'ATTACK',
              actor: 'ITALY',
              target: 'AUSTRIA',
              points: -3,
              description: 'Italy attacked Austria',
            },
          ],
          betrayalDetected: false,
        },
      ];

      const { result } = renderHook(() =>
        useRelationshipHistory({
          relationships: mockRelationships,
          currentYear: 1902,
          currentSeason: 'SPRING',
        })
      );

      const history = result.current.get('AUSTRIA-ITALY');
      expect(history).toBeDefined();

      const fallTurn = history?.timeline.find((t) => t.turn === 'F1901');
      expect(fallTurn?.keyEvent).toBe('war');
    });
  });

  describe('getHistoryForPair', () => {
    it('returns history for existing pair', () => {
      const historyMap = new Map<string, RelationshipHistory>();
      historyMap.set('ENGLAND-FRANCE', {
        power1: 'ENGLAND',
        power2: 'FRANCE',
        timeline: [],
        currentStatus: 'ally',
        currentScore: 15,
      });

      const result = getHistoryForPair(historyMap, 'FRANCE', 'ENGLAND');
      expect(result).toBeDefined();
      expect(result?.power1).toBe('ENGLAND');
    });

    it('returns undefined for non-existent pair', () => {
      const historyMap = new Map<string, RelationshipHistory>();

      const result = getHistoryForPair(historyMap, 'GERMANY', 'ITALY');
      expect(result).toBeUndefined();
    });
  });
});
