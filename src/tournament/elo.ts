/**
 * ELO rating calculations for Diplomacy tournaments.
 *
 * Diplomacy is a 7-player game, so we use a multiplayer ELO variant
 * that considers relative placements rather than just win/loss.
 */

import type {
  ParticipantId,
  Rating,
  GameResult,
  RatingChange,
  TournamentConfig,
} from './types';
import type { Power } from '../engine/types';
import { POWERS } from '../engine/types';

/**
 * Default K-factor for ELO calculations.
 * Higher values mean ratings change more per game.
 */
export const DEFAULT_K_FACTOR = 32;

/**
 * Default starting ELO rating.
 */
export const DEFAULT_STARTING_ELO = 1500;

/**
 * Minimum possible ELO rating.
 */
export const MIN_ELO = 100;

/**
 * Calculate expected score for a participant against an opponent.
 * Uses the standard ELO expected score formula.
 *
 * @param playerRating - The player's current rating
 * @param opponentRating - The opponent's current rating
 * @returns Expected score (0-1)
 */
export function calculateExpectedScore(
  playerRating: number,
  opponentRating: number
): number {
  const exponent = (opponentRating - playerRating) / 400;
  return 1 / (1 + Math.pow(10, exponent));
}

/**
 * Calculate expected score for a participant against multiple opponents.
 * Averages expected scores against all opponents.
 *
 * @param playerRating - The player's current rating
 * @param opponentRatings - Array of opponent ratings
 * @returns Expected score (0-1)
 */
export function calculateExpectedScoreMultiplayer(
  playerRating: number,
  opponentRatings: number[]
): number {
  if (opponentRatings.length === 0) return 0.5;

  const totalExpected = opponentRatings.reduce((sum, oppRating) => {
    return sum + calculateExpectedScore(playerRating, oppRating);
  }, 0);

  return totalExpected / opponentRatings.length;
}

/**
 * Calculate actual score based on game placement.
 * Maps 1st through 7th place to scores between 1 and 0.
 *
 * Scoring system:
 * - Solo victory (1st): 1.0
 * - 2nd place: 0.75
 * - 3rd place: 0.55
 * - 4th place: 0.40
 * - 5th place: 0.25
 * - 6th place: 0.10
 * - 7th place (first eliminated): 0.0
 *
 * For draws, participants split the pool of points for their positions.
 *
 * @param placement - Player's placement (1-7)
 * @param isWinner - Whether player achieved solo victory
 * @param isDraw - Whether game ended in a draw
 * @param drawParticipantCount - Number of participants in the draw
 * @returns Actual score (0-1)
 */
export function calculateActualScore(
  placement: number,
  isWinner: boolean,
  isDraw: boolean,
  drawParticipantCount: number = 0
): number {
  // Solo victory
  if (isWinner && !isDraw) {
    return 1.0;
  }

  // Draw - split points among draw participants
  if (isDraw && placement <= drawParticipantCount) {
    // Average the scores that would be assigned to positions 1 through drawParticipantCount
    const placementScores = [1.0, 0.75, 0.55, 0.40, 0.25, 0.10, 0.0];
    let totalScore = 0;
    for (let i = 0; i < drawParticipantCount && i < placementScores.length; i++) {
      totalScore += placementScores[i];
    }
    return totalScore / drawParticipantCount;
  }

  // Non-winner placements
  const placementScores: Record<number, number> = {
    1: 1.0,    // Solo victory
    2: 0.75,   // Second place
    3: 0.55,   // Third place
    4: 0.40,   // Fourth place
    5: 0.25,   // Fifth place
    6: 0.10,   // Sixth place
    7: 0.0,    // Eliminated first
  };

  return placementScores[placement] ?? 0;
}

/**
 * Calculate placements from a game result.
 * Orders players by supply center count, handling ties.
 *
 * @param result - The game result
 * @returns Map of power to placement (1-7)
 */
export function calculatePlacements(result: GameResult): Map<Power, number> {
  const placements = new Map<Power, number>();

  // Get all powers with their supply center counts
  const powerCounts: Array<{ power: Power; count: number }> = [];
  for (const power of POWERS) {
    const count = result.finalSupplyCenters.get(power) ?? 0;
    powerCounts.push({ power, count });
  }

  // Sort by supply center count (descending)
  powerCounts.sort((a, b) => b.count - a.count);

  // Assign placements, handling ties
  let currentPlacement = 1;
  let i = 0;
  while (i < powerCounts.length) {
    const currentCount = powerCounts[i].count;
    const tiedPowers: Power[] = [];

    // Find all powers with the same count
    while (i < powerCounts.length && powerCounts[i].count === currentCount) {
      tiedPowers.push(powerCounts[i].power);
      i++;
    }

    // Assign the same placement to tied powers
    for (const power of tiedPowers) {
      placements.set(power, currentPlacement);
    }

    // Next placement skips tied positions
    currentPlacement += tiedPowers.length;
  }

  // Winner always gets 1st place
  if (result.winner) {
    placements.set(result.winner, 1);
  }

  return placements;
}

/**
 * Calculate rating changes for all participants in a game.
 *
 * @param result - The game result
 * @param currentRatings - Map of participant ID to current rating
 * @param kFactor - K-factor for ELO calculation
 * @returns Array of rating changes
 */
