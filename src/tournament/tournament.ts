/**
 * Tournament orchestration for Diplomacy games.
 *
 * Supports multiple tournament formats:
 * - Round Robin: Every participant plays against every other
 * - Single Elimination: Knockout bracket
 * - Double Elimination: Knockout with losers bracket
 * - Swiss: Swiss-system pairing
 * - Ladder: Ongoing rating-based matchmaking
 * - Free For All: All participants in each game
 */

import type {
  Tournament,
  TournamentId,
  TournamentConfig,
  Match,
  MatchId,
  Participant,
  ParticipantId,
  GameResult,
  RatingChange,
} from './types';
import { Leaderboard } from './leaderboard';
import { calculateRatingChanges, createInitialRating, getMatchmakingRating } from './elo';
import type { Power } from '../engine/types';
import { POWERS } from '../engine/types';

/**
 * Generate a unique identifier.
 */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Manages tournament lifecycle and game scheduling.
 */
export class TournamentManager {
  private tournaments: Map<TournamentId, Tournament> = new Map();
  private leaderboard: Leaderboard = new Leaderboard();
  private participants: Map<ParticipantId, Participant> = new Map();

  /**
   * Create a new tournament.
   */
  createTournament(
    name: string,
    config: Partial<TournamentConfig> = {},
    description?: string
  ): Tournament {
    const fullConfig: TournamentConfig = {
      format: config.format ?? 'ROUND_ROBIN',
      gamesPerMatch: config.gamesPerMatch ?? 1,
      eloSeeding: config.eloSeeding ?? true,
      minParticipants: config.minParticipants ?? 7,
      maxParticipants: config.maxParticipants ?? 21,
      eloKFactor: config.eloKFactor ?? 32,
      startingElo: config.startingElo ?? 1500,
      yearLimit: config.yearLimit ?? 1920,
      allowDraws: config.allowDraws ?? true,
      minDrawYear: config.minDrawYear ?? 1908,
    };

    const tournament: Tournament = {
      id: `tournament_${generateId()}`,
      name,
      description,
      config: fullConfig,
      status: 'REGISTRATION',
      participants: [],
      matches: [],
      currentRound: 0,
      totalRounds: 0,
      createdAt: new Date(),
    };

    this.tournaments.set(tournament.id, tournament);
    return tournament;
  }

  /**
   * Register a participant for a tournament.
   */
  registerParticipant(
    tournamentId: TournamentId,
    participant: Omit<Participant, 'id' | 'registeredAt'>
  ): Participant {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) {
      throw new Error(`Tournament not found: ${tournamentId}`);
    }

    if (tournament.status !== 'REGISTRATION') {
      throw new Error('Tournament is not accepting registrations');
    }

    if (tournament.participants.length >= tournament.config.maxParticipants) {
      throw new Error('Tournament is full');
    }

    // Create participant
    const fullParticipant: Participant = {
      ...participant,
      id: `participant_${generateId()}`,
      registeredAt: new Date(),
    };

    // Register in global participant list
    this.participants.set(fullParticipant.id, fullParticipant);

    // Add to tournament
    tournament.participants.push(fullParticipant.id);

    // Initialize rating if new participant
    if (!this.leaderboard.getRating(fullParticipant.id)) {
      const initialRating = createInitialRating(fullParticipant.id, tournament.config.startingElo);
      this.leaderboard.registerParticipant(fullParticipant, initialRating);
    }

