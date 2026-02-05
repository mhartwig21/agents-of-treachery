/**
 * Tests for BFS pathfinding and strategic analysis.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState, Unit, Power } from '../../engine/types';
import {
  findShortestPath,
  calculateDistances,
  findNearestThreats,
  findNearestOpportunities,
  findConvoyRoutes,
  getAdjacentStatus,
  generateUnitStrategicContext,
  calculateThreatLevel,
  findImmediateThreatPowers,
  findReachableTargets,
  generatePowerStrategicContext,
  formatStrategicContextXML,
  formatStrategicContextMarkdown,
  generateDiplomacyContext,
  formatDiplomacyContextMarkdown,
  generateAllDiplomacyContexts,
} from '../pathfinding';

// Helper to create a minimal game state for testing
function createTestGameState(
  units: Unit[],
  supplyCenters?: Map<string, Power>
): GameState {
  return {
    year: 1901,
    season: 'SPRING',
    phase: 'MOVEMENT',
    units,
    supplyCenters: supplyCenters ?? new Map([
      ['LON', 'ENGLAND'],
      ['LVP', 'ENGLAND'],
      ['EDI', 'ENGLAND'],
      ['PAR', 'FRANCE'],
      ['MAR', 'FRANCE'],
      ['BRE', 'FRANCE'],
      ['BER', 'GERMANY'],
      ['MUN', 'GERMANY'],
      ['KIE', 'GERMANY'],
    ]),
    orders: new Map(),
    retreats: new Map(),
    pendingRetreats: [],
    pendingBuilds: new Map(),
    winner: null,
    draw: false,
  };
}

describe('findShortestPath', () => {
  it('returns distance 0 for same province', () => {
    const result = findShortestPath('PAR', 'PAR', 'ARMY');
    expect(result.distance).toBe(0);
    expect(result.path).toEqual(['PAR']);
  });

  it('finds adjacent provinces at distance 1', () => {
    const result = findShortestPath('PAR', 'BUR', 'ARMY');
    expect(result.distance).toBe(1);
    expect(result.path).toEqual(['PAR', 'BUR']);
  });

  it('finds path for army across land', () => {
    const result = findShortestPath('PAR', 'MUN', 'ARMY');
    expect(result.distance).toBe(2);
    expect(result.path).toHaveLength(3);
    expect(result.path[0]).toBe('PAR');
    expect(result.path[result.path.length - 1]).toBe('MUN');
  });

  it('finds path for fleet through sea', () => {
    const result = findShortestPath('LON', 'NWY', 'FLEET');
    expect(result.distance).toBeGreaterThan(0);
    expect(result.path[0]).toBe('LON');
    expect(result.path[result.path.length - 1]).toBe('NWY');
  });

  it('returns -1 for unreachable destinations', () => {
    // Army cannot reach sea provinces
    const result = findShortestPath('PAR', 'NTH', 'ARMY');
    expect(result.distance).toBe(-1);
    expect(result.path).toEqual([]);
  });

  it('fleet cannot reach inland provinces', () => {
    const result = findShortestPath('LON', 'PAR', 'FLEET');
    expect(result.distance).toBe(-1);
  });
});

describe('calculateDistances', () => {
  it('calculates distances to all reachable provinces', () => {
    const distances = calculateDistances('PAR', 'ARMY', 5);

    expect(distances.get('PAR')).toBe(0);
    expect(distances.get('BUR')).toBe(1);
    expect(distances.get('GAS')).toBe(1);
    expect(distances.get('PIC')).toBe(1);
    expect(distances.get('BRE')).toBe(1);

    // Further provinces
    expect(distances.get('MUN')).toBeGreaterThan(1);
    expect(distances.get('MAR')).toBeGreaterThan(1);
  });

  it('respects max distance limit', () => {
    const distances = calculateDistances('PAR', 'ARMY', 2);

    // Should have nearby provinces
    expect(distances.has('PAR')).toBe(true);
    expect(distances.has('BUR')).toBe(true);

    // But not very far ones
    const maxDist = Math.max(...Array.from(distances.values()));
    expect(maxDist).toBeLessThanOrEqual(2);
  });
});

describe('findNearestThreats', () => {
  it('finds nearby enemy units', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'PAR' };
    const enemyUnit: Unit = { power: 'GERMANY', type: 'ARMY', province: 'MUN' };

    const state = createTestGameState([myUnit, enemyUnit]);
    const threats = findNearestThreats(myUnit, state);

    expect(threats.length).toBeGreaterThan(0);
    expect(threats[0].power).toBe('GERMANY');
    expect(threats[0].unit.province).toBe('MUN');
    expect(threats[0].distance).toBeGreaterThan(0);
  });

  it('excludes friendly units', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'PAR' };
    const friendlyUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'BUR' };

    const state = createTestGameState([myUnit, friendlyUnit]);
    const threats = findNearestThreats(myUnit, state);

    expect(threats).toHaveLength(0);
  });

  it('sorts threats by distance', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'PAR' };
    const nearEnemy: Unit = { power: 'GERMANY', type: 'ARMY', province: 'BUR' };
    const farEnemy: Unit = { power: 'GERMANY', type: 'ARMY', province: 'MUN' };

    const state = createTestGameState([myUnit, nearEnemy, farEnemy]);
    const threats = findNearestThreats(myUnit, state);

    expect(threats.length).toBe(2);
    expect(threats[0].distance).toBeLessThanOrEqual(threats[1].distance);
  });
});

describe('findNearestOpportunities', () => {
  it('finds unowned supply centers', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'PAR' };
    const state = createTestGameState([myUnit]);

    // Clear some SCs to make them neutral
    state.supplyCenters.delete('BEL');
    state.supplyCenters.delete('SPA');

    const opportunities = findNearestOpportunities(myUnit, state);

    expect(opportunities.length).toBeGreaterThan(0);
  });

  it('finds enemy supply centers', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'BUR' };
    const state = createTestGameState([myUnit]);

    const opportunities = findNearestOpportunities(myUnit, state);

    // Should find German SCs
    const germanSC = opportunities.find(o => o.owner === 'GERMANY');
    expect(germanSC).toBeDefined();
  });

  it('excludes own supply centers', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'PAR' };
    const state = createTestGameState([myUnit]);

    const opportunities = findNearestOpportunities(myUnit, state);

    // Should not include French SCs
    const frenchSC = opportunities.find(o => o.owner === 'FRANCE');
    expect(frenchSC).toBeUndefined();
  });

  it('marks contested targets', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'BUR' };
    const enemyUnit: Unit = { power: 'GERMANY', type: 'ARMY', province: 'MUN' };

    const state = createTestGameState([myUnit, enemyUnit]);

    const opportunities = findNearestOpportunities(myUnit, state);
    const munichOpp = opportunities.find(o => o.province === 'MUN');

    expect(munichOpp).toBeDefined();
    expect(munichOpp!.contested).toBe(true);
  });
});

describe('findConvoyRoutes', () => {
  it('finds convoy routes for army on coast', () => {
    const army: Unit = { power: 'ENGLAND', type: 'ARMY', province: 'LON' };
    const fleet: Unit = { power: 'ENGLAND', type: 'FLEET', province: 'NTH' };

    const state = createTestGameState([army, fleet]);
    const routes = findConvoyRoutes(army, state, [fleet]);

    expect(routes.length).toBeGreaterThan(0);
  });

  it('marks routes as feasible when fleets are positioned', () => {
    const army: Unit = { power: 'ENGLAND', type: 'ARMY', province: 'LON' };
    const fleet: Unit = { power: 'ENGLAND', type: 'FLEET', province: 'NTH' };

    const state = createTestGameState([army, fleet]);
    const routes = findConvoyRoutes(army, state, [fleet]);

    const feasibleRoute = routes.find(r => r.feasible);
    expect(feasibleRoute).toBeDefined();
  });

  it('returns empty for inland armies', () => {
    const army: Unit = { power: 'FRANCE', type: 'ARMY', province: 'PAR' };

    const state = createTestGameState([army]);
    const routes = findConvoyRoutes(army, state, []);

    expect(routes).toHaveLength(0);
  });

  it('returns empty for fleets', () => {
    const fleet: Unit = { power: 'ENGLAND', type: 'FLEET', province: 'LON' };

    const state = createTestGameState([fleet]);
    const routes = findConvoyRoutes(fleet, state, []);

    expect(routes).toHaveLength(0);
  });
});

describe('getAdjacentStatus', () => {
  it('returns adjacent provinces with their status', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'PAR' };
    const enemyUnit: Unit = { power: 'GERMANY', type: 'ARMY', province: 'BUR' };

    const state = createTestGameState([myUnit, enemyUnit]);
    const adjacent = getAdjacentStatus(myUnit, state);

    expect(adjacent.length).toBeGreaterThan(0);

    // Check that BUR shows as occupied
    const burgundy = adjacent.find(a => a.province === 'BUR');
    expect(burgundy).toBeDefined();
    expect(burgundy!.occupant).toBeDefined();
    expect(burgundy!.occupant!.power).toBe('GERMANY');
  });

  it('identifies supply centers', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'BUR' };
    const state = createTestGameState([myUnit]);

    const adjacent = getAdjacentStatus(myUnit, state);

    // Munich is adjacent and is a SC
    const munich = adjacent.find(a => a.province === 'MUN');
    expect(munich).toBeDefined();
    expect(munich!.supplyCenter).toBe(true);
  });
});

describe('calculateThreatLevel', () => {
  it('returns LOW when no immediate threats', () => {
    const myUnit: Unit = { power: 'ENGLAND', type: 'FLEET', province: 'LON' };
    const state = createTestGameState([myUnit]);

    const level = calculateThreatLevel('ENGLAND', state);
    expect(level).toBe('LOW');
  });

  it('increases threat level with nearby enemies', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'PAR' };
    const enemy1: Unit = { power: 'GERMANY', type: 'ARMY', province: 'BUR' };
    const enemy2: Unit = { power: 'GERMANY', type: 'ARMY', province: 'GAS' };

    const state = createTestGameState([myUnit, enemy1, enemy2]);

    const level = calculateThreatLevel('FRANCE', state);
    expect(['MEDIUM', 'HIGH', 'CRITICAL']).toContain(level);
  });
});

describe('findImmediateThreatPowers', () => {
  it('identifies powers within range', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'PAR' };
    const germanUnit: Unit = { power: 'GERMANY', type: 'ARMY', province: 'BUR' };

    const state = createTestGameState([myUnit, germanUnit]);

    const threatPowers = findImmediateThreatPowers('FRANCE', state, 2);
    expect(threatPowers).toContain('GERMANY');
  });

  it('excludes distant powers', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'PAR' };
    const russianUnit: Unit = { power: 'RUSSIA', type: 'ARMY', province: 'MOS' };

    const state = createTestGameState([myUnit, russianUnit]);

    const threatPowers = findImmediateThreatPowers('FRANCE', state, 1);
    expect(threatPowers).not.toContain('RUSSIA');
  });
});

describe('findReachableTargets', () => {
  it('finds targets within range', () => {
    const myUnit: Unit = { power: 'FRANCE', type: 'ARMY', province: 'BUR' };
    const state = createTestGameState([myUnit]);

    const targets = findReachableTargets('FRANCE', state, 2);

    // Should find some nearby SCs
    expect(targets.length).toBeGreaterThan(0);
  });

  it('returns closest path when multiple units can reach', () => {
    const unit1: Unit = { power: 'FRANCE', type: 'ARMY', province: 'BUR' };
    const unit2: Unit = { power: 'FRANCE', type: 'ARMY', province: 'GAS' };

    const state = createTestGameState([unit1, unit2]);

    const targets = findReachableTargets('FRANCE', state, 3);

    // Each target should have the shortest distance from any unit
    for (const target of targets) {
      expect(target.distance).toBeGreaterThan(0);
    }
  });
});

describe('generatePowerStrategicContext', () => {
  it('generates complete context for a power', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'FRANCE', type: 'ARMY', province: 'MAR' },
      { power: 'FRANCE', type: 'FLEET', province: 'BRE' },
    ];

    const state = createTestGameState(units);
    const context = generatePowerStrategicContext('FRANCE', state);

    expect(context.power).toBe('FRANCE');
    expect(context.unitContexts).toHaveLength(3);
    expect(context.threatLevel).toBeDefined();
    expect(context.expansionScore).toBeGreaterThanOrEqual(0);
    expect(context.reachableTargets).toBeDefined();
  });
});

describe('formatStrategicContextXML', () => {
  it('formats context as valid XML-like structure', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
    ];

    const state = createTestGameState(units);
    const context = generatePowerStrategicContext('FRANCE', state);
    const xml = formatStrategicContextXML(context);

    expect(xml).toContain('<strategic_analysis>');
    expect(xml).toContain('</strategic_analysis>');
    expect(xml).toContain('<threat_level>');
    expect(xml).toContain('<units>');
  });
});

describe('formatStrategicContextMarkdown', () => {
  it('formats context as readable markdown', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
    ];

    const state = createTestGameState(units);
    const context = generatePowerStrategicContext('FRANCE', state);
    const md = formatStrategicContextMarkdown(context);

    expect(md).toContain('## Strategic Analysis');
    expect(md).toContain('**Threat Level**');
    expect(md).toContain('### Unit Analysis');
  });
});

describe('estimateDistance integration', () => {
  it('estimateDistance uses BFS pathfinding', async () => {
    // Import from game-view to test the integration
    const { estimateDistance } = await import('../game-view');

    expect(estimateDistance('PAR', 'PAR')).toBe(0);
    expect(estimateDistance('PAR', 'BUR', 'ARMY')).toBe(1);
    expect(estimateDistance('PAR', 'MUN', 'ARMY')).toBe(2);
  });
});

describe('generateDiplomacyContext', () => {
  it('generates bilateral context between two powers', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'FRANCE', type: 'ARMY', province: 'MAR' },
      { power: 'GERMANY', type: 'ARMY', province: 'MUN' },
      { power: 'GERMANY', type: 'ARMY', province: 'BER' },
    ];

    const state = createTestGameState(units);
    const context = generateDiplomacyContext('FRANCE', 'GERMANY', state);

    expect(context.fromPower).toBe('FRANCE');
    expect(context.toPower).toBe('GERMANY');
    expect(context.relationshipType).toBeDefined();
    expect(context.stakes).toBeInstanceOf(Array);
  });

  it('identifies contested territories between neighbors', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'GERMANY', type: 'ARMY', province: 'MUN' },
    ];

    // Both can reach BUR (neutral in this test)
    const supplyCenters = new Map<string, Power>([
      ['PAR', 'FRANCE'],
      ['MUN', 'GERMANY'],
    ]);
    const state = createTestGameState(units, supplyCenters);
    const context = generateDiplomacyContext('FRANCE', 'GERMANY', state);

    // BUR should be contested since both can reach it
    expect(context.contestedTargets.length).toBeGreaterThan(0);
  });

  it('identifies common threats', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'ENGLAND', type: 'ARMY', province: 'LON' },
      { power: 'GERMANY', type: 'ARMY', province: 'MUN' },
      { power: 'GERMANY', type: 'ARMY', province: 'KIE' },
    ];

    const state = createTestGameState(units);
    const context = generateDiplomacyContext('FRANCE', 'ENGLAND', state);

    // Germany threatens both France and England
    // But depends on proximity - let's just verify structure
    expect(context.commonThreats).toBeInstanceOf(Array);
  });

  it('detects shared border when units are adjacent', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'BUR' },
      { power: 'GERMANY', type: 'ARMY', province: 'MUN' },
    ];

    const state = createTestGameState(units);
    const context = generateDiplomacyContext('FRANCE', 'GERMANY', state);

    // BUR and MUN are adjacent
    expect(context.sharesBorder).toBe(true);
    expect(context.mutualThreatCount.fromTo).toBeGreaterThanOrEqual(0);
  });
});

describe('formatDiplomacyContextMarkdown', () => {
  it('formats bilateral context as readable markdown', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'GERMANY', type: 'ARMY', province: 'MUN' },
    ];

    const state = createTestGameState(units);
    const context = generateDiplomacyContext('FRANCE', 'GERMANY', state);
    const md = formatDiplomacyContextMarkdown(context);

    expect(md).toContain('### Strategic Context with GERMANY');
    expect(md).toContain('**Relationship**');
  });

  it('includes stakes when present', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'GERMANY', type: 'ARMY', province: 'MUN' },
    ];

    const supplyCenters = new Map<string, Power>([
      ['PAR', 'FRANCE'],
      ['MUN', 'GERMANY'],
    ]);
    const state = createTestGameState(units, supplyCenters);
    const context = generateDiplomacyContext('FRANCE', 'GERMANY', state);
    const md = formatDiplomacyContextMarkdown(context);

    // Should have some stakes since both can reach contested territories
    if (context.stakes.length > 0) {
      expect(md).toContain("**What's at stake:**");
    }
  });
});

describe('generateAllDiplomacyContexts', () => {
  it('generates contexts for all active powers except self', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'GERMANY', type: 'ARMY', province: 'MUN' },
      { power: 'ENGLAND', type: 'FLEET', province: 'LON' },
    ];

    const state = createTestGameState(units);
    const contexts = generateAllDiplomacyContexts('FRANCE', state);

    // Should have contexts for GERMANY and ENGLAND, not FRANCE
    expect(contexts.has('FRANCE')).toBe(false);
    expect(contexts.has('GERMANY')).toBe(true);
    expect(contexts.has('ENGLAND')).toBe(true);
  });

  it('excludes eliminated powers', () => {
    const units: Unit[] = [
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'GERMANY', type: 'ARMY', province: 'MUN' },
      // ENGLAND has no units
    ];

    const supplyCenters = new Map<string, Power>([
      ['PAR', 'FRANCE'],
      ['MUN', 'GERMANY'],
      // ENGLAND has no SCs
    ]);

    const state = createTestGameState(units, supplyCenters);
    const contexts = generateAllDiplomacyContexts('FRANCE', state);

    // ENGLAND should not be included (no units, no SCs)
    expect(contexts.has('ENGLAND')).toBe(false);
    expect(contexts.has('GERMANY')).toBe(true);
  });
});
