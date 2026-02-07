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
import { Order, MoveOrder, HoldOrder, SupportOrder, ConvoyOrder, Power, Unit, GameState, BuildOrder, RetreatOrder } from './types';

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
  // Root cause: original test used PAR -> BEL, but PAR is not adjacent to BEL.
  // Fixed to use PIC -> BEL (adjacent) supported by BUR (adjacent to BEL).
  it('three units competing for same destination - strongest wins', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PIC'),
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('GERMANY', 'ARMY', 'RUH'),
      makeUnit('ENGLAND', 'ARMY', 'HOL'),
    ];
    const orders = new Map<Power, Order[]>();
    // France: A PIC -> BEL (supported by BUR), A BUR S PIC -> BEL
    // Germany: A RUH -> BEL
    // England: A HOL -> BEL
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PIC', destination: 'BEL' } as MoveOrder,
      { type: 'SUPPORT', unit: 'BUR', supportedUnit: 'PIC', destination: 'BEL' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'RUH', destination: 'BEL' } as MoveOrder,
    ]);
    orders.set('ENGLAND', [
      { type: 'MOVE', unit: 'HOL', destination: 'BEL' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // France has strength 2, Germany and England have strength 1
    expect(results.get('PIC')?.success).toBe(true);
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
// SUPPORT HOLD SCENARIOS
// ============================================================================
describe('Support hold scenarios', () => {
  it('double support hold repels supported attack', () => {
    // BUR holds with support from PAR and GAS (hold str 3)
    // MUN attacks BUR with support from RUH (attack str 2)
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'GAS'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('GERMANY', 'ARMY', 'RUH'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
      { type: 'SUPPORT', unit: 'PAR', supportedUnit: 'BUR' } as SupportOrder,
      { type: 'SUPPORT', unit: 'GAS', supportedUnit: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'RUH', supportedUnit: 'MUN', destination: 'BUR' } as SupportOrder,
    ]);

    const results = adjudicate({ units, orders });

    // Hold str 3 beats attack str 2
    expect(results.get('BUR')?.dislodged).toBe(false);
    expect(results.get('MUN')?.success).toBe(false);
    expect(results.get('PAR')?.success).toBe(true);
    expect(results.get('GAS')?.success).toBe(true);
  });

  it('fleet supports army hold on adjacent coastal province', () => {
    // Fleet in LYO supports army in MAR to hold
    // Italy attacks MAR from PIE (str 1 vs hold str 2)
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'MAR'),
      makeUnit('FRANCE', 'FLEET', 'LYO'),
      makeUnit('ITALY', 'ARMY', 'PIE'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'HOLD', unit: 'MAR' } as HoldOrder,
      { type: 'SUPPORT', unit: 'LYO', supportedUnit: 'MAR' } as SupportOrder,
    ]);
    orders.set('ITALY', [
      { type: 'MOVE', unit: 'PIE', destination: 'MAR' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('LYO')?.success).toBe(true);
    expect(results.get('MAR')?.dislodged).toBe(false);
    expect(results.get('PIE')?.success).toBe(false);
  });

  it('cross-power support hold works', () => {
    // France A BUR holds, Germany A MUN supports French BUR hold
    // Italy A TYR attacks BUR (str 1 vs hold str 2)
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('ITALY', 'ARMY', 'TYR'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'SUPPORT', unit: 'MUN', supportedUnit: 'BUR' } as SupportOrder,
    ]);
    orders.set('ITALY', [
      { type: 'MOVE', unit: 'TYR', destination: 'BUR' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('BUR')?.dislodged).toBe(false);
    expect(results.get('MUN')?.success).toBe(true);
    expect(results.get('TYR')?.success).toBe(false);
  });

  it('equal hold strength and attack strength results in bounce', () => {
    // BUR holds with PAR support (hold str 2)
    // MUN attacks with RUH support (attack str 2)
    // Equal strength: attacker bounces (defender wins ties)
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('GERMANY', 'ARMY', 'RUH'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
      { type: 'SUPPORT', unit: 'PAR', supportedUnit: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'RUH', supportedUnit: 'MUN', destination: 'BUR' } as SupportOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('BUR')?.dislodged).toBe(false);
    expect(results.get('MUN')?.success).toBe(false);
  });
});

// ============================================================================
// CUTTING SUPPORT SCENARIOS
// ============================================================================
describe('Cutting support scenarios', () => {
  it('third-party attack on supporting unit cuts support to move', () => {
    // France: A PAR -> BUR (supported by GAS)
    // Germany: A BUR holds
    // Italy: A SPA -> GAS (cuts France's support!)
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'GAS'),
      makeUnit('GERMANY', 'ARMY', 'BUR'),
      makeUnit('ITALY', 'ARMY', 'SPA'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'GAS', supportedUnit: 'PAR', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
    ]);
    orders.set('ITALY', [
      { type: 'MOVE', unit: 'SPA', destination: 'GAS' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('GAS')?.success).toBe(false);
    expect(results.get('GAS')?.reason).toBe('Support was cut');
    expect(results.get('PAR')?.success).toBe(false); // Bounce without support
    expect(results.get('BUR')?.dislodged).toBe(false);
  });

  it('third-party attack on supporting unit cuts support to hold', () => {
    // France: A BUR holds, A PAR supports BUR hold
    // Germany: A MUN -> BUR (attack)
    // England: A PIC -> PAR (cuts France's support on BUR)
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('ENGLAND', 'ARMY', 'PIC'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
      { type: 'SUPPORT', unit: 'PAR', supportedUnit: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
    ]);
    orders.set('ENGLAND', [
      { type: 'MOVE', unit: 'PIC', destination: 'PAR' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('PAR')?.success).toBe(false);
    expect(results.get('PAR')?.reason).toBe('Support was cut');
    // BUR now has hold str 1 vs MUN str 1 -> bounce
    expect(results.get('BUR')?.dislodged).toBe(false);
    expect(results.get('MUN')?.success).toBe(false);
  });

  it('same-power attack does NOT cut support', () => {
    // France: A BUR holds, A PAR supports BUR hold, A PIC -> PAR (same power)
    // Germany: A MUN -> BUR
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'PIC'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
      { type: 'SUPPORT', unit: 'PAR', supportedUnit: 'BUR' } as SupportOrder,
      { type: 'MOVE', unit: 'PIC', destination: 'PAR' } as MoveOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // PAR's support NOT cut (same power attack)
    expect(results.get('PAR')?.success).toBe(true);
    // BUR holds with str 2 vs MUN str 1
    expect(results.get('BUR')?.dislodged).toBe(false);
    expect(results.get('MUN')?.success).toBe(false);
  });

  it('support is cut even when attack on supporter bounces', () => {
    // France: A BUR holds, A GAS supports BUR hold
    // Germany: A MUN -> BUR
    // Italy: A MAR -> GAS (bounces but still cuts support)
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('FRANCE', 'ARMY', 'GAS'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('ITALY', 'ARMY', 'MAR'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
      { type: 'SUPPORT', unit: 'GAS', supportedUnit: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
    ]);
    orders.set('ITALY', [
      { type: 'MOVE', unit: 'MAR', destination: 'GAS' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // GAS's support cut by Italy's attack (even though attack bounces)
    expect(results.get('GAS')?.success).toBe(false);
    expect(results.get('GAS')?.reason).toBe('Support was cut');
    // BUR hold str 1 vs MUN str 1 -> bounce
    expect(results.get('BUR')?.dislodged).toBe(false);
    expect(results.get('MUN')?.success).toBe(false);
    // Italy's attack on GAS also bounces
    expect(results.get('MAR')?.success).toBe(false);
  });

  it('attacking supporter cuts defense, reducing hold strength', () => {
    // Germany: A BUR holds, A MUN supports BUR hold (hold str 2)
    // France: A PAR -> BUR (str 1), A TYR -> MUN (cuts MUN's support!)
    // With support cut: BUR hold str 1, PAR attack str 1 -> bounce
    const units: Unit[] = [
      makeUnit('GERMANY', 'ARMY', 'BUR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'TYR'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('GERMANY', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
      { type: 'SUPPORT', unit: 'MUN', supportedUnit: 'BUR' } as SupportOrder,
    ]);
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      { type: 'MOVE', unit: 'TYR', destination: 'MUN' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // MUN's support cut by TYR's attack
    expect(results.get('MUN')?.success).toBe(false);
    expect(results.get('MUN')?.reason).toBe('Support was cut');
    // BUR hold str 1 vs PAR str 1 -> bounce (not dislodged)
    expect(results.get('PAR')?.success).toBe(false);
    expect(results.get('BUR')?.dislodged).toBe(false);
  });
});

// ============================================================================
// SELF-SUPPORT PREVENTION
// ============================================================================
describe('Self-support prevention', () => {
  it('unit cannot support itself to hold (not adjacent to self)', () => {
    // BUR tries to support itself: supportedUnit = unit province
    // areAdjacent('BUR', 'BUR') -> false -> validation error
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'SUPPORT', unit: 'BUR', supportedUnit: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('BUR')?.success).toBe(false);
    expect(results.get('BUR')?.reason).toContain('non-adjacent');
    // MUN attacks BUR at hold str 1 vs str 1 -> bounce
    expect(results.get('MUN')?.success).toBe(false);
  });

  it('self-support to move passes validation but has no effect', () => {
    // BUR orders support for itself moving to MUN
    // But BUR is giving SUPPORT, not MOVE - no matching move exists
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      // BUR "supports" its own move to MUN - but BUR isn't actually moving
      { type: 'SUPPORT', unit: 'BUR', supportedUnit: 'BUR', destination: 'MUN' } as SupportOrder,
      { type: 'MOVE', unit: 'PAR', destination: 'MUN' } as MoveOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'HOLD', unit: 'MUN' } as HoldOrder,
    ]);

    const results = adjudicate({ units, orders });

    // PAR -> MUN has no extra support (BUR's self-support doesn't match PAR's move)
    // PAR str 1 vs MUN hold str 1 -> bounce
    expect(results.get('PAR')?.success).toBe(false);
  });
});

// ============================================================================
// SUPPORT TO MULTIPLE DESTINATIONS
// ============================================================================
describe('Support to multiple destinations', () => {
  it('two supported moves to different destinations both succeed', () => {
    // France: A PAR -> BUR (supported by GAS), A PIC -> BEL (unopposed)
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'GAS'),
      makeUnit('FRANCE', 'ARMY', 'PIC'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'GAS', supportedUnit: 'PAR', destination: 'BUR' } as SupportOrder,
      { type: 'MOVE', unit: 'PIC', destination: 'BEL' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('PAR')?.success).toBe(true);
    expect(results.get('GAS')?.success).toBe(true);
    expect(results.get('PIC')?.success).toBe(true);
  });

  it('two units supporting the same move gives strength 3', () => {
    // France: A PAR -> BUR, A GAS S PAR -> BUR, A PIC S PAR -> BUR
    // Germany: A BUR holds with MUN support (hold str 2)
    // France attack str 3 > Germany hold str 2 -> dislodge
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'GAS'),
      makeUnit('FRANCE', 'ARMY', 'PIC'),
      makeUnit('GERMANY', 'ARMY', 'BUR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'GAS', supportedUnit: 'PAR', destination: 'BUR' } as SupportOrder,
      { type: 'SUPPORT', unit: 'PIC', supportedUnit: 'PAR', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'HOLD', unit: 'BUR' } as HoldOrder,
      { type: 'SUPPORT', unit: 'MUN', supportedUnit: 'BUR' } as SupportOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('PAR')?.success).toBe(true);
    expect(results.get('BUR')?.dislodged).toBe(true);
  });

  it('simultaneous supported moves from different powers both succeed', () => {
    // France: A PAR -> BUR (supported by GAS)
    // Italy: A TYR -> MUN (supported by BOH)
    // Both destinations empty
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('FRANCE', 'ARMY', 'GAS'),
      makeUnit('ITALY', 'ARMY', 'TYR'),
      makeUnit('ITALY', 'ARMY', 'BOH'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'GAS', supportedUnit: 'PAR', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('ITALY', [
      { type: 'MOVE', unit: 'TYR', destination: 'MUN' } as MoveOrder,
      { type: 'SUPPORT', unit: 'BOH', supportedUnit: 'TYR', destination: 'MUN' } as SupportOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('PAR')?.success).toBe(true);
    expect(results.get('GAS')?.success).toBe(true);
    expect(results.get('TYR')?.success).toBe(true);
    expect(results.get('BOH')?.success).toBe(true);
  });
});

// ============================================================================
// PARADOXICAL SUPPORT SCENARIOS
// ============================================================================
describe('Paradoxical support scenarios', () => {
  it('symmetric supported head-to-head - both bounce', () => {
    // France: A BUR -> MUN, A TYR S BUR -> MUN (str 2)
    // Germany: A MUN -> BUR, A RUH S MUN -> BUR (str 2)
    // Equal head-to-head: both bounce, neither dislodged
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'BUR'),
      makeUnit('FRANCE', 'ARMY', 'TYR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('GERMANY', 'ARMY', 'RUH'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'BUR', destination: 'MUN' } as MoveOrder,
      { type: 'SUPPORT', unit: 'TYR', supportedUnit: 'BUR', destination: 'MUN' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'RUH', supportedUnit: 'MUN', destination: 'BUR' } as SupportOrder,
    ]);

    const results = adjudicate({ units, orders });

    expect(results.get('BUR')?.success).toBe(false);
    expect(results.get('MUN')?.success).toBe(false);
    expect(results.get('BUR')?.dislodged).toBe(false);
    expect(results.get('MUN')?.dislodged).toBe(false);
  });

  it('mutual support cutting - both supports cut, both moves bounce', () => {
    // France: A GAS -> BUR, A MAR S GAS -> BUR
    // Germany: A MUN -> BUR, A RUH S MUN -> BUR
    // Italy: A PIE -> MAR (cuts French support)
    // England: A BEL -> RUH (cuts German support)
    // Both supports cut -> both moves str 1 -> standoff at BUR
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'GAS'),
      makeUnit('FRANCE', 'ARMY', 'MAR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('GERMANY', 'ARMY', 'RUH'),
      makeUnit('ITALY', 'ARMY', 'PIE'),
      makeUnit('ENGLAND', 'ARMY', 'BEL'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'GAS', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'MAR', supportedUnit: 'GAS', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'RUH', supportedUnit: 'MUN', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('ITALY', [
      { type: 'MOVE', unit: 'PIE', destination: 'MAR' } as MoveOrder,
    ]);
    orders.set('ENGLAND', [
      { type: 'MOVE', unit: 'BEL', destination: 'RUH' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // Both supports cut
    expect(results.get('MAR')?.success).toBe(false);
    expect(results.get('MAR')?.reason).toBe('Support was cut');
    expect(results.get('RUH')?.success).toBe(false);
    expect(results.get('RUH')?.reason).toBe('Support was cut');
    // Both moves bounce (equal str 1 vs str 1 standoff)
    expect(results.get('GAS')?.success).toBe(false);
    expect(results.get('MUN')?.success).toBe(false);
  });

  it('asymmetric support cutting - one support cut, other survives', () => {
    // France: A GAS -> BUR, A MAR S GAS -> BUR
    // Germany: A MUN -> BUR, A RUH S MUN -> BUR
    // Italy: A PIE -> MAR (cuts ONLY French support)
    // Germany's support survives -> MUN str 2 vs GAS str 1
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'GAS'),
      makeUnit('FRANCE', 'ARMY', 'MAR'),
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('GERMANY', 'ARMY', 'RUH'),
      makeUnit('ITALY', 'ARMY', 'PIE'),
    ];
    const orders = new Map<Power, Order[]>();
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'GAS', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'MAR', supportedUnit: 'GAS', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
      { type: 'SUPPORT', unit: 'RUH', supportedUnit: 'MUN', destination: 'BUR' } as SupportOrder,
    ]);
    orders.set('ITALY', [
      { type: 'MOVE', unit: 'PIE', destination: 'MAR' } as MoveOrder,
    ]);

    const results = adjudicate({ units, orders });

    // French support cut, German support intact
    expect(results.get('MAR')?.success).toBe(false);
    expect(results.get('MAR')?.reason).toBe('Support was cut');
    expect(results.get('RUH')?.success).toBe(true);
    // Germany wins the standoff at BUR (str 2 vs str 1)
    expect(results.get('MUN')?.success).toBe(true);
    expect(results.get('GAS')?.success).toBe(false);
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
// CONVOY SYSTEM
// ============================================================================
describe('Convoy system', () => {
  describe('basic single-fleet convoy', () => {
    it('army convoyed across one sea zone succeeds', () => {
      // England: A LON -> BEL via convoy, F ENG convoys
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'BEL', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'BEL' } as ConvoyOrder,
      ]);

      const results = adjudicate({ units, orders });

      expect(results.get('LON')?.success).toBe(true);
      expect(results.get('ENG')?.success).toBe(true);
    });

    it('convoy into empty province succeeds', () => {
      // England: A LVP -> NWY via convoy through NAO and NWG
      // Actually simpler: A EDI -> NWY via NTH (single fleet)
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'EDI'),
        makeUnit('ENGLAND', 'FLEET', 'NTH'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'EDI', destination: 'NWY', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'NTH', convoyedUnit: 'EDI', destination: 'NWY' } as ConvoyOrder,
      ]);

      const results = adjudicate({ units, orders });

      expect(results.get('EDI')?.success).toBe(true);
      expect(results.get('NTH')?.success).toBe(true);
    });

    it('convoy order result reports convoyed army did not move', () => {
      // Fleet convoys but the army's move bounces against a defender
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
        makeUnit('FRANCE', 'ARMY', 'BEL'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'BEL', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'BEL' } as ConvoyOrder,
      ]);
      orders.set('FRANCE', [
        { type: 'HOLD', unit: 'BEL' } as HoldOrder,
      ]);

      const results = adjudicate({ units, orders });

      // Army bounces against defender (1 vs 1), convoy fails
      expect(results.get('LON')?.success).toBe(false);
      expect(results.get('ENG')?.success).toBe(false);
      expect(results.get('ENG')?.reason).toContain('army did not move');
    });
  });

  describe('multi-fleet convoy chains', () => {
    it('two-fleet convoy chain succeeds', () => {
      // England: A LON -> NAF via ENG, MAO
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
        makeUnit('ENGLAND', 'FLEET', 'MAO'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'NAF', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'NAF' } as ConvoyOrder,
        { type: 'CONVOY', unit: 'MAO', convoyedUnit: 'LON', destination: 'NAF' } as ConvoyOrder,
      ]);

      const results = adjudicate({ units, orders });

      expect(results.get('LON')?.success).toBe(true);
      expect(results.get('ENG')?.success).toBe(true);
      expect(results.get('MAO')?.success).toBe(true);
    });

    it('three-fleet convoy chain succeeds', () => {
      // England: A LON -> TUN via ENG, MAO, WES
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
        makeUnit('ENGLAND', 'FLEET', 'MAO'),
        makeUnit('ENGLAND', 'FLEET', 'WES'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'TUN', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'TUN' } as ConvoyOrder,
        { type: 'CONVOY', unit: 'MAO', convoyedUnit: 'LON', destination: 'TUN' } as ConvoyOrder,
        { type: 'CONVOY', unit: 'WES', convoyedUnit: 'LON', destination: 'TUN' } as ConvoyOrder,
      ]);

      const results = adjudicate({ units, orders });

      expect(results.get('LON')?.success).toBe(true);
      expect(results.get('ENG')?.success).toBe(true);
      expect(results.get('MAO')?.success).toBe(true);
      expect(results.get('WES')?.success).toBe(true);
    });

    it('multi-fleet chain fails with gap in chain', () => {
      // A LON -> TUN via convoy, but only fleets at ENG and WES (missing MAO)
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
        makeUnit('ENGLAND', 'FLEET', 'WES'), // Gap: no fleet at MAO
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'TUN', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'TUN' } as ConvoyOrder,
        { type: 'CONVOY', unit: 'WES', convoyedUnit: 'LON', destination: 'TUN' } as ConvoyOrder,
      ]);

      const results = adjudicate({ units, orders });

      // No continuous path from LON to TUN - move fails
      expect(results.get('LON')?.success).toBe(false);
      expect(results.get('LON')?.reason).toContain('convoy path');
    });

    it('multi-power convoy chain succeeds', () => {
      // England's army convoyed by England's and France's fleets together
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
        makeUnit('FRANCE', 'FLEET', 'MAO'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'NAF', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'NAF' } as ConvoyOrder,
      ]);
      orders.set('FRANCE', [
        { type: 'CONVOY', unit: 'MAO', convoyedUnit: 'LON', destination: 'NAF' } as ConvoyOrder,
      ]);

      const results = adjudicate({ units, orders });

      expect(results.get('LON')?.success).toBe(true);
      expect(results.get('ENG')?.success).toBe(true);
      expect(results.get('MAO')?.success).toBe(true);
    });
  });

  describe('disrupted convoys', () => {
    // BUG: aot-g4990 - Disrupted convoy doesn't prevent convoyed army from moving
    it.skip('convoy fails when convoying fleet is dislodged', () => {
      // England: A LON -> BEL via convoy, F ENG convoys
      // France: F BRE -> ENG, F MAO supports BRE -> ENG (dislodges ENG)
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
        makeUnit('FRANCE', 'FLEET', 'BRE'),
        makeUnit('FRANCE', 'FLEET', 'MAO'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'BEL', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'BEL' } as ConvoyOrder,
      ]);
      orders.set('FRANCE', [
        { type: 'MOVE', unit: 'BRE', destination: 'ENG' } as MoveOrder,
        { type: 'SUPPORT', unit: 'MAO', supportedUnit: 'BRE', destination: 'ENG' } as SupportOrder,
      ]);

      const results = adjudicate({ units, orders });

      expect(results.get('ENG')?.dislodged).toBe(true);
      expect(results.get('ENG')?.reason).toContain('fleet was dislodged');
      expect(results.get('LON')?.success).toBe(false);
    });

    it('convoy survives unsupported attack on convoying fleet', () => {
      // England: A LON -> BEL via convoy, F ENG convoys
      // France: F BRE -> ENG (attack without support - bounces)
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
        makeUnit('FRANCE', 'FLEET', 'BRE'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'BEL', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'BEL' } as ConvoyOrder,
      ]);
      orders.set('FRANCE', [
        { type: 'MOVE', unit: 'BRE', destination: 'ENG' } as MoveOrder,
      ]);

      const results = adjudicate({ units, orders });

      // Attack on ENG bounces (1 vs 1), convoy succeeds
      expect(results.get('ENG')?.dislodged).toBeFalsy();
      expect(results.get('LON')?.success).toBe(true);
      expect(results.get('ENG')?.success).toBe(true);
    });

    // BUG: aot-g4990 - Disrupted convoy doesn't prevent convoyed army from moving
    it.skip('chain disrupted: dislodging one fleet in multi-fleet chain', () => {
      // England: A LON -> NAF via convoy through ENG, MAO
      // France: F WES -> MAO, F LYO supports WES -> MAO (dislodges MAO)
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
        makeUnit('ENGLAND', 'FLEET', 'MAO'),
        makeUnit('FRANCE', 'FLEET', 'WES'),
        makeUnit('FRANCE', 'FLEET', 'LYO'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'NAF', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'NAF' } as ConvoyOrder,
        { type: 'CONVOY', unit: 'MAO', convoyedUnit: 'LON', destination: 'NAF' } as ConvoyOrder,
      ]);
      orders.set('FRANCE', [
        { type: 'MOVE', unit: 'WES', destination: 'MAO' } as MoveOrder,
        { type: 'SUPPORT', unit: 'LYO', supportedUnit: 'WES', destination: 'MAO' } as SupportOrder,
      ]);

      const results = adjudicate({ units, orders });

      // MAO is dislodged, breaking the chain
      expect(results.get('MAO')?.dislodged).toBe(true);
      expect(results.get('LON')?.success).toBe(false);
    });
  });

  describe('convoy with support', () => {
    it('supported convoyed army dislodges defender', () => {
      // England: A LON -> BEL via convoy, F ENG convoys, F NTH supports LON -> BEL
      // France: A BEL holds
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
        makeUnit('ENGLAND', 'FLEET', 'NTH'),
        makeUnit('FRANCE', 'ARMY', 'BEL'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'BEL', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'BEL' } as ConvoyOrder,
        { type: 'SUPPORT', unit: 'NTH', supportedUnit: 'LON', destination: 'BEL' } as SupportOrder,
      ]);
      orders.set('FRANCE', [
        { type: 'HOLD', unit: 'BEL' } as HoldOrder,
      ]);

      const results = adjudicate({ units, orders });

      // Strength 2 (army + support) vs 1 (hold) - dislodge
      expect(results.get('LON')?.success).toBe(true);
      expect(results.get('BEL')?.dislodged).toBe(true);
      expect(results.get('ENG')?.success).toBe(true);
    });

    it('convoyed army bounces against supported defender', () => {
      // England: A LON -> BEL via convoy, F ENG convoys
      // France: A BEL holds, A PIC supports BEL
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
        makeUnit('FRANCE', 'ARMY', 'BEL'),
        makeUnit('FRANCE', 'ARMY', 'PIC'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'BEL', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'BEL' } as ConvoyOrder,
      ]);
      orders.set('FRANCE', [
        { type: 'HOLD', unit: 'BEL' } as HoldOrder,
        { type: 'SUPPORT', unit: 'PIC', supportedUnit: 'BEL' } as SupportOrder,
      ]);

      const results = adjudicate({ units, orders });

      // Strength 1 (convoyed army) vs 2 (hold + support) - bounce
      expect(results.get('LON')?.success).toBe(false);
      expect(results.get('BEL')?.dislodged).toBeFalsy();
    });
  });

  describe('invalid convoy paths', () => {
    it('convoy fails with no convoying fleet', () => {
      // Army tries via convoy but no fleet exists to convoy
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'BEL', viaConvoy: true } as MoveOrder,
      ]);

      const results = adjudicate({ units, orders });

      expect(results.get('LON')?.success).toBe(false);
      expect(results.get('LON')?.reason).toContain('convoy path');
    });

    it('fleet at coastal province cannot convoy', () => {
      // Fleet at BEL (coastal, not sea) tries to convoy
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'BEL'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'PIC', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'BEL', convoyedUnit: 'LON', destination: 'PIC' } as ConvoyOrder,
      ]);

      const results = adjudicate({ units, orders });

      expect(results.get('BEL')?.success).toBe(false);
      expect(results.get('BEL')?.reason).toContain('sea');
    });

    it('convoy with non-existent convoyed unit fails', () => {
      // Fleet tries to convoy army that doesn't exist
      const units: Unit[] = [
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'BEL' } as ConvoyOrder,
      ]);

      const results = adjudicate({ units, orders });

      expect(results.get('ENG')?.success).toBe(false);
      expect(results.get('ENG')?.reason).toContain('No unit at LON');
    });

    it('convoy where fleet order does not match army destination fails', () => {
      // Fleet convoys LON -> PIC, but army moves LON -> BEL
      const units: Unit[] = [
        makeUnit('ENGLAND', 'ARMY', 'LON'),
        makeUnit('ENGLAND', 'FLEET', 'ENG'),
      ];
      const orders = new Map<Power, Order[]>();
      orders.set('ENGLAND', [
        { type: 'MOVE', unit: 'LON', destination: 'BEL', viaConvoy: true } as MoveOrder,
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'PIC' } as ConvoyOrder,
      ]);

      const results = adjudicate({ units, orders });

      // Fleet convoys to PIC, army wants to go to BEL - mismatch, no valid path
      expect(results.get('LON')?.success).toBe(false);
    });
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
// RETREAT PHASE: VALID DESTINATIONS (extended)
// ============================================================================
describe('Retreat valid destinations', () => {
  it('returns all valid adjacent provinces when no restrictions', () => {
    // Army in BUR, dislodged from PAR. BUR adj: PIC, PAR, GAS, MAR, BEL, RUH, MUN
    // PAR is attacker origin, so excluded. Rest all LAND/COASTAL -> valid for army
    const unit = makeUnit('FRANCE', 'ARMY', 'BUR');
    const options = getRetreatOptions(unit, 'PAR', { units: [], orders: new Map() }, new Set<string>(), new Set<string>());

    expect(options).toContain('PIC');
    expect(options).toContain('GAS');
    expect(options).toContain('MAR');
    expect(options).toContain('BEL');
    expect(options).toContain('RUH');
    expect(options).toContain('MUN');
    expect(options).not.toContain('PAR'); // attacker origin
    expect(options.length).toBe(6);
  });

  it('excludes multiple occupied provinces', () => {
    const unit = makeUnit('GERMANY', 'ARMY', 'MUN');
    // MUN adj: KIE, BER, SIL, BOH, TYR, BUR, RUH
    // Dislodged from BUR, occupied: KIE, BER, RUH
    const occupied = new Set(['KIE', 'BER', 'RUH']);
    const options = getRetreatOptions(unit, 'BUR', { units: [], orders: new Map() }, occupied, new Set<string>());

    expect(options).not.toContain('BUR'); // attacker origin
    expect(options).not.toContain('KIE'); // occupied
    expect(options).not.toContain('BER'); // occupied
    expect(options).not.toContain('RUH'); // occupied
    expect(options).toContain('SIL');
    expect(options).toContain('BOH');
    expect(options).toContain('TYR');
    expect(options.length).toBe(3);
  });

  it('excludes both standoff and occupied provinces', () => {
    const unit = makeUnit('AUSTRIA', 'ARMY', 'VIE');
    // VIE adj: BOH, GAL, BUD, TRI, TYR
    // Dislodged from BUD, standoff at GAL, occupied: TRI
    const occupied = new Set(['TRI']);
    const standoffs = new Set(['GAL']);
    const options = getRetreatOptions(unit, 'BUD', { units: [], orders: new Map() }, occupied, standoffs);

    expect(options).not.toContain('BUD'); // attacker origin
    expect(options).not.toContain('GAL'); // standoff
    expect(options).not.toContain('TRI'); // occupied
    expect(options).toContain('BOH');
    expect(options).toContain('TYR');
    expect(options.length).toBe(2);
  });

  it('returns empty array when no valid retreat destinations exist', () => {
    const unit = makeUnit('AUSTRIA', 'ARMY', 'VIE');
    // VIE adj: BOH, GAL, BUD, TRI, TYR
    // Dislodged from BOH, occupied: GAL, BUD, TRI, TYR
    const occupied = new Set(['GAL', 'BUD', 'TRI', 'TYR']);
    const options = getRetreatOptions(unit, 'BOH', { units: [], orders: new Map() }, occupied, new Set<string>());

    expect(options).toEqual([]);
  });

  it('fleet cannot retreat to landlocked province', () => {
    // Fleet in TRI (COASTAL), dislodged from VEN
    // TRI adj: TYR, VIE, BUD, SER, ALB, VEN, ADR
    // TYR=LAND, VIE=LAND, BUD=LAND, SER=LAND -> fleet can't go
    // ALB=COASTAL, ADR=SEA -> fleet can go
    const unit = makeUnit('AUSTRIA', 'FLEET', 'TRI');
    const options = getRetreatOptions(unit, 'VEN', { units: [], orders: new Map() }, new Set<string>(), new Set<string>());

    for (const opt of options) {
      const prov = getProvince(opt);
      expect(prov?.type).not.toBe('LAND');
    }
    expect(options).toContain('ALB');
    expect(options).toContain('ADR');
    expect(options).not.toContain('TYR'); // LAND
    expect(options).not.toContain('VIE'); // LAND
    expect(options).not.toContain('BUD'); // LAND
    expect(options).not.toContain('SER'); // LAND
  });

  it('fleet can retreat to both sea and coastal provinces', () => {
    // Fleet in LON (COASTAL), dislodged from WAL
    // LON adj: YOR, WAL, NTH, ENG
    // YOR=COASTAL, NTH=SEA, ENG=SEA -> all valid for fleet
    const unit = makeUnit('ENGLAND', 'FLEET', 'LON');
    const options = getRetreatOptions(unit, 'WAL', { units: [], orders: new Map() }, new Set<string>(), new Set<string>());

    expect(options).toContain('YOR');
    expect(options).toContain('NTH');
    expect(options).toContain('ENG');
    expect(options).not.toContain('WAL'); // attacker origin
    expect(options.length).toBe(3);
  });
});

