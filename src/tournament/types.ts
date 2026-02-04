/**
 * Core types for tournament mode with ELO ratings.
 *
 * Supports automated multi-game competitions, tracking agent/model
 * performance with ELO ratings, leaderboards, win streaks, and
 * head-to-head records.
 */

import type { Power } from '../engine/types';

/**
 * Unique identifier for a participant (agent or model).
 */
export type ParticipantId = string;

/**
 * Unique identifier for a tournament.
 */
export type TournamentId = string;

/**
 * Unique identifier for a match within a tournament.
 */
export type MatchId = string;

/**
 * A participant in a tournament.
 * Can represent a specific model, model configuration, or human player.
 */
export interface Participant {
  id: ParticipantId;
  /** Display name for the participant */
  name: string;
  /** Model identifier (e.g., 'claude-3-opus', 'gpt-4o') */
  model?: string;
  /** Model provider (e.g., 'anthropic', 'openai', 'openrouter') */
  provider?: string;
  /** Additional metadata (temperature, personality, etc.) */
  metadata?: Record<string, unknown>;
  /** When this participant was registered */
  registeredAt: Date;
}

/**
 * ELO rating for a participant.
 */
export interface Rating {
  participantId: ParticipantId;
  /** Current ELO rating */
  rating: number;
  /** Rating deviation (confidence measure) */
  deviation: number;
  /** Number of games played */
  gamesPlayed: number;
  /** Number of solo victories */
  wins: number;
  /** Number of draws */
  draws: number;
  /** Number of eliminations (0 supply centers) */
  eliminations: number;
  /** Number of second-place finishes */
  secondPlace: number;
  /** Timestamp of last rating update */
  lastUpdated: Date;
}

/**
 * Result of a single game within a tournament.
 */
export interface GameResult {
  /** Unique identifier for this game */
  gameId: string;
  /** Tournament this game belongs to (if any) */
  tournamentId?: TournamentId;
  /** Match this game belongs to (if any) */
  matchId?: MatchId;
  /** Participants by power */
  participants: Map<Power, ParticipantId>;
  /** The winning power (solo victory) */
  winner?: Power;
  /** Whether the game ended in a draw */
  isDraw: boolean;
  /** Powers that participated in the draw (if applicable) */
  drawParticipants?: Power[];
  /** Powers that were eliminated (0 supply centers) */
  eliminatedPowers: Power[];
  /** Final supply center counts by power */
  finalSupplyCenters: Map<Power, number>;
  /** Final year when game ended */
  finalYear: number;
  /** Game duration in milliseconds */
  durationMs: number;
  /** When the game started */
  startedAt: Date;
  /** When the game ended */
  endedAt: Date;
}

/**
 * Rating change resulting from a game.
 */
export interface RatingChange {
  participantId: ParticipantId;
  power: Power;
  oldRating: number;
  newRating: number;
  change: number;
  /** Placement in the game (1-7, 1=winner, 7=first eliminated) */
  placement: number;
}

/**
 * A match in a tournament (may consist of multiple games).
 */
export interface Match {
  id: MatchId;
  tournamentId: TournamentId;
  /** Round number (0-indexed) */
  round: number;
  /** Position within the round (for bracket display) */
  position: number;
  /** Participating players */
  participants: ParticipantId[];
  /** Games played in this match */
  games: string[];
  /** Status of the match */
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  /** Winner(s) who advance (for elimination tournaments) */
  advancingParticipants?: ParticipantId[];
  /** Scheduled start time */
  scheduledAt?: Date;
  /** Actual start time */
  startedAt?: Date;
  /** Completion time */
  completedAt?: Date;
}

/**
 * Tournament format.
 */
export type TournamentFormat =
  | 'ROUND_ROBIN'       // Every participant plays against every other
  | 'SINGLE_ELIMINATION' // Knockout bracket
  | 'DOUBLE_ELIMINATION' // Knockout with losers bracket
  | 'SWISS'             // Swiss-system pairing
  | 'LADDER'            // Ongoing ranking-based matchmaking
  | 'FREE_FOR_ALL';     // All participants in each game

/**
 * Configuration for a tournament.
 */
export interface TournamentConfig {
  /** Tournament format */
  format: TournamentFormat;
  /** Number of games per match (for averaging results) */
  gamesPerMatch: number;
  /** Whether to use ELO-based seeding */
  eloSeeding: boolean;
  /** Minimum number of participants to start */
  minParticipants: number;
  /** Maximum number of participants */
  maxParticipants: number;
  /** K-factor for ELO calculations (higher = more volatile) */
  eloKFactor: number;
  /** Starting ELO for new participants */
  startingElo: number;
  /** Year limit for games (to prevent endless games) */
  yearLimit: number;
  /** Whether draws are allowed */
  allowDraws: boolean;
  /** Minimum draw year (earliest year a draw can be proposed) */
  minDrawYear: number;
}

/**
 * Default tournament configuration.
 */
export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  format: 'ROUND_ROBIN',
  gamesPerMatch: 1,
  eloSeeding: true,
  minParticipants: 7,
  maxParticipants: 21,
  eloKFactor: 32,
  startingElo: 1500,
  yearLimit: 1920,
  allowDraws: true,
  minDrawYear: 1908,
};

