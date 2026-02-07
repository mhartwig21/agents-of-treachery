/**
 * BFS-based pathfinding for Diplomacy strategic analysis.
 *
 * Provides shortest path calculations, threat assessment, and opportunity
 * analysis for AI agents making strategic decisions.
 */

import type { GameState, Power, Unit } from '../engine/types';
import { ADJACENCIES, getProvince, PROVINCES, canArmyOccupy, canFleetOccupy } from '../engine/map';

/**
 * Result of a BFS pathfinding search.
 */
export interface PathResult {
  /** Target province */
  target: string;
  /** Number of moves to reach the target (-1 if unreachable) */
  distance: number;
  /** The path from source to target (including both endpoints) */
  path: string[];
}

/**
 * Strategic analysis for a single unit.
 */
export interface UnitStrategicContext {
  /** The unit being analyzed */
  unit: Unit;
  /** Nearest enemy units with distances */
  nearestThreats: ThreatInfo[];
  /** Nearest uncontrolled supply centers */
  nearestOpportunities: OpportunityInfo[];
  /** Possible convoy routes if this is an army on a coast */
  convoyRoutes: ConvoyRoute[];
  /** Adjacent provinces and what's in them */
  adjacentStatus: AdjacentProvince[];
}

/**
 * Information about a threat (enemy unit).
 */
export interface ThreatInfo {
  /** The enemy unit */
  unit: Unit;
  /** Distance in moves */
  distance: number;
  /** Path the enemy would take */
  path: string[];
  /** Power that owns the threatening unit */
  power: Power;
}

/**
 * Information about an opportunity (supply center to capture).
 */
export interface OpportunityInfo {
  /** Province ID of the supply center */
  province: string;
  /** Distance in moves */
  distance: number;
  /** Path to reach it */
  path: string[];
  /** Current owner (undefined if neutral) */
  owner?: Power;
  /** Whether it's contested (enemy unit present) */
  contested: boolean;
}

/**
 * A possible convoy route for an army.
 */
export interface ConvoyRoute {
  /** Destination province */
  destination: string;
  /** Sea provinces needed for convoy */
  seaPath: string[];
  /** Total distance (army move + convoy) */
  totalMoves: number;
  /** Whether we have fleets in all required positions */
  feasible: boolean;
  /** Fleets needed that we don't have */
  missingFleets: string[];
}

/**
 * Status of an adjacent province.
 */
export interface AdjacentProvince {
  /** Province ID */
  province: string;
  /** Type of province */
  type: 'LAND' | 'SEA' | 'COASTAL';
  /** Whether it's a supply center */
  supplyCenter: boolean;
  /** Unit currently in the province (if any) */
  occupant?: Unit;
  /** Owner of supply center (if applicable) */
  scOwner?: Power;
}

/**
 * Complete strategic context for a power.
 */
export interface PowerStrategicContext {
  /** The power being analyzed */
  power: Power;
  /** Strategic context for each unit */
  unitContexts: UnitStrategicContext[];
  /** Global threat assessment */
  threatLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Overall expansion opportunities */
  expansionScore: number;
  /** Powers that can reach our supply centers */
  immediateThreatPowers: Power[];
  /** Neutral/enemy SCs we can reach in 1-2 moves */
  reachableTargets: OpportunityInfo[];
}

/**
 * Get all adjacent provinces for a location, handling coasted provinces.
 */
function getAdjacentProvinces(provinceId: string, coast?: string): string[] {
  // Try coast-specific adjacency first
  if (coast) {
    const coastCode = coast.charAt(0).toUpperCase() + 'C';
    const coastedKey = `${provinceId}/${coastCode}`;
    if (ADJACENCIES[coastedKey]) {
      return ADJACENCIES[coastedKey];
    }
  }

  // Fall back to base province adjacency
  const baseAdj = ADJACENCIES[provinceId] || [];

  // For provinces with coasts, also include base adjacencies
  const province = getProvince(provinceId);
  if (province?.coasts) {
    const allAdj = new Set(baseAdj);
    for (const c of province.coasts) {
      const coastedKey = `${provinceId}/${c.charAt(0).toUpperCase()}C`;
      const coastAdj = ADJACENCIES[coastedKey] || [];
      for (const adj of coastAdj) {
        allAdj.add(adj);
      }
    }
    return Array.from(allAdj);
  }

  return baseAdj;
}

/**
 * Normalize a province ID by removing coast suffixes.
 */
