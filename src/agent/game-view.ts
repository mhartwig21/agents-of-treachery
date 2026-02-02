/**
 * Game state presentation for agents.
 *
 * Transforms the internal game state into a clear, structured format
 * that AI agents can easily understand and reason about.
 */

import type { Power, GameState, Unit, OrderResolution } from '../engine/types';
import { POWERS } from '../engine/types';
import { getHomeCenters, getProvince, PROVINCES } from '../engine/map';
import { getSupplyCenterCounts, getUnitCounts } from '../engine/game';
import type { AgentGameView, UnitView } from './types';

/**
 * Create an agent's view of the game state.
 */
export function createAgentGameView(
  state: GameState,
  viewingPower: Power,
  lastOrderResults?: Map<string, OrderResolution>
): AgentGameView {
  // Get this power's units
  const myUnits: UnitView[] = state.units
    .filter(u => u.power === viewingPower)
    .map(unitToView);

  // Get other powers' units
  const otherUnits = new Map<Power, UnitView[]>();
  for (const power of POWERS) {
    if (power !== viewingPower) {
      const units = state.units
        .filter(u => u.power === power)
        .map(unitToView);
      otherUnits.set(power, units);
    }
  }

  // Get supply center ownership grouped by power
  const supplyCenters = new Map<Power, string[]>();
  for (const power of POWERS) {
    supplyCenters.set(power, []);
  }
  for (const [province, power] of state.supplyCenters) {
    const current = supplyCenters.get(power) ?? [];
    current.push(province);
    supplyCenters.set(power, current);
  }

  // Get counts
  const supplyCenterCounts = getSupplyCenterCounts(state);
  const unitCounts = getUnitCounts(state);

  // Build the view
  const view: AgentGameView = {
    viewingPower,
    year: state.year,
    season: state.season,
    phase: state.phase,
    myUnits,
    otherUnits,
    supplyCenters,
    supplyCenterCounts,
    unitCounts,
  };

  // Add pending retreats if in retreat phase
  if (state.phase === 'RETREAT') {
    view.pendingRetreats = state.pendingRetreats
      .filter(u => u.power === viewingPower)
      .map(u => ({
        unit: unitToView(u),
        retreatOptions: state.retreats.get(u.province) ?? [],
        dislodgedFrom: findDislodgedFrom(u, lastOrderResults),
      }));
  }

  // Add build info if in build phase
  if (state.phase === 'BUILD') {
    const buildCount = state.pendingBuilds.get(viewingPower) ?? 0;
    view.buildCount = buildCount;

    if (buildCount > 0) {
      // Find available build locations (unoccupied home centers we control)
      const homeCenters = getHomeCenters(viewingPower);
      const occupiedProvinces = new Set(state.units.map(u => u.province));

      view.availableBuildLocations = homeCenters
        .filter(hc =>
          state.supplyCenters.get(hc.id) === viewingPower &&
          !occupiedProvinces.has(hc.id)
        )
        .map(hc => hc.id);
    }
  }

  // Add last order results if available
  if (lastOrderResults) {
    view.lastOrderResults = [];
    for (const [province, result] of lastOrderResults) {
      // Only show results for this power's units
      const unit = state.units.find(u => u.province === province && u.power === viewingPower);
      if (unit || result.order.unit.startsWith(viewingPower)) {
        view.lastOrderResults.push({
          order: formatOrder(result.order),
          success: result.success,
          reason: result.reason,
        });
      }
    }
  }

  return view;
}

/**
 * Convert a Unit to a UnitView.
 */
function unitToView(unit: Unit): UnitView {
  return {
    type: unit.type,
    province: unit.province,
    coast: unit.coast,
  };
}

/**
 * Find where a unit was dislodged from.
 */
function findDislodgedFrom(
  unit: Unit,
  results?: Map<string, OrderResolution>
): string {
  if (results) {
    for (const [province, result] of results) {
      if (result.dislodged && result.dislodgedFrom) {
        // Check if this result corresponds to our unit
        if (province === unit.province) {
          return result.dislodgedFrom;
        }
      }
    }
  }
  return 'unknown';
}

/**
 * Format an order for display.
 */
function formatOrder(order: any): string {
  switch (order.type) {
    case 'HOLD':
      return `${order.unit} HOLD`;
    case 'MOVE':
      const convoy = order.viaConvoy ? ' VIA CONVOY' : '';
      const coast = order.destinationCoast ? ` (${order.destinationCoast})` : '';
      return `${order.unit} -> ${order.destination}${coast}${convoy}`;
    case 'SUPPORT':
      if (order.destination) {
        return `${order.unit} SUPPORT ${order.supportedUnit} -> ${order.destination}`;
      }
      return `${order.unit} SUPPORT ${order.supportedUnit} HOLD`;
    case 'CONVOY':
      return `${order.unit} CONVOY ${order.convoyedUnit} -> ${order.destination}`;
    default:
      return JSON.stringify(order);
  }
}

/**
 * Create a complete game state summary for all powers.
 */
