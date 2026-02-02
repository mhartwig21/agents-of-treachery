/**
 * Standard Diplomacy map data.
 * 75 provinces, 34 supply centers, adjacencies.
 */

import { Province, ProvinceType, Power, Coast } from './types';

// Province IDs use standard abbreviations
export const PROVINCES: Province[] = [
  // ENGLAND home centers
  { id: 'LON', name: 'London', type: 'COASTAL', supplyCenter: true, homeCenter: 'ENGLAND' },
  { id: 'LVP', name: 'Liverpool', type: 'COASTAL', supplyCenter: true, homeCenter: 'ENGLAND' },
  { id: 'EDI', name: 'Edinburgh', type: 'COASTAL', supplyCenter: true, homeCenter: 'ENGLAND' },

  // FRANCE home centers
  { id: 'PAR', name: 'Paris', type: 'LAND', supplyCenter: true, homeCenter: 'FRANCE' },
  { id: 'MAR', name: 'Marseilles', type: 'COASTAL', supplyCenter: true, homeCenter: 'FRANCE' },
  { id: 'BRE', name: 'Brest', type: 'COASTAL', supplyCenter: true, homeCenter: 'FRANCE' },

  // GERMANY home centers
  { id: 'BER', name: 'Berlin', type: 'COASTAL', supplyCenter: true, homeCenter: 'GERMANY' },
  { id: 'MUN', name: 'Munich', type: 'LAND', supplyCenter: true, homeCenter: 'GERMANY' },
  { id: 'KIE', name: 'Kiel', type: 'COASTAL', supplyCenter: true, homeCenter: 'GERMANY' },

  // ITALY home centers
  { id: 'ROM', name: 'Rome', type: 'COASTAL', supplyCenter: true, homeCenter: 'ITALY' },
  { id: 'VEN', name: 'Venice', type: 'COASTAL', supplyCenter: true, homeCenter: 'ITALY' },
  { id: 'NAP', name: 'Naples', type: 'COASTAL', supplyCenter: true, homeCenter: 'ITALY' },

  // AUSTRIA home centers
  { id: 'VIE', name: 'Vienna', type: 'LAND', supplyCenter: true, homeCenter: 'AUSTRIA' },
  { id: 'BUD', name: 'Budapest', type: 'LAND', supplyCenter: true, homeCenter: 'AUSTRIA' },
  { id: 'TRI', name: 'Trieste', type: 'COASTAL', supplyCenter: true, homeCenter: 'AUSTRIA' },

  // RUSSIA home centers
  { id: 'MOS', name: 'Moscow', type: 'LAND', supplyCenter: true, homeCenter: 'RUSSIA' },
  { id: 'WAR', name: 'Warsaw', type: 'LAND', supplyCenter: true, homeCenter: 'RUSSIA' },
  { id: 'STP', name: 'St. Petersburg', type: 'COASTAL', supplyCenter: true, homeCenter: 'RUSSIA', coasts: ['NORTH', 'SOUTH'] },
  { id: 'SEV', name: 'Sevastopol', type: 'COASTAL', supplyCenter: true, homeCenter: 'RUSSIA' },

  // TURKEY home centers
  { id: 'CON', name: 'Constantinople', type: 'COASTAL', supplyCenter: true, homeCenter: 'TURKEY' },
  { id: 'ANK', name: 'Ankara', type: 'COASTAL', supplyCenter: true, homeCenter: 'TURKEY' },
  { id: 'SMY', name: 'Smyrna', type: 'COASTAL', supplyCenter: true, homeCenter: 'TURKEY' },

  // Neutral supply centers
  { id: 'NWY', name: 'Norway', type: 'COASTAL', supplyCenter: true },
  { id: 'SWE', name: 'Sweden', type: 'COASTAL', supplyCenter: true },
  { id: 'DEN', name: 'Denmark', type: 'COASTAL', supplyCenter: true },
  { id: 'HOL', name: 'Holland', type: 'COASTAL', supplyCenter: true },
  { id: 'BEL', name: 'Belgium', type: 'COASTAL', supplyCenter: true },
  { id: 'SPA', name: 'Spain', type: 'COASTAL', supplyCenter: true, coasts: ['NORTH', 'SOUTH'] },
  { id: 'POR', name: 'Portugal', type: 'COASTAL', supplyCenter: true },
  { id: 'TUN', name: 'Tunis', type: 'COASTAL', supplyCenter: true },
  { id: 'SER', name: 'Serbia', type: 'LAND', supplyCenter: true },
  { id: 'RUM', name: 'Rumania', type: 'COASTAL', supplyCenter: true },
  { id: 'BUL', name: 'Bulgaria', type: 'COASTAL', supplyCenter: true, coasts: ['EAST', 'SOUTH'] },
  { id: 'GRE', name: 'Greece', type: 'COASTAL', supplyCenter: true },

  // Non-supply center land/coastal provinces
  { id: 'CLY', name: 'Clyde', type: 'COASTAL', supplyCenter: false },
  { id: 'YOR', name: 'Yorkshire', type: 'COASTAL', supplyCenter: false },
  { id: 'WAL', name: 'Wales', type: 'COASTAL', supplyCenter: false },
  { id: 'PIC', name: 'Picardy', type: 'COASTAL', supplyCenter: false },
  { id: 'BUR', name: 'Burgundy', type: 'LAND', supplyCenter: false },
  { id: 'GAS', name: 'Gascony', type: 'COASTAL', supplyCenter: false },
  { id: 'RUH', name: 'Ruhr', type: 'LAND', supplyCenter: false },
  { id: 'PRU', name: 'Prussia', type: 'COASTAL', supplyCenter: false },
  { id: 'SIL', name: 'Silesia', type: 'LAND', supplyCenter: false },
  { id: 'PIE', name: 'Piedmont', type: 'COASTAL', supplyCenter: false },
  { id: 'TUS', name: 'Tuscany', type: 'COASTAL', supplyCenter: false },
  { id: 'APU', name: 'Apulia', type: 'COASTAL', supplyCenter: false },
  { id: 'TYR', name: 'Tyrolia', type: 'LAND', supplyCenter: false },
  { id: 'BOH', name: 'Bohemia', type: 'LAND', supplyCenter: false },
  { id: 'GAL', name: 'Galicia', type: 'LAND', supplyCenter: false },
  { id: 'UKR', name: 'Ukraine', type: 'LAND', supplyCenter: false },
  { id: 'LVN', name: 'Livonia', type: 'COASTAL', supplyCenter: false },
  { id: 'FIN', name: 'Finland', type: 'COASTAL', supplyCenter: false },
  { id: 'ARM', name: 'Armenia', type: 'COASTAL', supplyCenter: false },
  { id: 'SYR', name: 'Syria', type: 'COASTAL', supplyCenter: false },
  { id: 'ALB', name: 'Albania', type: 'COASTAL', supplyCenter: false },
  { id: 'NAF', name: 'North Africa', type: 'COASTAL', supplyCenter: false },

  // Sea provinces
  { id: 'NTH', name: 'North Sea', type: 'SEA', supplyCenter: false },
  { id: 'NWG', name: 'Norwegian Sea', type: 'SEA', supplyCenter: false },
  { id: 'BAR', name: 'Barents Sea', type: 'SEA', supplyCenter: false },
  { id: 'SKA', name: 'Skagerrak', type: 'SEA', supplyCenter: false },
  { id: 'HEL', name: 'Heligoland Bight', type: 'SEA', supplyCenter: false },
  { id: 'BAL', name: 'Baltic Sea', type: 'SEA', supplyCenter: false },
  { id: 'BOT', name: 'Gulf of Bothnia', type: 'SEA', supplyCenter: false },
  { id: 'ENG', name: 'English Channel', type: 'SEA', supplyCenter: false },
  { id: 'IRI', name: 'Irish Sea', type: 'SEA', supplyCenter: false },
  { id: 'NAO', name: 'North Atlantic Ocean', type: 'SEA', supplyCenter: false },
  { id: 'MAO', name: 'Mid-Atlantic Ocean', type: 'SEA', supplyCenter: false },
  { id: 'WES', name: 'Western Mediterranean', type: 'SEA', supplyCenter: false },
  { id: 'LYO', name: 'Gulf of Lyon', type: 'SEA', supplyCenter: false },
  { id: 'TYS', name: 'Tyrrhenian Sea', type: 'SEA', supplyCenter: false },
  { id: 'ION', name: 'Ionian Sea', type: 'SEA', supplyCenter: false },
  { id: 'ADR', name: 'Adriatic Sea', type: 'SEA', supplyCenter: false },
  { id: 'AEG', name: 'Aegean Sea', type: 'SEA', supplyCenter: false },
  { id: 'EAS', name: 'Eastern Mediterranean', type: 'SEA', supplyCenter: false },
  { id: 'BLA', name: 'Black Sea', type: 'SEA', supplyCenter: false },
];