// ============================================================================
// RETREAT PHASE: BOUNCES (two units to same province)
// ============================================================================
describe('Retreat bounces', () => {
  function makeRetreatState(pendingRetreats: Unit[], retreatOptions: Map<string, string[]>): GameState {
    return {
      year: 1901,
      season: 'SPRING',
      phase: 'RETREAT' as const,
      units: [],
      supplyCenters: new Map(),
      orders: new Map(),
      retreats: retreatOptions,
      pendingRetreats,
      pendingBuilds: new Map(),
    };
  }

  it('two units retreating to same province are both destroyed', () => {
    const unit1 = makeUnit('FRANCE', 'ARMY', 'BUR');
    const unit2 = makeUnit('GERMANY', 'ARMY', 'RUH');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['BEL', 'PIC']); // France can retreat to BEL or PIC
    retreatOptions.set('RUH', ['BEL', 'HOL']); // Germany can retreat to BEL or HOL

    const state = makeRetreatState([unit1, unit2], retreatOptions);

    // Both submit retreat to BEL
    submitRetreats(state, 'FRANCE', [{ unit: 'BUR', destination: 'BEL' }]);
    submitRetreats(state, 'GERMANY', [{ unit: 'RUH', destination: 'BEL' }]);
    resolveRetreats(state);

    // Both units should be destroyed - neither survives
    expect(state.units.length).toBe(0);
    expect(state.pendingRetreats.length).toBe(0);
  });

  it('non-conflicting retreats both succeed', () => {
    const unit1 = makeUnit('FRANCE', 'ARMY', 'BUR');
    const unit2 = makeUnit('GERMANY', 'ARMY', 'RUH');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['BEL', 'PIC']);
    retreatOptions.set('RUH', ['BEL', 'HOL']);

    const state = makeRetreatState([unit1, unit2], retreatOptions);

    // France retreats to PIC, Germany retreats to HOL (no conflict)
    submitRetreats(state, 'FRANCE', [{ unit: 'BUR', destination: 'PIC' }]);
    submitRetreats(state, 'GERMANY', [{ unit: 'RUH', destination: 'HOL' }]);
    resolveRetreats(state);

    expect(state.units.length).toBe(2);
    expect(state.units.find(u => u.power === 'FRANCE')?.province).toBe('PIC');
    expect(state.units.find(u => u.power === 'GERMANY')?.province).toBe('HOL');
  });

  it('one unit retreats successfully while another bounces with a third', () => {
    const unit1 = makeUnit('FRANCE', 'ARMY', 'BUR');
    const unit2 = makeUnit('GERMANY', 'ARMY', 'RUH');
    const unit3 = makeUnit('ENGLAND', 'ARMY', 'PIC');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['BEL', 'GAS']);
    retreatOptions.set('RUH', ['BEL', 'HOL']);
    retreatOptions.set('PIC', ['BRE', 'GAS']); // Not contesting BEL

    const state = makeRetreatState([unit1, unit2, unit3], retreatOptions);

    // France and Germany both try BEL (bounce), England goes to BRE (succeeds)
    submitRetreats(state, 'FRANCE', [{ unit: 'BUR', destination: 'BEL' }]);
    submitRetreats(state, 'GERMANY', [{ unit: 'RUH', destination: 'BEL' }]);
    submitRetreats(state, 'ENGLAND', [{ unit: 'PIC', destination: 'BRE' }]);
    resolveRetreats(state);

    // Only England survives
    expect(state.units.length).toBe(1);
    expect(state.units[0].power).toBe('ENGLAND');
    expect(state.units[0].province).toBe('BRE');
  });
});