export function createFullGameSummary(state: GameState): string {
  const lines: string[] = [];

  lines.push(`=== Game State: ${state.year} ${state.season} ${state.phase} ===`);
  lines.push('');

  // Supply center counts
  lines.push('Supply Centers:');
  const scCounts = getSupplyCenterCounts(state);
  for (const [power, count] of scCounts) {
    if (count > 0) {
      lines.push(`  ${power}: ${count}`);
    }
  }
  lines.push('');

  // Units by power
  lines.push('Units:');
  for (const power of POWERS) {
    const units = state.units.filter(u => u.power === power);
    if (units.length > 0) {
      lines.push(`  ${power}:`);
      for (const unit of units) {
        const coast = unit.coast ? ` (${unit.coast})` : '';
        lines.push(`    ${unit.type === 'ARMY' ? 'A' : 'F'} ${unit.province}${coast}`);
      }
    }
  }

  // Victory status
  if (state.winner) {
    lines.push('');
    lines.push(`WINNER: ${state.winner}`);
  } else if (state.draw) {
    lines.push('');
    lines.push('DRAW DECLARED');
  }

  return lines.join('\n');
}

/**
 * Format supply center ownership for a single power.
 */
export function formatSupplyCentersForPower(
  state: GameState,
  power: Power
): string {
  const owned: string[] = [];
  const homeCenters = getHomeCenters(power).map(h => h.id);

  for (const [province, owner] of state.supplyCenters) {
    if (owner === power) {
      const isHome = homeCenters.includes(province);
      owned.push(isHome ? `${province} (home)` : province);
    }
  }

  return owned.join(', ') || 'None';
}

/**
 * Get a list of uncontrolled supply centers.
 */
export function getUncontrolledSupplyCenters(state: GameState): string[] {
  const allSCs = PROVINCES
    .filter(p => p.supplyCenter)
    .map(p => p.id);

  const controlled = new Set(state.supplyCenters.keys());

  return allSCs.filter(sc => !controlled.has(sc));
}

/**
 * Get neutral supply centers (those not owned by any power).
 */
export function getNeutralSupplyCenters(state: GameState): string[] {
  const allSCs = PROVINCES
    .filter(p => p.supplyCenter && !p.homeCenter)
    .map(p => p.id);

  const controlled = new Set(state.supplyCenters.keys());

  return allSCs.filter(sc => !controlled.has(sc));
}

/**
 * Calculate the distance (in provinces) between two locations.
 * This is a simplified calculation that doesn't account for unit types.
 */
export function estimateDistance(from: string, to: string): number {
  // This would ideally use a proper pathfinding algorithm
  // For now, return a placeholder
  if (from === to) return 0;

  // Could implement BFS on adjacency graph here
  return -1; // -1 indicates unknown
}

/**
 * Get all powers that border a given power (share adjacent provinces).
 */
export function getNeighboringPowers(state: GameState, power: Power): Power[] {
  const myUnits = state.units.filter(u => u.power === power);
  const myProvinces = new Set(myUnits.map(u => u.province));

  // Get all home centers for this power as well
  const homeCenters = getHomeCenters(power);
  for (const hc of homeCenters) {
    myProvinces.add(hc.id);
  }

  const neighborPowers = new Set<Power>();

  // Check which other powers have units or supply centers adjacent to ours
  for (const otherPower of POWERS) {
    if (otherPower === power) continue;

    const theirUnits = state.units.filter(u => u.power === otherPower);

    // Simplified check - in a real implementation, check adjacencies
    if (theirUnits.length > 0) {
      neighborPowers.add(otherPower);
    }
  }

  return Array.from(neighborPowers);
}

/**
 * Create a strategic situation summary for an agent.
 */
export function createStrategicSummary(state: GameState, power: Power): string {
  const lines: string[] = [];
  const scCounts = getSupplyCenterCounts(state);
  const unitCounts = getUnitCounts(state);

  const mySCs = scCounts.get(power) ?? 0;
  const myUnits = unitCounts.get(power) ?? 0;

  lines.push(`## Strategic Situation for ${power}`);
  lines.push('');

  // Position summary
  lines.push(`**Your Position**: ${mySCs} supply centers, ${myUnits} units`);
  if (mySCs > myUnits) {
    lines.push(`  → Can build ${mySCs - myUnits} units in Winter`);
  } else if (mySCs < myUnits) {
    lines.push(`  → Must disband ${myUnits - mySCs} units in Winter`);
  }
  lines.push('');

  // Relative strength
  lines.push('**Relative Strength**:');
  const sortedPowers = [...scCounts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  for (const [p, count] of sortedPowers) {
    const units = unitCounts.get(p) ?? 0;
    const marker = p === power ? ' ← YOU' : '';
    lines.push(`  ${p}: ${count} SC, ${units} units${marker}`);
  }
  lines.push('');

  // Threat assessment
  const leader = sortedPowers[0];
  if (leader && leader[1] >= 14) {
    lines.push(`**WARNING**: ${leader[0]} is approaching victory with ${leader[1]} supply centers!`);
  }

  return lines.join('\n');
}

/**
 * Province name lookup - converts ID to full name.
 */
export function getProvinceName(id: string): string {
  const province = getProvince(id);
  return province?.name ?? id;
}

/**
 * Format a list of provinces with their full names.
 */
export function formatProvinceList(ids: string[]): string {
  return ids.map(id => {
    const name = getProvinceName(id);
    return name !== id ? `${name} (${id})` : id;
  }).join(', ');
}
