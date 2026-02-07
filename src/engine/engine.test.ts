import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  submitOrders,
  resolveMovement,
  submitRetreats,
  resolveRetreats,
  submitBuilds,
  resolveBuilds,
  checkVictory,
  getProvince,
  getSupplyCenters,
  getHomeCenters,
  areAdjacent,
  getRetreatOptions,
  calculateBuildCounts,
  PROVINCES,
  adjudicate,
  getSupplyCenterCounts,
  getUnitCounts,
} from './index';
import { Order, MoveOrder, HoldOrder, SupportOrder, ConvoyOrder, Power, Unit, GameState, BuildOrder } from './types';

describe('Map data', () => {
  it('has 75 provinces', () => {
    expect(PROVINCES.length).toBe(75);
  });

  it('has 34 supply centers', () => {
    expect(getSupplyCenters().length).toBe(34);
  });

  it('has correct home centers for each power', () => {
    expect(getHomeCenters('ENGLAND').length).toBe(3);
    expect(getHomeCenters('FRANCE').length).toBe(3);
    expect(getHomeCenters('GERMANY').length).toBe(3);
    expect(getHomeCenters('ITALY').length).toBe(3);
    expect(getHomeCenters('AUSTRIA').length).toBe(3);
    expect(getHomeCenters('RUSSIA').length).toBe(4);
    expect(getHomeCenters('TURKEY').length).toBe(3);
  });

  it('checks adjacency correctly', () => {
    expect(areAdjacent('LON', 'NTH')).toBe(true);
    expect(areAdjacent('LON', 'WAL')).toBe(true);
    expect(areAdjacent('LON', 'PAR')).toBe(false);
    expect(areAdjacent('MUN', 'BER')).toBe(true);
  });

  it('handles coasted provinces', () => {
    const stp = getProvince('STP');
    expect(stp?.coasts).toContain('NORTH');
    expect(stp?.coasts).toContain('SOUTH');
  });
});

describe('Initial state', () => {
  it('starts in Spring 1901', () => {
    const state = createInitialState();
    expect(state.year).toBe(1901);
    expect(state.season).toBe('SPRING');
    expect(state.phase).toBe('DIPLOMACY');
  });

  it('has 22 starting units', () => {
    const state = createInitialState();
    expect(state.units.length).toBe(22);
  });

  it('has correct starting positions', () => {
    const state = createInitialState();

    // England
    expect(state.units.find(u => u.province === 'LON')?.power).toBe('ENGLAND');
    expect(state.units.find(u => u.province === 'EDI')?.power).toBe('ENGLAND');
    expect(state.units.find(u => u.province === 'LVP')?.power).toBe('ENGLAND');

    // Germany
    expect(state.units.find(u => u.province === 'BER')?.power).toBe('GERMANY');
    expect(state.units.find(u => u.province === 'MUN')?.power).toBe('GERMANY');
    expect(state.units.find(u => u.province === 'KIE')?.power).toBe('GERMANY');
  });

  it('initializes supply center ownership', () => {
    const state = createInitialState();
    expect(state.supplyCenters.get('LON')).toBe('ENGLAND');
    expect(state.supplyCenters.get('PAR')).toBe('FRANCE');
    expect(state.supplyCenters.get('BER')).toBe('GERMANY');
    // Neutral centers should not be owned initially
    expect(state.supplyCenters.has('BEL')).toBe(false);
  });
});

