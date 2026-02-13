/**
 * Conversation recall tool for pull-based context retrieval.
 *
 * Provides agents with on-demand access to past conversation context
 * (diary entries, diplomatic messages, orders) without sending full
 * history on every turn. This is the "pull" model replacing the
 * "push" model of always sending N history messages.
 *
 * Text-based tool protocol: agents output a RECALL: block in their
 * response, the runtime parses it, fulfills it from memory, and
 * injects the result for the agent to continue reasoning.
 */

import type { Power, Season } from '../engine/types';
import type { AgentMemory, DiaryEntry } from './types';

/**
 * Parameters for a recall_conversation tool call.
 */
export interface RecallParams {
  /** Target phase, e.g. "S1903M" or "F1902D" */
  phase?: string;
  /** Power name to filter messages involving that power */
  power?: Power;
  /** Number of recent turns to retrieve (default 1, max 5) */
  count?: number;
  /** Type of content to recall */
  type?: 'messages' | 'orders' | 'all';
}

/**
 * Result of a recall_conversation tool call.
 */
export interface RecallResult {
  /** Whether the recall found any content */
  found: boolean;
  /** Number of entries returned */
  entryCount: number;
  /** Formatted content for injection into conversation */
  content: string;
}

/** Maximum entries to return per recall to bound token usage */
const MAX_RECALL_ENTRIES = 15;

/** Maximum recall tool calls per agent turn to prevent loops */
export const MAX_RECALL_CALLS_PER_TURN = 3;

/**
 * Parse a phase string like "S1903M" into year/season/phase components.
 * Supports formats: "S1903M", "S1903", "1903", "F1902D"
 */
export function parsePhaseString(phaseStr: string): {
  year?: number;
  season?: 'SPRING' | 'FALL';
  phaseCode?: string;
} {
  const trimmed = phaseStr.trim().toUpperCase();

  // Full format: S1903M or F1902D
  const fullMatch = trimmed.match(/^([SF])(\d{4})([DMRB])?$/);
  if (fullMatch) {
    return {
      season: fullMatch[1] === 'S' ? 'SPRING' : 'FALL',
      year: parseInt(fullMatch[2], 10),
      phaseCode: fullMatch[3],
    };
  }

  // Year only: 1903
  const yearMatch = trimmed.match(/^(\d{4})$/);
  if (yearMatch) {
    return { year: parseInt(yearMatch[1], 10) };
  }

  return {};
}

/**
 * Parse a RECALL block from an LLM response.
 *
 * Expected format:
 *   RECALL: phase=S1903M type=messages
 *   RECALL: power=FRANCE count=2 type=all
 *   RECALL: phase=1903 type=orders
 *
 * Returns null if no RECALL block is found.
 */
export function parseRecallBlock(response: string): RecallParams | null {
  // Match RECALL: at start of line (case-insensitive)
  const match = response.match(/^RECALL:\s*(.+)$/im);
  if (!match) return null;

  const paramStr = match[1].trim();
  const params: RecallParams = {};

  // Parse key=value pairs
  const kvPairs = paramStr.match(/(\w+)=(\S+)/g);
  if (!kvPairs) return null;

  for (const kv of kvPairs) {
    const [key, value] = kv.split('=');
    switch (key.toLowerCase()) {
      case 'phase':
        params.phase = value;
        break;
      case 'power':
        params.power = value.toUpperCase() as Power;
        break;
      case 'count':
        params.count = Math.min(5, Math.max(1, parseInt(value, 10) || 1));
        break;
      case 'type':
        if (['messages', 'orders', 'all'].includes(value.toLowerCase())) {
          params.type = value.toLowerCase() as 'messages' | 'orders' | 'all';
        }
        break;
    }
  }

  // Must have at least one meaningful parameter
  if (!params.phase && !params.power && !params.type) {
    return null;
  }

  return params;
}

/**
 * Check if an LLM response contains a RECALL block (indicating the agent
 * wants to recall conversation context before continuing).
 */
export function hasRecallRequest(response: string): boolean {
  return /^RECALL:\s*\S+/im.test(response);
}

/**
 * Execute a recall_conversation request against agent memory.
 *
 * Searches diary entries and returns formatted results matching
 * the requested phase, power, and content type.
 */
