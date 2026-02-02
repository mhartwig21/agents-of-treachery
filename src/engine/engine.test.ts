import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  submitOrders,
  resolveMovement,
  getProvince,
  getSupplyCenters,
  getHomeCenters,
  areAdjacent,
  PROVINCES,
  ADJACENCIES,
  adjudicate,
  getSupplyCenterCounts,
  getUnitCounts,
} from './index';
import { Order, MoveOrder, HoldOrder, SupportOrder, Power } from './types';

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