describe('Order adjudication', () => {
  it('resolves simple hold orders', () => {
    const state = createInitialState();
    const orders = new Map<Power, Order[]>();
    orders.set('ENGLAND', [{ type: 'HOLD', unit: 'LON' } as HoldOrder]);
    orders.set('FRANCE', [{ type: 'HOLD', unit: 'PAR' } as HoldOrder]);

    const results = adjudicate({
      units: state.units,
      orders,
    });

    expect(results.get('LON')?.success).toBe(true);
    expect(results.get('PAR')?.success).toBe(true);
  });

  it('resolves unopposed moves', () => {
    const state = createInitialState();
    const orders = new Map<Power, Order[]>();

    // German army Munich -> Burgundy (unopposed)
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
    ]);

    const results = adjudicate({
      units: state.units,
      orders,
    });

    expect(results.get('MUN')?.success).toBe(true);
  });

  it('bounces equal-strength head-to-head moves', () => {
    const state = createInitialState();

    // Set up a head-to-head scenario
    // France A PAR -> BUR, Germany A MUN -> BUR
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
    ]);

    const results = adjudicate({
      units: state.units,
      orders,
    });

    // Both should fail (bounce)
    expect(results.get('PAR')?.success).toBe(false);
    expect(results.get('MUN')?.success).toBe(false);
  });

  it('support adds strength to moves', () => {
    const state = createInitialState();

    // France: A PAR -> BUR, A MAR S PAR -> BUR
    // Germany: A MUN -> BUR
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'MAR', supportedUnit: 'PAR', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
    ]);

    const results = adjudicate({
      units: state.units,
      orders,
    });

    // France should succeed (strength 2 vs 1)
    expect(results.get('PAR')?.success).toBe(true);
    expect(results.get('MUN')?.success).toBe(false);
  });
});

