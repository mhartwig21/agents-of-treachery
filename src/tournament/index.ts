/**
 * Tournament mode with ELO ratings for Diplomacy.
 *
 * Features:
 * - Automated multi-game competitions
 * - ELO rating tracking with multiplayer adjustments
 * - Multiple tournament formats (round-robin, elimination, swiss, ladder)
 * - Leaderboards with win streaks and head-to-head records
 *
 * @module tournament
 */

// Core types
export type {
  // Identifiers
  ParticipantId,
  TournamentId,
  MatchId,

  // Entities
  Participant,
  Rating,
  GameResult,
  RatingChange,
  Match,
  Tournament,

  // Configuration
  TournamentFormat,
  TournamentConfig,
  TournamentStatus,

  // Statistics
  HeadToHead,
  Streak,
  LeaderboardEntry,
  RatingSnapshot,

  // Events
  TournamentEventType,
  TournamentEventBase,
  TournamentCreatedEvent,
  ParticipantRegisteredEvent,
  GameCompletedTournamentEvent,
  RatingUpdatedEvent,
  TournamentEvent,
} from './types';

export { DEFAULT_TOURNAMENT_CONFIG } from './types';

// ELO calculations
export {
  calculateExpectedScore,
  calculateExpectedScoreMultiplayer,
  calculateActualScore,
  calculatePlacements,
  calculateRatingChanges,
  applyRatingChanges,
  createInitialRating,
  getMatchmakingRating,
  calculateWinProbability,
  getProvisionalKFactor,
  DEFAULT_K_FACTOR,
  DEFAULT_STARTING_ELO,
  MIN_ELO,
} from './elo';

// Leaderboard
export { Leaderboard } from './leaderboard';
export type { LeaderboardSnapshot } from './leaderboard';

// Tournament management
export { TournamentManager } from './tournament';