function normalizeProvinceId(id: string): string {
  // Remove coast suffixes like /NC, /SC, /EC
  return id.replace(/\/[A-Z]C$/, '');
}

/**
 * BFS to find shortest path between two provinces for a specific unit type.
 */
export function findShortestPath(
  from: string,
  to: string,
  unitType: 'ARMY' | 'FLEET',
  blockedProvinces: Set<string> = new Set()
): PathResult {
  const normalizedFrom = normalizeProvinceId(from);
  const normalizedTo = normalizeProvinceId(to);

  if (normalizedFrom === normalizedTo) {
    return { target: to, distance: 0, path: [from] };
  }

  const canOccupy = unitType === 'ARMY' ? canArmyOccupy : canFleetOccupy;

  // BFS
  const visited = new Set<string>();
  const queue: { province: string; path: string[] }[] = [
    { province: normalizedFrom, path: [from] }
  ];
  visited.add(normalizedFrom);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const adjacent = getAdjacentProvinces(current.province);

    for (const adj of adjacent) {
      const normalizedAdj = normalizeProvinceId(adj);

      if (visited.has(normalizedAdj)) continue;
      if (blockedProvinces.has(normalizedAdj)) continue;
      if (!canOccupy(normalizedAdj)) continue;

      visited.add(normalizedAdj);
      const newPath = [...current.path, normalizedAdj];

      if (normalizedAdj === normalizedTo) {
        return { target: to, distance: newPath.length - 1, path: newPath };
      }

      queue.push({ province: normalizedAdj, path: newPath });
    }
  }

  // No path found
  return { target: to, distance: -1, path: [] };
}

/**
 * Calculate distances from a source to all reachable provinces.
 */
export function calculateDistances(
  from: string,
  unitType: 'ARMY' | 'FLEET',
  maxDistance: number = 10
): Map<string, number> {
  const distances = new Map<string, number>();
  const normalizedFrom = normalizeProvinceId(from);
  distances.set(normalizedFrom, 0);

  const canOccupy = unitType === 'ARMY' ? canArmyOccupy : canFleetOccupy;

  const queue: { province: string; distance: number }[] = [
    { province: normalizedFrom, distance: 0 }
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.distance >= maxDistance) continue;

    const adjacent = getAdjacentProvinces(current.province);

    for (const adj of adjacent) {
      const normalizedAdj = normalizeProvinceId(adj);

      if (distances.has(normalizedAdj)) continue;
      if (!canOccupy(normalizedAdj)) continue;

      const newDist = current.distance + 1;
      distances.set(normalizedAdj, newDist);
      queue.push({ province: normalizedAdj, distance: newDist });
    }
  }

  return distances;
}

/**
 * Find nearest threats to a unit.
 */
export function findNearestThreats(
  unit: Unit,
  state: GameState,
  maxThreats: number = 3
): ThreatInfo[] {
  const threats: ThreatInfo[] = [];
  const myPower = unit.power;

  // Find all enemy units
  const enemyUnits = state.units.filter(u => u.power !== myPower);

  for (const enemy of enemyUnits) {
    const pathResult = findShortestPath(
      enemy.province,
      unit.province,
      enemy.type
    );

    if (pathResult.distance > 0) {
      threats.push({
        unit: enemy,
        distance: pathResult.distance,
        path: pathResult.path,
        power: enemy.power
      });
    }
  }

  // Sort by distance and return top N
  return threats
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxThreats);
}

/**
 * Find nearest supply center opportunities for a unit.
 */
export function findNearestOpportunities(
  unit: Unit,
  state: GameState,
  maxOpportunities: number = 5
): OpportunityInfo[] {
  const opportunities: OpportunityInfo[] = [];
  const myPower = unit.power;

  // Get all supply centers not owned by this power
  const targetSCs = PROVINCES
    .filter(p => p.supplyCenter)
    .filter(p => state.supplyCenters.get(p.id) !== myPower);

  // Create a set of occupied provinces
  const occupiedProvinces = new Map<string, Unit>();
  for (const u of state.units) {
    occupiedProvinces.set(u.province, u);
  }

  for (const sc of targetSCs) {
    const pathResult = findShortestPath(
      unit.province,
      sc.id,
      unit.type
    );

    if (pathResult.distance > 0) {
      const occupant = occupiedProvinces.get(sc.id);
      const contested = occupant !== undefined && occupant.power !== myPower;
      const owner = state.supplyCenters.get(sc.id);

      opportunities.push({
        province: sc.id,
        distance: pathResult.distance,
        path: pathResult.path,
        owner,
        contested
      });
    }
  }

  // Sort by distance and return top N
  return opportunities
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxOpportunities);
}

