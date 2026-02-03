/**
 * Diplomacy game state management.
 * Handles turn progression, phase transitions, and victory detection.
 */

import {
  GameState,
  Unit,
  Order,
  Power,
  RetreatOrder,
  BuildOrder,
  POWERS,
} from './types';
import { getHomeCenters, getProvince, PROVINCES } from './map';
import { adjudicate, getRetreatOptions, calculateBuildCounts } from './adjudicator';

const VICTORY_THRESHOLD = 18;

/**
 * Create initial game state for a standard Diplomacy game.
 */
export function createInitialState(): GameState {
  const units: Unit[] = [
    // England
    { type: 'FLEET', power: 'ENGLAND', province: 'LON' },
    { type: 'FLEET', power: 'ENGLAND', province: 'EDI' },
    { type: 'ARMY', power: 'ENGLAND', province: 'LVP' },

    // France
    { type: 'FLEET', power: 'FRANCE', province: 'BRE' },
    { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
    { type: 'ARMY', power: 'FRANCE', province: 'MAR' },

    // Germany
    { type: 'FLEET', power: 'GERMANY', province: 'KIE' },
    { type: 'ARMY', power: 'GERMANY', province: 'BER' },
    { type: 'ARMY', power: 'GERMANY', province: 'MUN' },

    // Italy
    { type: 'FLEET', power: 'ITALY', province: 'NAP' },
    { type: 'ARMY', power: 'ITALY', province: 'ROM' },
    { type: 'ARMY', power: 'ITALY', province: 'VEN' },

    // Austria
    { type: 'FLEET', power: 'AUSTRIA', province: 'TRI' },
    { type: 'ARMY', power: 'AUSTRIA', province: 'VIE' },
    { type: 'ARMY', power: 'AUSTRIA', province: 'BUD' },

    // Russia
    { type: 'FLEET', power: 'RUSSIA', province: 'SEV' },
    { type: 'FLEET', power: 'RUSSIA', province: 'STP', coast: 'SOUTH' },
    { type: 'ARMY', power: 'RUSSIA', province: 'MOS' },
    { type: 'ARMY', power: 'RUSSIA', province: 'WAR' },

    // Turkey
    { type: 'FLEET', power: 'TURKEY', province: 'ANK' },
    { type: 'ARMY', power: 'TURKEY', province: 'CON' },
    { type: 'ARMY', power: 'TURKEY', province: 'SMY' },
  ];

  // Initialize supply center ownership
  const supplyCenters = new Map<string, Power>();
  for (const prov of PROVINCES) {
    if (prov.supplyCenter && prov.homeCenter) {
      supplyCenters.set(prov.id, prov.homeCenter);
    }
  }

  return {
    year: 1901,
    season: 'SPRING',
    phase: 'DIPLOMACY',
    units,
    supplyCenters,
    orders: new Map(),
    retreats: new Map(),
    pendingRetreats: [],
    pendingBuilds: new Map(),
  };
}

/**
 * Submit orders for a power during the diplomacy/movement phase.
 */
export function submitOrders(state: GameState, power: Power, orders: Order[]): void {
  if (state.phase !== 'DIPLOMACY' && state.phase !== 'MOVEMENT') {
    throw new Error(`Cannot submit movement orders during ${state.phase} phase`);
  }
  state.orders.set(power, orders);
}

/**
 * Check if all powers have submitted orders.
 */
export function allOrdersSubmitted(state: GameState): boolean {
  // Only active powers (those with units) need to submit
  const activePowers = new Set(state.units.map(u => u.power));
  for (const power of activePowers) {
    if (!state.orders.has(power)) {
      return false;
    }
  }
  return true;
}

/**
 * Advance from diplomacy phase to movement resolution.
 */
export function resolveMovement(state: GameState): {
  results: Map<string, import('./types').OrderResolution>;
  dislodged: Unit[];
  standoffs: Set<string>;
} {
  if (state.phase !== 'DIPLOMACY' && state.phase !== 'MOVEMENT') {
    throw new Error(`Cannot resolve movement during ${state.phase} phase`);
  }

  const results = adjudicate({
    units: state.units,
    orders: state.orders,
  });

  // Track dislodged units and standoff locations
  const dislodged: Unit[] = [];
  const standoffs = new Set<string>();
  const movedUnits = new Set<string>();

  // Process results
  for (const [unitProvince, result] of results) {
    if (result.order.type === 'MOVE' && result.success) {
      movedUnits.add(unitProvince);
    }
    if (result.dislodged) {
      const unit = state.units.find(u => u.province === unitProvince);
      if (unit) {
        dislodged.push({ ...unit });
        state.retreats.set(
          unitProvince,
          getRetreatOptions(
            unit,
            result.dislodgedFrom!,
            { units: state.units, orders: state.orders },
            new Set(state.units.map(u => u.province)),
            standoffs
          )
        );
      }
    }
  }

  // Detect standoffs (multiple units tried to enter, all failed)
  const moveAttempts = new Map<string, number>();
  for (const [, orders] of state.orders) {
    for (const order of orders) {
      if (order.type === 'MOVE') {
        const dest = order.destination;
        moveAttempts.set(dest, (moveAttempts.get(dest) || 0) + 1);
      }
    }
  }
  for (const [dest, count] of moveAttempts) {
    if (count > 1) {
      // Check if any move to this destination succeeded
      let anySucceeded = false;
      for (const [, result] of results) {
        if (result.order.type === 'MOVE' && result.order.destination === dest && result.success) {
          anySucceeded = true;
          break;
        }
      }
      if (!anySucceeded) {
        standoffs.add(dest);
      }
    }
  }

  // Update unit positions for successful moves
  for (const unit of state.units) {
    const result = results.get(unit.province);
    if (result?.order.type === 'MOVE' && result.success) {
      const moveOrder = result.order;
      unit.province = moveOrder.destination;
      if (moveOrder.destinationCoast) {
        unit.coast = moveOrder.destinationCoast;
      } else {
        delete unit.coast;
      }
    }
  }

  // Remove dislodged units from main list, add to pending retreats
  state.units = state.units.filter(u => !dislodged.some(d => d.province === u.province));
  state.pendingRetreats = dislodged;

  // Transition to retreat phase if there are retreats, otherwise advance
  if (dislodged.length > 0) {
    state.phase = 'RETREAT';
  } else {
    advancePhase(state);
  }

  // Clear orders
  state.orders = new Map();

  return { results, dislodged, standoffs };
}

/**
 * Submit retreat orders for dislodged units.
 */
export function submitRetreats(
  state: GameState,
  power: Power,
  retreats: RetreatOrder[]
): void {
  if (state.phase !== 'RETREAT') {
    throw new Error('Cannot submit retreats outside retreat phase');
  }

  for (const retreat of retreats) {
    const unit = state.pendingRetreats.find(
      u => u.province === retreat.unit && u.power === power
    );
    if (!unit) {
      throw new Error(`No retreating unit at ${retreat.unit} for ${power}`);
    }

    if (retreat.destination) {
      const validOptions = state.retreats.get(retreat.unit) || [];
      if (!validOptions.includes(retreat.destination)) {
        throw new Error(`Invalid retreat destination ${retreat.destination}`);
      }
    }
  }

  // Store retreat orders (simplified - just track the destinations)
  for (const retreat of retreats) {
    if (retreat.destination) {
      const retreatKey = `${power}:${retreat.unit}`;
      state.retreats.set(retreatKey, [retreat.destination]);
    }
  }
}

/**
 * Resolve retreat phase.
 */
export function resolveRetreats(state: GameState): void {
  if (state.phase !== 'RETREAT') {
    throw new Error('Not in retreat phase');
  }

  // Track which destinations are contested
  const retreatDestinations = new Map<string, Unit[]>();

  for (const unit of state.pendingRetreats) {
    const retreatKey = `${unit.power}:${unit.province}`;
    const retreatDest = state.retreats.get(retreatKey);

    if (retreatDest && retreatDest.length > 0) {
      const dest = retreatDest[0];
      if (!retreatDestinations.has(dest)) {
        retreatDestinations.set(dest, []);
      }
      retreatDestinations.get(dest)!.push(unit);
    }
    // If no retreat order, unit is disbanded
  }

  // Process retreats - units retreating to same location are both destroyed
  for (const [dest, units] of retreatDestinations) {
    if (units.length === 1) {
      // Successful retreat
      const unit = units[0];
      unit.province = dest;
      state.units.push(unit);
    }
    // Multiple units -> both destroyed (don't add to state.units)
  }

  // Clear retreat state
  state.pendingRetreats = [];
  state.retreats = new Map();

  advancePhase(state);
}

/**
 * Submit build/disband orders.
 */
export function submitBuilds(
  state: GameState,
  power: Power,
  builds: BuildOrder[]
): void {
  if (state.phase !== 'BUILD') {
    throw new Error('Cannot submit builds outside build phase');
  }

  const allowedBuilds = state.pendingBuilds.get(power) || 0;

  if (allowedBuilds > 0) {
    // Building
    if (builds.filter(b => b.type === 'BUILD').length > allowedBuilds) {
      throw new Error(`${power} can only build ${allowedBuilds} units`);
    }

    for (const build of builds) {
      if (build.type === 'BUILD') {
        if (!build.province || !build.unitType) {
          throw new Error('Build order must specify province and unit type');
        }

        // Must be unoccupied home center
        const homeCenters = getHomeCenters(power);
        const isHome = homeCenters.some(h => h.id === build.province);
        if (!isHome) {
          throw new Error(`${build.province} is not a home center for ${power}`);
        }

        const isOccupied = state.units.some(u => u.province === build.province);
        if (isOccupied) {
          throw new Error(`${build.province} is occupied`);
        }

        // Must own the supply center
        if (state.supplyCenters.get(build.province!) !== power) {
          throw new Error(`${power} does not control ${build.province}`);
        }

        // Check unit type validity
        const prov = getProvince(build.province!);
        if (build.unitType === 'FLEET') {
          if (prov?.type === 'LAND') {
            throw new Error(`Cannot build fleet in landlocked ${build.province}`);
          }
          if (prov?.coasts && !build.coast) {
            throw new Error(`Must specify coast for fleet in ${build.province}`);
          }
        }
      }
    }
  } else if (allowedBuilds < 0) {
    // Disbanding
    const requiredDisbands = -allowedBuilds;
    if (builds.filter(b => b.type === 'DISBAND').length !== requiredDisbands) {
      throw new Error(`${power} must disband exactly ${requiredDisbands} units`);
    }

    for (const build of builds) {
      if (build.type === 'DISBAND') {
        const unit = state.units.find(u => u.province === build.province && u.power === power);
        if (!unit) {
          throw new Error(`No ${power} unit at ${build.province} to disband`);
        }
      }
    }
  }

  // Store the build orders for resolution
  // Note: During BUILD phase, state.orders stores BuildOrder[] instead of Order[]
  // This is a known type limitation - the orders map is reused for different phase types
  state.orders.set(power, builds as unknown as Order[]);
}

/**
 * Resolve build/disband phase.
 */
export function resolveBuilds(state: GameState): void {
  if (state.phase !== 'BUILD') {
    throw new Error('Not in build phase');
  }

  for (const [power, orders] of state.orders) {
    const builds = orders as unknown as BuildOrder[];
    for (const build of builds) {
      if (build.type === 'BUILD' && build.province && build.unitType) {
        state.units.push({
          type: build.unitType,
          power,
          province: build.province,
          coast: build.coast,
        });
      } else if (build.type === 'DISBAND' && build.province) {
        const idx = state.units.findIndex(u => u.province === build.province && u.power === power);
        if (idx >= 0) {
          state.units.splice(idx, 1);
        }
      }
    }
  }

  // Clear build state
  state.pendingBuilds = new Map();
  state.orders = new Map();

  // Advance to next year
  state.year++;
  state.season = 'SPRING';
  state.phase = 'DIPLOMACY';
}

/**
 * Advance to the next phase.
 */
function advancePhase(state: GameState): void {
  if (state.season === 'SPRING') {
    state.season = 'FALL';
    state.phase = 'DIPLOMACY';
  } else if (state.season === 'FALL') {
    // After fall movement, update supply center ownership
    updateSupplyCenterOwnership(state);

    // Check for victory
    if (checkVictory(state)) {
      return;
    }

    // Calculate builds
    const buildCounts = calculateBuildCounts(state.units, state.supplyCenters);
    let hasBuildActivity = false;
    for (const [power, count] of buildCounts) {
      if (count !== 0) {
        state.pendingBuilds.set(power, count);
        hasBuildActivity = true;
      }
    }

    if (hasBuildActivity) {
      state.season = 'WINTER';
      state.phase = 'BUILD';
    } else {
      // Skip to next year
      state.year++;
      state.season = 'SPRING';
      state.phase = 'DIPLOMACY';
    }
  } else if (state.season === 'WINTER') {
    state.year++;
    state.season = 'SPRING';
    state.phase = 'DIPLOMACY';
  }
}

/**
 * Update supply center ownership based on unit positions.
 */
function updateSupplyCenterOwnership(state: GameState): void {
  for (const unit of state.units) {
    const prov = getProvince(unit.province);
    if (prov?.supplyCenter) {
      state.supplyCenters.set(unit.province, unit.power);
    }
  }
}

/**
 * Check for victory condition (18 supply centers).
 */
export function checkVictory(state: GameState): boolean {
  const scCounts = new Map<Power, number>();

  for (const [, power] of state.supplyCenters) {
    scCounts.set(power, (scCounts.get(power) || 0) + 1);
  }

  for (const [power, count] of scCounts) {
    if (count >= VICTORY_THRESHOLD) {
      state.winner = power;
      return true;
    }
  }

  // Check for draw (only 2 or fewer powers remaining with units)
  const activePowers = new Set(state.units.map(u => u.power));
  if (activePowers.size <= 1 && !state.winner) {
    if (activePowers.size === 1) {
      state.winner = [...activePowers][0];
    } else {
      state.draw = true;
    }
    return true;
  }

  return false;
}

/**
 * Get supply center count for each power.
 */
export function getSupplyCenterCounts(state: GameState): Map<Power, number> {
  const counts = new Map<Power, number>();
  for (const power of POWERS) {
    counts.set(power, 0);
  }
  for (const [, power] of state.supplyCenters) {
    counts.set(power, (counts.get(power) || 0) + 1);
  }
  return counts;
}

/**
 * Get unit count for each power.
 */
export function getUnitCounts(state: GameState): Map<Power, number> {
  const counts = new Map<Power, number>();
  for (const power of POWERS) {
    counts.set(power, 0);
  }
  for (const unit of state.units) {
    counts.set(unit.power, (counts.get(unit.power) || 0) + 1);
  }
  return counts;
}

/**
 * Clone game state for safe manipulation.
 */
export function cloneState(state: GameState): GameState {
  return {
    year: state.year,
    season: state.season,
    phase: state.phase,
    units: state.units.map(u => ({ ...u })),
    supplyCenters: new Map(state.supplyCenters),
    orders: new Map([...state.orders].map(([k, v]) => [k, [...v]])),
    retreats: new Map([...state.retreats].map(([k, v]) => [k, [...v]])),
    pendingRetreats: state.pendingRetreats.map(u => ({ ...u })),
    pendingBuilds: new Map(state.pendingBuilds),
    winner: state.winner,
    draw: state.draw,
  };
}
