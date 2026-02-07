/**
 * useActionRelationships - Manage ActionRelationshipEngine lifecycle in React.
 *
 * Replays game events through the engine to produce current relationship
 * scores and betrayal data. Memoized to prevent unnecessary recalculations.
 */

import { useMemo } from 'react';
import {
  createRelationshipEngine,
} from '../analysis/relationships';
import type { PowerPairRelationship, BetrayalInfo } from '../analysis/relationships';
import type {
  GameEvent,
  OrdersSubmittedEvent,
  MovementResolvedEvent,
  SupplyCentersCapturedEvent,
} from '../store/events';
import type { Power, Order } from '../engine/types';

/**
 * Options for the useActionRelationships hook.
 */
export interface UseActionRelationshipsOptions {
  /** Game events from the store to replay through the engine. */
  events: GameEvent[];
  /** Current game year (events beyond this point are excluded in replay mode). */
  currentYear: number;
  /** Current game season (events beyond this point are excluded in replay mode). */
  currentSeason: 'SPRING' | 'FALL';
}

/**
 * Result returned by the useActionRelationships hook.
 */
export interface UseActionRelationshipsResult {
  /** All pairwise power relationships with scores and status. */
  relationships: PowerPairRelationship[];
  /** All detected betrayals with full evidence. */
  betrayals: BetrayalInfo[];
}

/**
 * Checks whether a turn (year/season) is after the cutoff point.
 */
function isTurnAfterCutoff(
  turnYear: number,
  turnSeason: string,
  cutoffYear: number,
  cutoffSeason: 'SPRING' | 'FALL'
): boolean {
  if (turnYear > cutoffYear) return true;
  if (turnYear < cutoffYear) return false;
  // Same year: FALL is after SPRING
  return turnSeason === 'FALL' && cutoffSeason === 'SPRING';
}

/**
 * Hook that manages the ActionRelationshipEngine lifecycle.
 *
 * Instantiates the engine and replays game events to produce relationship
 * scores and betrayal data. Recalculates only when events or the current
 * turn position changes.
 *
 * @param options - Game events and current turn position
 * @returns Current relationships and betrayals
 */
export function useActionRelationships(
  options: UseActionRelationshipsOptions
): UseActionRelationshipsResult {
  const { events, currentYear, currentSeason } = options;

  return useMemo(() => {
    const engine = createRelationshipEngine();

    const unitsByProvince = new Map<string, Power>();
    let pendingOrders: Order[] = [];
    let pendingMovement: MovementResolvedEvent | null = null;
    let pendingCaptures: SupplyCentersCapturedEvent | null = null;

    for (const event of events) {
      switch (event.type) {
        case 'GAME_CREATED': {
          for (const unit of event.payload.initialUnits) {
            unitsByProvince.set(unit.province, unit.power);
          }
          engine.updateUnitOwners(event.payload.initialUnits);
          break;
        }

        case 'ORDERS_SUBMITTED': {
          const { year, season } = event.payload;
          if (isTurnAfterCutoff(year, season, currentYear, currentSeason)) break;
          engine.processOrdersSubmitted(event as OrdersSubmittedEvent);
          pendingOrders.push(...event.payload.orders);
          break;
        }

        case 'MOVEMENT_RESOLVED': {
          const { year, season } = event.payload;
          if (isTurnAfterCutoff(year, season, currentYear, currentSeason)) break;
          pendingMovement = event as MovementResolvedEvent;
          break;
        }

        case 'SUPPLY_CENTERS_CAPTURED': {
          const { year, season } = event.payload;
          if (isTurnAfterCutoff(year, season, currentYear, currentSeason)) break;
          pendingCaptures = event as SupplyCentersCapturedEvent;
          break;
        }

        case 'PHASE_ADVANCED': {
          // Process accumulated turn data when phase advances
          if (pendingMovement) {
            engine.processTurn(
              pendingOrders,
              pendingMovement,
              pendingCaptures,
              unitsByProvince
            );

            // Update unit positions after movement
            for (const move of pendingMovement.payload.unitMoves) {
              unitsByProvince.delete(move.from);
              unitsByProvince.set(move.to, move.power);
            }

            // Remove dislodged units
            for (const dislodged of pendingMovement.payload.dislodged) {
              unitsByProvince.delete(dislodged.dislodgedFrom);
            }

            pendingOrders = [];
            pendingMovement = null;
            pendingCaptures = null;
          }
          break;
        }

        case 'RETREATS_RESOLVED': {
          // Update unit positions after retreats
          for (const retreat of event.payload.retreatResults) {
            if (retreat.destination && retreat.success) {
              unitsByProvince.set(retreat.destination, retreat.unit.power);
            }
          }
          break;
        }

        case 'BUILDS_RESOLVED': {
          // Track new units from builds
          for (const build of event.payload.unitsBuilt) {
            unitsByProvince.set(build.province, build.power);
          }
          // Remove disbanded units
          for (const disband of event.payload.unitsDisbanded) {
            unitsByProvince.delete(disband.province);
          }
          break;
        }
      }
    }

    // Process any remaining movement that hasn't been followed by PHASE_ADVANCED
    if (pendingMovement) {
      engine.processTurn(
        pendingOrders,
        pendingMovement,
        pendingCaptures,
        unitsByProvince
      );
    }

    return {
      relationships: engine.getAllRelationships(),
      betrayals: engine.getAllBetrayalDetails(),
    };
  }, [events, currentYear, currentSeason]);
}