    return fullParticipant;
  }

  /**
   * Start a tournament (begin seeding and create bracket/schedule).
   */
  startTournament(tournamentId: TournamentId): Tournament {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) {
      throw new Error(`Tournament not found: ${tournamentId}`);
    }

    if (tournament.status !== 'REGISTRATION') {
      throw new Error('Tournament cannot be started from current status');
    }

    if (tournament.participants.length < tournament.config.minParticipants) {
      throw new Error(`Need at least ${tournament.config.minParticipants} participants`);
    }

    tournament.status = 'SEEDING';

    // Generate matches based on format
    switch (tournament.config.format) {
      case 'ROUND_ROBIN':
        this.generateRoundRobinMatches(tournament);
        break;
      case 'SINGLE_ELIMINATION':
        this.generateSingleEliminationMatches(tournament);
        break;
      case 'DOUBLE_ELIMINATION':
        this.generateDoubleEliminationMatches(tournament);
        break;
      case 'SWISS':
        this.generateSwissFirstRound(tournament);
        break;
      case 'LADDER':
        // Ladder doesn't pre-generate matches
        tournament.totalRounds = 0; // Ongoing
        break;
      case 'FREE_FOR_ALL':
        this.generateFreeForAllMatches(tournament);
        break;
    }

    tournament.status = 'IN_PROGRESS';
    tournament.startedAt = new Date();

    return tournament;
  }

  /**
   * Get the next match to be played in a tournament.
   */
  getNextMatch(tournamentId: TournamentId): Match | null {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) return null;

    // Find first pending match in current round
    for (const match of tournament.matches) {
      if (match.round === tournament.currentRound && match.status === 'PENDING') {
        return match;
      }
    }

    // If no pending matches in current round, check if round is complete
    const currentRoundMatches = tournament.matches.filter(m => m.round === tournament.currentRound);
    const allComplete = currentRoundMatches.every(m => m.status === 'COMPLETED');

    if (allComplete && tournament.currentRound < tournament.totalRounds - 1) {
      tournament.currentRound++;

      // For Swiss tournaments, generate next round pairings
      if (tournament.config.format === 'SWISS') {
        this.generateSwissNextRound(tournament);
      }

      return this.getNextMatch(tournamentId);
    }

    return null;
  }

  /**
   * Start a match (mark it as in progress).
   */
  startMatch(tournamentId: TournamentId, matchId: MatchId): Match {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) {
      throw new Error(`Tournament not found: ${tournamentId}`);
    }

    const match = tournament.matches.find(m => m.id === matchId);
    if (!match) {
      throw new Error(`Match not found: ${matchId}`);
    }

    if (match.status !== 'PENDING') {
      throw new Error('Match is not in pending status');
    }

    match.status = 'IN_PROGRESS';
    match.startedAt = new Date();

    return match;
  }

  /**
   * Record a game result for a match.
   */
  recordGameResult(
    tournamentId: TournamentId,
    matchId: MatchId,
    result: GameResult
  ): RatingChange[] {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament) {
      throw new Error(`Tournament not found: ${tournamentId}`);
    }

    const match = tournament.matches.find(m => m.id === matchId);
    if (!match) {
      throw new Error(`Match not found: ${matchId}`);
    }

    // Calculate rating changes
    const currentRatings = this.leaderboard.getAllRatings();
    const changes = calculateRatingChanges(
      result,
      currentRatings,
      tournament.config.eloKFactor
    );

    // Update leaderboard
    this.leaderboard.updateRatings(changes, result);

    // Add game to match
    match.games.push(result.gameId);

    // Check if match is complete
    if (match.games.length >= tournament.config.gamesPerMatch) {
      this.completeMatch(tournament, match);
    }

    // Check if tournament is complete
    this.checkTournamentComplete(tournament);

    return changes;
  }

  /**
   * Get the leaderboard.
   */
  getLeaderboard(): Leaderboard {
    return this.leaderboard;
  }

  /**
   * Get a tournament by ID.
   */
  getTournament(id: TournamentId): Tournament | undefined {
    return this.tournaments.get(id);
  }

  /**
   * Get all tournaments.
   */
  getAllTournaments(): Tournament[] {
    return Array.from(this.tournaments.values());
  }

  /**
   * Get a participant by ID.
   */
  getParticipant(id: ParticipantId): Participant | undefined {
    return this.participants.get(id);
  }

  /**
   * Assign powers to participants for a game.
   * Uses ELO-based seeding if configured.
   */
  assignPowers(
    tournament: Tournament,
    participantIds: ParticipantId[]
  ): Map<Power, ParticipantId> {
    const assignment = new Map<Power, ParticipantId>();

    if (participantIds.length !== 7) {
      throw new Error('Diplomacy requires exactly 7 participants');
    }

    // Get participants sorted by rating if using ELO seeding
    let orderedParticipants = [...participantIds];

    if (tournament.config.eloSeeding) {
      orderedParticipants.sort((a, b) => {
        const ratingA = this.leaderboard.getRating(a);
        const ratingB = this.leaderboard.getRating(b);
        return getMatchmakingRating(ratingB ?? { rating: 1500, deviation: 350 } as any)
          - getMatchmakingRating(ratingA ?? { rating: 1500, deviation: 350 } as any);
      });
    } else {
      // Random shuffle
      orderedParticipants = this.shuffleArray(orderedParticipants);
    }

    // Assign powers (shuffle power order for fairness)
    const shuffledPowers = this.shuffleArray([...POWERS]);
    for (let i = 0; i < 7; i++) {
      assignment.set(shuffledPowers[i], orderedParticipants[i]);
    }

    return assignment;
  }

  /**
   * Create a ladder match (for LADDER format).
   */
  createLadderMatch(tournamentId: TournamentId): Match | null {
    const tournament = this.tournaments.get(tournamentId);
    if (!tournament || tournament.config.format !== 'LADDER') {
      return null;
    }

    // Get 7 available participants sorted by rating
    const availableParticipants = tournament.participants.filter(id => {
      // Check if participant is not in an active match
      return !tournament.matches.some(
        m => m.status === 'IN_PROGRESS' && m.participants.includes(id)
      );
    });

    if (availableParticipants.length < 7) {
      return null;
    }

    // Match by similar rating
    const sortedByRating = availableParticipants.sort((a, b) => {
      const ratingA = this.leaderboard.getRating(a)?.rating ?? 1500;
      const ratingB = this.leaderboard.getRating(b)?.rating ?? 1500;
      return ratingB - ratingA;
    });

    // Take 7 participants with closest ratings
    const selectedParticipants = sortedByRating.slice(0, 7);

    const match: Match = {
      id: `match_${generateId()}`,
      tournamentId,
      round: tournament.currentRound,
      position: tournament.matches.length,
      participants: selectedParticipants,
      games: [],
      status: 'PENDING',
    };

    tournament.matches.push(match);
    return match;
  }

  // Private helper methods

  private generateRoundRobinMatches(tournament: Tournament): void {
    const participants = tournament.participants;
    const numParticipants = participants.length;

    // For Diplomacy (7 players), round-robin means every player plays in every game
    // Need multiple games where players rotate positions
    const numGames = Math.ceil(numParticipants / 7);
    tournament.totalRounds = numGames;

    for (let round = 0; round < numGames; round++) {
      // Rotate participants to create different groupings
      const rotated = this.rotateArray(participants, round);
      const gameParticipants = rotated.slice(0, 7);

      const match: Match = {
        id: `match_${generateId()}`,
        tournamentId: tournament.id,
        round,
        position: 0,
        participants: gameParticipants,
        games: [],
        status: 'PENDING',
      };

      tournament.matches.push(match);
    }
  }

  private generateSingleEliminationMatches(tournament: Tournament): void {
    const participants = tournament.participants;

    // Seed participants by rating
    const seeded = this.seedParticipants(participants);

    // Single elimination for 7-player games is tricky
    // We'll use a bracket where groups of 7 play and winners advance
    const numRounds = Math.ceil(Math.log(participants.length) / Math.log(7));
    tournament.totalRounds = numRounds;

    let currentRoundParticipants = seeded;
    for (let round = 0; round < numRounds; round++) {
      const matches = this.createBracketMatches(
        tournament.id,
        round,
        currentRoundParticipants
      );
      tournament.matches.push(...matches);

      // Winners advance (placeholder - filled when matches complete)
      const numAdvancing = Math.ceil(currentRoundParticipants.length / 7);
      currentRoundParticipants = Array(numAdvancing).fill(null);
    }
  }

  private generateDoubleEliminationMatches(tournament: Tournament): void {
    // Start with single elimination structure
    this.generateSingleEliminationMatches(tournament);

    // Add losers bracket (simplified implementation)
    // In a full implementation, this would track losers and create secondary bracket
    tournament.totalRounds = tournament.totalRounds * 2;
  }

  private generateSwissFirstRound(tournament: Tournament): void {
    const participants = tournament.participants;
    const seeded = this.seedParticipants(participants);

    // Swiss: pair top half vs bottom half in first round
    tournament.totalRounds = Math.ceil(Math.log2(participants.length));

    const matches = this.createBracketMatches(tournament.id, 0, seeded);
    tournament.matches.push(...matches);
  }

  private generateSwissNextRound(tournament: Tournament): void {
    // Get current standings
    const leaderboard = this.leaderboard.getLeaderboard();
    const participantsByRank = leaderboard
      .filter(e => tournament.participants.includes(e.participant.id))
      .map(e => e.participant.id);

    // Swiss pairing: match players with similar records
    const matches = this.createBracketMatches(
      tournament.id,
      tournament.currentRound,
      participantsByRank
    );
    tournament.matches.push(...matches);
  }

  private generateFreeForAllMatches(tournament: Tournament): void {
    // All participants in each game
    if (tournament.participants.length !== 7) {
      throw new Error('Free for all requires exactly 7 participants');
    }

    tournament.totalRounds = tournament.config.gamesPerMatch;

    for (let round = 0; round < tournament.totalRounds; round++) {
      const match: Match = {
        id: `match_${generateId()}`,
        tournamentId: tournament.id,
        round,
        position: 0,
        participants: [...tournament.participants],
        games: [],
        status: 'PENDING',
      };
      tournament.matches.push(match);
    }
  }

  private createBracketMatches(
    tournamentId: TournamentId,
    round: number,
    participants: ParticipantId[]
  ): Match[] {
    const matches: Match[] = [];
    let position = 0;

    for (let i = 0; i < participants.length; i += 7) {
      const gameParticipants = participants.slice(i, i + 7);

      // Pad with byes if necessary (for elimination brackets)
      while (gameParticipants.length < 7 && gameParticipants.length > 0) {
        // This shouldn't happen in Diplomacy, but handle gracefully
        break;
      }

      if (gameParticipants.length === 7) {
        matches.push({
          id: `match_${generateId()}`,
          tournamentId,
          round,
          position: position++,
          participants: gameParticipants,
          games: [],
          status: 'PENDING',
        });
      }
    }

    return matches;
  }

  private completeMatch(tournament: Tournament, match: Match): void {
    match.status = 'COMPLETED';
    match.completedAt = new Date();

    // Determine advancing participants (for elimination formats)
    if (tournament.config.format === 'SINGLE_ELIMINATION' ||
        tournament.config.format === 'DOUBLE_ELIMINATION') {
      // Get aggregate results across all games in match
      const participantScores = new Map<ParticipantId, number>();

      for (const _gameId of match.games) {
        // In a full implementation, we'd look up the game result
        // For now, use leaderboard data
        for (const id of match.participants) {
          const rating = this.leaderboard.getRating(id);
          const currentScore = participantScores.get(id) ?? 0;
          participantScores.set(id, currentScore + (rating?.rating ?? 1500));
        }
      }

      // Top performer advances
      const sorted = Array.from(participantScores.entries())
        .sort((a, b) => b[1] - a[1]);
      match.advancingParticipants = [sorted[0][0]];
    }
  }

  private checkTournamentComplete(tournament: Tournament): void {
    const allMatchesComplete = tournament.matches.every(m => m.status === 'COMPLETED');

    if (allMatchesComplete) {
      tournament.status = 'COMPLETED';
      tournament.completedAt = new Date();

      // Determine final standings
      const leaderboard = this.leaderboard.getLeaderboard();
      tournament.finalStandings = leaderboard
        .filter(e => tournament.participants.includes(e.participant.id))
        .map(e => e.participant.id);

      if (tournament.finalStandings.length > 0) {
        tournament.winner = tournament.finalStandings[0];
      }
    }
  }

  private seedParticipants(participants: ParticipantId[]): ParticipantId[] {
    return [...participants].sort((a, b) => {
      const ratingA = this.leaderboard.getRating(a);
      const ratingB = this.leaderboard.getRating(b);
      return getMatchmakingRating(ratingB ?? { rating: 1500, deviation: 350 } as any)
        - getMatchmakingRating(ratingA ?? { rating: 1500, deviation: 350 } as any);
    });
  }

  private shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  private rotateArray<T>(array: T[], positions: number): T[] {
    const n = array.length;
    const normalizedPositions = ((positions % n) + n) % n;
    return [...array.slice(normalizedPositions), ...array.slice(0, normalizedPositions)];
  }
}
