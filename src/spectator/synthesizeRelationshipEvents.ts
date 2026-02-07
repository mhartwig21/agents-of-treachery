/**
 * Synthesizes the events needed by ActionRelationshipEngine from consecutive
 * game snapshots. Bridges the spectator's snapshot-based view to the
 * event-driven interface that processTurn() expects.
 */

import type { MovementResolvedEvent, SupplyCentersCapturedEvent } from '../store/events';
import type { GameSnapshot } from './types';
import type { Power, Order } from '../engine/types';
import { synthesizeResolutionEvent } from './synthesizeResolutionEvent';

export interface SynthesizedRelationshipEvents {
  orders: Order[];
  movementEvent: MovementResolvedEvent;
  captureEvent: SupplyCentersCapturedEvent | null;
  unitsByProvince: Map<string, Power>;
}

/**
 * Synthesizes relationship engine inputs from consecutive game snapshots.
 *
 * Returns null if the snapshots don't represent a movement resolution
 * (e.g. missing previous snapshot, no orders, non-diplomacy phase).
 */
export function synthesizeRelationshipEvents(
  prevSnapshot: GameSnapshot | null,
  currentSnapshot: GameSnapshot
): SynthesizedRelationshipEvents | null {
  // Synthesize the movement resolution event (reuses existing logic)
  const movementEvent = synthesizeResolutionEvent(currentSnapshot, prevSnapshot);
  if (!movementEvent) return null;

  // Convert UI orders to engine Order format
  const orders = convertUIOrders(prevSnapshot!);

  // Detect supply center ownership changes
  const captureEvent = synthesizeCaptureEvent(prevSnapshot!, currentSnapshot);

  // Build unit-to-province ownership map from current snapshot
  const unitsByProvince = buildUnitsByProvince(currentSnapshot);

  return { orders, movementEvent, captureEvent, unitsByProvince };
}

/**
 * Converts all UI orders from a snapshot to engine Order format.
 */
function convertUIOrders(snapshot: GameSnapshot): Order[] {
  const orders: Order[] = [];
  for (const uiOrder of snapshot.orders) {
    const engineOrder = convertToEngineOrder(uiOrder);
    if (engineOrder) {
      orders.push(engineOrder);
    }
  }
  return orders;
}

/**
 * Converts a single UI order to engine Order format.
 * Province IDs are uppercased to match engine conventions.
 */
function convertToEngineOrder(uiOrder: GameSnapshot['orders'][0]): Order | null {
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

/**
 * Compares supply center ownership between snapshots to synthesize a
 * SupplyCentersCapturedEvent. Returns null if no ownership changed.
 */
function synthesizeCaptureEvent(
  prevSnapshot: GameSnapshot,
  currentSnapshot: GameSnapshot
): SupplyCentersCapturedEvent | null {
  const prevSC = prevSnapshot.gameState.supplyCenters;
  const currSC = currentSnapshot.gameState.supplyCenters;

  const changes: SupplyCentersCapturedEvent['payload']['changes'] = [];

  // Check all territories in current snapshot for ownership changes
  for (const [territory, currentOwner] of Object.entries(currSC)) {
    if (!currentOwner) continue;
    const previousOwner = prevSC[territory] ?? null;
    if (previousOwner !== currentOwner) {
      changes.push({
        territory: territory.toUpperCase(),
        from: previousOwner ? (previousOwner.toUpperCase() as Power) : null,
        to: currentOwner.toUpperCase() as Power,
      });
    }
  }

  if (changes.length === 0) return null;

  return {
    id: `synth_capture_${currentSnapshot.id}`,
    timestamp: currentSnapshot.timestamp,
    gameId: 'spectator',
    type: 'SUPPLY_CENTERS_CAPTURED',
    payload: {
      year: prevSnapshot.year,
      season: prevSnapshot.season,
      changes,
    },
  };
}

/**
 * Builds a Map<province, Power> from the current snapshot's units.
 * Province keys are uppercased to match engine conventions.
 */
function buildUnitsByProvince(snapshot: GameSnapshot): Map<string, Power> {
  const map = new Map<string, Power>();
  for (const unit of snapshot.gameState.units) {
    map.set(unit.territory.toUpperCase(), unit.power.toUpperCase() as Power);
  }
  return map;
}
