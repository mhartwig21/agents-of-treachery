/**
 * Tests for checkVictory() — Victory condition detection.
 *
 * Covers: 18 SC threshold, exceeding threshold, boundary at 17,
 * last power standing, draw (all eliminated), game continues with
 * multiple active powers, integration with advancePhase.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, Power, Unit } from '../types';
import { POWERS } from '../types';
import {
  createInitialState,
  checkVictory,
  submitOrders,
  resolveMovement,
  getSupplyCenterCounts,
  cloneState,
} from '../game';

// All 34 supply center IDs on the standard map
const ALL_SUPPLY_CENTERS = [
  // Home centers (22)
  'LON', 'LVP', 'EDI',           // England
  'PAR', 'MAR', 'BRE',           // France
  'BER', 'MUN', 'KIE',           // Germany
  'ROM', 'VEN', 'NAP',           // Italy
  'VIE', 'BUD', 'TRI',           // Austria
  'MOS', 'WAR', 'STP', 'SEV',    // Russia
  'CON', 'ANK', 'SMY',           // Turkey
  // Neutral centers (12)
  'NWY', 'SWE', 'DEN', 'HOL', 'BEL', 'SPA',
  'POR', 'TUN', 'SER', 'RUM', 'BUL', 'GRE',
];

/** Give a power exactly N supply centers by assigning from the pool. */
function assignSCs(state: GameState, power: Power, count: number): void {
  let assigned = 0;
  for (const sc of ALL_SUPPLY_CENTERS) {
    if (assigned >= count) break;
    state.supplyCenters.set(sc, power);
    assigned++;
  }
}

/** Create a minimal unit for a power. */
function makeUnit(power: Power, province: string): Unit {
  return { type: 'ARMY', power, province };
}

// ---------------------------------------------------------------------------
// 18 SC threshold victory
// ---------------------------------------------------------------------------

describe('checkVictory — 18 SC threshold', () => {
  it('should declare victory when a power has exactly 18 SCs', () => {
    const state = createInitialState();
    // Give France exactly 18 SCs
    const scs = ALL_SUPPLY_CENTERS.slice(0, 18);
    for (const sc of scs) {
      state.supplyCenters.set(sc, 'FRANCE');
    }

    expect(checkVictory(state)).toBe(true);
    expect(state.winner).toBe('FRANCE');
  });

  it('should declare victory when a power exceeds 18 SCs', () => {
    const state = createInitialState();
    // Give Turkey all 34 SCs
    for (const sc of ALL_SUPPLY_CENTERS) {
      state.supplyCenters.set(sc, 'TURKEY');
    }

    expect(checkVictory(state)).toBe(true);
    expect(state.winner).toBe('TURKEY');
  });

  it('should not declare victory at 17 SCs', () => {
    const state = createInitialState();
    const scs = ALL_SUPPLY_CENTERS.slice(0, 17);
    for (const sc of scs) {
      state.supplyCenters.set(sc, 'GERMANY');
    }

    expect(checkVictory(state)).toBe(false);
    expect(state.winner).toBeUndefined();
  });

  it('should not declare victory at game start (max 4 SCs per power)', () => {
    const state = createInitialState();

    expect(checkVictory(state)).toBe(false);
    expect(state.winner).toBeUndefined();
    expect(state.draw).toBeUndefined();
  });

  it('should identify the correct winner among multiple high-SC powers', () => {
    const state = createInitialState();
    // Give England 17 SCs
    const engSCs = ALL_SUPPLY_CENTERS.slice(0, 17);
    for (const sc of engSCs) {
      state.supplyCenters.set(sc, 'ENGLAND');
    }
    // Give France 18 SCs (overlapping will overwrite some of England's)
    const fraSCs = ALL_SUPPLY_CENTERS.slice(16, 34);
    for (const sc of fraSCs) {
      state.supplyCenters.set(sc, 'FRANCE');
    }

    expect(checkVictory(state)).toBe(true);
    expect(state.winner).toBe('FRANCE');
  });

  it('should count each SC only for its current owner', () => {
    const state = createInitialState();
    // Transfer all Russia home centers to England
    state.supplyCenters.set('MOS', 'ENGLAND');
    state.supplyCenters.set('WAR', 'ENGLAND');
    state.supplyCenters.set('STP', 'ENGLAND');
    state.supplyCenters.set('SEV', 'ENGLAND');
    // England now has 3 (home) + 4 (captured) = 7, still not 18

    expect(checkVictory(state)).toBe(false);
    expect(state.winner).toBeUndefined();
  });

  it('should handle a power with 19 SCs', () => {
    const state = createInitialState();
    const scs = ALL_SUPPLY_CENTERS.slice(0, 19);
    for (const sc of scs) {
      state.supplyCenters.set(sc, 'ITALY');
    }

    expect(checkVictory(state)).toBe(true);
    expect(state.winner).toBe('ITALY');
  });
});