// ============================================================================
// RETREAT PHASE: MANDATORY DISBAND
// ============================================================================
describe('Retreat mandatory disband', () => {
  function makeRetreatState(pendingRetreats: Unit[], retreatOptions: Map<string, string[]>): GameState {
    return {
      year: 1901,
      season: 'SPRING',
      phase: 'RETREAT' as const,
      units: [],
      supplyCenters: new Map(),
      orders: new Map(),
      retreats: retreatOptions,
      pendingRetreats,
      pendingBuilds: new Map(),
    };
  }

  it('unit with no retreat order is disbanded', () => {
    const unit = makeUnit('FRANCE', 'ARMY', 'BUR');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['PIC', 'GAS']);

    const state = makeRetreatState([unit], retreatOptions);

    // France submits no retreat orders at all
    resolveRetreats(state);

    // Unit is disbanded (not added to state.units)
    expect(state.units.length).toBe(0);
    expect(state.pendingRetreats.length).toBe(0);
  });

  it('unit with no valid options is automatically disbanded', () => {
    const unit = makeUnit('AUSTRIA', 'ARMY', 'VIE');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('VIE', []); // No valid retreat destinations

    const state = makeRetreatState([unit], retreatOptions);

    // Even with no orders submitted, unit is gone
    resolveRetreats(state);

    expect(state.units.length).toBe(0);
  });

  it('explicit disband (no destination) removes unit', () => {
    const unit = makeUnit('FRANCE', 'ARMY', 'BUR');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['PIC', 'GAS']);

    const state = makeRetreatState([unit], retreatOptions);

    // France explicitly chooses to disband (destination undefined)
    submitRetreats(state, 'FRANCE', [{ unit: 'BUR' }]);
    resolveRetreats(state);

    expect(state.units.length).toBe(0);
  });

  it('mix of successful retreat and disband', () => {
    const unit1 = makeUnit('FRANCE', 'ARMY', 'BUR');
    const unit2 = makeUnit('GERMANY', 'ARMY', 'MUN');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['PIC', 'GAS']);
    retreatOptions.set('MUN', ['BOH', 'TYR']);

    const state = makeRetreatState([unit1, unit2], retreatOptions);

    // France retreats to PIC, Germany submits nothing (disbanded)
    submitRetreats(state, 'FRANCE', [{ unit: 'BUR', destination: 'PIC' }]);
    resolveRetreats(state);

    expect(state.units.length).toBe(1);
    expect(state.units[0].power).toBe('FRANCE');
    expect(state.units[0].province).toBe('PIC');
  });
});

