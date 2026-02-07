/**
 * Progressive context compression for agent prompts.
 *
 * Reduces context window usage as games progress by:
 * 1. Compressing static content (rules, strategy) after early turns
 * 2. Summarizing distant/irrelevant powers in game state
 * 3. Trimming diary and event history based on turn number
 * 4. Tracking token usage for monitoring
 *
 * Target: <30% context at turn 10, <60% at turn 20.
 */

import type { Power } from '../engine/types';
import type { AgentGameView, AgentMemory } from './types';

/**
 * Short power name abbreviations for compact game state notation.
 */
export const POWER_SHORT: Record<string, string> = {
  ENGLAND: 'ENGLAND',
  FRANCE: 'FRA',
  GERMANY: 'GER',
  ITALY: 'ITA',
  AUSTRIA: 'AUS',
  RUSSIA: 'RUS',
  TURKEY: 'TUR',
};

/**
 * Format units in compact grouped notation: [A:PAR,MAR F:BRE]
 */
export function formatCompactUnits(units: Array<{ type: string; province: string; coast?: string }>): string {
  const armies: string[] = [];
  const fleets: string[] = [];
  for (const u of units) {
    const prov = u.coast ? `${u.province}/${u.coast.charAt(0).toUpperCase()}C` : u.province;
    if (u.type === 'ARMY') armies.push(prov);
    else fleets.push(prov);
  }
  const parts: string[] = [];
  if (armies.length > 0) parts.push(`A:${armies.join(',')}`);
  if (fleets.length > 0) parts.push(`F:${fleets.join(',')}`);
  return parts.length > 0 ? `[${parts.join(' ')}]` : '[]';
}

/**
 * Compression level based on game progress.
 */
export type CompressionLevel = 'none' | 'moderate' | 'aggressive';

/**
 * Token budget allocation for different prompt sections.
 */
export interface TokenBudget {
  rules: number;
  strategy: number;
  gameState: number;
  relationships: number;
  diary: number;
  events: number;
  notes: number;
  messages: number;
  instructions: number;
}

/**
 * Context usage statistics for monitoring.
 */
export interface ContextStats {
  turnNumber: number;
  compressionLevel: CompressionLevel;
  systemPromptTokens: number;
  turnPromptTokens: number;
  totalTokens: number;
  /** Ratio of compressed to uncompressed (0-1) */
  compressionRatio: number;
}

/**
 * Estimate token count from text (rough: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Determine compression level based on turn number.
 *
 * - Turns 1-3: none (full context, agent is learning the game)
 * - Turns 4-8: moderate (compress static content, summarize distant powers)
 * - Turns 9+: aggressive (minimal rules, only relevant powers, tight diary)
 */
export function getCompressionLevel(turnNumber: number): CompressionLevel {
  if (turnNumber <= 3) return 'none';
  if (turnNumber <= 8) return 'moderate';
  return 'aggressive';
}

// ============================================================================
// Rules & Strategy Compression
// ============================================================================

/**
 * Condensed rules reference for moderate compression.
 * Omits detailed explanations, keeps key mechanics.
 */
const COMPRESSED_RULES_MODERATE = `## Rules Reference
- **Victory**: 18 of 34 supply centers. Draw by mutual agreement.
- **Phases**: DIPLOMACY → MOVEMENT → RETREAT → BUILD (Winter).
- **Orders**: HOLD (defend), MOVE (attack adjacent), SUPPORT (+1 strength), CONVOY (fleet transports army).
- **Combat**: Attacker > Defender wins. Equal = standoff. Support cut if attacked.
- **Builds**: Only in HOME SCs you control AND are unoccupied. Must disband if units > SCs.`;

/**
 * Minimal rules reminder for aggressive compression.
 */
const COMPRESSED_RULES_AGGRESSIVE = `## Rules (Brief)
Victory: 18 SCs. Orders: HOLD/MOVE/SUPPORT/CONVOY. Attacker > Defender wins. Equal = standoff. Support cut if attacked. Build in unoccupied home SCs.`;

