/**
 * Leaderboard and statistics tracking for tournament participants.
 *
 * Tracks:
 * - Overall rankings
 * - Win streaks and survival streaks
 * - Head-to-head records
 * - Rating history
 */

import type {
  ParticipantId,
  Participant,
  Rating,
  GameResult,
  HeadToHead,
  Streak,
  LeaderboardEntry,
  RatingSnapshot,
  RatingChange,
} from './types';
import { calculatePlacements } from './elo';

/**
 * Manages leaderboard data and statistics.
 */
export class Leaderboard {
  private participants: Map<ParticipantId, Participant> = new Map();
  private ratings: Map<ParticipantId, Rating> = new Map();
  private streaks: Map<ParticipantId, Streak> = new Map();
  private headToHead: Map<string, HeadToHead> = new Map();
  private ratingHistory: RatingSnapshot[] = [];
  private gameResults: GameResult[] = [];

  /**
   * Register a new participant.
   */
  registerParticipant(participant: Participant, initialRating: Rating): void {
    this.participants.set(participant.id, participant);
    this.ratings.set(participant.id, initialRating);
    this.streaks.set(participant.id, this.createInitialStreak(participant.id));
    this.recordRatingSnapshot(participant.id, initialRating.rating);
  }

  /**
   * Get a participant by ID.
   */
  getParticipant(id: ParticipantId): Participant | undefined {
    return this.participants.get(id);
  }

  /**
   * Get rating for a participant.
   */
  getRating(id: ParticipantId): Rating | undefined {
    return this.ratings.get(id);
  }

  /**
   * Get all ratings.
   */
  getAllRatings(): Map<ParticipantId, Rating> {
    return new Map(this.ratings);
  }

  /**
   * Update ratings after a game.
   */
  updateRatings(changes: RatingChange[], gameResult: GameResult): void {
    for (const change of changes) {
      const rating = this.ratings.get(change.participantId);
      if (rating) {
        rating.rating = change.newRating;
        rating.gamesPlayed++;
        rating.lastUpdated = new Date();

        // Update stats based on placement
        if (change.placement === 1 && !gameResult.isDraw) {
          rating.wins++;
        } else if (gameResult.isDraw && change.placement <= (gameResult.drawParticipants?.length ?? 0)) {
          rating.draws++;
        } else if (change.placement === 2) {
          rating.secondPlace++;
        }

        // Check elimination
        if (gameResult.eliminatedPowers.includes(change.power)) {
          rating.eliminations++;
        }

        // Reduce deviation
        rating.deviation = Math.max(50, rating.deviation * 0.95);

        // Record snapshot
        this.recordRatingSnapshot(change.participantId, change.newRating, gameResult.gameId);
      }
    }

    // Update streaks
    this.updateStreaks(gameResult);

    // Update head-to-head records
    this.updateHeadToHead(gameResult);

    // Store game result
    this.gameResults.push(gameResult);
  }

  /**
   * Get the full leaderboard sorted by rating.
   */
  getLeaderboard(): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (const [id, participant] of this.participants) {
      const rating = this.ratings.get(id);
      const streak = this.streaks.get(id);

      if (!rating || !streak) continue;

      // Calculate stats
      const winRate = rating.gamesPlayed > 0 ? rating.wins / rating.gamesPlayed : 0;
      const survivalRate = rating.gamesPlayed > 0
        ? (rating.gamesPlayed - rating.eliminations) / rating.gamesPlayed
        : 1;

      // Calculate average placement from game results
      const avgPlacement = this.calculateAveragePlacement(id);

      // Calculate rating changes
      const ratingChange24h = this.calculateRatingChange(id, oneDayAgo);
      const ratingChange7d = this.calculateRatingChange(id, oneWeekAgo);

      entries.push({
        rank: 0, // Will be set after sorting
        participant,
        rating,
        streak,
        winRate,
        survivalRate,
        avgPlacement,
        ratingChange24h,
        ratingChange7d,
      });
    }

    // Sort by rating (descending)
    entries.sort((a, b) => b.rating.rating - a.rating.rating);