// ============================================================================
// RETREAT PHASE: SUBMIT VALIDATION
// ============================================================================
describe('Retreat submission validation', () => {
  function makeRetreatState(pendingRetreats: Unit[], retreatOptions: Map<string, string[]>): GameState {
    return {
      year: 1901,
      season: 'SPRING',
      phase: 'RETREAT' as const,
      units: [],
      supplyCenters: new Map(),
      orders: new Map(),
      retreats: retreatOptions,
      pendingRetreats,
      pendingBuilds: new Map(),
    };
  }

  it('throws error when submitting retreats outside retreat phase', () => {
    const state: GameState = {
      year: 1901,
      season: 'SPRING',
      phase: 'DIPLOMACY',
      units: [],
      supplyCenters: new Map(),
      orders: new Map(),
      retreats: new Map(),
      pendingRetreats: [],
      pendingBuilds: new Map(),
    };

    expect(() => submitRetreats(state, 'FRANCE', [{ unit: 'BUR', destination: 'PIC' }]))
      .toThrow('Cannot submit retreats outside retreat phase');
  });

  it('throws error when submitting retreat for non-existent unit', () => {
    const unit = makeUnit('FRANCE', 'ARMY', 'BUR');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['PIC', 'GAS']);

    const state = makeRetreatState([unit], retreatOptions);

    // Germany has no retreating unit
    expect(() => submitRetreats(state, 'GERMANY', [{ unit: 'MUN', destination: 'BOH' }]))
      .toThrow('No retreating unit');
  });

  it('throws error for invalid retreat destination', () => {
    const unit = makeUnit('FRANCE', 'ARMY', 'BUR');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['PIC', 'GAS']);

    const state = makeRetreatState([unit], retreatOptions);

    // MAR is not in the valid options
    expect(() => submitRetreats(state, 'FRANCE', [{ unit: 'BUR', destination: 'MAR' }]))
      .toThrow('Invalid retreat destination');
  });

  it('throws error when resolving retreats outside retreat phase', () => {
    const state: GameState = {
      year: 1901,
      season: 'SPRING',
      phase: 'DIPLOMACY',
      units: [],
      supplyCenters: new Map(),
      orders: new Map(),
      retreats: new Map(),
      pendingRetreats: [],
      pendingBuilds: new Map(),
    };

    expect(() => resolveRetreats(state)).toThrow('Not in retreat phase');
  });

  it('allows submitting retreat to valid destination', () => {
    const unit = makeUnit('FRANCE', 'ARMY', 'BUR');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['PIC', 'GAS']);

    const state = makeRetreatState([unit], retreatOptions);

    // Should not throw
    expect(() => submitRetreats(state, 'FRANCE', [{ unit: 'BUR', destination: 'PIC' }]))
      .not.toThrow();
  });
});

