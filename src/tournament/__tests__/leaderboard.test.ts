/**
 * Tests for Leaderboard functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Leaderboard } from '../leaderboard';
import { createInitialRating, calculateRatingChanges } from '../elo';
import type { Participant, GameResult, RatingChange } from '../types';
import type { Power } from '../../engine/types';

describe('Leaderboard', () => {
  let leaderboard: Leaderboard;

  beforeEach(() => {
    leaderboard = new Leaderboard();
  });

  describe('registerParticipant', () => {
    it('registers a new participant', () => {
      const participant: Participant = {
        id: 'p1',
        name: 'Test Player',
        model: 'claude-3-opus',
        registeredAt: new Date(),
      };
      const rating = createInitialRating('p1');

      leaderboard.registerParticipant(participant, rating);

      expect(leaderboard.getParticipant('p1')).toEqual(participant);
      expect(leaderboard.getRating('p1')).toEqual(rating);
    });

    it('initializes streak for new participant', () => {
      const participant: Participant = {
        id: 'p1',
        name: 'Test Player',
        registeredAt: new Date(),
      };
      const rating = createInitialRating('p1');

      leaderboard.registerParticipant(participant, rating);

      const streak = leaderboard.getStreak('p1');
      expect(streak).toBeDefined();
      expect(streak?.currentWinStreak).toBe(0);
      expect(streak?.bestWinStreak).toBe(0);
    });
  });

  describe('updateRatings', () => {
    it('updates ratings after a game', () => {
      // Register participants
      for (let i = 1; i <= 7; i++) {
        leaderboard.registerParticipant(
          { id: `p${i}`, name: `Player ${i}`, registeredAt: new Date() },
          createInitialRating(`p${i}`)
        );
      }

      const gameResult: GameResult = {
        gameId: 'game1',
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
        durationMs: 3600000,
        startedAt: new Date(),
        endedAt: new Date(),
      };

      const changes = calculateRatingChanges(gameResult, leaderboard.getAllRatings());
      leaderboard.updateRatings(changes, gameResult);

      // Winner should have higher rating
      const winnerRating = leaderboard.getRating('p1');
      expect(winnerRating?.rating).toBeGreaterThan(1500);
      expect(winnerRating?.wins).toBe(1);
      expect(winnerRating?.gamesPlayed).toBe(1);

      // Eliminated player should have elimination recorded
      const eliminatedRating = leaderboard.getRating('p7');
      expect(eliminatedRating?.eliminations).toBe(1);
    });

    it('tracks win streaks', () => {
      // Register participants
      for (let i = 1; i <= 7; i++) {
        leaderboard.registerParticipant(
          { id: `p${i}`, name: `Player ${i}`, registeredAt: new Date() },
          createInitialRating(`p${i}`)
        );
      }

      // Player 1 wins two games
      for (let game = 1; game <= 2; game++) {
        const gameResult: GameResult = {
          gameId: `game${game}`,
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
          durationMs: 3600000,
          startedAt: new Date(),
          endedAt: new Date(),
        };

        const changes = calculateRatingChanges(gameResult, leaderboard.getAllRatings());
        leaderboard.updateRatings(changes, gameResult);
      }

      const streak = leaderboard.getStreak('p1');
      expect(streak?.currentWinStreak).toBe(2);
      expect(streak?.bestWinStreak).toBe(2);
    });

    it('resets win streak on loss', () => {
      // Register participants
      for (let i = 1; i <= 7; i++) {
        leaderboard.registerParticipant(
          { id: `p${i}`, name: `Player ${i}`, registeredAt: new Date() },
          createInitialRating(`p${i}`)
        );
      }

      // Player 1 wins first game
      const game1: GameResult = {
        gameId: 'game1',
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
        durationMs: 3600000,
        startedAt: new Date(),
        endedAt: new Date(),
      };

      let changes = calculateRatingChanges(game1, leaderboard.getAllRatings());
      leaderboard.updateRatings(changes, game1);

      // Player 2 wins second game
      const game2: GameResult = {
        ...game1,
        gameId: 'game2',
        winner: 'FRANCE' as Power,
      };

      changes = calculateRatingChanges(game2, leaderboard.getAllRatings());
      leaderboard.updateRatings(changes, game2);

      const streak = leaderboard.getStreak('p1');
      expect(streak?.currentWinStreak).toBe(0);
      expect(streak?.bestWinStreak).toBe(1);
    });
  });

  describe('getLeaderboard', () => {
    it('returns sorted leaderboard entries', () => {
      // Register participants with different ratings
      for (let i = 1; i <= 3; i++) {
        const rating = createInitialRating(`p${i}`);
        rating.rating = 1600 - i * 100; // p1: 1500, p2: 1400, p3: 1300
        leaderboard.registerParticipant(
          { id: `p${i}`, name: `Player ${i}`, registeredAt: new Date() },
          rating
        );
      }

      const entries = leaderboard.getLeaderboard();

      expect(entries).toHaveLength(3);
      expect(entries[0].rank).toBe(1);
      expect(entries[0].participant.id).toBe('p1');
      expect(entries[1].rank).toBe(2);
      expect(entries[1].participant.id).toBe('p2');
      expect(entries[2].rank).toBe(3);
      expect(entries[2].participant.id).toBe('p3');
    });

    it('calculates win rate correctly', () => {
      const rating = createInitialRating('p1');
      rating.gamesPlayed = 10;
      rating.wins = 3;

      leaderboard.registerParticipant(
        { id: 'p1', name: 'Player 1', registeredAt: new Date() },
        rating
      );

      const entries = leaderboard.getLeaderboard();
      expect(entries[0].winRate).toBeCloseTo(0.3, 2);
    });
  });

  describe('getHeadToHead', () => {
    it('returns empty record for new matchup', () => {
      const h2h = leaderboard.getHeadToHead('p1', 'p2');

      expect(h2h.totalGames).toBe(0);
      expect(h2h.participant1Wins).toBe(0);
      expect(h2h.participant2Wins).toBe(0);
    });

    it('tracks head-to-head results', () => {
      // Register participants
      for (let i = 1; i <= 7; i++) {
        leaderboard.registerParticipant(
          { id: `p${i}`, name: `Player ${i}`, registeredAt: new Date() },
          createInitialRating(`p${i}`)
        );
      }

      // p1 beats p2 (p1 wins, p2 second place)
      const gameResult: GameResult = {
        gameId: 'game1',
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
        durationMs: 3600000,
        startedAt: new Date(),
        endedAt: new Date(),
      };

      const changes = calculateRatingChanges(gameResult, leaderboard.getAllRatings());
      leaderboard.updateRatings(changes, gameResult);

      const h2h = leaderboard.getHeadToHead('p1', 'p2');
      expect(h2h.totalGames).toBe(1);

      // p1 should have a "win" over p2 (better placement)
      if (h2h.participant1 === 'p1') {
        expect(h2h.participant1Wins).toBe(1);
      } else {
        expect(h2h.participant2Wins).toBe(1);
      }
    });
  });

  describe('getRatingHistory', () => {
    it('records rating snapshots', () => {
      const rating = createInitialRating('p1');
      leaderboard.registerParticipant(
        { id: 'p1', name: 'Player 1', registeredAt: new Date() },
        rating
      );

      const history = leaderboard.getRatingHistory('p1');
      expect(history).toHaveLength(1);
      expect(history[0].rating).toBe(1500);
    });
  });

  describe('toSnapshot / fromSnapshot', () => {
    it('serializes and deserializes leaderboard state', () => {
      // Set up some state
      for (let i = 1; i <= 3; i++) {
        leaderboard.registerParticipant(
          { id: `p${i}`, name: `Player ${i}`, registeredAt: new Date() },
          createInitialRating(`p${i}`)
        );
      }

      // Create snapshot
      const snapshot = leaderboard.toSnapshot();

      // Restore from snapshot
      const restored = Leaderboard.fromSnapshot(snapshot);

      // Verify state
      expect(restored.getParticipant('p1')).toBeDefined();
      expect(restored.getRating('p1')?.rating).toBe(1500);
      expect(restored.getStreak('p1')).toBeDefined();
    });
  });

  describe('getRecentGames', () => {
    it('returns games for a participant', () => {
      // Register participants
      for (let i = 1; i <= 7; i++) {
        leaderboard.registerParticipant(
          { id: `p${i}`, name: `Player ${i}`, registeredAt: new Date() },
          createInitialRating(`p${i}`)
        );
      }

      const gameResult: GameResult = {
        gameId: 'game1',
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
        durationMs: 3600000,
        startedAt: new Date(),
        endedAt: new Date(),
      };

      const changes = calculateRatingChanges(gameResult, leaderboard.getAllRatings());
      leaderboard.updateRatings(changes, gameResult);

      const recentGames = leaderboard.getRecentGames('p1');
      expect(recentGames).toHaveLength(1);
      expect(recentGames[0].gameId).toBe('game1');

      // p8 wasn't in the game
      const noGames = leaderboard.getRecentGames('p8');
      expect(noGames).toHaveLength(0);
    });
  });
});
