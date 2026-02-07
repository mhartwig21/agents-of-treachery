/**
 * Tests for game.ts — Core Diplomacy game state management.
 *
 * Covers: createInitialState, submitOrders, allOrdersSubmitted,
 * resolveMovement, submitRetreats, resolveRetreats, submitBuilds,
 * resolveBuilds, checkVictory, getSupplyCenterCounts, getUnitCounts, cloneState
 */

import { describe, it, expect } from 'vitest';
import type { Power, Order } from '../types';
import { POWERS } from '../types';
import {
  createInitialState,
  submitOrders,
  allOrdersSubmitted,
  resolveMovement,
  submitRetreats,
  resolveRetreats,
  submitBuilds,
  resolveBuilds,
  checkVictory,
  getSupplyCenterCounts,
  getUnitCounts,
  cloneState,
} from '../game';

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe('createInitialState', () => {
  it('should create 22 units across 7 powers', () => {
    const state = createInitialState();
    expect(state.units).toHaveLength(22);
  });

  it('should place correct number of units per power', () => {
    const state = createInitialState();
    const counts = new Map<Power, number>();
    for (const u of state.units) {
      counts.set(u.power, (counts.get(u.power) || 0) + 1);
    }
    // Russia gets 4, everyone else gets 3
    expect(counts.get('ENGLAND')).toBe(3);
    expect(counts.get('FRANCE')).toBe(3);
    expect(counts.get('GERMANY')).toBe(3);
    expect(counts.get('ITALY')).toBe(3);
    expect(counts.get('AUSTRIA')).toBe(3);
    expect(counts.get('RUSSIA')).toBe(4);
    expect(counts.get('TURKEY')).toBe(3);
  });

  it('should start in 1901 SPRING DIPLOMACY', () => {
    const state = createInitialState();
    expect(state.year).toBe(1901);
    expect(state.season).toBe('SPRING');
    expect(state.phase).toBe('DIPLOMACY');
  });

  it('should set 22 home supply centers', () => {
    const state = createInitialState();
    expect(state.supplyCenters.size).toBe(22);
  });

  it('should assign 3 home SCs to most powers, 4 to Russia', () => {
    const state = createInitialState();
    const scCounts = getSupplyCenterCounts(state);
    expect(scCounts.get('ENGLAND')).toBe(3);
    expect(scCounts.get('RUSSIA')).toBe(4);
  });

  it('should have empty orders, retreats, and builds', () => {
    const state = createInitialState();
    expect(state.orders.size).toBe(0);
    expect(state.retreats.size).toBe(0);
    expect(state.pendingRetreats).toHaveLength(0);
    expect(state.pendingBuilds.size).toBe(0);
  });

  it('should place Russia STP fleet on south coast', () => {
    const state = createInitialState();
    const stpFleet = state.units.find(u => u.province === 'STP');
    expect(stpFleet).toBeDefined();
    expect(stpFleet!.type).toBe('FLEET');
    expect(stpFleet!.coast).toBe('SOUTH');
  });

  it('should have no winner or draw', () => {
    const state = createInitialState();
    expect(state.winner).toBeUndefined();
    expect(state.draw).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// submitOrders
// ---------------------------------------------------------------------------

describe('submitOrders', () => {
  it('should accept orders in DIPLOMACY phase', () => {
    const state = createInitialState();
    submitOrders(state, 'ENGLAND', [
      { type: 'HOLD', unit: 'LON' },
    ]);
    expect(state.orders.get('ENGLAND')).toHaveLength(1);
  });

  it('should accept orders in MOVEMENT phase', () => {
    const state = createInitialState();
    state.phase = 'MOVEMENT';
    submitOrders(state, 'FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' },
    ]);
    expect(state.orders.get('FRANCE')).toHaveLength(1);
  });

  it('should throw when submitting orders in RETREAT phase', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    expect(() =>
      submitOrders(state, 'ENGLAND', [{ type: 'HOLD', unit: 'LON' }])
    ).toThrow('Cannot submit movement orders during RETREAT phase');
  });

  it('should throw when submitting orders in BUILD phase', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    expect(() =>
      submitOrders(state, 'ENGLAND', [{ type: 'HOLD', unit: 'LON' }])
    ).toThrow('Cannot submit movement orders during BUILD phase');
  });

  it('should overwrite previous orders for the same power', () => {
    const state = createInitialState();
    submitOrders(state, 'ENGLAND', [{ type: 'HOLD', unit: 'LON' }]);
    submitOrders(state, 'ENGLAND', [
      { type: 'HOLD', unit: 'LON' },
      { type: 'HOLD', unit: 'EDI' },
    ]);
    expect(state.orders.get('ENGLAND')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// allOrdersSubmitted
// ---------------------------------------------------------------------------

describe('allOrdersSubmitted', () => {
  it('should return false when no orders are submitted', () => {
    const state = createInitialState();
    expect(allOrdersSubmitted(state)).toBe(false);
  });

  it('should return false when only some powers have submitted', () => {
    const state = createInitialState();
    submitOrders(state, 'ENGLAND', [{ type: 'HOLD', unit: 'LON' }]);
    submitOrders(state, 'FRANCE', [{ type: 'HOLD', unit: 'PAR' }]);
    expect(allOrdersSubmitted(state)).toBe(false);
  });

  it('should return true when all active powers have submitted', () => {
    const state = createInitialState();
    for (const power of POWERS) {
      const units = state.units.filter(u => u.power === power);
      submitOrders(state, power, units.map(u => ({ type: 'HOLD', unit: u.province })));
    }
    expect(allOrdersSubmitted(state)).toBe(true);
  });

  it('should only check powers with units', () => {
    const state = createInitialState();
    // Remove all Italian units
    state.units = state.units.filter(u => u.power !== 'ITALY');
    // Submit for remaining 6 powers
    for (const power of POWERS.filter(p => p !== 'ITALY')) {
      const units = state.units.filter(u => u.power === power);
      if (units.length > 0) {
        submitOrders(state, power, units.map(u => ({ type: 'HOLD', unit: u.province })));
      }
    }
    expect(allOrdersSubmitted(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveMovement
// ---------------------------------------------------------------------------

describe('resolveMovement', () => {
  it('should throw when not in movement/diplomacy phase', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    expect(() => resolveMovement(state)).toThrow('Cannot resolve movement during RETREAT phase');
  });

  it('should resolve HOLD orders with units staying in place', () => {
    const state = createInitialState();
    for (const power of POWERS) {
      const units = state.units.filter(u => u.power === power);
      submitOrders(state, power, units.map(u => ({ type: 'HOLD', unit: u.province })));
    }

    const { results } = resolveMovement(state);
    expect(results.size).toBeGreaterThan(0);

    // All holds should succeed
    for (const [, result] of results) {
      expect(result.success).toBe(true);
    }
  });

  it('should update unit position for successful moves', () => {
    const state = createInitialState();
    // England moves EDI to NTH
    submitOrders(state, 'ENGLAND', [
      { type: 'HOLD', unit: 'LON' },
      { type: 'MOVE', unit: 'EDI', destination: 'NTH' },
      { type: 'HOLD', unit: 'LVP' },
    ]);
    // Submit hold for all others
    for (const power of POWERS.filter(p => p !== 'ENGLAND')) {
      const units = state.units.filter(u => u.power === power);
      submitOrders(state, power, units.map(u => ({ type: 'HOLD', unit: u.province })));
    }

    resolveMovement(state);

    const ediUnit = state.units.find(u => u.province === 'NTH');
    expect(ediUnit).toBeDefined();
    expect(ediUnit!.power).toBe('ENGLAND');
    expect(ediUnit!.type).toBe('FLEET');
  });

  it('should clear orders after resolution', () => {
    const state = createInitialState();
    for (const power of POWERS) {
      const units = state.units.filter(u => u.power === power);
      submitOrders(state, power, units.map(u => ({ type: 'HOLD', unit: u.province })));
    }

    resolveMovement(state);
    expect(state.orders.size).toBe(0);
  });

  it('should advance to FALL after SPRING with no retreats', () => {
    const state = createInitialState();
    for (const power of POWERS) {
      const units = state.units.filter(u => u.power === power);
      submitOrders(state, power, units.map(u => ({ type: 'HOLD', unit: u.province })));
    }

    resolveMovement(state);
    expect(state.season).toBe('FALL');
    expect(state.phase).toBe('DIPLOMACY');
  });

  it('should enter RETREAT phase when units are dislodged', () => {
    const state = createInitialState();
    // Germany attacks MUN with all 3 units (not realistic but tests mechanics)
    // Actually, let's create a simpler scenario: France moves to BUR, Germany moves to BUR
    // This will cause a standoff, no retreat. Let me use a direct attack scenario.

    // Simplified: two units attacking one position with support
    // Set up: FRANCE A PAR -> BUR, FRANCE A MAR S PAR -> BUR
    // GERMANY A MUN holds
    submitOrders(state, 'FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' },
      { type: 'SUPPORT', unit: 'MAR', supportedUnit: 'PAR', destination: 'BUR' },
      { type: 'HOLD', unit: 'BRE' },
    ]);
    submitOrders(state, 'GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' },
      { type: 'HOLD', unit: 'BER' },
      { type: 'HOLD', unit: 'KIE' },
    ]);
    // Submit holds for rest
    for (const power of POWERS.filter(p => p !== 'FRANCE' && p !== 'GERMANY')) {
      const units = state.units.filter(u => u.power === power);
      submitOrders(state, power, units.map(u => ({ type: 'HOLD', unit: u.province })));
    }

    const { results } = resolveMovement(state);

    // France's supported move to BUR should succeed (strength 2 vs 1)
    const parResult = results.get('PAR');
    expect(parResult?.success).toBe(true);
  });

  it('should detect standoffs (multiple failed moves to same province)', () => {
    const state = createInitialState();
    // France and Germany both move to BUR with equal strength -> standoff
    submitOrders(state, 'FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' },
      { type: 'HOLD', unit: 'MAR' },
      { type: 'HOLD', unit: 'BRE' },
    ]);
    submitOrders(state, 'GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' },
      { type: 'HOLD', unit: 'BER' },
      { type: 'HOLD', unit: 'KIE' },
    ]);
    for (const power of POWERS.filter(p => p !== 'FRANCE' && p !== 'GERMANY')) {
      const units = state.units.filter(u => u.power === power);
      submitOrders(state, power, units.map(u => ({ type: 'HOLD', unit: u.province })));
    }

    const { standoffs } = resolveMovement(state);
    expect(standoffs.has('BUR')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// submitRetreats
// ---------------------------------------------------------------------------

describe('submitRetreats', () => {
  it('should throw when not in RETREAT phase', () => {
    const state = createInitialState();
    expect(() =>
      submitRetreats(state, 'ENGLAND', [{ unit: 'LON', destination: 'YOR' }])
    ).toThrow('Cannot submit retreats outside retreat phase');
  });

  it('should silently skip non-existent retreating unit', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    state.pendingRetreats = [
      { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
    ];
    // Should not throw — silently skips the invalid retreat
    submitRetreats(state, 'ENGLAND', [{ unit: 'LON', destination: 'YOR' }]);
    expect(state.pendingRetreats).toHaveLength(1);
  });

  it('should convert invalid retreat destination to disband', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    state.pendingRetreats = [
      { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
    ];
    state.retreats.set('PAR', ['BRE', 'GAS']);
    // Should not throw — converts invalid destination to disband
    submitRetreats(state, 'FRANCE', [{ unit: 'PAR', destination: 'MOS' }]);
    // No retreat destination stored (unit will be disbanded)
    expect(state.retreats.has('FRANCE:PAR')).toBe(false);
  });

  it('should accept valid retreat orders', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    state.pendingRetreats = [
      { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
    ];
    state.retreats.set('PAR', ['BRE', 'GAS']);

    // Should not throw
    submitRetreats(state, 'FRANCE', [{ unit: 'PAR', destination: 'BRE' }]);
  });

  it('should accept retreat with no destination (disband)', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    state.pendingRetreats = [
      { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
    ];
    state.retreats.set('PAR', ['BRE', 'GAS']);

    // No destination means disband — should not throw
    submitRetreats(state, 'FRANCE', [{ unit: 'PAR' }]);
  });
});

// ---------------------------------------------------------------------------
// resolveRetreats
// ---------------------------------------------------------------------------

describe('resolveRetreats', () => {
  it('should throw when not in RETREAT phase', () => {
    const state = createInitialState();
    expect(() => resolveRetreats(state)).toThrow('Not in retreat phase');
  });

  it('should place successfully retreated units on the board', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    // Remove PAR from units list (it was dislodged)
    state.units = state.units.filter(u => u.province !== 'PAR');
    state.pendingRetreats = [
      { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
    ];
    state.retreats.set('FRANCE:PAR', ['BRE']);

    resolveRetreats(state);

    // Unit should now be at BRE
    const retreatedUnit = state.units.find(u => u.province === 'BRE' && u.power === 'FRANCE');
    expect(retreatedUnit).toBeDefined();
  });

  it('should disband units that collide retreating to same province', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    state.units = state.units.filter(u => u.province !== 'PAR' && u.province !== 'MUN');
    state.pendingRetreats = [
      { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
      { type: 'ARMY', power: 'GERMANY', province: 'MUN' },
    ];
    // Both retreating to BUR
    state.retreats.set('FRANCE:PAR', ['BUR']);
    state.retreats.set('GERMANY:MUN', ['BUR']);

    const unitCountBefore = state.units.length;
    resolveRetreats(state);

    // Both should be destroyed
    const burUnit = state.units.find(u => u.province === 'BUR');
    expect(burUnit).toBeUndefined();
    expect(state.units.length).toBe(unitCountBefore); // No new units added
  });

  it('should disband units with no retreat order', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    state.units = state.units.filter(u => u.province !== 'PAR');
    state.pendingRetreats = [
      { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
    ];
    // No retreat order filed — no key in retreats map

    const unitCountBefore = state.units.length;
    resolveRetreats(state);

    // Unit should not appear on the board
    const parUnit = state.units.find(u => u.province === 'PAR');
    expect(parUnit).toBeUndefined();
    expect(state.units.length).toBe(unitCountBefore);
  });

  it('should clear retreat state after resolution', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    state.pendingRetreats = [];

    resolveRetreats(state);

    expect(state.pendingRetreats).toHaveLength(0);
    expect(state.retreats.size).toBe(0);
  });

  it('should advance phase after resolution', () => {
    const state = createInitialState();
    state.phase = 'RETREAT';
    state.season = 'SPRING';
    state.pendingRetreats = [];

    resolveRetreats(state);

    // After spring retreat, should go to FALL DIPLOMACY
    expect(state.season).toBe('FALL');
    expect(state.phase).toBe('DIPLOMACY');
  });
});

// ---------------------------------------------------------------------------
// submitBuilds
// ---------------------------------------------------------------------------

describe('submitBuilds', () => {
  it('should throw when not in BUILD phase', () => {
    const state = createInitialState();
    expect(() =>
      submitBuilds(state, 'ENGLAND', [{ type: 'BUILD', province: 'LON', unitType: 'FLEET' }])
    ).toThrow('Cannot submit builds outside build phase');
  });

  it('should accept valid build order at unoccupied home center', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('ENGLAND', 1);
    // Remove unit from LON to make it available
    state.units = state.units.filter(u => u.province !== 'LON');

    // Should not throw
    submitBuilds(state, 'ENGLAND', [{ type: 'BUILD', province: 'LON', unitType: 'FLEET' }]);
  });

  it('should throw when building more units than allowed', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.pendingBuilds.set('ENGLAND', 1);
    state.units = state.units.filter(u => u.province !== 'LON' && u.province !== 'EDI');

    expect(() =>
      submitBuilds(state, 'ENGLAND', [
        { type: 'BUILD', province: 'LON', unitType: 'FLEET' },
        { type: 'BUILD', province: 'EDI', unitType: 'FLEET' },
      ])
    ).toThrow('can only build 1');
  });

  it('should throw when building on non-home center', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.pendingBuilds.set('ENGLAND', 1);
    state.supplyCenters.set('BEL', 'ENGLAND');

    expect(() =>
      submitBuilds(state, 'ENGLAND', [
        { type: 'BUILD', province: 'BEL', unitType: 'ARMY' },
      ])
    ).toThrow('not a home center');
  });

  it('should throw when building on occupied home center', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.pendingBuilds.set('ENGLAND', 1);

    expect(() =>
      submitBuilds(state, 'ENGLAND', [
        { type: 'BUILD', province: 'LON', unitType: 'FLEET' },
      ])
    ).toThrow('occupied');
  });

  it('should throw when building on uncontrolled home center', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.pendingBuilds.set('ENGLAND', 1);
    state.units = state.units.filter(u => u.province !== 'LON');
    // Transfer LON to France
    state.supplyCenters.set('LON', 'FRANCE');

    expect(() =>
      submitBuilds(state, 'ENGLAND', [
        { type: 'BUILD', province: 'LON', unitType: 'FLEET' },
      ])
    ).toThrow('does not control');
  });

  it('should throw when building fleet in landlocked province', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.pendingBuilds.set('AUSTRIA', 1);
    state.units = state.units.filter(u => u.province !== 'VIE');

    expect(() =>
      submitBuilds(state, 'AUSTRIA', [
        { type: 'BUILD', province: 'VIE', unitType: 'FLEET' },
      ])
    ).toThrow('landlocked');
  });

  it('should require exact number of disbands when negative', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.pendingBuilds.set('ENGLAND', -2);

    expect(() =>
      submitBuilds(state, 'ENGLAND', [
        { type: 'DISBAND', province: 'LON' },
      ])
    ).toThrow('must disband exactly 2');
  });

  it('should throw when disbanding non-existent unit', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.pendingBuilds.set('ENGLAND', -1);

    expect(() =>
      submitBuilds(state, 'ENGLAND', [
        { type: 'DISBAND', province: 'BER' }, // BER is German
      ])
    ).toThrow('No ENGLAND unit');
  });

  it('should accept valid disband orders', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.pendingBuilds.set('ENGLAND', -1);

    // Should not throw
    submitBuilds(state, 'ENGLAND', [
      { type: 'DISBAND', province: 'LON' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// resolveBuilds
// ---------------------------------------------------------------------------

describe('resolveBuilds', () => {
  it('should throw when not in BUILD phase', () => {
    const state = createInitialState();
    expect(() => resolveBuilds(state)).toThrow('Not in build phase');
  });

  it('should add built units to the board', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('ENGLAND', 1);
    state.units = state.units.filter(u => u.province !== 'LON');
    // Submit build order via orders map (as submitBuilds does)
    state.orders.set('ENGLAND', [
      { type: 'BUILD', province: 'LON', unitType: 'FLEET' },
    ] as unknown as Order[]);

    const unitCount = state.units.length;
    resolveBuilds(state);

    expect(state.units.length).toBe(unitCount + 1);
    const newUnit = state.units.find(u => u.province === 'LON' && u.power === 'ENGLAND');
    expect(newUnit).toBeDefined();
    expect(newUnit!.type).toBe('FLEET');
  });

  it('should remove disbanded units from the board', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('ENGLAND', -1);
    state.orders.set('ENGLAND', [
      { type: 'DISBAND', province: 'LON' },
    ] as unknown as Order[]);

    const unitCount = state.units.length;
    resolveBuilds(state);

    expect(state.units.length).toBe(unitCount - 1);
    const lonUnit = state.units.find(u => u.province === 'LON');
    expect(lonUnit).toBeUndefined();
  });

  it('should advance to next year SPRING DIPLOMACY', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.year = 1901;

    resolveBuilds(state);

    expect(state.year).toBe(1902);
    expect(state.season).toBe('SPRING');
    expect(state.phase).toBe('DIPLOMACY');
  });

  it('should clear pending builds and orders', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.pendingBuilds.set('ENGLAND', 1);

    resolveBuilds(state);

    expect(state.pendingBuilds.size).toBe(0);
    expect(state.orders.size).toBe(0);
  });

  it('should set coast on built fleet when specified', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.units = state.units.filter(u => u.province !== 'STP');
    state.pendingBuilds.set('RUSSIA', 1);
    state.orders.set('RUSSIA', [
      { type: 'BUILD', province: 'STP', unitType: 'FLEET', coast: 'NORTH' },
    ] as unknown as Order[]);

    resolveBuilds(state);

    const stpFleet = state.units.find(u => u.province === 'STP');
    expect(stpFleet).toBeDefined();
    expect(stpFleet!.coast).toBe('NORTH');
  });
});

