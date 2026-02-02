/**
 * Diplomacy order adjudicator.
 * Resolves conflicts according to standard Diplomacy rules.
 */

import {
  Unit,
  Order,
  HoldOrder,
  MoveOrder,
  SupportOrder,
  ConvoyOrder,
  OrderResolution,
  Power,
  Coast,
} from './types';
import { areAdjacent, canArmyOccupy, canFleetOccupy, getProvince, ADJACENCIES } from './map';

interface AdjudicationContext {
  units: Unit[];
  orders: Map<Power, Order[]>;
}

interface MoveStrength {
  order: MoveOrder;
  power: Power;
  strength: number;
  preventStrength: number;
  defendStrength: number;
}

/**
 * Validate that an order is legal.
 */
export function validateOrder(order: Order, unit: Unit, ctx: AdjudicationContext): string | null {
  switch (order.type) {
    case 'HOLD':
      return validateHold(order, unit);
    case 'MOVE':
      return validateMove(order, unit, ctx);
    case 'SUPPORT':
      return validateSupport(order, unit, ctx);
    case 'CONVOY':
      return validateConvoy(order, unit, ctx);
  }
}

function validateHold(_order: HoldOrder, _unit: Unit): string | null {
  return null; // Hold is always valid
}

function validateMove(order: MoveOrder, unit: Unit, ctx: AdjudicationContext): string | null {
  const dest = getProvince(order.destination);
  if (!dest) {
    return `Unknown destination: ${order.destination}`;
  }

  // Check unit type can occupy destination
  if (unit.type === 'ARMY' && !canArmyOccupy(order.destination)) {
    return 'Army cannot move to sea province';
  }
  if (unit.type === 'FLEET' && !canFleetOccupy(order.destination)) {
    return 'Fleet cannot move to land province';
  }

  // Check adjacency (or valid convoy path for army)
  if (order.viaConvoy && unit.type === 'ARMY') {
    if (!hasConvoyPath(unit.province, order.destination, ctx)) {
      return 'No valid convoy path exists';
    }
  } else {
    if (!areAdjacent(unit.province, order.destination, unit.coast, order.destinationCoast)) {
      return `${unit.province} is not adjacent to ${order.destination}`;
    }
  }

  // Check coast specification for multi-coast provinces
  if (dest.coasts && dest.coasts.length > 0 && unit.type === 'FLEET') {
    if (!order.destinationCoast) {
      return `Must specify coast for ${order.destination}`;
    }
    if (!dest.coasts.includes(order.destinationCoast)) {
      return `Invalid coast ${order.destinationCoast} for ${order.destination}`;
    }
  }

  return null;
}

function validateSupport(order: SupportOrder, unit: Unit, ctx: AdjudicationContext): string | null {
  // Find the unit being supported
  const supportedUnit = findUnit(order.supportedUnit, ctx);
  if (!supportedUnit) {
    return `No unit at ${order.supportedUnit} to support`;
  }

  if (order.destination) {
    // Support to move
    // Supporting unit must be able to move to the destination (ignoring occupancy)
    if (unit.type === 'ARMY' && !canArmyOccupy(order.destination)) {
      return 'Army cannot support move to sea province';
    }
    if (unit.type === 'FLEET' && !canFleetOccupy(order.destination)) {
      return 'Fleet cannot support move to land province';
    }
    if (!areAdjacent(unit.province, order.destination, unit.coast)) {
      return `Cannot support move to non-adjacent ${order.destination}`;
    }
  } else {
    // Support to hold
    if (!areAdjacent(unit.province, order.supportedUnit, unit.coast)) {
      return `Cannot support hold at non-adjacent ${order.supportedUnit}`;
    }
  }

  return null;
}

function validateConvoy(order: ConvoyOrder, unit: Unit, ctx: AdjudicationContext): string | null {
  if (unit.type !== 'FLEET') {
    return 'Only fleets can convoy';
  }

  const prov = getProvince(unit.province);
  if (prov?.type !== 'SEA') {
    return 'Fleet must be at sea to convoy';
  }

  const convoyedUnit = findUnit(order.convoyedUnit, ctx);
  if (!convoyedUnit) {
    return `No unit at ${order.convoyedUnit} to convoy`;
  }
  if (convoyedUnit.type !== 'ARMY') {
    return 'Only armies can be convoyed';
  }

  return null;
}

