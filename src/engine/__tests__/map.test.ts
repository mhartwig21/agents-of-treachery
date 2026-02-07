import { describe, it, expect } from 'vitest';
import {
  PROVINCES,
  ADJACENCIES,
  getProvince,
  getSupplyCenters,
  getHomeCenters,
  getAdjacent,
  areAdjacent,
  canArmyOccupy,
  canFleetOccupy,
} from '../map';
import type { Power } from '../types';

// ---------------------------------------------------------------------------
// Map data integrity
// ---------------------------------------------------------------------------
describe('Map data integrity', () => {
  it('should have 75 provinces', () => {
    expect(PROVINCES).toHaveLength(75);
  });

  it('should have 34 supply centers', () => {
    const scs = PROVINCES.filter(p => p.supplyCenter);
    expect(scs).toHaveLength(34);
  });

  it('should have unique province IDs', () => {
    const ids = PROVINCES.map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have 3 home centers for each power', () => {
    const powers: Power[] = [
      'ENGLAND',
      'FRANCE',
      'GERMANY',
      'ITALY',
      'AUSTRIA',
      'TURKEY',
    ];
    for (const power of powers) {
      const homes = PROVINCES.filter(p => p.homeCenter === power);
      expect(homes).toHaveLength(3);
    }
  });

  it('should have 4 home centers for Russia', () => {
    const russiaHomes = PROVINCES.filter(p => p.homeCenter === 'RUSSIA');
    expect(russiaHomes).toHaveLength(4);
  });

  it('should have coasted provinces for STP, SPA, BUL', () => {
    const stp = getProvince('STP');
    const spa = getProvince('SPA');
    const bul = getProvince('BUL');

    expect(stp?.coasts).toContain('NORTH');
    expect(stp?.coasts).toContain('SOUTH');
    expect(spa?.coasts).toContain('NORTH');
    expect(spa?.coasts).toContain('SOUTH');
    expect(bul?.coasts).toContain('EAST');
    expect(bul?.coasts).toContain('SOUTH');
  });

  it('should have adjacencies for coasted provinces', () => {
    // STP/NC and STP/SC should exist in ADJACENCIES
    expect(ADJACENCIES['STP/NC']).toBeDefined();
    expect(ADJACENCIES['STP/SC']).toBeDefined();
    expect(ADJACENCIES['SPA/NC']).toBeDefined();
    expect(ADJACENCIES['SPA/SC']).toBeDefined();
    expect(ADJACENCIES['BUL/EC']).toBeDefined();
    expect(ADJACENCIES['BUL/SC']).toBeDefined();
  });

  it('should have province types for all land/sea/coastal', () => {
    const types = new Set(PROVINCES.map(p => p.type));
    expect(types).toContain('LAND');
    expect(types).toContain('COASTAL');
    expect(types).toContain('SEA');
  });

  it('should have sea provinces with no supply centers', () => {
    const seas = PROVINCES.filter(p => p.type === 'SEA');
    for (const sea of seas) {
      expect(sea.supplyCenter).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// getProvince
// ---------------------------------------------------------------------------
describe('getProvince', () => {
  it('should return province by ID', () => {
    const london = getProvince('LON');
    expect(london).toBeDefined();
    expect(london!.name).toBe('London');
    expect(london!.type).toBe('COASTAL');
    expect(london!.supplyCenter).toBe(true);
    expect(london!.homeCenter).toBe('ENGLAND');
  });

  it('should return undefined for invalid ID', () => {
    expect(getProvince('ATLANTIS')).toBeUndefined();
    expect(getProvince('')).toBeUndefined();
  });

  it('should find all power capitals', () => {
    expect(getProvince('LON')?.homeCenter).toBe('ENGLAND');
    expect(getProvince('PAR')?.homeCenter).toBe('FRANCE');
    expect(getProvince('BER')?.homeCenter).toBe('GERMANY');
    expect(getProvince('ROM')?.homeCenter).toBe('ITALY');
    expect(getProvince('VIE')?.homeCenter).toBe('AUSTRIA');
    expect(getProvince('MOS')?.homeCenter).toBe('RUSSIA');
    expect(getProvince('CON')?.homeCenter).toBe('TURKEY');
  });

  it('should identify land-locked provinces', () => {
    const paris = getProvince('PAR');
    const munich = getProvince('MUN');
    const vienna = getProvince('VIE');
    const bohemia = getProvince('BOH');

    expect(paris!.type).toBe('LAND');
    expect(munich!.type).toBe('LAND');
    expect(vienna!.type).toBe('LAND');
    expect(bohemia!.type).toBe('LAND');
  });

  it('should identify sea provinces', () => {
    const nth = getProvince('NTH');
    const eng = getProvince('ENG');
    const mao = getProvince('MAO');

    expect(nth!.type).toBe('SEA');
    expect(eng!.type).toBe('SEA');
    expect(mao!.type).toBe('SEA');
  });
});

// ---------------------------------------------------------------------------
// getSupplyCenters
// ---------------------------------------------------------------------------
describe('getSupplyCenters', () => {
  it('should return exactly 34 supply centers', () => {
    expect(getSupplyCenters()).toHaveLength(34);
  });

  it('should include all major capitals', () => {
    const scIds = getSupplyCenters().map(p => p.id);
    expect(scIds).toContain('LON');
    expect(scIds).toContain('PAR');
    expect(scIds).toContain('BER');
    expect(scIds).toContain('ROM');
    expect(scIds).toContain('VIE');
    expect(scIds).toContain('MOS');
    expect(scIds).toContain('CON');
  });

  it('should include neutral supply centers', () => {
    const scIds = getSupplyCenters().map(p => p.id);
    expect(scIds).toContain('NWY');
    expect(scIds).toContain('SWE');
    expect(scIds).toContain('DEN');
    expect(scIds).toContain('HOL');
    expect(scIds).toContain('BEL');
    expect(scIds).toContain('SPA');
    expect(scIds).toContain('POR');
    expect(scIds).toContain('TUN');
    expect(scIds).toContain('SER');
    expect(scIds).toContain('RUM');
    expect(scIds).toContain('BUL');
    expect(scIds).toContain('GRE');
  });
});

// ---------------------------------------------------------------------------
// getHomeCenters
// ---------------------------------------------------------------------------
describe('getHomeCenters', () => {
  it('should return 3 home centers for England', () => {
    const homes = getHomeCenters('ENGLAND');
    expect(homes).toHaveLength(3);
    const ids = homes.map(h => h.id);
    expect(ids).toContain('LON');
    expect(ids).toContain('LVP');
    expect(ids).toContain('EDI');
  });

  it('should return 3 home centers for France', () => {
    const homes = getHomeCenters('FRANCE');
    expect(homes).toHaveLength(3);
    const ids = homes.map(h => h.id);
    expect(ids).toContain('PAR');
    expect(ids).toContain('MAR');
    expect(ids).toContain('BRE');
  });

  it('should return 4 home centers for Russia', () => {
    const homes = getHomeCenters('RUSSIA');
    expect(homes).toHaveLength(4);
    const ids = homes.map(h => h.id);
    expect(ids).toContain('MOS');
    expect(ids).toContain('WAR');
    expect(ids).toContain('STP');
    expect(ids).toContain('SEV');
  });

  it('should return all supply centers for home centers', () => {
    const powers: Power[] = [
      'ENGLAND',
      'FRANCE',
      'GERMANY',
      'ITALY',
      'AUSTRIA',
      'RUSSIA',
      'TURKEY',
    ];
    for (const power of powers) {
      for (const home of getHomeCenters(power)) {
        expect(home.supplyCenter).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getAdjacent
// ---------------------------------------------------------------------------
describe('getAdjacent', () => {
  it('should return adjacent provinces for LON', () => {
    const adj = getAdjacent('LON');
    expect(adj).toContain('YOR');
    expect(adj).toContain('WAL');
    expect(adj).toContain('ENG');
    expect(adj).toContain('NTH');
  });

  it('should return adjacent provinces for NTH (sea)', () => {
    const adj = getAdjacent('NTH');
    expect(adj).toContain('LON');
    expect(adj).toContain('EDI');
    expect(adj).toContain('NWY');
    expect(adj).toContain('ENG');
  });

  it('should return coasted adjacency for STP north coast', () => {
    const adj = getAdjacent('STP', 'NORTH');
    expect(adj.length).toBeGreaterThan(0);
    expect(adj).toContain('BAR');
    expect(adj).toContain('NWY');
  });

  it('should return coasted adjacency for STP south coast', () => {
    const adj = getAdjacent('STP', 'SOUTH');
    expect(adj.length).toBeGreaterThan(0);
    expect(adj).toContain('FIN');
    expect(adj).toContain('BOT');
  });

  it('should return empty array for invalid province', () => {
    expect(getAdjacent('ATLANTIS')).toEqual([]);
  });

  it('should fall back to uncoasted adjacency when coast not in adjacencies', () => {
    // For provinces without specific coast adjacencies, should use base
    const adj = getAdjacent('LON', 'SOUTH');
    // Should fall back to LON's base adjacencies
    expect(adj).toContain('YOR');
  });
});

// ---------------------------------------------------------------------------
// areAdjacent
// ---------------------------------------------------------------------------
describe('areAdjacent', () => {
  it('should confirm adjacent land provinces', () => {
    expect(areAdjacent('PAR', 'BUR')).toBe(true);
    expect(areAdjacent('BUR', 'PAR')).toBe(true); // Symmetric
  });

  it('should confirm adjacent coastal-sea provinces', () => {
    expect(areAdjacent('LON', 'NTH')).toBe(true);
    expect(areAdjacent('LON', 'ENG')).toBe(true);
  });

  it('should reject non-adjacent provinces', () => {
    expect(areAdjacent('LON', 'MOS')).toBe(false);
    expect(areAdjacent('PAR', 'BER')).toBe(false);
    expect(areAdjacent('ROM', 'LON')).toBe(false);
  });

  it('should handle coasted destination (STP north coast)', () => {
    // Fleet from BAR to STP(NC)
    expect(areAdjacent('BAR', 'STP', undefined, 'NORTH')).toBe(true);
  });

  it('should handle coasted source (STP south coast)', () => {
    // Fleet from STP(SC) to BOT
    expect(areAdjacent('STP', 'BOT', 'SOUTH')).toBe(true);
  });

  it('should handle SPA coast adjacencies', () => {
    // Fleet from MAO to SPA(NC)
    expect(areAdjacent('MAO', 'SPA', undefined, 'NORTH')).toBe(true);
    // Fleet from WES to SPA(SC)
    expect(areAdjacent('WES', 'SPA', undefined, 'SOUTH')).toBe(true);
  });

  it('should handle BUL coast adjacencies', () => {
    // Fleet from BLA to BUL(EC)
    expect(areAdjacent('BLA', 'BUL', undefined, 'EAST')).toBe(true);
    // Fleet from AEG to BUL(SC)
    expect(areAdjacent('AEG', 'BUL', undefined, 'SOUTH')).toBe(true);
  });

  it('should detect adjacency to coasted provinces without specifying coast', () => {
    // STP has coasts — should still be reachable from adjacent provinces
    // even without specifying a coast (the function checks all coasts)
    expect(areAdjacent('BAR', 'STP')).toBe(true);
    expect(areAdjacent('FIN', 'STP')).toBe(true);
  });

  it('should handle same province (not adjacent to itself)', () => {
    // Province should not be adjacent to itself
    expect(areAdjacent('PAR', 'PAR')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canArmyOccupy
// ---------------------------------------------------------------------------
describe('canArmyOccupy', () => {
  it('should allow armies on LAND provinces', () => {
    expect(canArmyOccupy('PAR')).toBe(true); // Paris is LAND
    expect(canArmyOccupy('MUN')).toBe(true); // Munich is LAND
    expect(canArmyOccupy('VIE')).toBe(true); // Vienna is LAND
    expect(canArmyOccupy('BUR')).toBe(true); // Burgundy is LAND
    expect(canArmyOccupy('BOH')).toBe(true); // Bohemia is LAND
  });

  it('should allow armies on COASTAL provinces', () => {
    expect(canArmyOccupy('LON')).toBe(true); // London is COASTAL
    expect(canArmyOccupy('MAR')).toBe(true); // Marseilles is COASTAL
    expect(canArmyOccupy('BER')).toBe(true); // Berlin is COASTAL
    expect(canArmyOccupy('CON')).toBe(true); // Constantinople is COASTAL
  });

  it('should NOT allow armies on SEA provinces', () => {
    expect(canArmyOccupy('NTH')).toBe(false); // North Sea
    expect(canArmyOccupy('ENG')).toBe(false); // English Channel
    expect(canArmyOccupy('MAO')).toBe(false); // Mid-Atlantic
    expect(canArmyOccupy('BLA')).toBe(false); // Black Sea
  });

  it('should return false for invalid province', () => {
    expect(canArmyOccupy('ATLANTIS')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canFleetOccupy
// ---------------------------------------------------------------------------
describe('canFleetOccupy', () => {
  it('should allow fleets on SEA provinces', () => {
    expect(canFleetOccupy('NTH')).toBe(true);
    expect(canFleetOccupy('ENG')).toBe(true);
    expect(canFleetOccupy('MAO')).toBe(true);
    expect(canFleetOccupy('BLA')).toBe(true);
    expect(canFleetOccupy('ION')).toBe(true);
  });

  it('should allow fleets on COASTAL provinces', () => {
    expect(canFleetOccupy('LON')).toBe(true);
    expect(canFleetOccupy('BRE')).toBe(true);
    expect(canFleetOccupy('KIE')).toBe(true);
    expect(canFleetOccupy('NAP')).toBe(true);
    expect(canFleetOccupy('CON')).toBe(true);
  });

  it('should NOT allow fleets on LAND provinces', () => {
    expect(canFleetOccupy('PAR')).toBe(false); // Paris is LAND
    expect(canFleetOccupy('MUN')).toBe(false); // Munich is LAND
    expect(canFleetOccupy('VIE')).toBe(false); // Vienna is LAND
    expect(canFleetOccupy('BUR')).toBe(false); // Burgundy is LAND
    expect(canFleetOccupy('BOH')).toBe(false); // Bohemia is LAND
    expect(canFleetOccupy('SIL')).toBe(false); // Silesia is LAND
  });

  it('should return false for invalid province', () => {
    expect(canFleetOccupy('ATLANTIS')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Critical Diplomacy adjacency rules
// ---------------------------------------------------------------------------
describe('Critical adjacency rules', () => {
  it('should make Constantinople adjacent to both Black Sea and Aegean', () => {
    expect(areAdjacent('CON', 'BLA')).toBe(true);
    expect(areAdjacent('CON', 'AEG')).toBe(true);
  });

  it('should make Kiel adjacent to both Baltic and Helgoland', () => {
    expect(areAdjacent('KIE', 'BAL')).toBe(true);
    expect(areAdjacent('KIE', 'HEL')).toBe(true);
  });

  it('should make Denmark adjacent to both Baltic and Skagerrak', () => {
    expect(areAdjacent('DEN', 'BAL')).toBe(true);
    expect(areAdjacent('DEN', 'SKA')).toBe(true);
  });

  it('should connect England to France through ENG', () => {
    expect(areAdjacent('LON', 'ENG')).toBe(true);
    expect(areAdjacent('BRE', 'ENG')).toBe(true);
  });

  it('should NOT connect LON directly to BRE', () => {
    expect(areAdjacent('LON', 'BRE')).toBe(false);
  });

  it('should have Serbia as land-locked', () => {
    const ser = getProvince('SER');
    expect(ser!.type).toBe('LAND');
    expect(canFleetOccupy('SER')).toBe(false);
    expect(canArmyOccupy('SER')).toBe(true);
  });

  it('should connect Moscow to St. Petersburg', () => {
    expect(areAdjacent('MOS', 'STP')).toBe(true);
  });

  it('should connect Warsaw to Moscow', () => {
    expect(areAdjacent('WAR', 'MOS')).toBe(true);
  });
});
