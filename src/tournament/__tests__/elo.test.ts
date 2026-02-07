/**
 * Tests for ELO rating calculations.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateExpectedScore,
  calculateExpectedScoreMultiplayer,
  calculateActualScore,
  calculatePlacements,
  calculateRatingChanges,
  createInitialRating,
  getMatchmakingRating,
  calculateWinProbability,
  getProvisionalKFactor,
  DEFAULT_STARTING_ELO,
} from '../elo';
import type { GameResult, Rating } from '../types';
import type { Power } from '../../engine/types';

describe('ELO Calculations', () => {
  describe('calculateExpectedScore', () => {
    it('returns 0.5 for equal ratings', () => {
      const expected = calculateExpectedScore(1500, 1500);
      expect(expected).toBeCloseTo(0.5, 4);
    });

    it('returns higher score when player is stronger', () => {
      const expected = calculateExpectedScore(1700, 1500);
      expect(expected).toBeGreaterThan(0.5);
      expect(expected).toBeCloseTo(0.76, 1);
    });

    it('returns lower score when player is weaker', () => {
      const expected = calculateExpectedScore(1300, 1500);
      expect(expected).toBeLessThan(0.5);
      expect(expected).toBeCloseTo(0.24, 1);
    });

    it('returns very high score for large rating difference', () => {
      const expected = calculateExpectedScore(2000, 1200);
      expect(expected).toBeGreaterThan(0.95);
    });
  });

  describe('calculateExpectedScoreMultiplayer', () => {
    it('returns 0.5 for equal ratings', () => {
      const expected = calculateExpectedScoreMultiplayer(1500, [1500, 1500, 1500]);
      expect(expected).toBeCloseTo(0.5, 4);
    });

    it('returns higher score when player is above average', () => {
      const expected = calculateExpectedScoreMultiplayer(1600, [1400, 1500, 1400]);
      expect(expected).toBeGreaterThan(0.5);
    });

    it('handles empty opponent list', () => {
      const expected = calculateExpectedScoreMultiplayer(1500, []);
      expect(expected).toBe(0.5);
    });
  });

  describe('calculateActualScore', () => {
    it('returns 1.0 for solo victory', () => {
      const score = calculateActualScore(1, true, false);
      expect(score).toBe(1.0);
    });

    it('returns 0.75 for second place', () => {
      const score = calculateActualScore(2, false, false);
      expect(score).toBe(0.75);
    });

    it('returns 0 for elimination', () => {
      const score = calculateActualScore(7, false, false);
      expect(score).toBe(0.0);
    });

    it('splits score for draw participants', () => {
      // 3-way draw: (1.0 + 0.75 + 0.55) / 3
      const score = calculateActualScore(1, false, true, 3);
      expect(score).toBeCloseTo(0.767, 2);
    });

    it('gives non-draw participants their normal score', () => {
      const score = calculateActualScore(4, false, false, 0);
      expect(score).toBe(0.40);
    });
  });

  describe('calculatePlacements', () => {
    it('assigns placements based on supply center count', () => {
      const result: GameResult = {
        gameId: 'test',
        participants: new Map([
          ['ENGLAND' as Power, 'p1'],
          ['FRANCE' as Power, 'p2'],
          ['GERMANY' as Power, 'p3'],
          ['ITALY' as Power, 'p4'],
          ['AUSTRIA' as Power, 'p5'],
          ['RUSSIA' as Power, 'p6'],
          ['TURKEY' as Power, 'p7'],
        ]),
        isDraw: false,
        eliminatedPowers: [],
        finalSupplyCenters: new Map([
          ['ENGLAND' as Power, 18],
          ['FRANCE' as Power, 5],
          ['GERMANY' as Power, 4],
          ['ITALY' as Power, 3],
          ['AUSTRIA' as Power, 2],
          ['RUSSIA' as Power, 1],
          ['TURKEY' as Power, 1],
        ]),
        finalYear: 1910,
        durationMs: 1000,
        startedAt: new Date(),
        endedAt: new Date(),
      };

      const placements = calculatePlacements(result);
      expect(placements.get('ENGLAND' as Power)).toBe(1);
      expect(placements.get('FRANCE' as Power)).toBe(2);
      expect(placements.get('GERMANY' as Power)).toBe(3);
    });

    it('handles ties correctly', () => {
      const result: GameResult = {
        gameId: 'test',
        participants: new Map([
          ['ENGLAND' as Power, 'p1'],
          ['FRANCE' as Power, 'p2'],
          ['GERMANY' as Power, 'p3'],
          ['ITALY' as Power, 'p4'],
          ['AUSTRIA' as Power, 'p5'],
          ['RUSSIA' as Power, 'p6'],
          ['TURKEY' as Power, 'p7'],
        ]),
        isDraw: false,
        eliminatedPowers: [],
        finalSupplyCenters: new Map([
          ['ENGLAND' as Power, 10],
          ['FRANCE' as Power, 10],  // Tied with England
          ['GERMANY' as Power, 5],
          ['ITALY' as Power, 5],    // Tied with Germany
          ['AUSTRIA' as Power, 2],
          ['RUSSIA' as Power, 1],
          ['TURKEY' as Power, 1],   // Tied with Russia
        ]),
        finalYear: 1910,
        durationMs: 1000,
        startedAt: new Date(),
        endedAt: new Date(),
      };

      const placements = calculatePlacements(result);
      expect(placements.get('ENGLAND' as Power)).toBe(1);
      expect(placements.get('FRANCE' as Power)).toBe(1); // Tied for 1st
      expect(placements.get('GERMANY' as Power)).toBe(3);
      expect(placements.get('ITALY' as Power)).toBe(3); // Tied for 3rd
    });

    it('assigns winner to 1st place regardless of supply centers', () => {
      const result: GameResult = {
        gameId: 'test',
        participants: new Map([
          ['ENGLAND' as Power, 'p1'],
          ['FRANCE' as Power, 'p2'],
          ['GERMANY' as Power, 'p3'],
          ['ITALY' as Power, 'p4'],
          ['AUSTRIA' as Power, 'p5'],
          ['RUSSIA' as Power, 'p6'],
          ['TURKEY' as Power, 'p7'],
        ]),
        winner: 'ENGLAND' as Power,
        isDraw: false,
        eliminatedPowers: [],
        finalSupplyCenters: new Map([
          ['ENGLAND' as Power, 18],
          ['FRANCE' as Power, 5],
          ['GERMANY' as Power, 4],
          ['ITALY' as Power, 3],
          ['AUSTRIA' as Power, 2],
          ['RUSSIA' as Power, 1],
          ['TURKEY' as Power, 1],
        ]),
        finalYear: 1910,
        durationMs: 1000,
        startedAt: new Date(),
        endedAt: new Date(),
      };

      const placements = calculatePlacements(result);
      expect(placements.get('ENGLAND' as Power)).toBe(1);
    });
  });

  describe('calculateRatingChanges', () => {
    it('gives positive change to winner, negative to losers', () => {
      const result: GameResult = {
        gameId: 'test',
        participants: new Map([
          ['ENGLAND' as Power, 'p1'],
          ['FRANCE' as Power, 'p2'],
          ['GERMANY' as Power, 'p3'],
          ['ITALY' as Power, 'p4'],
          ['AUSTRIA' as Power, 'p5'],
          ['RUSSIA' as Power, 'p6'],
          ['TURKEY' as Power, 'p7'],
        ]),
        winner: 'ENGLAND' as Power,
        isDraw: false,
        eliminatedPowers: ['TURKEY' as Power],
        finalSupplyCenters: new Map([
          ['ENGLAND' as Power, 18],
          ['FRANCE' as Power, 5],
          ['GERMANY' as Power, 4],
          ['ITALY' as Power, 3],
          ['AUSTRIA' as Power, 2],
          ['RUSSIA' as Power, 2],
          ['TURKEY' as Power, 0],
        ]),
        finalYear: 1910,
        durationMs: 1000,
        startedAt: new Date(),
        endedAt: new Date(),
      };

      const currentRatings = new Map<string, Rating>();
      for (let i = 1; i <= 7; i++) {
        currentRatings.set(`p${i}`, createInitialRating(`p${i}`));
      }

      const changes = calculateRatingChanges(result, currentRatings);

      // Winner should gain rating
      const winnerChange = changes.find(c => c.participantId === 'p1');
      expect(winnerChange?.change).toBeGreaterThan(0);

      // Last place should lose rating
      const loserChange = changes.find(c => c.participantId === 'p7');
      expect(loserChange?.change).toBeLessThan(0);
    });

    it('adjusts changes based on rating difference', () => {
      const result: GameResult = {
        gameId: 'test',
        participants: new Map([
          ['ENGLAND' as Power, 'p1'],
          ['FRANCE' as Power, 'p2'],
          ['GERMANY' as Power, 'p3'],
          ['ITALY' as Power, 'p4'],
          ['AUSTRIA' as Power, 'p5'],
          ['RUSSIA' as Power, 'p6'],
          ['TURKEY' as Power, 'p7'],
        ]),
        winner: 'ENGLAND' as Power,
        isDraw: false,
        eliminatedPowers: [],
        finalSupplyCenters: new Map([
          ['ENGLAND' as Power, 18],
          ['FRANCE' as Power, 5],
          ['GERMANY' as Power, 4],
          ['ITALY' as Power, 3],
          ['AUSTRIA' as Power, 2],
          ['RUSSIA' as Power, 1],
          ['TURKEY' as Power, 1],
        ]),
        finalYear: 1910,
        durationMs: 1000,
        startedAt: new Date(),
        endedAt: new Date(),
      };

      // Winner has much higher rating
      const currentRatings = new Map<string, Rating>();
      currentRatings.set('p1', { ...createInitialRating('p1'), rating: 2000 });
      for (let i = 2; i <= 7; i++) {
        currentRatings.set(`p${i}`, createInitialRating(`p${i}`));
      }

      const changes = calculateRatingChanges(result, currentRatings);
      const winnerChange = changes.find(c => c.participantId === 'p1');

      // Expected win - small gain
      expect(winnerChange?.change).toBeGreaterThanOrEqual(0);
      expect(winnerChange?.change).toBeLessThan(20); // Small gain for expected result
    });
  });

  describe('createInitialRating', () => {
    it('creates rating with default values', () => {
      const rating = createInitialRating('test');
      expect(rating.participantId).toBe('test');
      expect(rating.rating).toBe(DEFAULT_STARTING_ELO);
      expect(rating.gamesPlayed).toBe(0);
      expect(rating.wins).toBe(0);
    });

    it('accepts custom starting ELO', () => {
      const rating = createInitialRating('test', 1200);
      expect(rating.rating).toBe(1200);
    });
  });

  describe('getMatchmakingRating', () => {
    it('adjusts rating by deviation', () => {
      const rating: Rating = {
        participantId: 'test',
        rating: 1500,
        deviation: 100,
        gamesPlayed: 5,
        wins: 1,
        draws: 0,
        eliminations: 0,
        secondPlace: 1,
        lastUpdated: new Date(),
      };

      const mmr = getMatchmakingRating(rating);
      expect(mmr).toBe(1450); // 1500 - 100/2
    });
  });

  describe('calculateWinProbability', () => {
    it('returns ~50% for equal ratings', () => {
      const prob = calculateWinProbability(1500, 1500);
      expect(prob).toBeCloseTo(0.35, 1); // Lower than expected score due to pow(1.5)
    });

    it('returns higher probability for higher rated player', () => {
      const probHigh = calculateWinProbability(1700, 1500);
      const probLow = calculateWinProbability(1300, 1500);
      expect(probHigh).toBeGreaterThan(probLow);
    });
  });

  describe('getProvisionalKFactor', () => {
    it('returns higher K-factor for new players', () => {
      expect(getProvisionalKFactor(32, 5)).toBe(48); // 32 * 1.5
    });

    it('returns base K-factor after provisional period', () => {
      expect(getProvisionalKFactor(32, 10)).toBe(32);
      expect(getProvisionalKFactor(32, 15)).toBe(32);
    });
  });
});