// Adjacency map: province -> list of adjacent provinces
// For coastal provinces with multiple coasts, we use special keys like 'STP/NC' for St. Petersburg North Coast
export const ADJACENCIES: Record<string, string[]> = {
  // England
  'CLY': ['EDI', 'LVP', 'NAO', 'NWG'],
  'EDI': ['CLY', 'YOR', 'LVP', 'NTH', 'NWG'],
  'LVP': ['CLY', 'EDI', 'YOR', 'WAL', 'NAO', 'IRI'],
  'YOR': ['EDI', 'LVP', 'LON', 'WAL', 'NTH'],
  'WAL': ['LVP', 'YOR', 'LON', 'ENG', 'IRI'],
  'LON': ['YOR', 'WAL', 'NTH', 'ENG'],

  // France
  'BRE': ['PIC', 'PAR', 'GAS', 'ENG', 'MAO'],
  'PIC': ['BRE', 'PAR', 'BUR', 'BEL', 'ENG'],
  'PAR': ['BRE', 'PIC', 'BUR', 'GAS'],
  'BUR': ['PIC', 'PAR', 'GAS', 'MAR', 'BEL', 'RUH', 'MUN'],
  'GAS': ['BRE', 'PAR', 'BUR', 'MAR', 'SPA', 'MAO'],
  'MAR': ['BUR', 'GAS', 'SPA', 'PIE', 'LYO'],

  // Germany
  'KIE': ['BER', 'MUN', 'RUH', 'HOL', 'DEN', 'HEL', 'BAL'],
  'BER': ['KIE', 'MUN', 'SIL', 'PRU', 'BAL'],
  'MUN': ['KIE', 'BER', 'SIL', 'BOH', 'TYR', 'BUR', 'RUH'],
  'RUH': ['KIE', 'MUN', 'BUR', 'BEL', 'HOL'],
  'PRU': ['BER', 'SIL', 'WAR', 'LVN', 'BAL'],
  'SIL': ['BER', 'MUN', 'BOH', 'GAL', 'WAR', 'PRU'],

  // Italy
  'PIE': ['MAR', 'TYR', 'VEN', 'TUS', 'LYO'],
  'VEN': ['PIE', 'TYR', 'TRI', 'APU', 'ROM', 'TUS', 'ADR'],
  'TUS': ['PIE', 'VEN', 'ROM', 'LYO', 'TYS'],
  'ROM': ['TUS', 'VEN', 'APU', 'NAP', 'TYS'],
  'APU': ['VEN', 'ROM', 'NAP', 'ADR', 'ION'],
  'NAP': ['ROM', 'APU', 'TYS', 'ION'],

  // Austria
  'TYR': ['MUN', 'BOH', 'VIE', 'TRI', 'VEN', 'PIE'],
  'BOH': ['MUN', 'SIL', 'GAL', 'VIE', 'TYR'],
  'VIE': ['BOH', 'GAL', 'BUD', 'TRI', 'TYR'],
  'TRI': ['TYR', 'VIE', 'BUD', 'SER', 'ALB', 'VEN', 'ADR'],
  'BUD': ['VIE', 'GAL', 'RUM', 'SER', 'TRI'],
  'GAL': ['BOH', 'SIL', 'WAR', 'UKR', 'RUM', 'BUD', 'VIE'],

  // Russia
  'STP': ['NWY', 'FIN', 'LVN', 'MOS', 'BAR', 'BOT'],
  'STP/NC': ['NWY', 'BAR'],
  'STP/SC': ['FIN', 'LVN', 'BOT'],
  'MOS': ['STP', 'LVN', 'WAR', 'UKR', 'SEV'],
  'WAR': ['PRU', 'SIL', 'GAL', 'UKR', 'MOS', 'LVN'],
  'LVN': ['STP', 'MOS', 'WAR', 'PRU', 'BAL', 'BOT'],
  'SEV': ['MOS', 'UKR', 'RUM', 'ARM', 'BLA'],
  'UKR': ['MOS', 'WAR', 'GAL', 'RUM', 'SEV'],
  'FIN': ['STP', 'NWY', 'SWE', 'BOT'],

  // Turkey
  'CON': ['BUL', 'AEG', 'BLA', 'ANK', 'SMY'],
  'ANK': ['CON', 'BLA', 'ARM', 'SMY'],
  'SMY': ['CON', 'ANK', 'ARM', 'SYR', 'AEG', 'EAS'],
  'ARM': ['ANK', 'SEV', 'SYR', 'BLA'],
  'SYR': ['ARM', 'SMY', 'EAS'],

  // Balkans
  'SER': ['TRI', 'BUD', 'RUM', 'BUL', 'GRE', 'ALB'],
  'ALB': ['TRI', 'SER', 'GRE', 'ADR', 'ION'],
  'GRE': ['SER', 'BUL', 'ALB', 'AEG', 'ION'],
  'BUL': ['SER', 'RUM', 'CON', 'GRE', 'AEG', 'BLA'],
  'BUL/EC': ['RUM', 'CON', 'BLA'],
  'BUL/SC': ['GRE', 'CON', 'AEG'],
  'RUM': ['BUD', 'GAL', 'UKR', 'SEV', 'BUL', 'SER', 'BLA'],

  // Scandinavia
  'NWY': ['STP', 'FIN', 'SWE', 'SKA', 'NTH', 'NWG', 'BAR'],
  'SWE': ['NWY', 'FIN', 'DEN', 'SKA', 'BAL', 'BOT'],
  'DEN': ['SWE', 'KIE', 'SKA', 'HEL', 'BAL', 'NTH'],

  // Low Countries
  'HOL': ['KIE', 'RUH', 'BEL', 'HEL', 'NTH'],
  'BEL': ['HOL', 'RUH', 'BUR', 'PIC', 'ENG', 'NTH'],

  // Iberia
  'SPA': ['GAS', 'MAR', 'POR', 'MAO', 'LYO', 'WES'],
  'SPA/NC': ['GAS', 'POR', 'MAO'],
  'SPA/SC': ['MAR', 'POR', 'MAO', 'LYO', 'WES'],
  'POR': ['SPA', 'MAO'],

  // North Africa
  'NAF': ['TUN', 'MAO', 'WES'],
  'TUN': ['NAF', 'WES', 'TYS', 'ION'],

  // Sea zones
  'NAO': ['NWG', 'CLY', 'LVP', 'IRI', 'MAO'],
  'NWG': ['NAO', 'BAR', 'NWY', 'NTH', 'EDI', 'CLY'],
  'BAR': ['NWG', 'NWY', 'STP/NC'],
  'NTH': ['NWG', 'NWY', 'SKA', 'DEN', 'HEL', 'HOL', 'BEL', 'ENG', 'LON', 'YOR', 'EDI'],
  'SKA': ['NWY', 'SWE', 'DEN', 'NTH', 'BAL'],
  'HEL': ['NTH', 'DEN', 'KIE', 'HOL'],
  'BAL': ['SKA', 'SWE', 'BOT', 'LVN', 'PRU', 'BER', 'KIE', 'DEN'],
  'BOT': ['BAL', 'SWE', 'FIN', 'STP/SC', 'LVN'],
  'IRI': ['NAO', 'MAO', 'ENG', 'WAL', 'LVP'],
  'ENG': ['IRI', 'MAO', 'BRE', 'PIC', 'BEL', 'NTH', 'LON', 'WAL'],
  'MAO': ['NAO', 'IRI', 'ENG', 'BRE', 'GAS', 'SPA/NC', 'SPA/SC', 'POR', 'WES', 'NAF'],
  'WES': ['MAO', 'SPA/SC', 'LYO', 'TYS', 'TUN', 'NAF'],
  'LYO': ['SPA/SC', 'MAR', 'PIE', 'TUS', 'TYS', 'WES'],
  'TYS': ['LYO', 'TUS', 'ROM', 'NAP', 'ION', 'TUN', 'WES'],
  'ION': ['TYS', 'NAP', 'APU', 'ADR', 'ALB', 'GRE', 'AEG', 'EAS', 'TUN'],
  'ADR': ['VEN', 'TRI', 'ALB', 'ION', 'APU'],
  'AEG': ['GRE', 'BUL/SC', 'CON', 'SMY', 'EAS', 'ION'],
  'EAS': ['AEG', 'SMY', 'SYR', 'ION'],
  'BLA': ['RUM', 'BUL/EC', 'CON', 'ANK', 'ARM', 'SEV'],
};