/**
 * Find a unit at a given province.
 */
function findUnit(province: string, ctx: AdjudicationContext): Unit | undefined {
  return ctx.units.find(u => u.province === province);
}

/**
 * Get the order for a unit at a province.
 */
function getOrderForUnit(province: string, ctx: AdjudicationContext): Order | undefined {
  for (const [, orders] of ctx.orders) {
    const order = orders.find(o => o.unit === province);
    if (order) return order;
  }
  return undefined;
}

/**
 * Check if a convoy path exists from source to destination.
 */
function hasConvoyPath(from: string, to: string, ctx: AdjudicationContext): boolean {
  // BFS to find path through convoying fleets
  const visited = new Set<string>();
  const queue: string[] = [];

  // Find all coastal provinces adjacent to 'from' that have convoying fleets in adjacent seas
  const fromAdj = ADJACENCIES[from] || [];
  for (const adj of fromAdj) {
    const adjProv = getProvince(adj);
    if (adjProv?.type === 'SEA') {
      const fleet = findUnit(adj, ctx);
      if (fleet && fleet.type === 'FLEET') {
        const fleetOrder = getOrderForUnit(adj, ctx);
        if (fleetOrder?.type === 'CONVOY') {
          const convoyOrder = fleetOrder as ConvoyOrder;
          if (convoyOrder.convoyedUnit === from && convoyOrder.destination === to) {
            queue.push(adj);
          }
        }
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const currentAdj = ADJACENCIES[current] || [];
    // Check if destination is adjacent to current sea province
    if (currentAdj.includes(to)) {
      return true;
    }

    // Add adjacent sea provinces with convoying fleets
    for (const adj of currentAdj) {
      const adjProv = getProvince(adj);
      if (adjProv?.type === 'SEA' && !visited.has(adj)) {
        const fleet = findUnit(adj, ctx);
        if (fleet && fleet.type === 'FLEET') {
          const fleetOrder = getOrderForUnit(adj, ctx);
          if (fleetOrder?.type === 'CONVOY') {
            const convoyOrder = fleetOrder as ConvoyOrder;
            if (convoyOrder.convoyedUnit === from && convoyOrder.destination === to) {
              queue.push(adj);
            }
          }
        }
      }
    }
  }

  return false;
}

/**
 * Main adjudication function.
 * Resolves all orders and returns the results.
 */
export function adjudicate(ctx: AdjudicationContext): Map<string, OrderResolution> {
  const results = new Map<string, OrderResolution>();

  // First, validate all orders and collect moves
  const moves: MoveStrength[] = [];
  const allOrders: Array<{ power: Power; order: Order }> = [];

  for (const [power, orders] of ctx.orders) {
    for (const order of orders) {
      allOrders.push({ power, order });
      const unit = findUnit(order.unit, ctx);
      if (!unit) {
        results.set(order.unit, {
          order,
          success: false,
          reason: `No unit at ${order.unit}`,
        });
        continue;
      }

      const validationError = validateOrder(order, unit, ctx);
      if (validationError) {
        results.set(order.unit, {
          order,
          success: false,
          reason: validationError,
        });
        continue;
      }

      if (order.type === 'MOVE') {
        moves.push({
          order,
          power,
          strength: 1,
          preventStrength: 1,
          defendStrength: 0,
        });
      }
    }
  }

  // Calculate support for each move
  for (const [, orders] of ctx.orders) {
    for (const order of orders) {
      if (order.type === 'SUPPORT' && order.destination) {
        const supportingUnit = findUnit(order.unit, ctx);
        if (!supportingUnit) continue;

        // Check if support is cut
        const isCut = isSupportCut(order, ctx, moves);
        if (isCut) continue;

        // Find the move being supported
        const supportedMove = moves.find(
          m => m.order.unit === order.supportedUnit && m.order.destination === order.destination
        );
        if (supportedMove) {
          supportedMove.strength++;
        }
      }
    }
  }

  // Calculate hold strength for defenders
  const holdStrengths = new Map<string, number>();
  for (const unit of ctx.units) {
    let strength = 1;
    const order = getOrderForUnit(unit.province, ctx);

    // Add support for holds
    for (const [, orders] of ctx.orders) {
      for (const supportOrder of orders) {
        if (supportOrder.type === 'SUPPORT' && !supportOrder.destination) {
          if (supportOrder.supportedUnit === unit.province) {
            const supportingUnit = findUnit(supportOrder.unit, ctx);
            if (supportingUnit && !isSupportCut(supportOrder as SupportOrder, ctx, moves)) {
              strength++;
            }
          }
        }
      }
    }

    holdStrengths.set(unit.province, strength);
  }

  // Resolve moves
  const successfulMoves = new Set<string>();
  const dislodgedUnits = new Map<string, string>(); // unit location -> dislodger location

  // Group moves by destination
  const movesByDest = new Map<string, MoveStrength[]>();
  for (const move of moves) {
    const dest = move.order.destination;
    if (!movesByDest.has(dest)) {
      movesByDest.set(dest, []);
    }
    movesByDest.get(dest)!.push(move);
  }

  // Resolve each destination
  for (const [dest, destMoves] of movesByDest) {
    if (destMoves.length === 1) {
      // Single move to this destination
      const move = destMoves[0];
      const defender = findUnit(dest, ctx);

      if (defender) {
        // Check if defender is moving away
        const defenderOrder = getOrderForUnit(dest, ctx);
        if (defenderOrder?.type === 'MOVE') {
          // Defender is moving - check for head-to-head battle
          const defMove = defenderOrder as MoveOrder;
          if (defMove.destination === move.order.unit) {
            // Head-to-head battle
            const defenderMoveStrength =
              moves.find(m => m.order.unit === dest)?.strength || 1;
            if (move.strength > defenderMoveStrength) {
              successfulMoves.add(move.order.unit);
              dislodgedUnits.set(dest, move.order.unit);
            } else if (defenderMoveStrength > move.strength) {
              successfulMoves.add(dest);
              dislodgedUnits.set(move.order.unit, dest);
            }
            // Equal strength: both bounce
          } else {
            // Defender moving elsewhere - succeed if stronger than hold strength
            const holdStr = holdStrengths.get(dest) || 1;
            if (move.strength > holdStr) {
              successfulMoves.add(move.order.unit);
              // Defender might be dislodged if their move fails
            }
          }
        } else {
          // Defender is holding - need to overcome hold strength
          const holdStr = holdStrengths.get(dest) || 1;
          if (move.strength > holdStr) {
            successfulMoves.add(move.order.unit);
            dislodgedUnits.set(dest, move.order.unit);
          }
        }
      } else {
        // Empty destination - move succeeds
        successfulMoves.add(move.order.unit);
      }
    } else {
      // Multiple moves to same destination - standoff
      // Find strongest
      let maxStrength = 0;
      let strongest: MoveStrength[] = [];
      for (const move of destMoves) {
        if (move.strength > maxStrength) {
          maxStrength = move.strength;
          strongest = [move];
        } else if (move.strength === maxStrength) {
          strongest.push(move);
        }
      }

      if (strongest.length === 1) {
        // Clear winner
        const winner = strongest[0];
        const defender = findUnit(dest, ctx);
        if (defender) {
          const holdStr = holdStrengths.get(dest) || 1;
          if (winner.strength > holdStr) {
            successfulMoves.add(winner.order.unit);
            const defenderOrder = getOrderForUnit(dest, ctx);
            if (defenderOrder?.type !== 'MOVE' || !successfulMoves.has(dest)) {
              dislodgedUnits.set(dest, winner.order.unit);
            }
          }
        } else {
          successfulMoves.add(winner.order.unit);
        }
      }
      // If tie, all bounce - no moves succeed
    }
  }

  // Build final results
  for (const { power, order } of allOrders) {
    if (results.has(order.unit)) continue; // Already failed validation

    const unit = findUnit(order.unit, ctx);
    if (!unit) continue;

    switch (order.type) {
      case 'HOLD':
        results.set(order.unit, {
          order,
          success: true,
          dislodged: dislodgedUnits.has(order.unit),
          dislodgedFrom: dislodgedUnits.get(order.unit),
        });
        break;

      case 'MOVE':
        const success = successfulMoves.has(order.unit);
        results.set(order.unit, {
          order,
          success,
          reason: success ? undefined : 'Move failed (bounce or overpowered)',
          dislodged: dislodgedUnits.has(order.unit),
          dislodgedFrom: dislodgedUnits.get(order.unit),
        });
        break;

      case 'SUPPORT':
        const isCut = isSupportCut(order, ctx, moves);
        results.set(order.unit, {
          order,
          success: !isCut,
          reason: isCut ? 'Support was cut' : undefined,
          dislodged: dislodgedUnits.has(order.unit),
          dislodgedFrom: dislodgedUnits.get(order.unit),
        });
        break;

      case 'CONVOY':
        // Convoy succeeds if not dislodged and the convoyed army's move succeeds
        const convoyedMoveSuccess = successfulMoves.has(order.convoyedUnit);
        results.set(order.unit, {
          order,
          success: convoyedMoveSuccess && !dislodgedUnits.has(order.unit),
          reason: dislodgedUnits.has(order.unit)
            ? 'Convoying fleet was dislodged'
            : !convoyedMoveSuccess
            ? 'Convoyed army did not move'
            : undefined,
          dislodged: dislodgedUnits.has(order.unit),
          dislodgedFrom: dislodgedUnits.get(order.unit),
        });
        break;
    }
  }

  return results;
}

/**
 * Check if a support order is cut by an attack on the supporting unit.
 */
function isSupportCut(
  support: SupportOrder,
  ctx: AdjudicationContext,
  moves: MoveStrength[]
): boolean {
  // Support is cut if an enemy unit is moving to the supporting unit's province
  // Exception: support is NOT cut by the unit being attacked
  for (const move of moves) {
    if (move.order.destination === support.unit) {
      // Someone is attacking the supporting unit
      // Support is cut UNLESS the attacker is the unit being supported to attack
      if (support.destination === move.order.unit) {
        // The attacker is the one we're supporting an attack against - no cut
        continue;
      }

      // Find the power of the moving unit
      const movingUnit = findUnit(move.order.unit, ctx);
      const supportingUnit = findUnit(support.unit, ctx);

      if (movingUnit && supportingUnit && movingUnit.power !== supportingUnit.power) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get valid retreat destinations for a dislodged unit.
 */
export function getRetreatOptions(
  unit: Unit,
  dislodgedFrom: string,
  ctx: AdjudicationContext,
  occupiedAfter: Set<string>,
  standoffProvinces: Set<string>
): string[] {
  const options: string[] = [];
  const adjacent = ADJACENCIES[unit.province] || [];

  for (const adj of adjacent) {
    // Can't retreat to the province the attack came from
    if (adj === dislodgedFrom) continue;

    // Can't retreat to occupied provinces
    if (occupiedAfter.has(adj)) continue;

    // Can't retreat to provinces where a standoff occurred
    if (standoffProvinces.has(adj)) continue;

    // Check unit type can enter
    if (unit.type === 'ARMY' && !canArmyOccupy(adj)) continue;
    if (unit.type === 'FLEET' && !canFleetOccupy(adj)) continue;

    options.push(adj);
  }

  return options;
}

/**
 * Calculate build/disband counts for each power.
 */
export function calculateBuildCounts(
  units: Unit[],
  supplyCenters: Map<string, Power>
): Map<Power, number> {
  const counts = new Map<Power, number>();

  // Count units per power
  const unitCounts = new Map<Power, number>();
  for (const unit of units) {
    unitCounts.set(unit.power, (unitCounts.get(unit.power) || 0) + 1);
  }

  // Count supply centers per power
  const scCounts = new Map<Power, number>();
  for (const [, power] of supplyCenters) {
    scCounts.set(power, (scCounts.get(power) || 0) + 1);
  }

  // Calculate difference
  const powers: Power[] = ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'];
  for (const power of powers) {
    const scCount = scCounts.get(power) || 0;
    const unitCount = unitCounts.get(power) || 0;
    counts.set(power, scCount - unitCount);
  }

  return counts;
}