    // Assign ranks
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    return entries;
  }

  /**
   * Get head-to-head record between two participants.
   */
  getHeadToHead(participant1: ParticipantId, participant2: ParticipantId): HeadToHead {
    const key = this.getHeadToHeadKey(participant1, participant2);
    let record = this.headToHead.get(key);

    if (!record) {
      record = this.createEmptyHeadToHead(participant1, participant2);
    }

    return record;
  }

  /**
   * Get all head-to-head records for a participant.
   */
  getParticipantHeadToHead(participantId: ParticipantId): HeadToHead[] {
    const records: HeadToHead[] = [];

    for (const record of this.headToHead.values()) {
      if (record.participant1 === participantId || record.participant2 === participantId) {
        records.push(record);
      }
    }

    return records;
  }

  /**
   * Get streak information for a participant.
   */
  getStreak(id: ParticipantId): Streak | undefined {
    return this.streaks.get(id);
  }

  /**
   * Get rating history for a participant.
   */
  getRatingHistory(
    participantId: ParticipantId,
    limit?: number
  ): RatingSnapshot[] {
    const history = this.ratingHistory.filter(s => s.participantId === participantId);
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get recent games for a participant.
   */
  getRecentGames(participantId: ParticipantId, limit: number = 10): GameResult[] {
    return this.gameResults
      .filter(game => {
        for (const [, id] of game.participants) {
          if (id === participantId) return true;
        }
        return false;
      })
      .slice(-limit);
  }

  /**
   * Get top performers in various categories.
   */
  getTopPerformers(category: 'wins' | 'winStreak' | 'rating' | 'survival', limit: number = 5): LeaderboardEntry[] {
    const leaderboard = this.getLeaderboard();

    switch (category) {
      case 'wins':
        return [...leaderboard].sort((a, b) => b.rating.wins - a.rating.wins).slice(0, limit);
      case 'winStreak':
        return [...leaderboard].sort((a, b) => b.streak.bestWinStreak - a.streak.bestWinStreak).slice(0, limit);
      case 'rating':
        return leaderboard.slice(0, limit);
      case 'survival':
        return [...leaderboard].sort((a, b) => b.survivalRate - a.survivalRate).slice(0, limit);
      default:
        return leaderboard.slice(0, limit);
    }
  }

  /**
   * Create a snapshot for persistence.
   */
  toSnapshot(): LeaderboardSnapshot {
    return {
      participants: Array.from(this.participants.values()),
      ratings: Array.from(this.ratings.values()),
      streaks: Array.from(this.streaks.values()),
      headToHead: Array.from(this.headToHead.values()),
      ratingHistory: this.ratingHistory,
      gameResults: this.gameResults,
      snapshotAt: new Date(),
    };
  }

  /**
   * Restore from a snapshot.
   */
  static fromSnapshot(snapshot: LeaderboardSnapshot): Leaderboard {
    const leaderboard = new Leaderboard();

    for (const participant of snapshot.participants) {
      leaderboard.participants.set(participant.id, participant);
    }

    for (const rating of snapshot.ratings) {
      leaderboard.ratings.set(rating.participantId, rating);
    }

    for (const streak of snapshot.streaks) {
      leaderboard.streaks.set(streak.participantId, streak);
    }

    for (const h2h of snapshot.headToHead) {
      const key = leaderboard.getHeadToHeadKey(h2h.participant1, h2h.participant2);
      leaderboard.headToHead.set(key, h2h);
    }

    leaderboard.ratingHistory = snapshot.ratingHistory;
    leaderboard.gameResults = snapshot.gameResults;

    return leaderboard;
  }

  // Private helper methods

  private createInitialStreak(participantId: ParticipantId): Streak {
    return {
      participantId,
      currentWinStreak: 0,
      currentUnbeatenStreak: 0,
      bestWinStreak: 0,
      bestUnbeatenStreak: 0,
      currentSurvivalStreak: 0,
      bestSurvivalStreak: 0,
    };
  }

  private updateStreaks(result: GameResult): void {
    // const placements = calculatePlacements(result); // TODO: use for placement-based streaks

    for (const [power, participantId] of result.participants) {
      const streak = this.streaks.get(participantId);
      if (!streak) continue;

      const isWinner = result.winner === power && !result.isDraw;
      const inDraw = result.isDraw && result.drawParticipants?.includes(power);
      const wasEliminated = result.eliminatedPowers.includes(power);

      // Update win streak
      if (isWinner) {
        streak.currentWinStreak++;
        streak.bestWinStreak = Math.max(streak.bestWinStreak, streak.currentWinStreak);
      } else {
        streak.currentWinStreak = 0;
      }

      // Update unbeaten streak (wins + draws)
      if (isWinner || inDraw) {
        streak.currentUnbeatenStreak++;
        streak.bestUnbeatenStreak = Math.max(streak.bestUnbeatenStreak, streak.currentUnbeatenStreak);
      } else {
        streak.currentUnbeatenStreak = 0;
      }

      // Update survival streak
      if (!wasEliminated) {
        streak.currentSurvivalStreak++;
        streak.bestSurvivalStreak = Math.max(streak.bestSurvivalStreak, streak.currentSurvivalStreak);
      } else {
        streak.currentSurvivalStreak = 0;
      }
    }
  }

  private updateHeadToHead(result: GameResult): void {
    const placements = calculatePlacements(result);
    const participants = Array.from(result.participants.entries());

    // Update head-to-head for each pair
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const [power1, id1] = participants[i];
        const [power2, id2] = participants[j];

        const key = this.getHeadToHeadKey(id1, id2);
        let record = this.headToHead.get(key);

        if (!record) {
          record = this.createEmptyHeadToHead(id1, id2);
        }

        const placement1 = placements.get(power1) ?? 7;
        const placement2 = placements.get(power2) ?? 7;

        // Determine winner between these two
        const isWinner1 = result.winner === power1 && !result.isDraw;
        const isWinner2 = result.winner === power2 && !result.isDraw;
        const bothInDraw = result.isDraw &&
          result.drawParticipants?.includes(power1) &&
          result.drawParticipants?.includes(power2);

        if (isWinner1) {
          if (record.participant1 === id1) {
            record.participant1Wins++;
          } else {
            record.participant2Wins++;
          }
        } else if (isWinner2) {
          if (record.participant1 === id2) {
            record.participant1Wins++;
          } else {
            record.participant2Wins++;
          }
        } else if (bothInDraw) {
          record.draws++;
        } else {
          // Neither won outright - compare placements
          if (placement1 < placement2) {
            if (record.participant1 === id1) {
              record.participant1Wins++;
            } else {
              record.participant2Wins++;
            }
          } else if (placement2 < placement1) {
            if (record.participant1 === id2) {
              record.participant1Wins++;
            } else {
              record.participant2Wins++;
            }
          } else {
            record.draws++;
          }
        }

        record.totalGames++;

        // Update average placements
        const n = record.totalGames;
        if (record.participant1 === id1) {
          record.avgPlacement1 = ((record.avgPlacement1 * (n - 1)) + placement1) / n;
          record.avgPlacement2 = ((record.avgPlacement2 * (n - 1)) + placement2) / n;
        } else {
          record.avgPlacement1 = ((record.avgPlacement1 * (n - 1)) + placement2) / n;
          record.avgPlacement2 = ((record.avgPlacement2 * (n - 1)) + placement1) / n;
        }

        record.lastPlayed = result.endedAt;

        this.headToHead.set(key, record);
      }
    }
  }

  private getHeadToHeadKey(id1: ParticipantId, id2: ParticipantId): string {
    // Ensure consistent ordering
    return id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`;
  }

  private createEmptyHeadToHead(id1: ParticipantId, id2: ParticipantId): HeadToHead {
    const [p1, p2] = id1 < id2 ? [id1, id2] : [id2, id1];
    return {
      participant1: p1,
      participant2: p2,
      participant1Wins: 0,
      participant2Wins: 0,
      draws: 0,
      totalGames: 0,
      avgPlacement1: 4, // Middle placement default
      avgPlacement2: 4,
    };
  }

  private recordRatingSnapshot(
    participantId: ParticipantId,
    rating: number,
    gameId?: string
  ): void {
    this.ratingHistory.push({
      participantId,
      rating,
      timestamp: new Date(),
      gameId,
    });
  }

  private calculateAveragePlacement(participantId: ParticipantId): number {
    let totalPlacement = 0;
    let gameCount = 0;

    for (const game of this.gameResults) {
      for (const [power, id] of game.participants) {
        if (id === participantId) {
          const placements = calculatePlacements(game);
          totalPlacement += placements.get(power) ?? 7;
          gameCount++;
          break;
        }
      }
    }

    return gameCount > 0 ? totalPlacement / gameCount : 4;
  }

  private calculateRatingChange(participantId: ParticipantId, since: Date): number {
    const history = this.getRatingHistory(participantId);
    const currentRating = this.ratings.get(participantId)?.rating ?? 0;

    // Find the rating closest to the 'since' date
    let oldestRating = currentRating;
    for (const snapshot of history) {
      if (snapshot.timestamp >= since) {
        break;
      }
      oldestRating = snapshot.rating;
    }

    return currentRating - oldestRating;
  }
}

/**
 * Snapshot of leaderboard state for persistence.
 */
export interface LeaderboardSnapshot {
  participants: Participant[];
  ratings: Rating[];
  streaks: Streak[];
  headToHead: HeadToHead[];
  ratingHistory: RatingSnapshot[];
  gameResults: GameResult[];
  snapshotAt: Date;
}