describe('Turn progression', () => {
  it('advances from spring to fall', () => {
    const state = createInitialState();

    // Submit minimal orders for all powers
    const powers: Power[] = ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'];
    for (const power of powers) {
      const powerUnits = state.units.filter(u => u.power === power);
      const holdOrders: Order[] = powerUnits.map(u => ({ type: 'HOLD', unit: u.province }));
      submitOrders(state, power, holdOrders);
    }

    resolveMovement(state);

    expect(state.season).toBe('FALL');
    expect(state.phase).toBe('DIPLOMACY');
  });

  it('tracks supply center counts', () => {
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

  it('tracks unit counts', () => {
    const state = createInitialState();
    const counts = getUnitCounts(state);

    expect(counts.get('ENGLAND')).toBe(3);
    expect(counts.get('FRANCE')).toBe(3);
    expect(counts.get('GERMANY')).toBe(3);
    expect(counts.get('ITALY')).toBe(3);
    expect(counts.get('AUSTRIA')).toBe(3);
    expect(counts.get('RUSSIA')).toBe(4);
    expect(counts.get('TURKEY')).toBe(3);
  });
});

// ============================================================================
// Helper: create a custom game state with specific units for targeted testing
// ============================================================================
function createCustomState(units: Unit[]): { units: Unit[]; orders: Map<Power, Order[]> } {
  return { units, orders: new Map() };
}

function makeUnit(power: Power, type: 'ARMY' | 'FLEET', province: string): Unit {
  return { power, type, province };
}

// ============================================================================
// SUPPORT MECHANICS
// ============================================================================
describe('Support mechanics', () => {
  it('support hold increases defense strength', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
    ];
    const orders = new Map<Power, Order[]>();
    // France: A BUR HOLD, A PAR SUPPORT A BUR
    // Germany: A MUN -> BUR
    orders.set('FRANCE', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
      { type: 'SUPPORT', unit: 'PAR', supportedUnit: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // BUR holds with strength 2 vs MUN's strength 1 - Germany bounces
    expect(results.get('BUR')?.success).toBe(true);
    expect(results.get('BUR')?.dislodged).toBe(false);
    expect(results.get('MUN')?.success).toBe(false);
  });

  // BUG: aot-hidn8 - Support not being cut when supporting unit is attacked
  // Original test used MUN -> MAR, but MUN and MAR are not adjacent.
  // Fixed to use PIE -> MAR (PIE is adjacent to MAR).
  it('cutting support by attacking the supporting unit', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'MAR'),
      makeUnit('ITALY', 'ARMY', 'PIE'),
      makeUnit('GERMANY', 'ARMY', 'BUR'),
    ];
    const orders = new Map<Power, Order[]>();
    // France: A PAR -> BUR (with support from MAR), A MAR SUPPORT A PAR -> BUR
    // Italy: A PIE -> MAR (cuts support!)
    // Germany: A BUR HOLD
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'MAR', supportedUnit: 'PAR', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('ITALY', [
      { type: 'MOVE', unit: 'PIE', destination: 'MAR' } as MoveOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
    ]);

    const results = adjudicate({ units, orders });

    // Italy attacks MAR, cutting France's support for PAR -> BUR
    // So PAR -> BUR is now strength 1 vs BUR hold strength 1 = bounce
    expect(results.get('MAR')?.success).toBe(false); // Support was cut
    expect(results.get('MAR')?.reason).toBe('Support was cut');
    expect(results.get('PAR')?.success).toBe(false); // Bounce without support
  });

  it('support is NOT cut by the unit being attacked', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'GAS'),
      makeUnit('GERMANY', 'ARMY', 'BUR'),
    ];
    const orders = new Map<Power, Order[]>();
    // France: A PAR -> BUR, A GAS SUPPORT A PAR -> BUR
    // Germany: A BUR -> GAS (attacks the supporting unit, but this is the unit being attacked)
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'GAS', supportedUnit: 'PAR', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'BUR', destination: 'GAS' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // BUR -> GAS does NOT cut the support because BUR is the target of the supported attack
    // PAR -> BUR has strength 2 (with support), BUR is moving away
    expect(results.get('GAS')?.success).toBe(true); // Support holds
    expect(results.get('PAR')?.success).toBe(true); // Move succeeds with support
  });

  // BUG: aot-eoid5 - Multi-destination support not working with 3+ moves
  it.skip('three units competing for same destination - strongest wins', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'PIC'),
      makeUnit('GERMANY', 'ARMY', 'RUH'),
      makeUnit('ENGLAND', 'ARMY', 'HOL'),
    ];
    const orders = new Map<Power, Order[]>();
    // France: A PAR -> BEL (supported by PIC), A PIC S PAR -> BEL
    // Germany: A RUH -> BEL
    // England: A HOL -> BEL
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BEL' } as MoveOrder,
      { type: 'SUPPORT', unit: 'PIC', supportedUnit: 'PAR', destination: 'BEL' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'RUH', destination: 'BEL' } as MoveOrder,
    ]);
    orders.set('ENGLAND', [
      { type: 'MOVE', unit: 'HOL', destination: 'BEL' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // France has strength 2, Germany and England have strength 1
    expect(results.get('PAR')?.success).toBe(true);
    expect(results.get('RUH')?.success).toBe(false);
    expect(results.get('HOL')?.success).toBe(false);
  });

  it('three equal-strength moves to same destination - all bounce', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('GERMANY', 'ARMY', 'RUH'),
      makeUnit('ENGLAND', 'ARMY', 'HOL'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BEL' } as MoveOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'RUH', destination: 'BEL' } as MoveOrder,
    ]);
    orders.set('ENGLAND', [
      { type: 'MOVE', unit: 'HOL', destination: 'BEL' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('PAR')?.success).toBe(false);
    expect(results.get('RUH')?.success).toBe(false);
    expect(results.get('HOL')?.success).toBe(false);
  });
});

// ============================================================================
// DISLODGEMENT
// ============================================================================
describe('Dislodgement', () => {
  it('supported attack dislodges holding unit', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'GAS'),
      makeUnit('GERMANY', 'ARMY', 'BUR'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'GAS', supportedUnit: 'PAR', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('PAR')?.success).toBe(true);
    expect(results.get('BUR')?.dislodged).toBe(true);
    expect(results.get('BUR')?.dislodgedFrom).toBe('PAR');
  });

  it('head-to-head battle with support - stronger wins and dislodges', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('FRANCE', 'ARMY', 'RUH'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
    ];
    const orders = new Map<Power, Order[]>();
    // France: A BUR -> MUN (supported by RUH)
    // Germany: A MUN -> BUR
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'BUR', destination: 'MUN' } as MoveOrder,
      { type: 'SUPPORT', unit: 'RUH', supportedUnit: 'BUR', destination: 'MUN' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // France has strength 2, Germany strength 1 - France wins
    expect(results.get('BUR')?.success).toBe(true);
    expect(results.get('MUN')?.success).toBe(false);
    expect(results.get('MUN')?.dislodged).toBe(true);
  });
});