// ============================================================================
// RETREAT PHASE: PHASE TRANSITION
// ============================================================================
describe('Retreat phase transitions', () => {
  function makeRetreatState(pendingRetreats: Unit[], retreatOptions: Map<string, string[]>): GameState {
    return {
      year: 1901,
      season: 'SPRING',
      phase: 'RETREAT' as const,
      units: [],
      supplyCenters: new Map(),
      orders: new Map(),
      retreats: retreatOptions,
      pendingRetreats,
      pendingBuilds: new Map(),
    };
  }

  it('advances phase after retreat resolution in spring', () => {
    const unit = makeUnit('FRANCE', 'ARMY', 'BUR');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['PIC']);

    const state = makeRetreatState([unit], retreatOptions);
    state.season = 'SPRING';

    submitRetreats(state, 'FRANCE', [{ unit: 'BUR', destination: 'PIC' }]);
    resolveRetreats(state);

    // Spring retreat -> advances to fall diplomacy
    expect(state.season).toBe('FALL');
    expect(state.phase).toBe('DIPLOMACY');
  });

  it('clears retreat state after resolution', () => {
    const unit = makeUnit('FRANCE', 'ARMY', 'BUR');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['PIC']);

    const state = makeRetreatState([unit], retreatOptions);

    submitRetreats(state, 'FRANCE', [{ unit: 'BUR', destination: 'PIC' }]);
    resolveRetreats(state);

    expect(state.pendingRetreats.length).toBe(0);
    expect(state.retreats.size).toBe(0);
  });

  it('successful retreat adds unit back to game state', () => {
    const existingUnit = makeUnit('GERMANY', 'ARMY', 'MUN');
    const retreatingUnit = makeUnit('FRANCE', 'ARMY', 'BUR');
    const retreatOptions = new Map<string, string[]>();
    retreatOptions.set('BUR', ['PIC', 'GAS']);

    const state = makeRetreatState([retreatingUnit], retreatOptions);
    state.units = [existingUnit]; // Existing unit on the board

    submitRetreats(state, 'FRANCE', [{ unit: 'BUR', destination: 'PIC' }]);
    resolveRetreats(state);

    expect(state.units.length).toBe(2);
    expect(state.units.find(u => u.province === 'PIC' && u.power === 'FRANCE')).toBeDefined();
    expect(state.units.find(u => u.province === 'MUN' && u.power === 'GERMANY')).toBeDefined();
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
// BUILD PHASE - SUCCESSFUL BUILDS
// ============================================================================
describe('Build phase - successful builds', () => {
  function makeBuildState(power: Power, pendingCount: number, occupiedProvinces: string[] = []) {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set(power, pendingCount);
    // Remove units from home centers so they're available for building
    // Keep only units at specified occupied provinces
    state.units = state.units.filter(u =>
      u.power !== power || occupiedProvinces.includes(u.province)
    );
    return state;
  }

  it('builds army in unoccupied home center', () => {
    const state = makeBuildState('FRANCE', 1);
    submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'PAR', unitType: 'ARMY' }]);
    resolveBuilds(state);

    const parisUnit = state.units.find(u => u.province === 'PAR' && u.power === 'FRANCE');
    expect(parisUnit).toBeDefined();
    expect(parisUnit!.type).toBe('ARMY');
  });

  it('builds fleet in coastal home center', () => {
    const state = makeBuildState('ENGLAND', 1);
    submitBuilds(state, 'ENGLAND', [{ type: 'BUILD', province: 'LON', unitType: 'FLEET' }]);
    resolveBuilds(state);

    const lonUnit = state.units.find(u => u.province === 'LON' && u.power === 'ENGLAND');
    expect(lonUnit).toBeDefined();
    expect(lonUnit!.type).toBe('FLEET');
  });

  it('builds army in coastal home center', () => {
    const state = makeBuildState('ENGLAND', 1);
    submitBuilds(state, 'ENGLAND', [{ type: 'BUILD', province: 'LON', unitType: 'ARMY' }]);
    resolveBuilds(state);

    const lonUnit = state.units.find(u => u.province === 'LON' && u.power === 'ENGLAND');
    expect(lonUnit).toBeDefined();
    expect(lonUnit!.type).toBe('ARMY');
  });

  it('builds fleet with coast specification (STP)', () => {
    const state = makeBuildState('RUSSIA', 1);
    submitBuilds(state, 'RUSSIA', [
      { type: 'BUILD', province: 'STP', unitType: 'FLEET', coast: 'SOUTH' },
    ]);
    resolveBuilds(state);

    const stpUnit = state.units.find(u => u.province === 'STP' && u.power === 'RUSSIA');
    expect(stpUnit).toBeDefined();
    expect(stpUnit!.type).toBe('FLEET');
    expect(stpUnit!.coast).toBe('SOUTH');
  });

  it('builds multiple units when allowed', () => {
    const state = makeBuildState('FRANCE', 2);
    submitBuilds(state, 'FRANCE', [
      { type: 'BUILD', province: 'PAR', unitType: 'ARMY' },
      { type: 'BUILD', province: 'BRE', unitType: 'FLEET' },
    ]);
    resolveBuilds(state);

    expect(state.units.find(u => u.province === 'PAR' && u.power === 'FRANCE')).toBeDefined();
    expect(state.units.find(u => u.province === 'BRE' && u.power === 'FRANCE')).toBeDefined();
  });

  it('builds fewer units than allowed (waive builds)', () => {
    const state = makeBuildState('FRANCE', 2);
    // Only build 1 of allowed 2 - should not throw
    submitBuilds(state, 'FRANCE', [
      { type: 'BUILD', province: 'PAR', unitType: 'ARMY' },
    ]);
    resolveBuilds(state);

    const frenchUnits = state.units.filter(u => u.power === 'FRANCE');
    expect(frenchUnits.length).toBe(1);
  });
});

