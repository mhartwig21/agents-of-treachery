#!/usr/bin/env node
/**
 * Generate territories.ts from jDip SVG data
 * Run: node scripts/generate-map-paths.js
 */

const fs = require('fs');
const path = require('path');

// Read the extracted path data (use all_paths.txt which has more coverage)
const pathLines = fs.readFileSync('/tmp/all_paths.txt', 'utf-8')
  .split('\n')
  .filter(line => line.trim());

const pathData = {};
for (const line of pathLines) {
  const colonIdx = line.indexOf(':');
  if (colonIdx > 0) {
    let id = line.slice(0, colonIdx).trim();
    const pathStr = line.slice(colonIdx + 1).trim();
    // Normalize IDs: stp-nc -> stp_nc
    id = id.replace(/-/g, '_');

    // Map underscore-prefixed sea zones to our IDs
    const seaZoneMap = {
      '_nat': 'nao',  // North Atlantic Ocean
      '_nrg': 'nwg',  // Norwegian Sea
      '_bar': 'bar',  // Barents Sea
      '_mid': 'mao',  // Mid-Atlantic Ocean
      '_wes': 'wes',  // Western Mediterranean
      '_gol': 'gol',  // Gulf of Lyon
      '_tyn': 'tys',  // Tyrrhenian Sea
      '_adr': 'adr',  // Adriatic Sea
      '_ion': 'ion',  // Ionian Sea
      '_aeg': 'aeg',  // Aegean Sea
      '_eas': 'eas',  // Eastern Mediterranean
      '_bot': 'bot',  // Gulf of Bothnia
      '_bal': 'bal',  // Baltic Sea
      '_ska': 'ska',  // Skagerrak
      '_hel': 'hel',  // Heligoland Bight
      '_nth': 'nth',  // North Sea
      '_iri': 'iri',  // Irish Sea
      '_eng': 'eng',  // English Channel
      'denmark_water': null, // Skip
      'unplayable_water': null, // Skip
    };

    if (id.startsWith('_') || id === 'denmark_water' || id === 'unplayable_water') {
      if (seaZoneMap[id]) {
        id = seaZoneMap[id];
      } else {
        continue; // Skip unmapped underscore IDs
      }
    }

    // Keep first occurrence (don't overwrite)
    if (!pathData[id]) {
      pathData[id] = pathStr;
    }
  }
}

// Read the position data
const posLines = fs.readFileSync('/tmp/positions.txt', 'utf-8')
  .split('\n')
  .filter(line => line.trim());

const positionData = {};
for (const line of posLines) {
  const parts = line.split(' ');
  if (parts.length >= 3) {
    const id = parts[0].replace(/-/g, '_');
    positionData[id] = { x: parseFloat(parts[1]), y: parseFloat(parts[2]) };
  }
}

console.log(`Loaded ${Object.keys(pathData).length} paths`);
console.log(`Loaded ${Object.keys(positionData).length} positions`);

// Read the original territories.ts to get metadata
const originalPath = path.join(__dirname, '../src/data/territories.ts');
const original = fs.readFileSync(originalPath, 'utf-8');

// Parse out territory metadata from original
const territories = [];
const idRegex = /id:\s*'([^']+)'/g;
const nameRegex = /name:\s*'([^']+)'/;
const typeRegex = /type:\s*'([^']+)'/;
const scRegex = /supplyCenter:\s*(true|false)/;
const neighborsRegex = /neighbors:\s*\[([^\]]+)\]/;

// Split by territory blocks
const blocks = original.split(/\{\s*\n\s*id:/);
for (let i = 1; i < blocks.length; i++) {
  const block = '{' + '\n    id:' + blocks[i];

  const idMatch = block.match(/id:\s*'([^']+)'/);
  const nameMatch = block.match(nameRegex);
  const typeMatch = block.match(typeRegex);
  const scMatch = block.match(scRegex);
  const neighborsMatch = block.match(neighborsRegex);

  if (idMatch) {
    const id = idMatch[1];
    territories.push({
      id,
      name: nameMatch ? nameMatch[1] : id,
      type: typeMatch ? typeMatch[1] : 'land',
      supplyCenter: scMatch ? scMatch[1] === 'true' : false,
      path: pathData[id] || `M 0 0 L 10 0 L 10 10 L 0 10 Z`, // fallback
      labelX: positionData[id]?.x || 0,
      labelY: positionData[id]?.y || 0,
      neighbors: neighborsMatch
        ? neighborsMatch[1].split(',').map(s => s.trim().replace(/'/g, ''))
        : [],
    });
  }
}

console.log(`Generated ${territories.length} territories`);

// Check which territories are missing paths
const missingPaths = territories.filter(t => !pathData[t.id]);
if (missingPaths.length > 0) {
  console.log(`Missing paths for: ${missingPaths.map(t => t.id).join(', ')}`);
}

// Generate output
const output = `import type { Territory, TerritoryType } from '../types/game'

// Diplomacy map data - paths from jDip SVG
// ViewBox: 0 0 1835 1360
// Source: https://github.com/diplomacy/diplomacy (GPL License)

export const territories: Territory[] = [
${territories.map(t => `  {
    id: '${t.id}',
    name: '${t.name}',
    type: '${t.type}',
    supplyCenter: ${t.supplyCenter},
    path: '${t.path}',
    labelX: ${t.labelX},
    labelY: ${t.labelY},
    neighbors: [${t.neighbors.map(n => `'${n}'`).join(', ')}],
  },`).join('\n')}
]

// Helper to get territory by ID
export function getTerritory(id: string): Territory | undefined {
  return territories.find(t => t.id === id)
}

// Get all supply center territories
export function getSupplyCenters(): Territory[] {
  return territories.filter(t => t.supplyCenter)
}

// Get territories by type
export function getTerritoriesByType(type: TerritoryType): Territory[] {
  return territories.filter(t => t.type === type)
}
`;

fs.writeFileSync('/tmp/new_territories.ts', output);
console.log('Written to /tmp/new_territories.ts');