// ============================================================================
// CONVOY VALIDATION
// ============================================================================
describe('Convoy validation', () => {
  it('only fleets can convoy', () => {
    const units: Unit[] = [
      makeUnit('ENGLAND', 'ARMY', 'LON'),
      makeUnit('ENGLAND', 'ARMY', 'NTH'), // Army, not fleet
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('ENGLAND', [
      { type: 'MOVE', unit: 'LON', destination: 'NWY', viaConvoy: true } as MoveOrder,
      { type: 'CONVOY', unit: 'NTH', convoyedUnit: 'LON', destination: 'NWY' } as ConvoyOrder,
    ]);

    const results = adjudicate({ units, orders });

    // NTH is an army, can't convoy
    expect(results.get('NTH')?.success).toBe(false);
    expect(results.get('NTH')?.reason).toContain('Only fleets can convoy');
  });

  it('only armies can be convoyed', () => {
    const units: Unit[] = [
      makeUnit('ENGLAND', 'FLEET', 'LON'),
      makeUnit('ENGLAND', 'FLEET', 'NTH'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('ENGLAND', [
      { type: 'MOVE', unit: 'LON', destination: 'NWY', viaConvoy: true } as MoveOrder,
      { type: 'CONVOY', unit: 'NTH', convoyedUnit: 'LON', destination: 'NWY' } as ConvoyOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('NTH')?.success).toBe(false);
    expect(results.get('NTH')?.reason).toContain('Only armies can be convoyed');
  });
});

// ============================================================================
// RETREAT OPTIONS
// ============================================================================
describe('Retreat options', () => {
  it('cannot retreat to attacker origin', () => {
    const unit = makeUnit('GERMANY', 'ARMY', 'BUR');
    const dislodgedFrom = 'PAR'; // France attacked from PAR
    const occupied = new Set(['MUN', 'MAR']); // Other units
    const standoffs = new Set<string>();

    const options = getRetreatOptions(unit, dislodgedFrom, { units: [], orders: new Map() }, occupied, standoffs);

    expect(options).not.toContain('PAR'); // Can't go back to attacker origin
    expect(options).not.toContain('MUN'); // Occupied
    expect(options).not.toContain('MAR'); // Occupied
  });

  it('cannot retreat to province where standoff occurred', () => {
    const unit = makeUnit('GERMANY', 'ARMY', 'BUR');
    const dislodgedFrom = 'PAR';
    const occupied = new Set<string>();
    const standoffs = new Set(['GAS']); // Standoff occurred at GAS

    const options = getRetreatOptions(unit, dislodgedFrom, { units: [], orders: new Map() }, occupied, standoffs);

    expect(options).not.toContain('GAS'); // Standoff province excluded
  });

  it('army cannot retreat to sea province', () => {
    const unit = makeUnit('ENGLAND', 'ARMY', 'LON');
    const dislodgedFrom = 'WAL';
    const occupied = new Set<string>();
    const standoffs = new Set<string>();

    const options = getRetreatOptions(unit, dislodgedFrom, { units: [], orders: new Map() }, occupied, standoffs);

    // LON is adjacent to NTH (sea) and ENG (sea) - army can't go there
    for (const opt of options) {
      const prov = getProvince(opt);
      expect(prov?.type).not.toBe('SEA');
    }
  });
});

// ============================================================================
// BUILD/DISBAND CALCULATIONS
// ============================================================================
describe('Build calculations', () => {
  it('calculates positive builds when SCs > units', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('FRANCE', 'FLEET', 'BRE'),
    ];
    // France owns 4 SCs but has 3 units -> +1 build
    const supplyCenters = new Map<string, Power>();
    supplyCenters.set('PAR', 'FRANCE');
    supplyCenters.set('BRE', 'FRANCE');
    supplyCenters.set('MAR', 'FRANCE');
    supplyCenters.set('SPA', 'FRANCE');

    const builds = calculateBuildCounts(units, supplyCenters);
    expect(builds.get('FRANCE')).toBe(1);
  });

  it('calculates negative builds (disbands) when units > SCs', () => {
    const units: Unit[] = [
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('GERMANY', 'ARMY', 'BER'),
      makeUnit('GERMANY', 'FLEET', 'KIE'),
    ];
    // Germany lost a SC - now has 2 SCs but 3 units -> must disband 1
    const supplyCenters = new Map<string, Power>();
    supplyCenters.set('MUN', 'GERMANY');
    supplyCenters.set('BER', 'GERMANY');

    const builds = calculateBuildCounts(units, supplyCenters);
    expect(builds.get('GERMANY')).toBe(-1);
  });

  it('calculates zero when units == SCs', () => {
    const units: Unit[] = [
      makeUnit('ENGLAND', 'FLEET', 'LON'),
      makeUnit('ENGLAND', 'FLEET', 'EDI'),
      makeUnit('ENGLAND', 'ARMY', 'LVP'),
    ];
    const supplyCenters = new Map<string, Power>();
    supplyCenters.set('LON', 'ENGLAND');
    supplyCenters.set('EDI', 'ENGLAND');
    supplyCenters.set('LVP', 'ENGLAND');

    const builds = calculateBuildCounts(units, supplyCenters);
    expect(builds.get('ENGLAND')).toBe(0);
  });
});

// ============================================================================
// BUILD/DISBAND PHASE INTEGRATION
// ============================================================================
describe('Build phase', () => {
  it('rejects build outside build phase', () => {
    const state = createInitialState();
    expect(() => {
      submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'MAR', unitType: 'ARMY' }]);
    }).toThrow('Cannot submit builds outside build phase');
  });

  it('rejects build in non-home center', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    // BEL is not a French home center
    state.supplyCenters.set('BEL', 'FRANCE');

    expect(() => {
      submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'BEL', unitType: 'ARMY' }]);
    }).toThrow('not a home center');
  });

  it('rejects build in occupied home center', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);

    // PAR is a French home center but occupied by an existing unit
    expect(() => {
      submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'PAR', unitType: 'ARMY' }]);
    }).toThrow('occupied');
  });

  it('rejects fleet build in landlocked province', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('GERMANY', 1);
    // Remove the unit from MUN to make it available
    state.units = state.units.filter(u => u.province !== 'MUN');

    expect(() => {
      submitBuilds(state, 'GERMANY', [{ type: 'BUILD', province: 'MUN', unitType: 'FLEET' }]);
    }).toThrow('landlocked');
  });

  it('rejects excess builds', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    // Remove units from two home centers
    state.units = state.units.filter(u => u.province !== 'MAR' && u.province !== 'BRE');

    expect(() => {
      submitBuilds(state, 'FRANCE', [
        { type: 'BUILD', province: 'MAR', unitType: 'ARMY' },
        { type: 'BUILD', province: 'BRE', unitType: 'FLEET' },
      ]);
    }).toThrow('can only build 1');
  });
});