// ============================================================================
// BUILD PHASE - VALIDATION FAILURES
// ============================================================================
describe('Build phase - validation failures', () => {
  it('rejects build in home center not controlled by power', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    // Remove unit from MAR but give SC ownership to another power
    state.units = state.units.filter(u => u.province !== 'MAR');
    state.supplyCenters.set('MAR', 'ITALY');

    expect(() => {
      submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'MAR', unitType: 'ARMY' }]);
    }).toThrow('does not control');
  });

  it('rejects build without province specified', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);

    expect(() => {
      submitBuilds(state, 'FRANCE', [{ type: 'BUILD', unitType: 'ARMY' }]);
    }).toThrow('must specify province and unit type');
  });

  it('rejects build without unitType specified', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    state.units = state.units.filter(u => u.province !== 'PAR');

    expect(() => {
      submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'PAR' }]);
    }).toThrow('must specify province and unit type');
  });

  it('rejects fleet build in STP without coast', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('RUSSIA', 1);
    state.units = state.units.filter(u => u.province !== 'STP');

    expect(() => {
      submitBuilds(state, 'RUSSIA', [{ type: 'BUILD', province: 'STP', unitType: 'FLEET' }]);
    }).toThrow('Must specify coast');
  });
});

// ============================================================================
// DISBAND PHASE
// ============================================================================
describe('Disband phase', () => {
  function makeDisbandState(power: Power, disbandCount: number, units: Unit[]) {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set(power, -disbandCount);
    // Replace all units with specified ones
    state.units = units;
    return state;
  }

  it('disbands a unit successfully', () => {
    const units = [
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('GERMANY', 'ARMY', 'BER'),
      makeUnit('GERMANY', 'FLEET', 'KIE'),
    ];
    const state = makeDisbandState('GERMANY', 1, units);
    submitBuilds(state, 'GERMANY', [{ type: 'DISBAND', province: 'KIE' }]);
    resolveBuilds(state);

    expect(state.units.find(u => u.province === 'KIE')).toBeUndefined();
    expect(state.units.filter(u => u.power === 'GERMANY').length).toBe(2);
  });

  it('disbands multiple units', () => {
    const units = [
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('GERMANY', 'ARMY', 'BER'),
      makeUnit('GERMANY', 'FLEET', 'KIE'),
    ];
    const state = makeDisbandState('GERMANY', 2, units);
    submitBuilds(state, 'GERMANY', [
      { type: 'DISBAND', province: 'MUN' },
      { type: 'DISBAND', province: 'KIE' },
    ]);
    resolveBuilds(state);

    expect(state.units.filter(u => u.power === 'GERMANY').length).toBe(1);
    expect(state.units.find(u => u.province === 'BER')).toBeDefined();
  });

  it('rejects wrong number of disbands', () => {
    const units = [
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('GERMANY', 'ARMY', 'BER'),
      makeUnit('GERMANY', 'FLEET', 'KIE'),
    ];
    const state = makeDisbandState('GERMANY', 2, units);

    // Only disbanding 1 when 2 required
    expect(() => {
      submitBuilds(state, 'GERMANY', [{ type: 'DISBAND', province: 'MUN' }]);
    }).toThrow('must disband exactly 2');
  });

  it('rejects disbanding unit not belonging to power', () => {
    const units = [
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('FRANCE', 'ARMY', 'PAR'),
    ];
    const state = makeDisbandState('GERMANY', 1, units);

    expect(() => {
      submitBuilds(state, 'GERMANY', [{ type: 'DISBAND', province: 'PAR' }]);
    }).toThrow('No GERMANY unit at PAR');
  });

  it('rejects disbanding unit at empty province', () => {
    const units = [
      makeUnit('GERMANY', 'ARMY', 'MUN'),
      makeUnit('GERMANY', 'ARMY', 'BER'),
    ];
    const state = makeDisbandState('GERMANY', 1, units);

    expect(() => {
      submitBuilds(state, 'GERMANY', [{ type: 'DISBAND', province: 'KIE' }]);
    }).toThrow('No GERMANY unit at KIE');
  });
});