export function executeRecall(
  memory: AgentMemory,
  params: RecallParams,
): RecallResult {
  const { phase, power, count = 1, type = 'all' } = params;

  // Collect matching diary entries
  let entries: DiaryEntry[] = [];

  // Search both current year diary and full diary
  const allEntries = [
    ...(memory.currentYearDiary ?? []),
    ...(memory.fullPrivateDiary ?? []),
  ];

  // Deduplicate by phase + type + content hash
  const seen = new Set<string>();
  const uniqueEntries: DiaryEntry[] = [];
  for (const entry of allEntries) {
    const key = `${entry.phase}:${entry.type}:${entry.content.slice(0, 50)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueEntries.push(entry);
    }
  }

  // Filter by phase if specified
  if (phase) {
    const parsed = parsePhaseString(phase);
    entries = uniqueEntries.filter(entry => {
      if (parsed.year) {
        const yearStr = String(parsed.year);
        if (!entry.phase.includes(yearStr)) return false;
      }
      if (parsed.season) {
        const seasonCode = parsed.season === 'SPRING' ? 'S' : 'F';
        // Phase format is [S1901M] - check the first char after [
        if (!entry.phase.startsWith(`[${seasonCode}`)) return false;
      }
      if (parsed.phaseCode) {
        // Check the last char before ]
        if (!entry.phase.endsWith(`${parsed.phaseCode}]`)) return false;
      }
      return true;
    });
  } else {
    entries = uniqueEntries;
  }

  // Filter by type if specified
  if (type !== 'all') {
    const typeMap: Record<string, string[]> = {
      'messages': ['negotiation'],
      'orders': ['orders'],
    };
    const allowedTypes = typeMap[type] ?? [];
    if (allowedTypes.length > 0) {
      entries = entries.filter(e => allowedTypes.includes(e.type));
    }
  }

  // Filter by power if specified (search content for power mentions)
  if (power) {
    entries = entries.filter(entry =>
      entry.content.toUpperCase().includes(power.toUpperCase())
    );
  }

  // Sort by timestamp descending (most recent first)
  entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // Apply count limit (count = number of turns, each turn may have multiple entries)
  // Group by phase, take the most recent `count` phases
  const phaseGroups = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    const group = phaseGroups.get(entry.phase) ?? [];
    group.push(entry);
    phaseGroups.set(entry.phase, group);
  }

  const recentPhases = Array.from(phaseGroups.keys()).slice(0, count);
  const selectedEntries: DiaryEntry[] = [];
  for (const phase of recentPhases) {
    selectedEntries.push(...(phaseGroups.get(phase) ?? []));
  }

  // Cap total entries
  const capped = selectedEntries.slice(0, MAX_RECALL_ENTRIES);

  if (capped.length === 0) {
    return {
      found: false,
      entryCount: 0,
      content: formatEmptyResult(params),
    };
  }

  return {
    found: true,
    entryCount: capped.length,
    content: formatRecallResult(capped, params),
  };
}

/**
 * Format recall results for injection into conversation.
 */
function formatRecallResult(entries: DiaryEntry[], params: RecallParams): string {
  const lines: string[] = [];
  lines.push('--- RECALLED CONTEXT ---');

  const filterDesc: string[] = [];
  if (params.phase) filterDesc.push(`phase=${params.phase}`);
  if (params.power) filterDesc.push(`power=${params.power}`);
  if (params.type && params.type !== 'all') filterDesc.push(`type=${params.type}`);
  if (filterDesc.length > 0) {
    lines.push(`Filter: ${filterDesc.join(', ')}`);
  }

  // Group by phase for readability
  const byPhase = new Map<string, DiaryEntry[]>();
  for (const entry of entries) {
    const group = byPhase.get(entry.phase) ?? [];
    group.push(entry);
    byPhase.set(entry.phase, group);
  }

  for (const [phase, phaseEntries] of byPhase) {
    lines.push(`\n${phase}:`);
    for (const entry of phaseEntries) {
      // Truncate long entries to save tokens
      const content = entry.content.length > 300
        ? entry.content.slice(0, 297) + '...'
        : entry.content;
      lines.push(`  [${entry.type}] ${content}`);
    }
  }

  lines.push('--- END RECALLED CONTEXT ---');
  return lines.join('\n');
}

/**
 * Format an empty recall result.
 */
function formatEmptyResult(params: RecallParams): string {
  const filterDesc: string[] = [];
  if (params.phase) filterDesc.push(`phase=${params.phase}`);
  if (params.power) filterDesc.push(`power=${params.power}`);
  if (params.type) filterDesc.push(`type=${params.type}`);

  return `--- RECALLED CONTEXT ---\nNo matching entries found for: ${filterDesc.join(', ') || 'unspecified query'}.\nYour diary and memory are your primary context.\n--- END RECALLED CONTEXT ---`;
}

/**
 * Extract the non-RECALL portion of an LLM response.
 * Removes the RECALL: line so the response can be parsed for orders/diplomacy.
 */
export function stripRecallBlock(response: string): string {
  return response.replace(/^RECALL:\s*.+$/im, '').trim();
}