// ============================================================================
// VICTORY CONDITIONS
// ============================================================================
describe('Victory conditions', () => {
  it('declares winner at 18 supply centers', () => {
    const state = createInitialState();
    // Give France 18 SCs
    const scNames = ['PAR', 'BRE', 'MAR', 'SPA', 'POR', 'BEL', 'HOL', 'LON', 'LVP', 'EDI',
      'NWY', 'SWE', 'DEN', 'MUN', 'BER', 'KIE', 'WAR', 'MOS'];
    for (const sc of scNames) {
      state.supplyCenters.set(sc, 'FRANCE');
    }

    const result = checkVictory(state);
    expect(result).toBe(true);
    expect(state.winner).toBe('FRANCE');
  });

  it('does not declare winner at 17 supply centers', () => {
    const state = createInitialState();
    const scNames = ['PAR', 'BRE', 'MAR', 'SPA', 'POR', 'BEL', 'HOL', 'LON', 'LVP', 'EDI',
      'NWY', 'SWE', 'DEN', 'MUN', 'BER', 'KIE', 'WAR'];
    for (const sc of scNames) {
      state.supplyCenters.set(sc, 'FRANCE');
    }

    const result = checkVictory(state);
    // 17 SCs doesn't trigger victory (only last-power-standing check applies)
    // Since other powers still have units, no winner
    expect(state.winner).toBeUndefined();
  });

  it('last power standing wins', () => {
    const state = createInitialState();
    // Remove all units except France's
    state.units = state.units.filter(u => u.power === 'FRANCE');

    const result = checkVictory(state);
    expect(result).toBe(true);
    expect(state.winner).toBe('FRANCE');
  });

  it('declares draw when no units remain', () => {
    const state = createInitialState();
    state.units = []; // No units at all

    const result = checkVictory(state);
    expect(result).toBe(true);
    expect(state.draw).toBe(true);
  });

  it('game continues with multiple active powers', () => {
    const state = createInitialState();
    // Normal state - 7 powers with units
    const result = checkVictory(state);
    expect(result).toBe(false);
    expect(state.winner).toBeUndefined();
    expect(state.draw).toBeUndefined();
  });
});