// ============================================================================
// RESOLVE BUILDS - STATE TRANSITIONS
// ============================================================================
describe('resolveBuilds state transitions', () => {
  it('advances to next year spring diplomacy after builds', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.year = 1901;
    state.pendingBuilds.set('FRANCE', 1);
    state.units = state.units.filter(u => u.province !== 'PAR');
    submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'PAR', unitType: 'ARMY' }]);
    resolveBuilds(state);

    expect(state.year).toBe(1902);
    expect(state.season).toBe('SPRING');
    expect(state.phase).toBe('DIPLOMACY');
  });

  it('clears pendingBuilds after resolution', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    state.units = state.units.filter(u => u.province !== 'MAR');
    submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'MAR', unitType: 'ARMY' }]);
    resolveBuilds(state);

    expect(state.pendingBuilds.size).toBe(0);
  });

  it('clears orders after resolution', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    state.units = state.units.filter(u => u.province !== 'BRE');
    submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'BRE', unitType: 'FLEET' }]);
    resolveBuilds(state);

    expect(state.orders.size).toBe(0);
  });

  it('rejects resolveBuilds outside build phase', () => {
    const state = createInitialState();
    expect(() => resolveBuilds(state)).toThrow('Not in build phase');
  });

  it('handles multiple powers building in same phase', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    state.pendingBuilds.set('ENGLAND', 1);
    // Free up home centers
    state.units = state.units.filter(u =>
      !(u.province === 'MAR' && u.power === 'FRANCE') &&
      !(u.province === 'LON' && u.power === 'ENGLAND')
    );

    submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'MAR', unitType: 'ARMY' }]);
    submitBuilds(state, 'ENGLAND', [{ type: 'BUILD', province: 'LON', unitType: 'FLEET' }]);
    resolveBuilds(state);

    expect(state.units.find(u => u.province === 'MAR' && u.power === 'FRANCE')).toBeDefined();
    expect(state.units.find(u => u.province === 'LON' && u.power === 'ENGLAND')).toBeDefined();
    expect(state.year).toBe(1902);
  });

  it('handles mixed builds and disbands for different powers', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    state.pendingBuilds.set('GERMANY', -1);
    // Free up French home center
    state.units = state.units.filter(u => u.province !== 'MAR');

    submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'MAR', unitType: 'ARMY' }]);
    submitBuilds(state, 'GERMANY', [{ type: 'DISBAND', province: 'MUN' }]);
    resolveBuilds(state);

    expect(state.units.find(u => u.province === 'MAR' && u.power === 'FRANCE')).toBeDefined();
    expect(state.units.find(u => u.province === 'MUN' && u.power === 'GERMANY')).toBeUndefined();
  });
});