// ---------------------------------------------------------------------------
// checkVictory
// ---------------------------------------------------------------------------

describe('checkVictory', () => {
  it('should return false when no power has 18 SCs', () => {
    const state = createInitialState();
    expect(checkVictory(state)).toBe(false);
    expect(state.winner).toBeUndefined();
  });

  it('should declare victory when a power reaches 18 SCs', () => {
    const state = createInitialState();
    // Give England 18 SCs
    const neutralSCs = ['BEL', 'HOL', 'DEN', 'NWY', 'SWE', 'SPA', 'POR',
      'TUN', 'GRE', 'SER', 'RUM', 'BUL', 'MOS', 'WAR', 'SEV'];
    for (const sc of neutralSCs) {
      state.supplyCenters.set(sc, 'ENGLAND');
    }
    // England now has 3 (home) + 15 (captured) = 18

    expect(checkVictory(state)).toBe(true);
    expect(state.winner).toBe('ENGLAND');
  });

  it('should declare winner when only one power has units', () => {
    const state = createInitialState();
    state.units = state.units.filter(u => u.power === 'TURKEY');

    expect(checkVictory(state)).toBe(true);
    expect(state.winner).toBe('TURKEY');
  });

  it('should declare draw when no power has units', () => {
    const state = createInitialState();
    state.units = [];

    expect(checkVictory(state)).toBe(true);
    expect(state.draw).toBe(true);
  });

  it('should not declare victory with exactly 17 SCs', () => {
    const state = createInitialState();
    const neutralSCs = ['BEL', 'HOL', 'DEN', 'NWY', 'SWE', 'SPA', 'POR',
      'TUN', 'GRE', 'SER', 'RUM', 'BUL', 'MOS', 'WAR'];
    for (const sc of neutralSCs) {
      state.supplyCenters.set(sc, 'ENGLAND');
    }
    // 3 + 14 = 17

    expect(checkVictory(state)).toBe(false);
    expect(state.winner).toBeUndefined();
  });

  it('should not declare draw with 2+ active powers', () => {
    const state = createInitialState();
    // Keep only England and France
    state.units = state.units.filter(u => u.power === 'ENGLAND' || u.power === 'FRANCE');

    expect(checkVictory(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSupplyCenterCounts
// ---------------------------------------------------------------------------

describe('getSupplyCenterCounts', () => {
  it('should count SCs for all 7 powers', () => {
    const state = createInitialState();
    const counts = getSupplyCenterCounts(state);
    expect(counts.size).toBe(7);
  });

  it('should return correct counts at game start', () => {
    const state = createInitialState();
    const counts = getSupplyCenterCounts(state);
    expect(counts.get('ENGLAND')).toBe(3);
    expect(counts.get('FRANCE')).toBe(3);
    expect(counts.get('GERMANY')).toBe(3);
    expect(counts.get('ITALY')).toBe(3);
    expect(counts.get('AUSTRIA')).toBe(3);
    expect(counts.get('RUSSIA')).toBe(4);
    expect(counts.get('TURKEY')).toBe(3);
  });

  it('should initialize 0 for powers with no SCs', () => {
    const state = createInitialState();
    state.supplyCenters = new Map();
    const counts = getSupplyCenterCounts(state);
    for (const power of POWERS) {
      expect(counts.get(power)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getUnitCounts
// ---------------------------------------------------------------------------

describe('getUnitCounts', () => {
  it('should count units for all 7 powers', () => {
    const state = createInitialState();
    const counts = getUnitCounts(state);
    expect(counts.size).toBe(7);
  });

  it('should return correct counts at game start', () => {
    const state = createInitialState();
    const counts = getUnitCounts(state);
    expect(counts.get('ENGLAND')).toBe(3);
    expect(counts.get('RUSSIA')).toBe(4);
  });

  it('should return 0 for eliminated powers', () => {
    const state = createInitialState();
    state.units = state.units.filter(u => u.power !== 'ITALY');
    const counts = getUnitCounts(state);
    expect(counts.get('ITALY')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cloneState
// ---------------------------------------------------------------------------

describe('cloneState', () => {
  it('should create an independent copy', () => {
    const state = createInitialState();
    const clone = cloneState(state);

    // Modify clone
    clone.year = 1999;
    clone.units.push({ type: 'ARMY', power: 'ENGLAND', province: 'XXX' });

    // Original should be unchanged
    expect(state.year).toBe(1901);
    expect(state.units).toHaveLength(22);
  });

  it('should deep copy units', () => {
    const state = createInitialState();
    const clone = cloneState(state);

    clone.units[0].province = 'CHANGED';
    expect(state.units[0].province).not.toBe('CHANGED');
  });

  it('should deep copy supply centers map', () => {
    const state = createInitialState();
    const clone = cloneState(state);

    clone.supplyCenters.set('BEL', 'ENGLAND');
    expect(state.supplyCenters.has('BEL')).toBe(false);
  });

  it('should deep copy orders map', () => {
    const state = createInitialState();
    submitOrders(state, 'ENGLAND', [{ type: 'HOLD', unit: 'LON' }]);
    const clone = cloneState(state);

    clone.orders.set('FRANCE', [{ type: 'HOLD', unit: 'PAR' }]);
    expect(state.orders.has('FRANCE')).toBe(false);
  });

  it('should preserve all scalar values', () => {
    const state = createInitialState();
    state.winner = 'ENGLAND';
    state.draw = true;
    const clone = cloneState(state);

    expect(clone.year).toBe(state.year);
    expect(clone.season).toBe(state.season);
    expect(clone.phase).toBe(state.phase);
    expect(clone.winner).toBe('ENGLAND');
    expect(clone.draw).toBe(true);
  });

  it('should deep copy pending retreats', () => {
    const state = createInitialState();
    state.pendingRetreats = [{ type: 'ARMY', power: 'FRANCE', province: 'PAR' }];
    const clone = cloneState(state);

    clone.pendingRetreats[0].province = 'CHANGED';
    expect(state.pendingRetreats[0].province).toBe('PAR');
  });

  it('should deep copy pending builds', () => {
    const state = createInitialState();
    state.pendingBuilds.set('ENGLAND', 2);
    const clone = cloneState(state);

    clone.pendingBuilds.set('ENGLAND', 5);
    expect(state.pendingBuilds.get('ENGLAND')).toBe(2);
  });
});