/**
 * Find possible convoy routes for an army.
 */
export function findConvoyRoutes(
  army: Unit,
  _state: GameState,
  myFleets: Unit[],
  maxRoutes: number = 3
): ConvoyRoute[] {
  if (army.type !== 'ARMY') return [];

  const armyProvince = getProvince(army.province);
  if (!armyProvince || armyProvince.type === 'LAND') {
    // Army not on coast, can't be convoyed
    return [];
  }

  const routes: ConvoyRoute[] = [];
  const myFleetPositions = new Set(myFleets.map(f => f.province));

  // Find coastal provinces reachable via convoy
  // BFS through sea provinces to find coastal destinations
  const visited = new Set<string>();
  const queue: { province: string; seaPath: string[] }[] = [];

  // Start from sea provinces adjacent to the army
  const armyAdjacent = getAdjacentProvinces(army.province);
  for (const adj of armyAdjacent) {
    const adjProv = getProvince(normalizeProvinceId(adj));
    if (adjProv?.type === 'SEA') {
      visited.add(adjProv.id);
      queue.push({ province: adjProv.id, seaPath: [adjProv.id] });
    }
  }

  while (queue.length > 0 && routes.length < maxRoutes * 2) {
    const current = queue.shift()!;
    const adjacent = getAdjacentProvinces(current.province);

    for (const adj of adjacent) {
      const normalizedAdj = normalizeProvinceId(adj);
      const adjProv = getProvince(normalizedAdj);

      if (!adjProv) continue;

      if (adjProv.type === 'SEA') {
        // Continue through sea
        if (!visited.has(normalizedAdj)) {
          visited.add(normalizedAdj);
          queue.push({
            province: normalizedAdj,
            seaPath: [...current.seaPath, normalizedAdj]
          });
        }
      } else if (adjProv.type === 'COASTAL' && normalizedAdj !== army.province) {
        // Potential destination
        const seaPath = current.seaPath;
        const missingFleets = seaPath.filter(sp => !myFleetPositions.has(sp));
        const feasible = missingFleets.length === 0;

        routes.push({
          destination: normalizedAdj,
          seaPath,
          totalMoves: 1, // Convoy is simultaneous
          feasible,
          missingFleets
        });
      }
    }
  }

  // Sort by feasibility and path length
  return routes
    .sort((a, b) => {
      if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
      return a.seaPath.length - b.seaPath.length;
    })
    .slice(0, maxRoutes);
}

/**
 * Get strategic context for adjacent provinces.
 */
export function getAdjacentStatus(
  unit: Unit,
  state: GameState
): AdjacentProvince[] {
  const adjacent: AdjacentProvince[] = [];
  const occupiedProvinces = new Map<string, Unit>();

  for (const u of state.units) {
    occupiedProvinces.set(u.province, u);
  }

  const adjProvinces = getAdjacentProvinces(unit.province, unit.coast);

  for (const adj of adjProvinces) {
    const normalizedAdj = normalizeProvinceId(adj);
    const prov = getProvince(normalizedAdj);

    if (!prov) continue;

    // Check if unit can actually move there
    const canMove = unit.type === 'ARMY'
      ? canArmyOccupy(normalizedAdj)
      : canFleetOccupy(normalizedAdj);

    if (!canMove) continue;

    adjacent.push({
      province: normalizedAdj,
      type: prov.type,
      supplyCenter: prov.supplyCenter,
      occupant: occupiedProvinces.get(normalizedAdj),
      scOwner: prov.supplyCenter
        ? state.supplyCenters.get(normalizedAdj)
        : undefined
    });
  }

  return adjacent;
}

/**
 * Generate complete strategic context for a unit.
 */
export function generateUnitStrategicContext(
  unit: Unit,
  state: GameState
): UnitStrategicContext {
  const myFleets = state.units.filter(
    u => u.power === unit.power && u.type === 'FLEET'
  );

  return {
    unit,
    nearestThreats: findNearestThreats(unit, state),
    nearestOpportunities: findNearestOpportunities(unit, state),
    convoyRoutes: findConvoyRoutes(unit, state, myFleets),
    adjacentStatus: getAdjacentStatus(unit, state)
  };
}