export function calculateRatingChanges(
  result: GameResult,
  currentRatings: Map<ParticipantId, Rating>,
  kFactor: number = DEFAULT_K_FACTOR
): RatingChange[] {
  const changes: RatingChange[] = [];
  const placements = calculatePlacements(result);
  const drawParticipantCount = result.isDraw ? (result.drawParticipants?.length ?? 0) : 0;

  // Collect all participant ratings
  const participantRatings: Map<ParticipantId, number> = new Map();
  for (const [_power, participantId] of result.participants) {
    const rating = currentRatings.get(participantId);
    participantRatings.set(participantId, rating?.rating ?? DEFAULT_STARTING_ELO);
  }

  // Calculate changes for each participant
  for (const [power, participantId] of result.participants) {
    const playerRating = participantRatings.get(participantId) ?? DEFAULT_STARTING_ELO;
    const placement = placements.get(power) ?? 7;

    // Get opponent ratings
    const opponentRatings: number[] = [];
    for (const [otherPower, otherId] of result.participants) {
      if (otherPower !== power) {
        opponentRatings.push(participantRatings.get(otherId) ?? DEFAULT_STARTING_ELO);
      }
    }

    // Calculate expected and actual scores
    const expectedScore = calculateExpectedScoreMultiplayer(playerRating, opponentRatings);
    const isWinner = result.winner === power;

    // Check if this power was in the draw
    const inDraw = result.isDraw && result.drawParticipants?.includes(power);
    const actualScore = calculateActualScore(
      placement,
      isWinner,
      inDraw ?? false,
      drawParticipantCount
    );

    // Calculate rating change
    // Multiply by number of opponents to normalize for multiplayer
    const ratingDelta = Math.round(kFactor * (actualScore - expectedScore) * (opponentRatings.length / 6));
    const newRating = Math.max(MIN_ELO, playerRating + ratingDelta);

    changes.push({
      participantId,
      power,
      oldRating: playerRating,
      newRating,
      change: newRating - playerRating,
      placement,
    });
  }

  return changes;
}

/**
 * Apply rating changes to ratings map.
 *
 * @param ratings - Current ratings map (will be mutated)
 * @param changes - Rating changes to apply
 * @param gameResult - The game result for updating stats
 */
export function applyRatingChanges(
  ratings: Map<ParticipantId, Rating>,
  changes: RatingChange[],
  gameResult: GameResult
): void {
  for (const change of changes) {
    let rating = ratings.get(change.participantId);

    if (!rating) {
      // Create new rating if doesn't exist
      rating = {
        participantId: change.participantId,
        rating: change.newRating,
        deviation: 350, // High initial deviation
        gamesPlayed: 0,
        wins: 0,
        draws: 0,
        eliminations: 0,
        secondPlace: 0,
        lastUpdated: new Date(),
      };
    }

    // Update rating
    rating.rating = change.newRating;
    rating.gamesPlayed++;
    rating.lastUpdated = new Date();

    // Update win/loss/draw counts
    if (change.placement === 1 && !gameResult.isDraw) {
      rating.wins++;
    } else if (gameResult.isDraw && change.placement <= (gameResult.drawParticipants?.length ?? 0)) {
      rating.draws++;
    } else if (change.placement === 2) {
      rating.secondPlace++;
    }

    // Check if eliminated
    const power = change.power;
    if (gameResult.eliminatedPowers.includes(power)) {
      rating.eliminations++;
    }

    // Reduce deviation as more games are played
    rating.deviation = Math.max(50, rating.deviation * 0.95);

    ratings.set(change.participantId, rating);
  }
}

/**
 * Create a new rating for a participant.
 *
 * @param participantId - The participant's ID
 * @param startingElo - Starting ELO rating
 * @returns New rating object
 */
export function createInitialRating(
  participantId: ParticipantId,
  startingElo: number = DEFAULT_STARTING_ELO
): Rating {
  return {
    participantId,
    rating: startingElo,
    deviation: 350,
    gamesPlayed: 0,
    wins: 0,
    draws: 0,
    eliminations: 0,
    secondPlace: 0,
    lastUpdated: new Date(),
  };
}

/**
 * Get rating for sorting/matching purposes.
 * Uses rating adjusted by deviation for more accurate matching.
 *
 * @param rating - The rating object
 * @returns Adjusted rating for matching
 */
export function getMatchmakingRating(rating: Rating): number {
  // Conservative estimate: rating minus half deviation
  // This helps avoid mismatches with uncertain ratings
  return rating.rating - rating.deviation / 2;
}

/**
 * Calculate win probability based on ELO ratings.
 *
 * @param playerRating - Player's rating
 * @param averageOpponentRating - Average opponent rating
 * @returns Probability of winning (0-1)
 */
export function calculateWinProbability(
  playerRating: number,
  averageOpponentRating: number
): number {
  // In Diplomacy, "winning" probability is complex
  // This gives a rough estimate based on ELO difference
  const expectedScore = calculateExpectedScore(playerRating, averageOpponentRating);
  // Convert expected score to win probability (scoring 0.7+ typically means winning)
  return Math.pow(expectedScore, 1.5);
}

/**
 * Calculate provisional rating after N games.
 * Provisional players have higher K-factor.
 *
 * @param baseKFactor - Base K-factor
 * @param gamesPlayed - Number of games played
 * @returns Adjusted K-factor
 */
export function getProvisionalKFactor(
  baseKFactor: number,
  gamesPlayed: number
): number {
  // Provisional period: first 10 games
  if (gamesPlayed < 10) {
    return baseKFactor * 1.5;
  }
  return baseKFactor;
}
