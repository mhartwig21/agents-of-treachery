/**
 * useActionRelationships - Snapshot-based relationship analysis for SpectatorGameView.
 *
 * Replays consecutive game snapshots through the ActionRelationshipEngine
 * to produce current relationship scores and betrayal data.
 * Uses synthesizeRelationshipEvents to bridge the snapshot-based spectator
 * view to the event-driven engine interface.
 */

import { useMemo } from 'react';
import { createRelationshipEngine } from '../analysis/relationships';
import type { PowerPairRelationship, BetrayalInfo } from '../analysis/relationships';
import type { GameSnapshot } from '../spectator/types';
import { synthesizeRelationshipEvents } from '../spectator/synthesizeRelationshipEvents';

export interface UseActionRelationshipsOptions {
  /** Game snapshots from the spectator in chronological order. */
  snapshots: GameSnapshot[];
  /** Current game year (snapshots beyond this are excluded). */
  currentYear: number;
  /** Current game season (snapshots beyond this are excluded). */
  currentSeason: 'SPRING' | 'FALL';
}

export interface UseActionRelationshipsResult {
  /** All pairwise power relationships with scores and status. */
  relationships: PowerPairRelationship[];
  /** All detected betrayals with full evidence. */
  betrayals: BetrayalInfo[];
}

/**
 * Checks whether a snapshot is after the cutoff turn.
 */
function isSnapshotAfterCutoff(
  snapshot: GameSnapshot,
  cutoffYear: number,
  cutoffSeason: 'SPRING' | 'FALL'
): boolean {
  if (snapshot.year > cutoffYear) return true;
  if (snapshot.year < cutoffYear) return false;
  return snapshot.season === 'FALL' && cutoffSeason === 'SPRING';
}

/**
 * Hook that manages the ActionRelationshipEngine lifecycle using snapshots.
 *
 * Instantiates the engine and replays consecutive snapshot pairs through
 * synthesizeRelationshipEvents to produce relationship scores and betrayal data.
 * Recalculates only when snapshots or current turn position changes.
 */
export function useActionRelationships(
  options: UseActionRelationshipsOptions
): UseActionRelationshipsResult {
  const { snapshots, currentYear, currentSeason } = options;

  return useMemo(() => {
    if (snapshots.length === 0) {
      return { relationships: [], betrayals: [] };
    }

    const engine = createRelationshipEngine();

    // Initialize unit owners from the first snapshot
    const firstSnapshot = snapshots[0];
    engine.updateUnitOwners(
      firstSnapshot.gameState.units.map(u => ({
        type: u.type.toUpperCase() as 'ARMY' | 'FLEET',
        power: u.power.toUpperCase() as import('../engine/types').Power,
        province: u.territory.toUpperCase(),
      }))
    );

    // Replay consecutive snapshot pairs through the engine
    for (let i = 1; i < snapshots.length; i++) {
      const current = snapshots[i];

      // Stop processing at the cutoff turn
      if (isSnapshotAfterCutoff(current, currentYear, currentSeason)) {
        break;
      }

      const prev = snapshots[i - 1];
      const synthesized = synthesizeRelationshipEvents(prev, current);

      if (synthesized) {
        engine.processTurn(
          synthesized.orders,
          synthesized.movementEvent,
          synthesized.captureEvent,
          synthesized.unitsByProvince
        );
      }
    }

    return {
      relationships: engine.getAllRelationships(),
      betrayals: engine.getAllBetrayalDetails(),
    };
  }, [snapshots, currentYear, currentSeason]);
}