/**
 * Calculate overall threat level for a power.
 */
export function calculateThreatLevel(
  power: Power,
  state: GameState
): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  const myUnits = state.units.filter(u => u.power === power);
  const mySCs = Array.from(state.supplyCenters.entries())
    .filter(([, owner]) => owner === power)
    .map(([sc]) => sc);

  // Count enemy units within 2 moves of our supply centers
  let threatsToSCs = 0;
  let immediateThreats = 0;

  for (const sc of mySCs) {
    for (const enemy of state.units) {
      if (enemy.power === power) continue;

      const path = findShortestPath(enemy.province, sc, enemy.type);
      if (path.distance === 1) immediateThreats++;
      if (path.distance <= 2) threatsToSCs++;
    }
  }

  // Check if we're significantly outnumbered locally
  const myUnitCount = myUnits.length;
  const neighborThreats = state.units.filter(u => u.power !== power).length;

  if (immediateThreats >= 3 || threatsToSCs >= mySCs.length * 2) {
    return 'CRITICAL';
  }
  if (immediateThreats >= 2 || neighborThreats > myUnitCount * 2) {
    return 'HIGH';
  }
  if (immediateThreats >= 1 || threatsToSCs >= mySCs.length) {
    return 'MEDIUM';
  }
  return 'LOW';
}

/**
 * Find all powers that can reach our supply centers within N moves.
 */
export function findImmediateThreatPowers(
  power: Power,
  state: GameState,
  maxDistance: number = 2
): Power[] {
  const threatPowers = new Set<Power>();
  const mySCs = Array.from(state.supplyCenters.entries())
    .filter(([, owner]) => owner === power)
    .map(([sc]) => sc);

  for (const sc of mySCs) {
    for (const enemy of state.units) {
      if (enemy.power === power) continue;
      if (threatPowers.has(enemy.power)) continue;

      const path = findShortestPath(enemy.province, sc, enemy.type);
      if (path.distance > 0 && path.distance <= maxDistance) {
        threatPowers.add(enemy.power);
      }
    }
  }

  return Array.from(threatPowers);
}

/**
 * Find supply centers reachable by any of our units within N moves.
 */