// ---------------------------------------------------------------------------
// Last power standing
// ---------------------------------------------------------------------------

describe('checkVictory — last power standing', () => {
  it('should declare winner when only one power has units', () => {
    const state = createInitialState();
    state.units = state.units.filter(u => u.power === 'RUSSIA');

    expect(checkVictory(state)).toBe(true);
    expect(state.winner).toBe('RUSSIA');
  });

  it('should declare winner with a single remaining unit', () => {
    const state = createInitialState();
    state.units = [makeUnit('AUSTRIA', 'VIE')];

    expect(checkVictory(state)).toBe(true);
    expect(state.winner).toBe('AUSTRIA');
  });

  it('should not trigger with two active powers', () => {
    const state = createInitialState();
    state.units = [
      makeUnit('ENGLAND', 'LON'),
      makeUnit('FRANCE', 'PAR'),
    ];

    expect(checkVictory(state)).toBe(false);
    expect(state.winner).toBeUndefined();
  });

  it('should not trigger with all seven powers active', () => {
    const state = createInitialState();
    // Default state has all 7 powers

    expect(checkVictory(state)).toBe(false);
  });

  it('should prioritize 18 SC win over last-power-standing', () => {
    const state = createInitialState();
    // Give England 18 SCs AND make it the only power with units
    const scs = ALL_SUPPLY_CENTERS.slice(0, 18);
    for (const sc of scs) {
      state.supplyCenters.set(sc, 'ENGLAND');
    }
    state.units = state.units.filter(u => u.power === 'ENGLAND');

    expect(checkVictory(state)).toBe(true);
    // Winner should be set from SC check (fires first)
    expect(state.winner).toBe('ENGLAND');
  });

  it('should handle last power standing with many units', () => {
    const state = createInitialState();
    // Only Turkey remains but with 10 units scattered
    state.units = [
      makeUnit('TURKEY', 'CON'),
      makeUnit('TURKEY', 'ANK'),
      makeUnit('TURKEY', 'SMY'),
      makeUnit('TURKEY', 'BUL'),
      makeUnit('TURKEY', 'GRE'),
      makeUnit('TURKEY', 'SER'),
      makeUnit('TURKEY', 'RUM'),
      makeUnit('TURKEY', 'SEV'),
      makeUnit('TURKEY', 'BUD'),
      makeUnit('TURKEY', 'VIE'),
    ];

    expect(checkVictory(state)).toBe(true);
    expect(state.winner).toBe('TURKEY');
  });
});

// ---------------------------------------------------------------------------
// Draw conditions
// ---------------------------------------------------------------------------

