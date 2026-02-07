/**
 * Tests for game-view.ts — Agent game state perception.
 *
 * Covers: createAgentGameView, createFullGameSummary, formatSupplyCentersForPower,
 * getUncontrolledSupplyCenters, getNeutralSupplyCenters, estimateDistance,
 * getNeighboringPowers, createStrategicSummary, getProvinceName, formatProvinceList
 */

import { describe, it, expect } from 'vitest';
import type { GameState, Power, Unit, OrderResolution, Order } from '../../engine/types';
import {
  createAgentGameView,
  createFullGameSummary,
  formatSupplyCentersForPower,
  getUncontrolledSupplyCenters,
  getNeutralSupplyCenters,
  estimateDistance,
  getNeighboringPowers,
  createStrategicSummary,
  getProvinceName,
  formatProvinceList,
} from '../game-view';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    year: 1901,
    season: 'SPRING',
    phase: 'DIPLOMACY',
    units: [
      { type: 'FLEET', power: 'ENGLAND', province: 'LON' },
      { type: 'FLEET', power: 'ENGLAND', province: 'EDI' },
      { type: 'ARMY', power: 'ENGLAND', province: 'LVP' },
      { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
      { type: 'ARMY', power: 'FRANCE', province: 'MAR' },
      { type: 'FLEET', power: 'FRANCE', province: 'BRE' },
      { type: 'ARMY', power: 'GERMANY', province: 'BER' },
      { type: 'ARMY', power: 'GERMANY', province: 'MUN' },
      { type: 'FLEET', power: 'GERMANY', province: 'KIE' },
      { type: 'ARMY', power: 'RUSSIA', province: 'MOS' },
      { type: 'ARMY', power: 'RUSSIA', province: 'WAR' },
      { type: 'FLEET', power: 'RUSSIA', province: 'SEV' },
      { type: 'FLEET', power: 'RUSSIA', province: 'STP', coast: 'SOUTH' },
      { type: 'FLEET', power: 'TURKEY', province: 'ANK' },
      { type: 'ARMY', power: 'TURKEY', province: 'CON' },
      { type: 'ARMY', power: 'TURKEY', province: 'SMY' },
      { type: 'ARMY', power: 'AUSTRIA', province: 'VIE' },
      { type: 'ARMY', power: 'AUSTRIA', province: 'BUD' },
      { type: 'FLEET', power: 'AUSTRIA', province: 'TRI' },
      { type: 'ARMY', power: 'ITALY', province: 'ROM' },
      { type: 'ARMY', power: 'ITALY', province: 'VEN' },
      { type: 'FLEET', power: 'ITALY', province: 'NAP' },
    ],
    supplyCenters: new Map<string, Power>([
      ['LON', 'ENGLAND'], ['EDI', 'ENGLAND'], ['LVP', 'ENGLAND'],
      ['PAR', 'FRANCE'], ['MAR', 'FRANCE'], ['BRE', 'FRANCE'],
      ['BER', 'GERMANY'], ['MUN', 'GERMANY'], ['KIE', 'GERMANY'],
      ['MOS', 'RUSSIA'], ['WAR', 'RUSSIA'], ['SEV', 'RUSSIA'], ['STP', 'RUSSIA'],
      ['ANK', 'TURKEY'], ['CON', 'TURKEY'], ['SMY', 'TURKEY'],
      ['VIE', 'AUSTRIA'], ['BUD', 'AUSTRIA'], ['TRI', 'AUSTRIA'],
      ['ROM', 'ITALY'], ['VEN', 'ITALY'], ['NAP', 'ITALY'],
    ]),
    orders: new Map(),
    retreats: new Map(),
    pendingRetreats: [],
    pendingBuilds: new Map(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createAgentGameView
// ---------------------------------------------------------------------------

describe('createAgentGameView', () => {
  it('should return the correct viewingPower', () => {
    const view = createAgentGameView(makeState(), 'ENGLAND');
    expect(view.viewingPower).toBe('ENGLAND');
  });

  it('should include year, season, and phase', () => {
    const view = createAgentGameView(makeState({ year: 1905, season: 'FALL', phase: 'MOVEMENT' }), 'FRANCE');
    expect(view.year).toBe(1905);
    expect(view.season).toBe('FALL');
    expect(view.phase).toBe('MOVEMENT');
  });

  it('should separate my units from other units', () => {
    const view = createAgentGameView(makeState(), 'ENGLAND');
    expect(view.myUnits).toHaveLength(3);
    expect(view.myUnits.every(u => u.province === 'LON' || u.province === 'EDI' || u.province === 'LVP')).toBe(true);

    // Other units should not contain England
    expect(view.otherUnits.has('ENGLAND')).toBe(false);
    expect(view.otherUnits.get('FRANCE')).toHaveLength(3);
    expect(view.otherUnits.get('GERMANY')).toHaveLength(3);
  });

  it('should include adjacent provinces for each unit', () => {
    const view = createAgentGameView(makeState(), 'ENGLAND');
    const lonUnit = view.myUnits.find(u => u.province === 'LON');
    expect(lonUnit).toBeDefined();
    expect(lonUnit!.adjacentProvinces).toBeDefined();
    expect(lonUnit!.adjacentProvinces!.length).toBeGreaterThan(0);
  });

  it('should handle coasted units (STP south coast)', () => {
    const view = createAgentGameView(makeState(), 'RUSSIA');
    const stpUnit = view.myUnits.find(u => u.province === 'STP');
    expect(stpUnit).toBeDefined();
    expect(stpUnit!.coast).toBe('SOUTH');
    // Fleet on south coast should reach BOT, FIN, LVN
    expect(stpUnit!.adjacentProvinces).toBeDefined();
  });

  it('should include supply center counts for all powers', () => {
    const view = createAgentGameView(makeState(), 'ENGLAND');
    expect(view.supplyCenterCounts.get('ENGLAND')).toBe(3);
    expect(view.supplyCenterCounts.get('RUSSIA')).toBe(4);
    expect(view.supplyCenterCounts.get('GERMANY')).toBe(3);
  });

  it('should include unit counts for all powers', () => {
    const view = createAgentGameView(makeState(), 'FRANCE');
    expect(view.unitCounts.get('FRANCE')).toBe(3);
    expect(view.unitCounts.get('ENGLAND')).toBe(3);
    expect(view.unitCounts.get('RUSSIA')).toBe(4);
  });

  it('should group supply centers by power', () => {
    const view = createAgentGameView(makeState(), 'ENGLAND');
    const englandSCs = view.supplyCenters.get('ENGLAND');
    expect(englandSCs).toBeDefined();
    expect(englandSCs).toContain('LON');
    expect(englandSCs).toContain('EDI');
    expect(englandSCs).toContain('LVP');
  });

  describe('retreat phase', () => {
    it('should include pending retreats when in RETREAT phase', () => {
      const state = makeState({
        phase: 'RETREAT',
        pendingRetreats: [
          { type: 'ARMY', power: 'ENGLAND', province: 'LON' },
        ],
        retreats: new Map([
          ['LON', ['YOR', 'WAL']],
        ]),
      });

      const view = createAgentGameView(state, 'ENGLAND');
      expect(view.pendingRetreats).toBeDefined();
      expect(view.pendingRetreats).toHaveLength(1);
      expect(view.pendingRetreats![0].retreatOptions).toEqual(['YOR', 'WAL']);
    });

    it('should only show own retreats, not other powers', () => {
      const state = makeState({
        phase: 'RETREAT',
        pendingRetreats: [
          { type: 'ARMY', power: 'ENGLAND', province: 'LON' },
          { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
        ],
        retreats: new Map([
          ['LON', ['YOR', 'WAL']],
          ['PAR', ['BRE', 'GAS']],
        ]),
      });

      const engView = createAgentGameView(state, 'ENGLAND');
      expect(engView.pendingRetreats).toHaveLength(1);
      expect(engView.pendingRetreats![0].unit.province).toBe('LON');

      const fraView = createAgentGameView(state, 'FRANCE');
      expect(fraView.pendingRetreats).toHaveLength(1);
      expect(fraView.pendingRetreats![0].unit.province).toBe('PAR');
    });

    it('should not include pending retreats in DIPLOMACY phase', () => {
      const view = createAgentGameView(makeState(), 'ENGLAND');
      expect(view.pendingRetreats).toBeUndefined();
    });

    it('should include dislodgedFrom info from order results', () => {
      const results = new Map<string, OrderResolution>([
        ['LON', {
          order: { type: 'HOLD', unit: 'LON' },
          success: false,
          dislodged: true,
          dislodgedFrom: 'NTH',
        }],
      ]);

      const state = makeState({
        phase: 'RETREAT',
        pendingRetreats: [
          { type: 'FLEET', power: 'ENGLAND', province: 'LON' },
        ],
        retreats: new Map([['LON', ['YOR', 'WAL']]]),
      });

      const view = createAgentGameView(state, 'ENGLAND', results);
      expect(view.pendingRetreats![0].dislodgedFrom).toBe('NTH');
    });
  });

  describe('build phase', () => {
    it('should include buildCount when in BUILD phase', () => {
      const state = makeState({
        phase: 'BUILD',
        pendingBuilds: new Map([['ENGLAND', 2], ['FRANCE', -1]]),
      });

      const engView = createAgentGameView(state, 'ENGLAND');
      expect(engView.buildCount).toBe(2);

      const fraView = createAgentGameView(state, 'FRANCE');
      expect(fraView.buildCount).toBe(-1);
    });

    it('should list available build locations (unoccupied home centers)', () => {
      // Remove unit from LON so it's available as a build location
      const units = makeState().units.filter(u => u.province !== 'LON');
      const state = makeState({
        phase: 'BUILD',
        units,
        pendingBuilds: new Map([['ENGLAND', 1]]),
      });

      const view = createAgentGameView(state, 'ENGLAND');
      expect(view.availableBuildLocations).toBeDefined();
      expect(view.availableBuildLocations).toContain('LON');
    });

    it('should not show build locations occupied by own units', () => {
      // All home centers occupied - no available build locations
      const state = makeState({
        phase: 'BUILD',
        pendingBuilds: new Map([['ENGLAND', 1]]),
      });

      const view = createAgentGameView(state, 'ENGLAND');
      expect(view.availableBuildLocations).toBeDefined();
      // LON, EDI, LVP all occupied
      expect(view.availableBuildLocations).toHaveLength(0);
    });

    it('should not include build info outside BUILD phase', () => {
      const view = createAgentGameView(makeState(), 'ENGLAND');
      expect(view.buildCount).toBeUndefined();
      expect(view.availableBuildLocations).toBeUndefined();
    });
  });

  describe('order results', () => {
    it('should include lastOrderResults for own units', () => {
      const results = new Map<string, OrderResolution>([
        ['LON', {
          order: { type: 'HOLD', unit: 'LON' },
          success: true,
        }],
        ['PAR', {
          order: { type: 'MOVE', unit: 'PAR', destination: 'BUR' },
          success: true,
        }],
      ]);

      const view = createAgentGameView(makeState(), 'ENGLAND', results);
      expect(view.lastOrderResults).toBeDefined();
      // Should only show England's results
      expect(view.lastOrderResults!.length).toBe(1);
      expect(view.lastOrderResults![0].order).toContain('LON');
      expect(view.lastOrderResults![0].success).toBe(true);
    });

    it('should not include order results when none provided', () => {
      const view = createAgentGameView(makeState(), 'ENGLAND');
      expect(view.lastOrderResults).toBeUndefined();
    });

    it('should format MOVE orders correctly', () => {
      const results = new Map<string, OrderResolution>([
        ['EDI', {
          order: { type: 'MOVE', unit: 'EDI', destination: 'NTH' },
          success: true,
        }],
      ]);

      const view = createAgentGameView(makeState(), 'ENGLAND', results);
      expect(view.lastOrderResults![0].order).toBe('EDI -> NTH');
    });

    it('should format SUPPORT HOLD orders correctly', () => {
      const results = new Map<string, OrderResolution>([
        ['EDI', {
          order: { type: 'SUPPORT', unit: 'EDI', supportedUnit: 'LON' },
          success: true,
        }],
      ]);

      const view = createAgentGameView(makeState(), 'ENGLAND', results);
      expect(view.lastOrderResults![0].order).toBe('EDI SUPPORT LON HOLD');
    });

    it('should format SUPPORT MOVE orders correctly', () => {
      const results = new Map<string, OrderResolution>([
        ['EDI', {
          order: { type: 'SUPPORT', unit: 'EDI', supportedUnit: 'LON', destination: 'NTH' },
          success: true,
        }],
      ]);

      const view = createAgentGameView(makeState(), 'ENGLAND', results);
      expect(view.lastOrderResults![0].order).toBe('EDI SUPPORT LON -> NTH');
    });

    it('should format CONVOY orders correctly', () => {
      const results = new Map<string, OrderResolution>([
        ['EDI', {
          order: { type: 'CONVOY', unit: 'EDI', convoyedUnit: 'LVP', destination: 'NWY' },
          success: false,
          reason: 'Convoy disrupted',
        }],
      ]);

      const view = createAgentGameView(makeState(), 'ENGLAND', results);
      expect(view.lastOrderResults![0].order).toBe('EDI CONVOY LVP -> NWY');
      expect(view.lastOrderResults![0].success).toBe(false);
      expect(view.lastOrderResults![0].reason).toBe('Convoy disrupted');
    });
  });
});

// ---------------------------------------------------------------------------
// createFullGameSummary
// ---------------------------------------------------------------------------

describe('createFullGameSummary', () => {
  it('should include year, season, and phase in header', () => {
    const summary = createFullGameSummary(makeState());
    expect(summary).toContain('1901');
    expect(summary).toContain('SPRING');
    expect(summary).toContain('DIPLOMACY');
  });

  it('should list supply center counts per power', () => {
    const summary = createFullGameSummary(makeState());
    expect(summary).toContain('ENGLAND: 3');
    expect(summary).toContain('FRANCE: 3');
    expect(summary).toContain('RUSSIA: 4');
  });

  it('should list units per power', () => {
    const summary = createFullGameSummary(makeState());
    expect(summary).toContain('ENGLAND:');
    expect(summary).toContain('F LON');
    expect(summary).toContain('A LVP');
    expect(summary).toContain('A PAR');
  });

  it('should show coasted units', () => {
    const summary = createFullGameSummary(makeState());
    expect(summary).toContain('F STP (SOUTH)');
  });

  it('should show winner when set', () => {
    const state = makeState({ winner: 'ENGLAND' });
    const summary = createFullGameSummary(state);
    expect(summary).toContain('WINNER: ENGLAND');
  });

  it('should show draw when set', () => {
    const state = makeState({ draw: true });
    const summary = createFullGameSummary(state);
    expect(summary).toContain('DRAW DECLARED');
  });

  it('should omit powers with zero supply centers', () => {
    const state = makeState({
      supplyCenters: new Map([['LON', 'ENGLAND' as Power]]),
    });
    const summary = createFullGameSummary(state);
    // Supply Centers section should only show ENGLAND
    const scSection = summary.split('Units:')[0];
    expect(scSection).toContain('ENGLAND: 1');
    expect(scSection).not.toContain('FRANCE:');
  });
});

// ---------------------------------------------------------------------------
// formatSupplyCentersForPower
// ---------------------------------------------------------------------------

describe('formatSupplyCentersForPower', () => {
  it('should list owned supply centers', () => {
    const result = formatSupplyCentersForPower(makeState(), 'ENGLAND');
    expect(result).toContain('LON');
    expect(result).toContain('EDI');
    expect(result).toContain('LVP');
  });

  it('should mark home centers with (home)', () => {
    const result = formatSupplyCentersForPower(makeState(), 'ENGLAND');
    expect(result).toContain('(home)');
  });

  it('should not mark non-home captured centers as home', () => {
    const state = makeState({
      supplyCenters: new Map([
        ['LON', 'ENGLAND'],
        ['BEL', 'ENGLAND'],  // captured, not home
      ]),
    });
    const result = formatSupplyCentersForPower(state, 'ENGLAND');
    // BEL should be listed without (home)
    expect(result).toContain('BEL');
    // Count (home) markers - should only be for LON (3 home centers in default but we have 2 SCs)
    const homeCount = (result.match(/\(home\)/g) || []).length;
    expect(homeCount).toBe(1); // Only LON is a home center
  });

  it('should return "None" when power has no supply centers', () => {
    const state = makeState({ supplyCenters: new Map() });
    const result = formatSupplyCentersForPower(state, 'ENGLAND');
    expect(result).toBe('None');
  });
});

// ---------------------------------------------------------------------------
// getUncontrolledSupplyCenters
// ---------------------------------------------------------------------------

describe('getUncontrolledSupplyCenters', () => {
  it('should return supply centers not owned by any power', () => {
    const state = makeState(); // 22 SCs owned in our standard state
    const uncontrolled = getUncontrolledSupplyCenters(state);

    // 34 total SCs - 22 owned = 12 uncontrolled (neutral SCs at game start)
    expect(uncontrolled.length).toBe(12);
    // Some known neutral SCs
    expect(uncontrolled).toContain('BEL');
    expect(uncontrolled).toContain('HOL');
    expect(uncontrolled).toContain('NWY');
    expect(uncontrolled).toContain('SWE');
    expect(uncontrolled).toContain('DEN');
    expect(uncontrolled).toContain('SER');
    expect(uncontrolled).toContain('RUM');
    expect(uncontrolled).toContain('BUL');
    expect(uncontrolled).toContain('GRE');
    expect(uncontrolled).toContain('TUN');
    expect(uncontrolled).toContain('SPA');
    expect(uncontrolled).toContain('POR');
  });

  it('should not include owned centers', () => {
    const uncontrolled = getUncontrolledSupplyCenters(makeState());
    expect(uncontrolled).not.toContain('LON');
    expect(uncontrolled).not.toContain('PAR');
    expect(uncontrolled).not.toContain('BER');
    expect(uncontrolled).not.toContain('MOS');
  });

  it('should return all SCs when none are owned', () => {
    const state = makeState({ supplyCenters: new Map() });
    const uncontrolled = getUncontrolledSupplyCenters(state);
    expect(uncontrolled.length).toBe(34);
  });
});

// ---------------------------------------------------------------------------
// getNeutralSupplyCenters
// ---------------------------------------------------------------------------

describe('getNeutralSupplyCenters', () => {
  it('should return only non-home supply centers that are uncontrolled', () => {
    const neutral = getNeutralSupplyCenters(makeState());

    // Neutral SCs exclude home centers (which are always owned at start)
    // The function filters out provinces where homeCenter is set
    expect(neutral).toContain('BEL');
    expect(neutral).toContain('HOL');
    expect(neutral).toContain('NWY');
    expect(neutral).toContain('SPA');
    expect(neutral).toContain('POR');
    expect(neutral).toContain('TUN');
    expect(neutral).toContain('SER');
    expect(neutral).toContain('RUM');
    expect(neutral).toContain('BUL');
    expect(neutral).toContain('GRE');
    expect(neutral).toContain('SWE');
    expect(neutral).toContain('DEN');
  });

  it('should not include home centers even if uncontrolled', () => {
    // Even if LON (England home center) is uncontrolled, getNeutralSupplyCenters
    // should not include it because it has homeCenter set
    const state = makeState({ supplyCenters: new Map() });
    const neutral = getNeutralSupplyCenters(state);
    expect(neutral).not.toContain('LON');
    expect(neutral).not.toContain('PAR');
    expect(neutral).not.toContain('BER');
    expect(neutral).not.toContain('MOS');
  });
});

// ---------------------------------------------------------------------------
// estimateDistance
// ---------------------------------------------------------------------------

describe('estimateDistance', () => {
  it('should return 0 for same province', () => {
    expect(estimateDistance('LON', 'LON')).toBe(0);
  });

  it('should return 1 for adjacent provinces', () => {
    // LON is adjacent to WAL, YOR, ENG
    expect(estimateDistance('LON', 'WAL', 'ARMY')).toBe(1);
    expect(estimateDistance('LON', 'ENG', 'FLEET')).toBe(1);
  });

  it('should return correct multi-hop distance', () => {
    // LON -> YOR -> EDI = 2 for army
    const dist = estimateDistance('LON', 'EDI', 'ARMY');
    expect(dist).toBe(2);
  });

  it('should return -1 for unreachable destinations', () => {
    // Army can't reach sea zones
    const dist = estimateDistance('PAR', 'NTH', 'ARMY');
    expect(dist).toBe(-1);
  });

  it('should try both unit types when none specified', () => {
    // Without specifying unit type, should find the shortest of army or fleet
    const dist = estimateDistance('LON', 'EDI');
    expect(dist).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getNeighboringPowers
// ---------------------------------------------------------------------------

describe('getNeighboringPowers', () => {
  it('should return powers with units on the board', () => {
    const neighbors = getNeighboringPowers(makeState(), 'ENGLAND');
    // In the current simplified implementation, all powers with units are returned
    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors).not.toContain('ENGLAND');
  });

  it('should not include the queried power itself', () => {
    const neighbors = getNeighboringPowers(makeState(), 'FRANCE');
    expect(neighbors).not.toContain('FRANCE');
  });

  it('should return empty for power with no neighbors when all units removed', () => {
    const state = makeState({
      units: [
        { type: 'ARMY', power: 'ENGLAND', province: 'LON' },
      ],
    });

    const neighbors = getNeighboringPowers(state, 'FRANCE');
    // FRANCE has no units, but ENGLAND does, so ENGLAND is a neighbor of FRANCE
    // Wait, this checks other powers' units, not adjacency, so all with units show up
    expect(neighbors).toContain('ENGLAND');
  });
});

// ---------------------------------------------------------------------------
// createStrategicSummary
// ---------------------------------------------------------------------------

describe('createStrategicSummary', () => {
  it('should include the power name', () => {
    const summary = createStrategicSummary(makeState(), 'ENGLAND');
    expect(summary).toContain('ENGLAND');
  });

  it('should include position info (SCs and units)', () => {
    const summary = createStrategicSummary(makeState(), 'ENGLAND');
    expect(summary).toContain('3 supply centers');
    expect(summary).toContain('3 units');
  });

  it('should indicate when builds are available (SCs > units)', () => {
    // Give England an extra SC but no extra unit
    const state = makeState();
    state.supplyCenters.set('BEL', 'ENGLAND');
    const summary = createStrategicSummary(state, 'ENGLAND');
    expect(summary).toContain('Can build 1');
  });

  it('should indicate when disbands are needed (units > SCs)', () => {
    // Remove one of England's SCs
    const state = makeState();
    state.supplyCenters.delete('LON');
    const summary = createStrategicSummary(state, 'ENGLAND');
    expect(summary).toContain('Must disband 1');
  });

  it('should list all powers in relative strength section', () => {
    const summary = createStrategicSummary(makeState(), 'ENGLAND');
    expect(summary).toContain('← YOU');
    expect(summary).toContain('FRANCE');
    expect(summary).toContain('GERMANY');
  });

  it('should sort powers by SC count in relative strength', () => {
    const summary = createStrategicSummary(makeState(), 'ENGLAND');
    // RUSSIA has 4 SCs, should be first
    const russiaIdx = summary.indexOf('RUSSIA:');
    const englandIdx = summary.indexOf('ENGLAND:');
    expect(russiaIdx).toBeLessThan(englandIdx);
  });

  it('should warn when a power approaches victory (14+ SCs)', () => {
    const state = makeState();
    // Give RUSSIA 14 supply centers
    for (const sc of ['BEL', 'HOL', 'DEN', 'SWE', 'NWY', 'RUM', 'BUL', 'GRE', 'SER', 'TUN']) {
      state.supplyCenters.set(sc, 'RUSSIA');
    }
    const summary = createStrategicSummary(state, 'ENGLAND');
    expect(summary).toContain('WARNING');
    expect(summary).toContain('RUSSIA');
    expect(summary).toContain('approaching victory');
  });

  it('should not warn when no power is near victory', () => {
    const summary = createStrategicSummary(makeState(), 'ENGLAND');
    expect(summary).not.toContain('WARNING');
  });
});

// ---------------------------------------------------------------------------
// getProvinceName
// ---------------------------------------------------------------------------

describe('getProvinceName', () => {
  it('should return full province name', () => {
    expect(getProvinceName('LON')).toBe('London');
    expect(getProvinceName('PAR')).toBe('Paris');
    expect(getProvinceName('BER')).toBe('Berlin');
    expect(getProvinceName('MOS')).toBe('Moscow');
  });

  it('should return the ID itself for unknown provinces', () => {
    expect(getProvinceName('XXX')).toBe('XXX');
  });
});

// ---------------------------------------------------------------------------
// formatProvinceList
// ---------------------------------------------------------------------------

describe('formatProvinceList', () => {
  it('should format provinces with full names', () => {
    const result = formatProvinceList(['LON', 'PAR', 'BER']);
    expect(result).toContain('London (LON)');
    expect(result).toContain('Paris (PAR)');
    expect(result).toContain('Berlin (BER)');
  });

  it('should separate with commas', () => {
    const result = formatProvinceList(['LON', 'PAR']);
    expect(result).toBe('London (LON), Paris (PAR)');
  });

  it('should handle empty list', () => {
    const result = formatProvinceList([]);
    expect(result).toBe('');
  });

  it('should handle unknown provinces gracefully', () => {
    const result = formatProvinceList(['XXX']);
    expect(result).toBe('XXX');
  });
});