/**
 * Condensed strategy for moderate compression.
 */
const COMPRESSED_STRATEGY_MODERATE = `## Strategy Notes
- Early alliances crucial. No power wins alone.
- Watch what powers DO, not what they SAY.
- Control key centers: Munich, Warsaw, Constantinople, Tunis, Spain.
- Breaking promises destroys trust. Growing too fast makes you a target.`;

/**
 * Minimal strategy for aggressive compression.
 */
const COMPRESSED_STRATEGY_AGGRESSIVE = `## Strategy
Ally early. Watch actions not words. Control key SCs. Don't grow too fast.`;

/**
 * Compress rules text based on compression level.
 */
export function compressRules(fullRules: string, level: CompressionLevel): string {
  switch (level) {
    case 'none': return fullRules;
    case 'moderate': return COMPRESSED_RULES_MODERATE;
    case 'aggressive': return COMPRESSED_RULES_AGGRESSIVE;
  }
}

/**
 * Compress strategy text based on compression level.
 */
export function compressStrategy(fullStrategy: string, level: CompressionLevel): string {
  switch (level) {
    case 'none': return fullStrategy;
    case 'moderate': return COMPRESSED_STRATEGY_MODERATE;
    case 'aggressive': return COMPRESSED_STRATEGY_AGGRESSIVE;
  }
}

/**
 * Compress power-specific strategy based on compression level.
 * After early game, the agent should know its own power's strategy.
 */
export function compressPowerStrategy(fullStrategy: string, level: CompressionLevel): string {
  switch (level) {
    case 'none': return fullStrategy;
    case 'moderate': return fullStrategy; // Keep power strategy in moderate
    case 'aggressive': return ''; // Omit in aggressive - agent should know by now
  }
}

// ============================================================================
// Game State Compression
// ============================================================================

/**
 * Determine which powers are "relevant" to show in detail.
 * Relevant = adjacent/threatening, allies, or leading powers.
 */
export function getRelevantPowers(
  view: AgentGameView,
  memory: AgentMemory
): Set<Power> {
  const relevant = new Set<Power>();

  // Build set of provinces our units occupy + can reach
  const myProvinces = new Set(view.myUnits.map(u => u.province));
  const myReach = new Set<string>(myProvinces);
  for (const unit of view.myUnits) {
    for (const adj of (unit.adjacentProvinces ?? [])) {
      myReach.add(adj);
    }
  }

  for (const [power, units] of view.otherUnits) {
    // A power is adjacent if:
    // 1. Any of their units are in our reach (we can move to their province)
    // 2. Any of their units can reach our provinces
    // 3. Their units share reachable provinces with ours (contest zones)
    let isAdjacent = false;
    for (const unit of units) {
      if (myReach.has(unit.province)) {
        isAdjacent = true;
        break;
      }
      for (const adj of (unit.adjacentProvinces ?? [])) {
        if (myProvinces.has(adj) || myReach.has(adj)) {
          // They can reach a province we can also reach = contested zone
          isAdjacent = true;
          break;
        }
      }
      if (isAdjacent) break;
    }
    if (isAdjacent) {
      relevant.add(power);
    }
  }

  // Include allies and enemies
  for (const ally of memory.currentAllies) {
    relevant.add(ally);
  }
  for (const enemy of memory.currentEnemies) {
    relevant.add(enemy);
  }

  // Include leading power if they have >= 12 SCs
  for (const [power, count] of view.supplyCenterCounts) {
    if (power !== view.viewingPower && count >= 12) {
      relevant.add(power);
    }
  }

  return relevant;
}

/**
 * Build compressed game state section using compact notation.
 * Format: POWER: Xu/Ysc [A:prov,prov F:prov,prov] SC:prov,prov
 */