describe('checkVictory — draw', () => {
  it('should declare draw when no units remain', () => {
    const state = createInitialState();
    state.units = [];

    expect(checkVictory(state)).toBe(true);
    expect(state.draw).toBe(true);
    expect(state.winner).toBeUndefined();
  });

  it('should not declare draw when one power has units', () => {
    const state = createInitialState();
    state.units = [makeUnit('ITALY', 'ROM')];

    expect(checkVictory(state)).toBe(true);
    // This is last-power-standing, not a draw
    expect(state.draw).toBeUndefined();
    expect(state.winner).toBe('ITALY');
  });

  it('should not set draw flag when 18 SC winner exists with no other units', () => {
    const state = createInitialState();
    // Give France 18 SCs but remove all units
    const scs = ALL_SUPPLY_CENTERS.slice(0, 18);
    for (const sc of scs) {
      state.supplyCenters.set(sc, 'FRANCE');
    }
    state.units = [];

    expect(checkVictory(state)).toBe(true);
    // 18 SC check fires first, sets winner to France
    expect(state.winner).toBe('FRANCE');
    // Draw check is skipped because winner is already set
    expect(state.draw).toBeUndefined();
  });

  it('should declare draw even when SCs are still owned', () => {
    const state = createInitialState();
    // All powers eliminated but SCs still assigned
    state.units = [];
    // Supply centers remain from initial state

    expect(checkVictory(state)).toBe(true);
    expect(state.draw).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Game continues (no victory)
// ---------------------------------------------------------------------------

describe('checkVictory — game continues', () => {
  it('should return false at standard game start', () => {
    const state = createInitialState();

    expect(checkVictory(state)).toBe(false);
    expect(state.winner).toBeUndefined();
    expect(state.draw).toBeUndefined();
  });

  it('should return false with 6 powers remaining', () => {
    const state = createInitialState();
    // Eliminate Italy
    state.units = state.units.filter(u => u.power !== 'ITALY');

    expect(checkVictory(state)).toBe(false);
  });

  it('should return false with 2 powers remaining', () => {
    const state = createInitialState();
    state.units = [
      makeUnit('ENGLAND', 'LON'),
      makeUnit('TURKEY', 'CON'),
    ];

    expect(checkVictory(state)).toBe(false);
  });

  it('should return false when one power has 17 SCs and multiple powers have units', () => {
    const state = createInitialState();
    // Clear all SC ownership first, then assign exactly 17 to Russia
    state.supplyCenters = new Map();
    const scs = ALL_SUPPLY_CENTERS.slice(0, 17);
    for (const sc of scs) {
      state.supplyCenters.set(sc, 'RUSSIA');
    }
    // Multiple powers still have units
    expect(checkVictory(state)).toBe(false);
    expect(state.winner).toBeUndefined();
  });

  it('should not modify state when returning false', () => {
    const state = createInitialState();
    const clone = cloneState(state);

    checkVictory(state);

    expect(state.winner).toEqual(clone.winner);
    expect(state.draw).toEqual(clone.draw);
  });
});

// ---------------------------------------------------------------------------
// Integration: victory through game flow
// ---------------------------------------------------------------------------

describe('checkVictory — integration with game flow', () => {
  it('should detect victory during fall phase transition', () => {
    const state = createInitialState();

    // Set up a scenario where France controls 18 SC provinces via units.
    // Remove all non-French and non-Turkish units to simplify.
    // Keep Turkey alive so this tests 18-SC path (not last-power-standing).
    state.units = state.units.filter(u =>
      u.power === 'FRANCE' || u.power === 'TURKEY'
    );

    // Place French armies on 15 additional SC provinces (18 total with 3 home)
    const extraSCs = [
      'SPA', 'POR', 'BEL', 'HOL', 'LON', 'LVP', 'EDI',
      'NWY', 'SWE', 'DEN', 'MUN', 'BER', 'KIE', 'VIE', 'BUD',
    ];
    for (const sc of extraSCs) {
      state.units.push(makeUnit('FRANCE', sc));
    }

    // Start in fall DIPLOMACY — victory is checked after fall resolution
    state.season = 'FALL';
    state.phase = 'DIPLOMACY';

    // Submit all holds
    for (const power of ['FRANCE', 'TURKEY'] as Power[]) {
      const units = state.units.filter(u => u.power === power);
      submitOrders(state, power, units.map(u => ({ type: 'HOLD', unit: u.province })));
    }
    resolveMovement(state);

    // After fall resolution, advancePhase calls updateSupplyCenterOwnership
    // (assigns all 18 SC provinces to France) then checkVictory detects win
    expect(state.winner).toBe('FRANCE');
  });

  it('should not declare victory after spring (checkVictory only runs after fall)', () => {
    const state = createInitialState();

    // Give France 18 SCs in the map
    const fraSCs = ALL_SUPPLY_CENTERS.slice(0, 18);
    for (const sc of fraSCs) {
      state.supplyCenters.set(sc, 'FRANCE');
    }

    // We're in spring - resolve spring movement
    for (const power of POWERS) {
      const units = state.units.filter(u => u.power === power);
      if (units.length > 0) {
        submitOrders(state, power, units.map(u => ({ type: 'HOLD', unit: u.province })));
      }
    }
    resolveMovement(state);

    // After spring, advancePhase goes to FALL DIPLOMACY without checking victory
    expect(state.season).toBe('FALL');
    expect(state.phase).toBe('DIPLOMACY');
    // Winner is NOT set because checkVictory doesn't run after spring
    expect(state.winner).toBeUndefined();
  });
});