export function findReachableTargets(
  power: Power,
  state: GameState,
  maxDistance: number = 2
): OpportunityInfo[] {
  const myUnits = state.units.filter(u => u.power === power);
  const targetMap = new Map<string, OpportunityInfo>();

  const occupiedProvinces = new Map<string, Unit>();
  for (const u of state.units) {
    occupiedProvinces.set(u.province, u);
  }

  for (const unit of myUnits) {
    const opportunities = findNearestOpportunities(unit, state, 10);

    for (const opp of opportunities) {
      if (opp.distance > maxDistance) continue;

      const existing = targetMap.get(opp.province);
      if (!existing || existing.distance > opp.distance) {
        targetMap.set(opp.province, opp);
      }
    }
  }

  return Array.from(targetMap.values())
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Generate complete strategic context for a power.
 */
export function generatePowerStrategicContext(
  power: Power,
  state: GameState
): PowerStrategicContext {
  const myUnits = state.units.filter(u => u.power === power);

  const unitContexts = myUnits.map(unit =>
    generateUnitStrategicContext(unit, state)
  );

  // Calculate expansion score based on reachable SCs
  const reachableTargets = findReachableTargets(power, state, 2);
  const expansionScore = reachableTargets.reduce((score, target) => {
    const distanceWeight = target.distance === 1 ? 2 : 1;
    const contestedPenalty = target.contested ? 0.5 : 1;
    return score + distanceWeight * contestedPenalty;
  }, 0);

  return {
    power,
    unitContexts,
    threatLevel: calculateThreatLevel(power, state),
    expansionScore,
    immediateThreatPowers: findImmediateThreatPowers(power, state),
    reachableTargets
  };
}

/**
 * Format strategic context as XML for inclusion in agent prompts.
 */
export function formatStrategicContextXML(
  context: PowerStrategicContext
): string {
  const lines: string[] = [];

  lines.push('<strategic_analysis>');
  lines.push(`  <threat_level>${context.threatLevel}</threat_level>`);
  lines.push(`  <expansion_score>${context.expansionScore.toFixed(1)}</expansion_score>`);

  if (context.immediateThreatPowers.length > 0) {
    lines.push(`  <immediate_threats>${context.immediateThreatPowers.join(', ')}</immediate_threats>`);
  }

  // Reachable targets
  if (context.reachableTargets.length > 0) {
    lines.push('  <reachable_supply_centers>');
    for (const target of context.reachableTargets.slice(0, 5)) {
      const ownerStr = target.owner ? ` owner="${target.owner}"` : ' owner="neutral"';
      const contestedStr = target.contested ? ' contested="true"' : '';
      lines.push(`    <sc province="${target.province}" distance="${target.distance}"${ownerStr}${contestedStr} path="${target.path.join(' -> ')}" />`);
    }
    lines.push('  </reachable_supply_centers>');
  }

  // Per-unit analysis
  lines.push('  <units>');
  for (const unitCtx of context.unitContexts) {
    const unit = unitCtx.unit;
    const typeChar = unit.type === 'ARMY' ? 'A' : 'F';
    const coastStr = unit.coast ? ` coast="${unit.coast}"` : '';

    lines.push(`    <unit type="${typeChar}" province="${unit.province}"${coastStr}>`);

    // Threats
    if (unitCtx.nearestThreats.length > 0) {
      lines.push('      <threats>');
      for (const threat of unitCtx.nearestThreats.slice(0, 2)) {
        const threatType = threat.unit.type === 'ARMY' ? 'A' : 'F';
        lines.push(`        <threat power="${threat.power}" unit="${threatType} ${threat.unit.province}" distance="${threat.distance}" />`);
      }
      lines.push('      </threats>');
    }

    // Opportunities
    if (unitCtx.nearestOpportunities.length > 0) {
      lines.push('      <opportunities>');
      for (const opp of unitCtx.nearestOpportunities.slice(0, 3)) {
        const ownerStr = opp.owner ? ` owner="${opp.owner}"` : ' owner="neutral"';
        lines.push(`        <target province="${opp.province}" distance="${opp.distance}"${ownerStr} />`);
      }
      lines.push('      </opportunities>');
    }

    // Convoy routes (for armies on coast)
    const feasibleConvoys = unitCtx.convoyRoutes.filter(r => r.feasible);
    if (feasibleConvoys.length > 0) {
      lines.push('      <convoy_options>');
      for (const route of feasibleConvoys.slice(0, 2)) {
        lines.push(`        <route destination="${route.destination}" via="${route.seaPath.join(', ')}" />`);
      }
      lines.push('      </convoy_options>');
    }

    // Adjacent provinces
    lines.push('      <adjacent>');
    for (const adj of unitCtx.adjacentStatus) {
      const scStr = adj.supplyCenter ? ' sc="true"' : '';
      const occupantStr = adj.occupant
        ? ` occupant="${adj.occupant.power} ${adj.occupant.type === 'ARMY' ? 'A' : 'F'}"`
        : '';
      lines.push(`        <province id="${adj.province}"${scStr}${occupantStr} />`);
    }
    lines.push('      </adjacent>');

    lines.push('    </unit>');
  }
  lines.push('  </units>');

  lines.push('</strategic_analysis>');

  return lines.join('\n');
}

/**
 * Format strategic context as markdown for prompts.
 */
export function formatStrategicContextMarkdown(
  context: PowerStrategicContext
): string {
  const lines: string[] = [];

  lines.push('## Strategic Analysis');
  lines.push('');
  lines.push(`**Threat Level**: ${context.threatLevel}`);
  lines.push(`**Expansion Potential**: ${context.expansionScore.toFixed(1)}`);

  if (context.immediateThreatPowers.length > 0) {
    lines.push(`**Immediate Threats From**: ${context.immediateThreatPowers.join(', ')}`);
  }
  lines.push('');

  // Reachable targets
  if (context.reachableTargets.length > 0) {
    lines.push('### Reachable Supply Centers');
    for (const target of context.reachableTargets.slice(0, 5)) {
      const ownerStr = target.owner ? `(${target.owner})` : '(neutral)';
      const contestedStr = target.contested ? ' [CONTESTED]' : '';
      lines.push(`- **${target.province}** ${ownerStr}: ${target.distance} move(s)${contestedStr}`);
      lines.push(`  Path: ${target.path.join(' -> ')}`);
    }
    lines.push('');
  }

  // Per-unit analysis
  lines.push('### Unit Analysis');
  for (const unitCtx of context.unitContexts) {
    const unit = unitCtx.unit;
    const typeStr = unit.type === 'ARMY' ? 'Army' : 'Fleet';
    const coastStr = unit.coast ? ` (${unit.coast} coast)` : '';

    lines.push(`\n#### ${typeStr} ${unit.province}${coastStr}`);

    // Threats
    if (unitCtx.nearestThreats.length > 0) {
      lines.push('**Nearest Threats**:');
      for (const threat of unitCtx.nearestThreats.slice(0, 2)) {
        const threatType = threat.unit.type === 'ARMY' ? 'A' : 'F';
        lines.push(`- ${threat.power} ${threatType} ${threat.unit.province} (${threat.distance} moves away)`);
      }
    }

    // Opportunities
    if (unitCtx.nearestOpportunities.length > 0) {
      lines.push('**Nearest Targets**:');
      for (const opp of unitCtx.nearestOpportunities.slice(0, 3)) {
        const ownerStr = opp.owner ? `${opp.owner}'s` : 'neutral';
        lines.push(`- ${opp.province} (${ownerStr}, ${opp.distance} moves)`);
      }
    }

    // Convoy options
    const feasibleConvoys = unitCtx.convoyRoutes.filter(r => r.feasible);
    if (feasibleConvoys.length > 0) {
      lines.push('**Convoy Options**:');
      for (const route of feasibleConvoys.slice(0, 2)) {
        lines.push(`- Can convoy to ${route.destination} via ${route.seaPath.join(', ')}`);
      }
    }

    // Can move to
    const emptyAdjacent = unitCtx.adjacentStatus.filter(a => !a.occupant);
    const scAdjacent = emptyAdjacent.filter(a => a.supplyCenter);
    if (scAdjacent.length > 0) {
      lines.push(`**Can reach SCs**: ${scAdjacent.map(a => a.province).join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Bilateral strategic context between two powers for diplomatic messaging.
 */
export interface DiplomacyStrategicContext {
  /** The power sending the message */
  fromPower: Power;
  /** The power receiving the message */
  toPower: Power;
  /** Supply centers both powers can reach (potential competition or cooperation) */
  contestedTargets: Array<{
    province: string;
    fromDistance: number;
    toDistance: number;
    currentOwner?: Power;
  }>;
  /** Common threat powers that threaten both */
  commonThreats: Power[];
  /** Whether powers share a border (adjacent units) */
  sharesBorder: boolean;
  /** Number of units threatening each other */
  mutualThreatCount: { fromTo: number; toFrom: number };
  /** Summary of strategic relationship */
  relationshipType: 'NEIGHBOR' | 'DISTANT' | 'RIVAL' | 'POTENTIAL_ALLY';
  /** Specific strategic stakes */
  stakes: string[];
}

/**
 * Generate bilateral strategic context for diplomatic communication.
 */
export function generateDiplomacyContext(
  fromPower: Power,
  toPower: Power,
  state: GameState
): DiplomacyStrategicContext {
  const fromUnits = state.units.filter(u => u.power === fromPower);
  const toUnits = state.units.filter(u => u.power === toPower);

  // Find contested targets - SCs both powers can reach within 2 moves
  const fromReachable = findReachableTargets(fromPower, state, 2);
  const toReachable = findReachableTargets(toPower, state, 2);

  const contestedTargets: DiplomacyStrategicContext['contestedTargets'] = [];
  for (const fromTarget of fromReachable) {
    const toTarget = toReachable.find(t => t.province === fromTarget.province);
    if (toTarget) {
      contestedTargets.push({
        province: fromTarget.province,
        fromDistance: fromTarget.distance,
        toDistance: toTarget.distance,
        currentOwner: fromTarget.owner
      });
    }
  }

  // Find common threats - powers that threaten both
  const fromThreats = findImmediateThreatPowers(fromPower, state);
  const toThreats = findImmediateThreatPowers(toPower, state);
  const commonThreats = fromThreats.filter(p => toThreats.includes(p) && p !== fromPower && p !== toPower);

  // Check if powers share a border (any units adjacent)
  let sharesBorder = false;
  for (const fromUnit of fromUnits) {
    const adj = getAdjacentProvinces(fromUnit.province, fromUnit.coast);
    for (const toUnit of toUnits) {
      if (adj.includes(toUnit.province)) {
        sharesBorder = true;
        break;
      }
    }
    if (sharesBorder) break;
  }

  // Count mutual threats
  let fromToThreats = 0;
  let toFromThreats = 0;

  for (const fromUnit of fromUnits) {
    const adj = getAdjacentProvinces(fromUnit.province, fromUnit.coast);
    for (const toUnit of toUnits) {
      if (adj.includes(toUnit.province)) {
        fromToThreats++;
      }
    }
  }

  for (const toUnit of toUnits) {
    const adj = getAdjacentProvinces(toUnit.province, toUnit.coast);
    for (const fromUnit of fromUnits) {
      if (adj.includes(fromUnit.province)) {
        toFromThreats++;
      }
    }
  }

  // Determine relationship type
  let relationshipType: DiplomacyStrategicContext['relationshipType'];
  if (contestedTargets.length >= 3 && sharesBorder) {
    relationshipType = 'RIVAL';
  } else if (commonThreats.length > 0 && !sharesBorder) {
    relationshipType = 'POTENTIAL_ALLY';
  } else if (sharesBorder) {
    relationshipType = 'NEIGHBOR';
  } else {
    relationshipType = 'DISTANT';
  }

  // Generate strategic stakes
  const stakes: string[] = [];

  // Contested neutrals
  const contestedNeutrals = contestedTargets.filter(t => !t.currentOwner);
  if (contestedNeutrals.length > 0) {
    stakes.push(`Both can reach neutral SCs: ${contestedNeutrals.map(t => t.province).join(', ')}`);
  }

  // SCs owned by one that other can reach
  const fromOwnedTargeted = contestedTargets.filter(t => t.currentOwner === fromPower);
  const toOwnedTargeted = contestedTargets.filter(t => t.currentOwner === toPower);

  if (fromOwnedTargeted.length > 0) {
    stakes.push(`${toPower} can reach your SCs: ${fromOwnedTargeted.map(t => t.province).join(', ')}`);
  }
  if (toOwnedTargeted.length > 0) {
    stakes.push(`You can reach ${toPower}'s SCs: ${toOwnedTargeted.map(t => t.province).join(', ')}`);
  }

  // Common threats
  if (commonThreats.length > 0) {
    stakes.push(`Common threat: ${commonThreats.join(', ')} threatens both of you`);
  }

  // Border tension
  if (fromToThreats > 0 || toFromThreats > 0) {
    stakes.push(`Border tension: ${fromToThreats + toFromThreats} units in contact`);
  }

  return {
    fromPower,
    toPower,
    contestedTargets,
    commonThreats,
    sharesBorder,
    mutualThreatCount: { fromTo: fromToThreats, toFrom: toFromThreats },
    relationshipType,
    stakes
  };
}

/**
 * Format bilateral diplomatic context for inclusion in prompts.
 */
export function formatDiplomacyContextMarkdown(
  context: DiplomacyStrategicContext
): string {
  const lines: string[] = [];

  lines.push(`### Strategic Context with ${context.toPower}`);
  lines.push('');
  lines.push(`**Relationship**: ${context.relationshipType}`);

  if (context.stakes.length > 0) {
    lines.push('');
    lines.push('**What\'s at stake:**');
    for (const stake of context.stakes) {
      lines.push(`- ${stake}`);
    }
  }

  if (context.contestedTargets.length > 0) {
    lines.push('');
    lines.push('**Contested territories:**');
    for (const target of context.contestedTargets.slice(0, 3)) {
      const owner = target.currentOwner ? `(${target.currentOwner})` : '(neutral)';
      const advantage = target.fromDistance < target.toDistance ? 'you closer' :
        target.fromDistance > target.toDistance ? `${context.toPower} closer` : 'equidistant';
      lines.push(`- ${target.province} ${owner}: ${advantage}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate all bilateral contexts for diplomacy phase.
 */
export function generateAllDiplomacyContexts(
  power: Power,
  state: GameState
): Map<Power, DiplomacyStrategicContext> {
  const ALL_POWERS: Power[] = ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'];
  const contexts = new Map<Power, DiplomacyStrategicContext>();

  for (const otherPower of ALL_POWERS) {
    if (otherPower !== power) {
      // Only include powers still in the game
      const hasUnits = state.units.some(u => u.power === otherPower);
      const hasSCs = Array.from(state.supplyCenters.values()).some(owner => owner === otherPower);

      if (hasUnits || hasSCs) {
        contexts.set(otherPower, generateDiplomacyContext(power, otherPower, state));
      }
    }
  }

  return contexts;
}