export function compressGameState(
  view: AgentGameView,
  level: CompressionLevel,
  relevantPowers?: Set<Power>
): string {
  if (level === 'none') {
    return ''; // Signal to use the full game state builder
  }

  const lines: string[] = [];
  lines.push(`## Current Game State`);
  lines.push(`Y:${view.year} S:${view.season} P:${view.phase}`);

  // Your forces - compact notation
  const yourSCs = view.supplyCenters.get(view.viewingPower) ?? [];
  const shortName = POWER_SHORT[view.viewingPower] ?? view.viewingPower;
  lines.push(`You (${shortName}): ${view.myUnits.length}u/${yourSCs.length}sc ${formatCompactUnits(view.myUnits)} SC:${yourSCs.join(',') || 'none'}`);

  // Other powers - compact notation
  const summarizedPowers: string[] = [];
  for (const [power, units] of view.otherUnits) {
    const scs = view.supplyCenters.get(power) ?? [];
    const isRelevant = relevantPowers?.has(power) ?? true;
    const pShort = POWER_SHORT[power] ?? power;

    if (level === 'moderate' || isRelevant) {
      lines.push(`${pShort}: ${units.length}u/${scs.length}sc ${formatCompactUnits(units)} SC:${scs.join(',') || 'none'}`);
    } else {
      summarizedPowers.push(`${pShort}:${units.length}u/${scs.length}sc`);
    }
  }

  if (summarizedPowers.length > 0) {
    lines.push(`Others: ${summarizedPowers.join(' | ')}`);
  }

  // Pending retreats
  if (view.pendingRetreats && view.pendingRetreats.length > 0) {
    lines.push(`Retreats:`);
    for (const retreat of view.pendingRetreats) {
      const unitStr = `${retreat.unit.type === 'ARMY' ? 'A' : 'F'} ${retreat.unit.province}`;
      const opts = retreat.retreatOptions.length > 0 ? retreat.retreatOptions.join(', ') : 'MUST DISBAND';
      lines.push(`${unitStr} from ${retreat.dislodgedFrom} -> ${opts}`);
    }
  }

  // Build count
  if (view.buildCount !== undefined) {
    if (view.buildCount > 0) {
      lines.push(`Builds: ${view.buildCount}`);
      if (view.availableBuildLocations) {
        lines.push(`Locs: ${view.availableBuildLocations.join(',')}`);
      }
    } else if (view.buildCount < 0) {
      lines.push(`Must disband: ${Math.abs(view.buildCount)}`);
    }
  }

  // Last order results
  if (view.lastOrderResults && view.lastOrderResults.length > 0) {
    if (level === 'aggressive') {
      const failures = view.lastOrderResults.filter(r => !r.success);
      if (failures.length > 0) {
        lines.push(`Failed:`);
        for (const result of failures) {
          lines.push(`✗ ${result.order} (${result.reason ?? 'failed'})`);
        }
      } else {
        lines.push(`All orders succeeded.`);
      }
    } else {
      lines.push(`Results:`);
      for (const result of view.lastOrderResults) {
        const status = result.success ? '✓' : '✗';
        const reason = result.reason ? ` (${result.reason})` : '';
        lines.push(`${status} ${result.order}${reason}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Memory & Diary Compression
// ============================================================================

/**
 * Get max recent events to include based on compression level.
 */
export function getMaxRecentEvents(level: CompressionLevel): number {
  switch (level) {
    case 'none': return 5;
    case 'moderate': return 3;
    case 'aggressive': return 2;
  }
}

/**
 * Get max current year diary entries to include.
 */
export function getMaxDiaryEntries(level: CompressionLevel): number {
  switch (level) {
    case 'none': return 10;
    case 'moderate': return 6;
    case 'aggressive': return 4;
  }
}

/**
 * Get max year summaries to include.
 * Older summaries are dropped in aggressive mode.
 */
export function getMaxYearSummaries(level: CompressionLevel): number {
  switch (level) {
    case 'none': return Infinity;
    case 'moderate': return 5;
    case 'aggressive': return 3;
  }
}

/**
 * Get max diplomatic messages to include.
 */
export function getMaxRecentMessages(level: CompressionLevel): number {
  switch (level) {
    case 'none': return Infinity;
    case 'moderate': return 10;
    case 'aggressive': return 6;
  }
}

/**
 * Compress the diary context based on compression level.
 */
export function compressDiaryContext(
  memory: AgentMemory,
  level: CompressionLevel
): string {
  if (level === 'none') return ''; // Signal to use default

  const sections: string[] = [];
  const maxYearSummaries = getMaxYearSummaries(level);
  const maxDiaryEntries = getMaxDiaryEntries(level);

  // Year summaries - keep only recent ones in aggressive mode
  if (memory.yearSummaries && memory.yearSummaries.length > 0) {
    const summaries = memory.yearSummaries.slice(-maxYearSummaries);
    const skipped = memory.yearSummaries.length - summaries.length;

    sections.push('## Past Years Summary');
    if (skipped > 0) {
      sections.push(`*(${skipped} earlier years omitted)*`);
    }
    for (const summary of summaries) {
      if (level === 'aggressive') {
        // One-line per year
        const firstLine = summary.summary.split('\n')[0];
        sections.push(`**Year ${summary.year}:** ${firstLine}`);
      } else {
        sections.push(`**Year ${summary.year}:** ${summary.summary}`);
        if (summary.territorialChanges.length > 0) {
          sections.push(`  Territorial: ${summary.territorialChanges.join(', ')}`);
        }
        if (summary.diplomaticChanges.length > 0) {
          sections.push(`  Diplomatic: ${summary.diplomaticChanges.join(', ')}`);
        }
      }
    }
  }

  // Current year diary - limit entries
  if (memory.currentYearDiary && memory.currentYearDiary.length > 0) {
    sections.push('\n## Current Year Diary');
    const entries = memory.currentYearDiary.slice(-maxDiaryEntries);
    const skipped = memory.currentYearDiary.length - entries.length;

    if (skipped > 0) {
      sections.push(`*(${skipped} earlier entries omitted)*`);
    }
    for (const entry of entries) {
      if (level === 'aggressive') {
        // Truncate long entries
        const truncated = entry.content.length > 150
          ? entry.content.slice(0, 150) + '...'
          : entry.content;
        sections.push(`${entry.phase}: ${truncated}`);
      } else {
        sections.push(`${entry.phase} [${entry.type}]: ${entry.content}`);
      }
    }
  }

  return sections.length > 0 ? sections.join('\n') : '';
}

// ============================================================================
// Order Format Compression
// ============================================================================

/**
 * Compressed order format for agents who already know the format.
 */
const COMPRESSED_ORDER_FORMAT_MODERATE = `## Order Format
- HOLD: \`A PAR HOLD\`
- MOVE: \`A PAR -> BUR\`
- SUPPORT HOLD: \`A MUN SUPPORT A PAR\`
- SUPPORT MOVE: \`A MUN SUPPORT A PAR -> BUR\`
- CONVOY: \`F NTH CONVOY A LON -> NWY\`
- VIA CONVOY: \`A LON -> NWY VIA CONVOY\`

Use \`A\` for Army and \`F\` for Fleet.`;

const COMPRESSED_ORDER_FORMAT_AGGRESSIVE = `## Orders: HOLD / MOVE (->)  / SUPPORT / CONVOY. Use A (Army) F (Fleet).`;

/**
 * Compress order format instructions.
 */
export function compressOrderFormat(fullFormat: string, level: CompressionLevel): string {
  switch (level) {
    case 'none': return fullFormat;
    case 'moderate': return COMPRESSED_ORDER_FORMAT_MODERATE;
    case 'aggressive': return COMPRESSED_ORDER_FORMAT_AGGRESSIVE;
  }
}

/**
 * Compress response guidelines.
 */
export function compressGuidelines(fullGuidelines: string, level: CompressionLevel): string {
  switch (level) {
    case 'none': return fullGuidelines;
    case 'moderate': return `## Response Guidelines
Think strategically. Consider trust levels. Format orders exactly as specified. Provide brief reasoning.`;
    case 'aggressive': return ''; // Omit entirely - agent knows by now
  }
}