/**
 * Tournament status.
 */
export type TournamentStatus =
  | 'REGISTRATION'  // Accepting participants
  | 'SEEDING'       // Creating bracket/schedule
  | 'IN_PROGRESS'   // Games being played
  | 'COMPLETED'     // All games finished
  | 'CANCELLED';    // Tournament cancelled

/**
 * A tournament instance.
 */
export interface Tournament {
  id: TournamentId;
  /** Display name */
  name: string;
  /** Tournament description */
  description?: string;
  /** Tournament configuration */
  config: TournamentConfig;
  /** Current status */
  status: TournamentStatus;
  /** Registered participants */
  participants: ParticipantId[];
  /** Matches in the tournament */
  matches: Match[];
  /** Current round (0-indexed) */
  currentRound: number;
  /** Total number of rounds */
  totalRounds: number;
  /** Created timestamp */
  createdAt: Date;
  /** Started timestamp */
  startedAt?: Date;
  /** Completed timestamp */
  completedAt?: Date;
  /** Winner (for elimination tournaments) */
  winner?: ParticipantId;
  /** Final standings (participant IDs in order) */
  finalStandings?: ParticipantId[];
}

/**
 * Head-to-head record between two participants.
 */
export interface HeadToHead {
  participant1: ParticipantId;
  participant2: ParticipantId;
  /** Games where participant1 won */
  participant1Wins: number;
  /** Games where participant2 won */
  participant2Wins: number;
  /** Games ending in draw */
  draws: number;
  /** Total games played */
  totalGames: number;
  /** Average placement for participant1 */
  avgPlacement1: number;
  /** Average placement for participant2 */
  avgPlacement2: number;
  /** Last time they played */
  lastPlayed?: Date;
}

/**
 * Streak information for a participant.
 */
export interface Streak {
  participantId: ParticipantId;
  /** Current win streak (consecutive solo victories) */
  currentWinStreak: number;
  /** Current unbeaten streak (wins + draws) */
  currentUnbeatenStreak: number;
  /** Best win streak ever */
  bestWinStreak: number;
  /** Best unbeaten streak ever */
  bestUnbeatenStreak: number;
  /** Current games without elimination */
  currentSurvivalStreak: number;
  /** Best survival streak ever */
  bestSurvivalStreak: number;
}

/**
 * Leaderboard entry for display.
 */
export interface LeaderboardEntry {
  rank: number;
  participant: Participant;
  rating: Rating;
  streak: Streak;
  /** Win rate (solo victories / total games) */
  winRate: number;
  /** Survival rate (games not eliminated / total games) */
  survivalRate: number;
  /** Average placement (1-7) */
  avgPlacement: number;
  /** Rating change in last 24 hours */
  ratingChange24h: number;
  /** Rating change in last 7 days */
  ratingChange7d: number;
}

/**
 * Historical rating snapshot for tracking rating over time.
 */
export interface RatingSnapshot {
  participantId: ParticipantId;
  rating: number;
  timestamp: Date;
  gameId?: string;
}

/**
 * Tournament event types for event sourcing.
 */
export type TournamentEventType =
  | 'TOURNAMENT_CREATED'
  | 'PARTICIPANT_REGISTERED'
  | 'PARTICIPANT_WITHDRAWN'
  | 'TOURNAMENT_STARTED'
  | 'MATCH_STARTED'
  | 'GAME_COMPLETED'
  | 'MATCH_COMPLETED'
  | 'ROUND_COMPLETED'
  | 'TOURNAMENT_COMPLETED'
  | 'TOURNAMENT_CANCELLED'
  | 'RATING_UPDATED';

/**
 * Base tournament event.
 */
export interface TournamentEventBase {
  id: string;
  type: TournamentEventType;
  tournamentId: TournamentId;
  timestamp: Date;
}

/**
 * Event when a tournament is created.
 */
export interface TournamentCreatedEvent extends TournamentEventBase {
  type: 'TOURNAMENT_CREATED';
  payload: {
    name: string;
    config: TournamentConfig;
  };
}

/**
 * Event when a participant registers.
 */
export interface ParticipantRegisteredEvent extends TournamentEventBase {
  type: 'PARTICIPANT_REGISTERED';
  payload: {
    participant: Participant;
  };
}

/**
 * Event when a game completes.
 */
export interface GameCompletedTournamentEvent extends TournamentEventBase {
  type: 'GAME_COMPLETED';
  payload: {
    matchId: MatchId;
    gameResult: GameResult;
    ratingChanges: RatingChange[];
  };
}

/**
 * Event when ratings are updated.
 */
export interface RatingUpdatedEvent extends TournamentEventBase {
  type: 'RATING_UPDATED';
  payload: {
    changes: RatingChange[];
    gameId: string;
  };
}

/**
 * Union of all tournament events.
 */
export type TournamentEvent =
  | TournamentCreatedEvent
  | ParticipantRegisteredEvent
  | GameCompletedTournamentEvent
  | RatingUpdatedEvent;