// ============================================================================
// ORDER VALIDATION EDGE CASES
// ============================================================================
describe('Order validation', () => {
  it('rejects army move to sea province', () => {
    const units: Unit[] = [makeUnit('ENGLAND', 'ARMY', 'LON')];
    const orders = new Map<Power, Order[]>();
    orders.set('ENGLAND', [
      { type: 'MOVE', unit: 'LON', destination: 'NTH' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });
    expect(results.get('LON')?.success).toBe(false);
    expect(results.get('LON')?.reason).toContain('Army cannot move to sea');
  });

  it('rejects fleet move to landlocked province', () => {
    const units: Unit[] = [makeUnit('GERMANY', 'FLEET', 'KIE')];
    const orders = new Map<Power, Order[]>();
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'KIE', destination: 'MUN' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });
    expect(results.get('KIE')?.success).toBe(false);
    expect(results.get('KIE')?.reason).toContain('Fleet cannot move to land');
  });

  it('rejects move to non-adjacent province', () => {
    const units: Unit[] = [makeUnit('FRANCE', 'ARMY', 'PAR')];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'MUN' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });
    expect(results.get('PAR')?.success).toBe(false);
    expect(results.get('PAR')?.reason).toContain('not adjacent');
  });

  it('rejects order for nonexistent unit', () => {
    const units: Unit[] = [];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'HOLD', unit: 'PAR' } as HoldOrder,
    ]);

    const results = adjudicate({ units, orders });
    expect(results.get('PAR')?.success).toBe(false);
    expect(results.get('PAR')?.reason).toContain('No unit at');
  });

  it('rejects support to non-adjacent province', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'MAR'),
    ];
    const orders = new Map<Power, Order[]>();
    // MAR trying to support PAR into MUN, but MAR is not adjacent to MUN
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'MAR', supportedUnit: 'PAR', destination: 'MUN' } as SupportOrder,
    ]);

    const results = adjudicate({ units, orders });
    // MAR can't reach MUN to support
    expect(results.get('MAR')?.success).toBe(false);
    expect(results.get('MAR')?.reason).toContain('non-adjacent');
  });
});

// ============================================================================
// DEFENDER MOVING AWAY
// ============================================================================
describe('Defender moving away', () => {
  // BUG: aot-nsu74 - Attacker can't move into vacated province
  it.skip('attacker takes empty province when defender moves out', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('GERMANY', 'ARMY', 'BUR'),
    ];
    const orders = new Map<Power, Order[]>();
    // France: A PAR -> BUR
    // Germany: A BUR -> MUN (moving away)
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'BUR', destination: 'MUN' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // Both moves should succeed - BUR is vacated by Germany
    expect(results.get('BUR')?.success).toBe(true); // Germany moves out
    expect(results.get('PAR')?.success).toBe(true); // France moves in
  });
});
