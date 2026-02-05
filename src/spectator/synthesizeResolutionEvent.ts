/**
 * Synthesizes a MovementResolvedEvent from comparing consecutive game snapshots.
 *
 * Since the spectator view doesn't have direct access to game events, we can
 * reconstruct resolution data by comparing unit positions and orders between snapshots.
 */

import type { MovementResolvedEvent } from '../store/events';
import type { GameSnapshot } from './types';
import type { Power, Order } from '../engine/types';

/**
 * Attempts to synthesize a MovementResolvedEvent from the given snapshots.
 *
 * @param currentSnapshot - The snapshot after resolution (units in new positions)
 * @param previousSnapshot - The snapshot before resolution (units in original positions with orders)
 * @returns A synthesized event, or null if this isn't a resolution transition
 */
export function synthesizeResolutionEvent(
  currentSnapshot: GameSnapshot,
  previousSnapshot: GameSnapshot | null
): MovementResolvedEvent | null {
  // Can't synthesize without a previous snapshot
  if (!previousSnapshot) return null;

  // Only synthesize for phase transitions that indicate movement resolution
  // Movement happens in SPRING/FALL DIPLOMACY phases, resolution shows in next snapshot
  const isDiplomacyPhase = previousSnapshot.phase === 'DIPLOMACY';
  const prevOrders = previousSnapshot.orders;

  // If no orders in previous snapshot, nothing to resolve
  if (!isDiplomacyPhase || prevOrders.length === 0) return null;

  // Map units by territory for quick lookup
  const prevUnits = new Map(
    previousSnapshot.gameState.units.map((u) => [u.territory, u])
  );
  const currUnits = new Map(
    currentSnapshot.gameState.units.map((u) => [u.territory, u])
  );

  // Track unit moves by comparing positions
  const unitMoves: MovementResolvedEvent['payload']['unitMoves'] = [];
  const results: MovementResolvedEvent['payload']['results'] = [];
  const dislodged: MovementResolvedEvent['payload']['dislodged'] = [];

  // Process each order from the previous snapshot
  for (const uiOrder of prevOrders) {
    const prevUnit = prevUnits.get(uiOrder.unit);
    if (!prevUnit) continue;

    // Convert UI order to engine Order format
    const engineOrder = convertToEngineOrder(uiOrder, prevUnit.power.toUpperCase() as Power);
    if (!engineOrder) continue;

    if (uiOrder.type === 'move' && uiOrder.target) {
      // Check if the unit successfully moved to its target
      const currUnit = currUnits.get(uiOrder.target);
      const unitStillAtOrigin = currUnits.get(uiOrder.unit)?.power === prevUnit.power;

      if (currUnit && currUnit.power === prevUnit.power) {
        // Unit is at destination - move succeeded
        results.push({ order: engineOrder, success: true });
        unitMoves.push({
          power: prevUnit.power.toUpperCase() as Power,
          from: uiOrder.unit,
          to: uiOrder.target,
        });
      } else if (unitStillAtOrigin) {
        // Unit still at origin - move failed
        results.push({ order: engineOrder, success: false, reason: 'Bounced' });
      } else {
        // Unit disappeared - it was dislodged
        results.push({ order: engineOrder, success: false, reason: 'Dislodged' });
        dislodged.push({
          unit: {
            type: prevUnit.type === 'army' ? 'ARMY' : 'FLEET',
            power: prevUnit.power.toUpperCase() as Power,
            province: uiOrder.unit.toUpperCase(),
          },
          dislodgedFrom: uiOrder.unit.toUpperCase(),
          retreatOptions: [], // We don't have retreat options in snapshot data
        });
      }
    } else if (uiOrder.type === 'hold') {
      // Hold order - check if unit is still there
      const currUnit = currUnits.get(uiOrder.unit);
      if (currUnit && currUnit.power === prevUnit.power) {
        results.push({ order: engineOrder, success: true });
      } else {
        results.push({ order: engineOrder, success: false, reason: 'Dislodged' });
        dislodged.push({
          unit: {
            type: prevUnit.type === 'army' ? 'ARMY' : 'FLEET',
            power: prevUnit.power.toUpperCase() as Power,
            province: uiOrder.unit.toUpperCase(),
          },
          dislodgedFrom: uiOrder.unit.toUpperCase(),
          retreatOptions: [],
        });
      }
    } else if (uiOrder.type === 'support' || uiOrder.type === 'convoy') {
      // Support/convoy orders - check if unit is still there (not cut/dislodged)
      const currUnit = currUnits.get(uiOrder.unit);
      if (currUnit && currUnit.power === prevUnit.power) {
        results.push({ order: engineOrder, success: true });
      } else {
        results.push({ order: engineOrder, success: false, reason: 'Cut' });
      }
    }
  }

  // If no movement orders were found, don't create an event
  if (results.length === 0) return null;

  return {
    id: `synth_${currentSnapshot.id}`,
    timestamp: currentSnapshot.timestamp,
    gameId: 'spectator',
    type: 'MOVEMENT_RESOLVED',
    payload: {
      year: previousSnapshot.year,
      season: previousSnapshot.season,
      results,
      unitMoves,
      dislodged,
    },
  };
}

/**
 * Converts a UI order to engine Order format.
 */
function convertToEngineOrder(
  uiOrder: GameSnapshot['orders'][0],
  _power: Power
): Order | null {
  const unit = uiOrder.unit.toUpperCase();

  switch (uiOrder.type) {
    case 'hold':
      return { type: 'HOLD', unit };
    case 'move':
      if (!uiOrder.target) return null;
      return { type: 'MOVE', unit, destination: uiOrder.target.toUpperCase() };
    case 'support':
      if (!uiOrder.target) return null;
      return {
        type: 'SUPPORT',
        unit,
        supportedUnit: uiOrder.target.toUpperCase(),
        destination: uiOrder.supportTarget?.toUpperCase() ?? uiOrder.target.toUpperCase(),
      };
    case 'convoy':
      if (!uiOrder.target) return null;
      return {
        type: 'CONVOY',
        unit,
        convoyedUnit: uiOrder.target.toUpperCase(),
        destination: uiOrder.supportTarget?.toUpperCase() ?? '',
      };
    default:
      return null;
  }
}
