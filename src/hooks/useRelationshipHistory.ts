/**
 * useRelationshipHistory - Track and access relationship score history over time.
 *
 * Provides timeline data for visualizing how relationships between powers
 * evolved throughout the game. Tracks scores per turn and key events.
 */

import { useMemo } from 'react';
import type { Power } from '../engine/types';
import type { ActionEvent, PowerPairRelationship } from '../analysis/relationships';

/**
 * Key events that can occur in a relationship.
 */
export type KeyEvent = 'betrayal' | 'alliance' | 'war' | 'peace';

/**
 * A single point in the relationship timeline.
 */
export interface TimelinePoint {
  /** Turn identifier in 'S1901' or 'F1901' format */
  turn: string;
  /** Relationship score at this turn (-100 to +100) */
  score: number;
  /** Key event that occurred this turn (if any) */
  keyEvent?: KeyEvent;
  /** Description of what happened */
  description?: string;
}

/**
 * Complete history of a relationship between two powers.
 */
export interface RelationshipHistory {
  /** First power (alphabetically) */
  power1: Power;
  /** Second power */
  power2: Power;
  /** Timeline of relationship changes */
  timeline: TimelinePoint[];
  /** Current relationship status */
  currentStatus: 'ally' | 'enemy' | 'neutral';
  /** Current score */
  currentScore: number;
}

/**
 * Options for the useRelationshipHistory hook.
 */
export interface UseRelationshipHistoryOptions {
  /** All pairwise relationships from the engine */
  relationships: PowerPairRelationship[];
  /** Current game year */
  currentYear: number;
  /** Current game season */
  currentSeason: 'SPRING' | 'FALL';
}

/**
 * Format a turn as a string (e.g., 'S1901' or 'F1901').
 */
function formatTurn(year: number, season: 'SPRING' | 'FALL'): string {
  return `${season === 'SPRING' ? 'S' : 'F'}${year}`;
}

/**
 * Determine the key event type from an action event.
 */
function getKeyEventFromAction(actionType: string): KeyEvent | undefined {
  if (actionType.includes('STAB') || actionType.includes('BETRAYAL')) {
    return 'betrayal';
  }
  if (actionType === 'DIRECT_SUPPORT' || actionType === 'SUCCESSFUL_CONVOY') {
    return 'alliance';
  }
  if (actionType === 'ATTACK' || actionType === 'SUCCESSFUL_CAPTURE') {
    return 'war';
  }
  return undefined;
}

/**
 * Build timeline from action events.
 */
function buildTimeline(
  events: ActionEvent[],
  currentYear: number,
  currentSeason: 'SPRING' | 'FALL'
): TimelinePoint[] {
  // Group events by turn
  const eventsByTurn = new Map<string, ActionEvent[]>();

  for (const event of events) {
    const turnKey = formatTurn(event.year, event.season);
    const existing = eventsByTurn.get(turnKey) || [];
    eventsByTurn.set(turnKey, [...existing, event]);
  }

  // Build timeline with running score
  const timeline: TimelinePoint[] = [];
  let runningScore = 0;

  // Generate all turns from 1901 to current
  for (let year = 1901; year <= currentYear; year++) {
    for (const season of ['SPRING', 'FALL'] as const) {
      // Stop if we've reached current turn
      if (year === currentYear && season === 'FALL' && currentSeason === 'SPRING') {
        break;
      }

      const turnKey = formatTurn(year, season);
      const turnEvents = eventsByTurn.get(turnKey) || [];

      // Calculate score change from events
      let scoreChange = 0;
      let keyEvent: KeyEvent | undefined;
      let description: string | undefined;

      for (const event of turnEvents) {
        scoreChange += event.points;
        const eventType = getKeyEventFromAction(event.type);
        if (eventType) {
          // Prioritize betrayal events
          if (eventType === 'betrayal' || !keyEvent) {
            keyEvent = eventType;
            description = event.description;
          }
        }
      }

      runningScore = Math.max(-100, Math.min(100, runningScore + scoreChange));

      timeline.push({
        turn: turnKey,
        score: runningScore,
        keyEvent,
        description,
      });

      // Stop if we've reached current turn
      if (year === currentYear && season === currentSeason) {
        break;
      }
    }
  }

  return timeline;
}

/**
 * Hook to get relationship history data for visualization.
 *
 * @param options - Configuration options
 * @returns Map of power pair keys to their history
 */
export function useRelationshipHistory(
  options: UseRelationshipHistoryOptions
): Map<string, RelationshipHistory> {
  const { relationships, currentYear, currentSeason } = options;

  return useMemo(() => {
    const historyMap = new Map<string, RelationshipHistory>();

    for (const rel of relationships) {
      const key = getPairKey(rel.power1, rel.power2);
      const timeline = buildTimeline(
        rel.recentActions,
        currentYear,
        currentSeason as 'SPRING' | 'FALL'
      );

      historyMap.set(key, {
        power1: rel.power1,
        power2: rel.power2,
        timeline,
        currentStatus: rel.status,
        currentScore: rel.score,
      });
    }

    return historyMap;
  }, [relationships, currentYear, currentSeason]);
}

/**
 * Get a canonical key for a power pair (alphabetically sorted).
 */
export function getPairKey(p1: Power, p2: Power): string {
  return [p1, p2].sort().join('-');
}

/**
 * Get the history for a specific power pair.
 */
export function getHistoryForPair(
  historyMap: Map<string, RelationshipHistory>,
  p1: Power,
  p2: Power
): RelationshipHistory | undefined {
  const key = getPairKey(p1, p2);
  return historyMap.get(key);
}