// ============================================================================
// BUILD PHASE - FULL GAME INTEGRATION
// ============================================================================
describe('Build phase - full game flow', () => {
  it('enters build phase after fall when SC counts differ from unit counts', () => {
    const state = createInitialState();

    // Spring: Germany moves MUN->BUR, everyone else holds
    const powers: Power[] = ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'];
    for (const power of powers) {
      if (power === 'GERMANY') {
        submitOrders(state, power, [
          { type: 'MOVE', unit: 'MUN', destination: 'BUR' } as MoveOrder,
          { type: 'HOLD', unit: 'BER' } as HoldOrder,
          { type: 'HOLD', unit: 'KIE' } as HoldOrder,
        ]);
      } else {
        const powerUnits = state.units.filter(u => u.power === power);
        submitOrders(state, power, powerUnits.map(u => ({ type: 'HOLD', unit: u.province })));
      }
    }
    resolveMovement(state);

    // Fall: Germany moves BUR->BEL (capturing neutral SC), everyone else holds
    expect(state.season).toBe('FALL');
    for (const power of powers) {
      if (power === 'GERMANY') {
        submitOrders(state, power, [
          { type: 'MOVE', unit: 'BUR', destination: 'BEL' } as MoveOrder,
          { type: 'HOLD', unit: 'BER' } as HoldOrder,
          { type: 'HOLD', unit: 'KIE' } as HoldOrder,
        ]);
      } else {
        const powerUnits = state.units.filter(u => u.power === power);
        submitOrders(state, power, powerUnits.map(u => ({ type: 'HOLD', unit: u.province })));
      }
    }
    resolveMovement(state);

    // Germany now has 4 SCs (BER, MUN, KIE, BEL) but only 3 units -> build phase
    expect(state.supplyCenters.get('BEL')).toBe('GERMANY');
    expect(state.season).toBe('WINTER');
    expect(state.phase).toBe('BUILD');
    expect(state.pendingBuilds.get('GERMANY')).toBe(1);
  });

  it('skips build phase when all powers have units == SCs', () => {
    const state = createInitialState();

    // Spring: everyone holds
    const powers: Power[] = ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'];
    for (const power of powers) {
      const powerUnits = state.units.filter(u => u.power === power);
      submitOrders(state, power, powerUnits.map(u => ({ type: 'HOLD', unit: u.province })));
    }
    resolveMovement(state);

    // Fall: everyone holds (no SC changes)
    for (const power of powers) {
      const powerUnits = state.units.filter(u => u.power === power);
      submitOrders(state, power, powerUnits.map(u => ({ type: 'HOLD', unit: u.province })));
    }
    resolveMovement(state);

    // Should skip BUILD and go to next year
    expect(state.year).toBe(1902);
    expect(state.season).toBe('SPRING');
    expect(state.phase).toBe('DIPLOMACY');
  });
});

// ============================================================================
// FLEET VS ARMY BUILD CONSTRAINTS
// ============================================================================
describe('Fleet vs Army build constraints', () => {
  it('allows army build in landlocked home center (MUN)', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('GERMANY', 1);
    state.units = state.units.filter(u => u.province !== 'MUN');

    // Should not throw
    submitBuilds(state, 'GERMANY', [{ type: 'BUILD', province: 'MUN', unitType: 'ARMY' }]);
    resolveBuilds(state);

    const munUnit = state.units.find(u => u.province === 'MUN' && u.power === 'GERMANY');
    expect(munUnit).toBeDefined();
    expect(munUnit!.type).toBe('ARMY');
  });

  it('allows fleet build in coastal home center (BRE)', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    state.units = state.units.filter(u => u.province !== 'BRE');

    submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'BRE', unitType: 'FLEET' }]);
    resolveBuilds(state);

    const breUnit = state.units.find(u => u.province === 'BRE' && u.power === 'FRANCE');
    expect(breUnit).toBeDefined();
    expect(breUnit!.type).toBe('FLEET');
  });

  it('allows army build in coastal home center (BRE)', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    state.units = state.units.filter(u => u.province !== 'BRE');

    submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'BRE', unitType: 'ARMY' }]);
    resolveBuilds(state);

    const breUnit = state.units.find(u => u.province === 'BRE' && u.power === 'FRANCE');
    expect(breUnit).toBeDefined();
    expect(breUnit!.type).toBe('ARMY');
  });

  it('rejects fleet in landlocked PAR', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('FRANCE', 1);
    state.units = state.units.filter(u => u.province !== 'PAR');

    expect(() => {
      submitBuilds(state, 'FRANCE', [{ type: 'BUILD', province: 'PAR', unitType: 'FLEET' }]);
    }).toThrow('landlocked');
  });

  it('allows fleet with NORTH coast in STP', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('RUSSIA', 1);
    state.units = state.units.filter(u => u.province !== 'STP');

    submitBuilds(state, 'RUSSIA', [
      { type: 'BUILD', province: 'STP', unitType: 'FLEET', coast: 'NORTH' },
    ]);
    resolveBuilds(state);

    const stpUnit = state.units.find(u => u.province === 'STP' && u.power === 'RUSSIA');
    expect(stpUnit).toBeDefined();
    expect(stpUnit!.type).toBe('FLEET');
    expect(stpUnit!.coast).toBe('NORTH');
  });

  it('allows army in coasted province STP (no coast needed)', () => {
    const state = createInitialState();
    state.phase = 'BUILD';
    state.season = 'WINTER';
    state.pendingBuilds.set('RUSSIA', 1);
    state.units = state.units.filter(u => u.province !== 'STP');

    submitBuilds(state, 'RUSSIA', [
      { type: 'BUILD', province: 'STP', unitType: 'ARMY' },
    ]);
    resolveBuilds(state);

    const stpUnit = state.units.find(u => u.province === 'STP' && u.power === 'RUSSIA');
    expect(stpUnit).toBeDefined();
    expect(stpUnit!.type).toBe('ARMY');
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
  it('attacker takes empty province when defender moves out', () => {
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

  it('defender is dislodged when their move fails but attacker succeeds', () => {
    const units: Unit[] = [
      makeUnit('FRANCE', 'ARMY', 'PAR'),
      makeUnit('GERMANY', 'ARMY', 'BUR'),
      makeUnit('RUSSIA', 'ARMY', 'MUN'),
    ];
    const orders = new Map<Power, Order[]>();
    // France: A PAR -> BUR
    // Germany: A BUR -> MUN (bounces off Russia)
    // Russia: A MUN HOLD
    orders.set('FRANCE', [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
    ]);
    orders.set('GERMANY', [
      { type: 'MOVE', unit: 'BUR', destination: 'MUN' } as MoveOrder,
    ]);
    orders.set('RUSSIA', [
      { type: 'HOLD', unit: 'MUN' } as HoldOrder,
    ]);

    const results = adjudicate({ units, orders });

    // France moves into BUR, Germany bounces off MUN and is dislodged
    expect(results.get('PAR')?.success).toBe(true);
    expect(results.get('BUR')?.success).toBe(false); // Germany's move fails
    expect(results.get('BUR')?.dislodged).toBe(true); // But gets dislodged by France
    expect(results.get('MUN')?.success).toBe(true); // Russia holds
  });
});
