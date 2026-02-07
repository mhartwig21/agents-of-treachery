/**
 * Tests for TournamentManager.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TournamentManager } from '../tournament';
import type { GameResult } from '../types';
import type { Power } from '../../engine/types';
import { POWERS } from '../../engine/types';

describe('TournamentManager', () => {
  let manager: TournamentManager;

  beforeEach(() => {
    manager = new TournamentManager();
  });

  describe('createTournament', () => {
    it('creates a tournament with default config', () => {
      const tournament = manager.createTournament('Test Tournament');

      expect(tournament.name).toBe('Test Tournament');
      expect(tournament.status).toBe('REGISTRATION');
      expect(tournament.config.format).toBe('ROUND_ROBIN');
      expect(tournament.participants).toHaveLength(0);
    });

    it('creates a tournament with custom config', () => {
      const tournament = manager.createTournament('Swiss Tournament', {
        format: 'SWISS',
        eloKFactor: 24,
      });

      expect(tournament.config.format).toBe('SWISS');
      expect(tournament.config.eloKFactor).toBe(24);
    });

    it('creates a tournament with description', () => {
      const tournament = manager.createTournament(
        'Championship',
        {},
        'Annual championship tournament'
      );

      expect(tournament.description).toBe('Annual championship tournament');
    });
  });

  describe('registerParticipant', () => {
    it('registers a participant to a tournament', () => {
      const tournament = manager.createTournament('Test');
      const participant = manager.registerParticipant(tournament.id, {
        name: 'Claude',
        model: 'claude-3-opus',
      });

      expect(participant.name).toBe('Claude');
      expect(participant.id).toBeDefined();

      const updated = manager.getTournament(tournament.id);
      expect(updated?.participants).toContain(participant.id);
    });

    it('initializes rating for new participant', () => {
      const tournament = manager.createTournament('Test', { startingElo: 1200 });
      const participant = manager.registerParticipant(tournament.id, {
        name: 'Claude',
      });

      const rating = manager.getLeaderboard().getRating(participant.id);
      expect(rating?.rating).toBe(1200);
    });

    it('rejects registration when tournament is full', () => {
      const tournament = manager.createTournament('Test', { maxParticipants: 7 });

      // Register 7 participants
      for (let i = 0; i < 7; i++) {
        manager.registerParticipant(tournament.id, { name: `Player ${i}` });
      }

      // 8th should fail
      expect(() => {
        manager.registerParticipant(tournament.id, { name: 'Player 8' });
      }).toThrow('Tournament is full');
    });

    it('rejects registration when tournament not accepting', () => {
      const tournament = manager.createTournament('Test');

      // Register 7 participants and start
      for (let i = 0; i < 7; i++) {
        manager.registerParticipant(tournament.id, { name: `Player ${i}` });
      }
      manager.startTournament(tournament.id);

      // Registration should fail now
      expect(() => {
        manager.registerParticipant(tournament.id, { name: 'Late Player' });
      }).toThrow('not accepting registrations');
    });
  });

  describe('startTournament', () => {
    it('starts a tournament with enough participants', () => {
      const tournament = manager.createTournament('Test');

      for (let i = 0; i < 7; i++) {
        manager.registerParticipant(tournament.id, { name: `Player ${i}` });
      }

      const started = manager.startTournament(tournament.id);

      expect(started.status).toBe('IN_PROGRESS');
      expect(started.startedAt).toBeDefined();
      expect(started.matches.length).toBeGreaterThan(0);
    });

    it('rejects start without enough participants', () => {
      const tournament = manager.createTournament('Test');

      for (let i = 0; i < 5; i++) {
        manager.registerParticipant(tournament.id, { name: `Player ${i}` });
      }

      expect(() => {
        manager.startTournament(tournament.id);
      }).toThrow('at least 7 participants');
    });

    it('generates round-robin matches', () => {
      const tournament = manager.createTournament('Test', {
        format: 'ROUND_ROBIN',
      });

      for (let i = 0; i < 7; i++) {
        manager.registerParticipant(tournament.id, { name: `Player ${i}` });
      }

      const started = manager.startTournament(tournament.id);

      expect(started.matches.length).toBe(1); // 7 players = 1 game
      expect(started.matches[0].participants).toHaveLength(7);
    });

    it('generates free-for-all matches', () => {
      const tournament = manager.createTournament('Test', {
        format: 'FREE_FOR_ALL',
        gamesPerMatch: 3,
      });

      for (let i = 0; i < 7; i++) {
        manager.registerParticipant(tournament.id, { name: `Player ${i}` });
      }

      const started = manager.startTournament(tournament.id);

      expect(started.matches.length).toBe(3);
      expect(started.totalRounds).toBe(3);
    });
  });

  describe('getNextMatch', () => {
    it('returns the next pending match', () => {
      const tournament = manager.createTournament('Test');

      for (let i = 0; i < 7; i++) {
        manager.registerParticipant(tournament.id, { name: `Player ${i}` });
      }

      manager.startTournament(tournament.id);

      const nextMatch = manager.getNextMatch(tournament.id);
      expect(nextMatch).toBeDefined();
      expect(nextMatch?.status).toBe('PENDING');
    });

    it('returns null when all matches complete', () => {
      const tournament = manager.createTournament('Test', {
        format: 'FREE_FOR_ALL',
        gamesPerMatch: 1,
      });

      const participants: string[] = [];
      for (let i = 0; i < 7; i++) {
        const p = manager.registerParticipant(tournament.id, { name: `Player ${i}` });
        participants.push(p.id);
      }

      manager.startTournament(tournament.id);
      const match = manager.getNextMatch(tournament.id);
      if (match) {
        manager.startMatch(tournament.id, match.id);

        const gameResult = createMockGameResult(
          'game1',
          tournament.id,
          match.id,
          participants
        );
        manager.recordGameResult(tournament.id, match.id, gameResult);
      }

      const nextMatch = manager.getNextMatch(tournament.id);
      expect(nextMatch).toBeNull();
    });
  });

  describe('startMatch', () => {
    it('marks match as in progress', () => {
      const tournament = manager.createTournament('Test');

      for (let i = 0; i < 7; i++) {
        manager.registerParticipant(tournament.id, { name: `Player ${i}` });
      }

      manager.startTournament(tournament.id);
      const match = manager.getNextMatch(tournament.id)!;

      const started = manager.startMatch(tournament.id, match.id);

      expect(started.status).toBe('IN_PROGRESS');
      expect(started.startedAt).toBeDefined();
    });
  });

  describe('recordGameResult', () => {
    it('records game result and updates ratings', () => {
      const tournament = manager.createTournament('Test');

      const participants: string[] = [];
      for (let i = 0; i < 7; i++) {
        const p = manager.registerParticipant(tournament.id, { name: `Player ${i}` });
        participants.push(p.id);
      }

      manager.startTournament(tournament.id);
      const match = manager.getNextMatch(tournament.id)!;
      manager.startMatch(tournament.id, match.id);

      manager.getLeaderboard().getRating(participants[0])?.rating ?? 1500;

      const gameResult = createMockGameResult(
        'game1',
        tournament.id,
        match.id,
        participants
      );

      const changes = manager.recordGameResult(tournament.id, match.id, gameResult);

      expect(changes).toHaveLength(7);

      // Winner should have gained rating
      const winnerChange = changes.find(c => c.participantId === participants[0]);
      expect(winnerChange?.change).toBeGreaterThan(0);
    });

    it('completes tournament when all matches done', () => {
      const tournament = manager.createTournament('Test', {
        format: 'FREE_FOR_ALL',
        gamesPerMatch: 1,
      });

      const participants: string[] = [];
      for (let i = 0; i < 7; i++) {
        const p = manager.registerParticipant(tournament.id, { name: `Player ${i}` });
        participants.push(p.id);
      }

      manager.startTournament(tournament.id);
      const match = manager.getNextMatch(tournament.id)!;
      manager.startMatch(tournament.id, match.id);

      const gameResult = createMockGameResult(
        'game1',
        tournament.id,
        match.id,
        participants
      );

      manager.recordGameResult(tournament.id, match.id, gameResult);

      const completed = manager.getTournament(tournament.id);
      expect(completed?.status).toBe('COMPLETED');
      expect(completed?.completedAt).toBeDefined();
    });
  });

  describe('assignPowers', () => {
    it('assigns all 7 powers to participants', () => {
      const tournament = manager.createTournament('Test');

      const participants: string[] = [];
      for (let i = 0; i < 7; i++) {
        const p = manager.registerParticipant(tournament.id, { name: `Player ${i}` });
        participants.push(p.id);
      }

      manager.startTournament(tournament.id);

      const assignment = manager.assignPowers(
        manager.getTournament(tournament.id)!,
        participants
      );

      expect(assignment.size).toBe(7);
      for (const power of POWERS) {
        expect(assignment.has(power)).toBe(true);
      }

      // All participants should be assigned
      const assignedParticipants = new Set(assignment.values());
      expect(assignedParticipants.size).toBe(7);
    });

    it('throws error for wrong number of participants', () => {
      const tournament = manager.createTournament('Test');

      expect(() => {
        manager.assignPowers(tournament, ['p1', 'p2', 'p3']);
      }).toThrow('exactly 7 participants');
    });
  });

  describe('createLadderMatch', () => {
    it('creates match in ladder tournament', () => {
      const tournament = manager.createTournament('Ladder', {
        format: 'LADDER',
      });

      for (let i = 0; i < 7; i++) {
        manager.registerParticipant(tournament.id, { name: `Player ${i}` });
      }

      manager.startTournament(tournament.id);

      const match = manager.createLadderMatch(tournament.id);

      expect(match).toBeDefined();
      expect(match?.participants).toHaveLength(7);
    });

    it('returns null for non-ladder tournament', () => {
      const tournament = manager.createTournament('Test', {
        format: 'ROUND_ROBIN',
      });

      for (let i = 0; i < 7; i++) {
        manager.registerParticipant(tournament.id, { name: `Player ${i}` });
      }

      manager.startTournament(tournament.id);

      const match = manager.createLadderMatch(tournament.id);
      expect(match).toBeNull();
    });
  });

  describe('getAllTournaments', () => {
    it('returns all tournaments', () => {
      manager.createTournament('Tournament 1');
      manager.createTournament('Tournament 2');

      const tournaments = manager.getAllTournaments();
      expect(tournaments).toHaveLength(2);
    });
  });
});

// Helper to create mock game results
function createMockGameResult(
  gameId: string,
  tournamentId: string,
  matchId: string,
  participantIds: string[]
): GameResult {
  const participants = new Map<Power, string>();
  POWERS.forEach((power, index) => {
    participants.set(power, participantIds[index]);
  });

  const finalSupplyCenters = new Map<Power, number>();
  finalSupplyCenters.set('ENGLAND' as Power, 18);
  finalSupplyCenters.set('FRANCE' as Power, 5);
  finalSupplyCenters.set('GERMANY' as Power, 4);
  finalSupplyCenters.set('ITALY' as Power, 3);
  finalSupplyCenters.set('AUSTRIA' as Power, 2);
  finalSupplyCenters.set('RUSSIA' as Power, 1);
  finalSupplyCenters.set('TURKEY' as Power, 1);

  return {
    gameId,
    tournamentId,
    matchId,
    participants,
    winner: 'ENGLAND' as Power,
    isDraw: false,
    eliminatedPowers: [],
    finalSupplyCenters,
    finalYear: 1910,
    durationMs: 3600000,
    startedAt: new Date(Date.now() - 3600000),
    endedAt: new Date(),
  };
}