// Lookup helpers
export function getProvince(id: string): Province | undefined {
  return PROVINCES.find(p => p.id === id);
}

export function getSupplyCenters(): Province[] {
  return PROVINCES.filter(p => p.supplyCenter);
}

export function getHomeCenters(power: Power): Province[] {
  return PROVINCES.filter(p => p.homeCenter === power);
}

export function getAdjacent(provinceId: string, coast?: Coast): string[] {
  // Handle coasted provinces
  if (coast) {
    const coastedId = `${provinceId}/${coast.charAt(0)}C`;
    if (ADJACENCIES[coastedId]) {
      return ADJACENCIES[coastedId];
    }
  }
  return ADJACENCIES[provinceId] || [];
}

export function areAdjacent(from: string, to: string, fromCoast?: Coast, toCoast?: Coast): boolean {
  const fromAdj = getAdjacent(from, fromCoast);

  // Check direct adjacency
  if (fromAdj.includes(to)) return true;

  // Check coasted destination
  if (toCoast) {
    const coastedTo = `${to}/${toCoast.charAt(0)}C`;
    if (fromAdj.includes(coastedTo)) return true;
  }

  // Check all possible coasts of destination
  const toProv = getProvince(to);
  if (toProv?.coasts) {
    for (const c of toProv.coasts) {
      const coastedTo = `${to}/${c.charAt(0)}C`;
      if (fromAdj.includes(coastedTo)) return true;
    }
  }

  return false;
}

export function canArmyOccupy(provinceId: string): boolean {
  const prov = getProvince(provinceId);
  return prov?.type === 'LAND' || prov?.type === 'COASTAL';
}

export function canFleetOccupy(provinceId: string): boolean {
  const prov = getProvince(provinceId);
  return prov?.type === 'SEA' || prov?.type === 'COASTAL';
}
