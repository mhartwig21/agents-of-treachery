/**
 * Memory consolidation system for long games.
 *
 * Prevents turn summary overflow by periodically consolidating older
 * turn summaries into compact blocks. Trust-affecting events (betrayals,
 * broken promises) are always preserved at full detail.
 *
 * Consolidation triggers every 5 turns when unconsolidated summaries exceed
 * the threshold. Uses LLM-assisted summarization when available, with a
 * deterministic fallback for when no LLM is provided.
 *
 * Design goals:
 * - 30+ turn games without memory overflow
 * - Betrayals from 15+ turns back remain accessible
 * - Similar strategic notes are merged to reduce noise
 */

import type { Power, Season } from '../engine/types';
import type {
  AgentMemory,
  TurnSummary,
  ConsolidatedBlock,
  TrustAffectingEvent,
  StrategicNote,
  MemoryEvent,
  LLMProvider,
} from './types';

/** Number of recent turn summaries to keep unconsolidated. */
export const RECENT_TURNS_TO_KEEP = 5;

/** Consolidation triggers when unconsolidated summaries exceed this count. */
export const CONSOLIDATION_THRESHOLD = 10;

/** Maximum consolidated blocks to keep before merging old blocks together. */
export const MAX_CONSOLIDATED_BLOCKS = 6;

/** Event types that are always preserved through consolidation. */
const TRUST_AFFECTING_TYPES = new Set([
  'BETRAYAL',
  'PROMISE_BROKEN',
  'PROMISE_KEPT',
  'ALLIANCE_BROKEN',
  'ALLIANCE_FORMED',
]);

/**
 * Check whether consolidation should run.
 * Triggers when there are more unconsolidated turn summaries than the threshold.
 */
export function shouldConsolidateTurns(memory: AgentMemory): boolean {
  return memory.turnSummaries.length > CONSOLIDATION_THRESHOLD;
}

/**
 * Extract trust-affecting events from a batch of turn summaries and memory events.
 * These events are preserved at full detail through all consolidation rounds.
 */
export function extractTrustEvents(
  summaries: TurnSummary[],
  memoryEvents: MemoryEvent[]
): TrustAffectingEvent[] {
  const events: TrustAffectingEvent[] = [];

  // Extract from memory events in the time range of the summaries
  if (summaries.length === 0) return events;

  const firstYear = summaries[0].year;
  const firstSeason = summaries[0].season;
  const lastYear = summaries[summaries.length - 1].year;
  const lastSeason = summaries[summaries.length - 1].season;

  for (const event of memoryEvents) {
    if (!TRUST_AFFECTING_TYPES.has(event.type)) continue;

    // Check if event is within the summary range
    if (isInRange(event.year, event.season, firstYear, firstSeason, lastYear, lastSeason)) {
      events.push({
        year: event.year,
        season: event.season,
        type: event.type as TrustAffectingEvent['type'],
        powers: [...event.powers],
        description: event.description,
        trustImpact: event.impactOnTrust,
      });
    }
  }

  // Also extract from diplomatic highlights that mention betrayal/broken promises
  for (const summary of summaries) {
    for (const highlight of summary.diplomaticHighlights) {
      const lower = highlight.toLowerCase();
      if (lower.includes('betray') || lower.includes('broken') || lower.includes('stab')) {
        // Check if we already have this event (avoid duplicates)
        const isDuplicate = events.some(
          e => e.year === summary.year && e.season === summary.season &&
               e.description === highlight
        );
        if (!isDuplicate) {
          events.push({
            year: summary.year,
            season: summary.season,
            type: 'BETRAYAL',
            powers: [],
            description: highlight,
            trustImpact: -0.3,
          });
        }
      }
    }
  }

  return events;
}

/**
 * Build the consolidation prompt for LLM-assisted summarization.
 */
export function buildTurnConsolidationPrompt(
  power: Power,
  summaries: TurnSummary[]
): string {
  const summaryText = summaries.map(s => {
    const lines = [`${s.year} ${s.season}:`];
    if (s.ordersSucceeded.length > 0) {
      lines.push(`  Succeeded: ${s.ordersSucceeded.join(', ')}`);
    }
    if (s.ordersFailed.length > 0) {
      lines.push(`  Failed: ${s.ordersFailed.join(', ')}`);
    }
    if (s.supplyCentersGained.length > 0) {
      lines.push(`  Gained SCs: ${s.supplyCentersGained.join(', ')}`);
    }
    if (s.supplyCentersLost.length > 0) {
      lines.push(`  Lost SCs: ${s.supplyCentersLost.join(', ')}`);
    }
    if (s.diplomaticHighlights.length > 0) {
      lines.push(`  Diplomacy: ${s.diplomaticHighlights.join('; ')}`);
    }
    return lines.join('\n');
  }).join('\n\n');

  return `Consolidate these turn summaries for ${power} into a concise strategic summary.

TURNS TO CONSOLIDATE:
${summaryText}

Create a brief summary (3-5 sentences) that captures:
1. Net territorial changes (SCs gained/lost overall)
2. Key military outcomes
3. Important diplomatic developments
4. Strategic trajectory (expanding/contracting/stable)

Format your response as a single paragraph summary. Be concise.`;
}

/**
 * Parse LLM consolidation response into a summary string.
 */
export function parseConsolidationResponse(response: string): string {
  // Take the response as-is, trimmed. The prompt asks for a single paragraph.
  return response.trim();
}

/**
 * Create a consolidated block from a batch of turn summaries without LLM.
 * Uses deterministic extraction of key information.
 */
export function createFallbackConsolidation(
  summaries: TurnSummary[],
  trustEvents: TrustAffectingEvent[]
): ConsolidatedBlock {
  if (summaries.length === 0) {
    throw new Error('Cannot consolidate empty summaries');
  }

  const first = summaries[0];
  const last = summaries[summaries.length - 1];

  // Aggregate SC changes
  const allGained = new Set<string>();
  const allLost = new Set<string>();
  for (const s of summaries) {
    for (const sc of s.supplyCentersGained) allGained.add(sc);
    for (const sc of s.supplyCentersLost) allLost.add(sc);
  }

  // Net changes: gained minus those also lost, and vice versa
  const netGained = [...allGained].filter(sc => !allLost.has(sc));
  const netLost = [...allLost].filter(sc => !allGained.has(sc));

  // Count total orders
  const totalOrders = summaries.reduce((sum, s) => sum + s.ordersSubmitted.length, 0);
  const totalFailed = summaries.reduce((sum, s) => sum + s.ordersFailed.length, 0);
  const totalBuilt = summaries.reduce((sum, s) => sum + s.unitsBuilt, 0);
  const totalLostUnits = summaries.reduce((sum, s) => sum + s.unitsLost, 0);

  // Collect diplomatic highlights
  const highlights: string[] = [];
  for (const s of summaries) {
    for (const h of s.diplomaticHighlights) {
      highlights.push(`${s.year} ${s.season}: ${h}`);
    }
  }

  // Build summary
  const parts: string[] = [];
  parts.push(`${first.year} ${first.season} - ${last.year} ${last.season}:`);

  if (netGained.length > 0) {
    parts.push(`Gained ${netGained.join(', ')}.`);
  }
  if (netLost.length > 0) {
    parts.push(`Lost ${netLost.join(', ')}.`);
  }

  parts.push(`${totalOrders} orders (${totalFailed} failed).`);

  if (totalBuilt > 0 || totalLostUnits > 0) {
    parts.push(`Units: +${totalBuilt}/-${totalLostUnits}.`);
  }

  if (trustEvents.length > 0) {
    const betrayals = trustEvents.filter(e => e.type === 'BETRAYAL' || e.type === 'PROMISE_BROKEN' || e.type === 'ALLIANCE_BROKEN');
    if (betrayals.length > 0) {
      parts.push(`${betrayals.length} betrayal(s) recorded.`);
    }
  }

  if (highlights.length > 0) {
    parts.push(`Key: ${highlights.slice(0, 3).join('; ')}.`);
  }

  return {
    fromYear: first.year,
    fromSeason: first.season,
    toYear: last.year,
    toSeason: last.season,
    summary: parts.join(' '),
    trustEvents,
    netSCsGained: netGained,
    netSCsLost: netLost,
    consolidatedAt: new Date(),
  };
}

/**
 * Consolidate older turn summaries into a block.
 * Keeps the most recent RECENT_TURNS_TO_KEEP summaries unconsolidated.
 * Uses LLM for summarization when provided, falls back to deterministic.
 */
export async function consolidateTurnSummaries(
  memory: AgentMemory,
  llmProvider?: LLMProvider,
  model?: string
): Promise<ConsolidatedBlock | null> {
  if (!shouldConsolidateTurns(memory)) {
    return null;
  }

  // Initialize consolidated blocks array if missing
  if (!memory.consolidatedBlocks) {
    memory.consolidatedBlocks = [];
  }

  // Split: consolidate older summaries, keep recent ones
  const toConsolidate = memory.turnSummaries.slice(0, -RECENT_TURNS_TO_KEEP);
  const toKeep = memory.turnSummaries.slice(-RECENT_TURNS_TO_KEEP);

  if (toConsolidate.length === 0) {
    return null;
  }

  // Extract trust-affecting events before consolidation
  const trustEvents = extractTrustEvents(toConsolidate, memory.events);

  let block: ConsolidatedBlock;

  if (llmProvider) {
    try {
      const prompt = buildTurnConsolidationPrompt(memory.power, toConsolidate);
      const result = await llmProvider.complete({
        messages: [{ role: 'user', content: prompt, timestamp: new Date() }],
        model,
        maxTokens: 300,
        temperature: 0.3,
      });

      const summary = parseConsolidationResponse(result.content);

      // Aggregate SC changes
      const allGained = new Set<string>();
      const allLost = new Set<string>();
      for (const s of toConsolidate) {
        for (const sc of s.supplyCentersGained) allGained.add(sc);
        for (const sc of s.supplyCentersLost) allLost.add(sc);
      }
      const netGained = [...allGained].filter(sc => !allLost.has(sc));
      const netLost = [...allLost].filter(sc => !allGained.has(sc));

      block = {
        fromYear: toConsolidate[0].year,
        fromSeason: toConsolidate[0].season,
        toYear: toConsolidate[toConsolidate.length - 1].year,
        toSeason: toConsolidate[toConsolidate.length - 1].season,
        summary,
        trustEvents,
        netSCsGained: netGained,
        netSCsLost: netLost,
        consolidatedAt: new Date(),
      };
    } catch {
      // Fall back to deterministic consolidation
      block = createFallbackConsolidation(toConsolidate, trustEvents);
    }
  } else {
    block = createFallbackConsolidation(toConsolidate, trustEvents);
  }

  // Update memory: replace old summaries with consolidated block + recent
  memory.consolidatedBlocks.push(block);
  memory.turnSummaries = toKeep;

  // If too many consolidated blocks, merge the oldest ones
  if (memory.consolidatedBlocks.length > MAX_CONSOLIDATED_BLOCKS) {
    mergeOldestBlocks(memory);
  }

  return block;
}

/**
 * Merge the two oldest consolidated blocks into one to prevent block overflow.
 */
export function mergeOldestBlocks(memory: AgentMemory): void {
  if (memory.consolidatedBlocks.length < 2) return;

  const [first, second, ...rest] = memory.consolidatedBlocks;

  // Merge trust events from both blocks, deduplicating
  const mergedTrustEvents: TrustAffectingEvent[] = [...first.trustEvents];
  for (const event of second.trustEvents) {
    const isDuplicate = mergedTrustEvents.some(
      e => e.year === event.year && e.season === event.season &&
           e.description === event.description
    );
    if (!isDuplicate) {
      mergedTrustEvents.push(event);
    }
  }

  // Merge SC changes
  const gainedSet = new Set([...first.netSCsGained, ...second.netSCsGained]);
  const lostSet = new Set([...first.netSCsLost, ...second.netSCsLost]);
  // Remove SCs that appear in both gained and lost (net zero)
  for (const sc of gainedSet) {
    if (lostSet.has(sc)) {
      gainedSet.delete(sc);
      lostSet.delete(sc);
    }
  }

  const merged: ConsolidatedBlock = {
    fromYear: first.fromYear,
    fromSeason: first.fromSeason,
    toYear: second.toYear,
    toSeason: second.toSeason,
    summary: `${first.summary} | ${second.summary}`,
    trustEvents: mergedTrustEvents,
    netSCsGained: [...gainedSet],
    netSCsLost: [...lostSet],
    consolidatedAt: new Date(),
  };

  memory.consolidatedBlocks = [merged, ...rest];
}

/**
 * Merge similar strategic notes to reduce memory bloat.
 * Notes are considered similar if they share the same subject or very similar content.
 */
export function mergeStrategicNotes(memory: AgentMemory, maxNotes: number = 20): void {
  if (memory.strategicNotes.length <= maxNotes) return;

  // Group notes by subject
  const bySubject = new Map<string, StrategicNote[]>();
  for (const note of memory.strategicNotes) {
    const key = note.subject.toLowerCase().trim();
    const group = bySubject.get(key) || [];
    group.push(note);
    bySubject.set(key, group);
  }

  const merged: StrategicNote[] = [];

  for (const [_subject, notes] of bySubject) {
    if (notes.length === 1) {
      merged.push(notes[0]);
    } else {
      // Keep the highest priority and most recent note, merge content
      notes.sort((a, b) => {
        const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        // Same priority: prefer more recent
        return b.year - a.year || seasonOrder(b.season) - seasonOrder(a.season);
      });

      const best = notes[0];
      const otherContent = notes.slice(1).map(n => n.content).join('; ');
      merged.push({
        ...best,
        content: `${best.content} [Also: ${otherContent}]`,
      });
    }
  }

  // If still over limit, keep highest priority notes
  if (merged.length > maxNotes) {
    merged.sort((a, b) => {
      const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    memory.strategicNotes = merged.slice(0, maxNotes);
  } else {
    memory.strategicNotes = merged;
  }
}

/**
 * Get all trust-affecting events from consolidated memory.
 * Returns events from all consolidated blocks plus recent memory events.
 * This enables remembering betrayals from 15+ turns back.
 */
export function getAllTrustEvents(memory: AgentMemory): TrustAffectingEvent[] {
  const events: TrustAffectingEvent[] = [];

  // From consolidated blocks
  for (const block of (memory.consolidatedBlocks || [])) {
    events.push(...block.trustEvents);
  }

  // From recent memory events
  for (const event of memory.events) {
    if (TRUST_AFFECTING_TYPES.has(event.type)) {
      events.push({
        year: event.year,
        season: event.season,
        type: event.type as TrustAffectingEvent['type'],
        powers: [...event.powers],
        description: event.description,
        trustImpact: event.impactOnTrust,
      });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return events.filter(e => {
    const key = `${e.year}:${e.season}:${e.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Format consolidated memory for inclusion in LLM context.
 * Returns a concise text representation of consolidated blocks + recent summaries.
 */
export function formatConsolidatedMemory(memory: AgentMemory): string {
  const sections: string[] = [];

  // Consolidated blocks (historical context)
  if (memory.consolidatedBlocks && memory.consolidatedBlocks.length > 0) {
    sections.push('## Historical Summary');
    for (const block of memory.consolidatedBlocks) {
      sections.push(`**${block.fromYear} ${block.fromSeason} - ${block.toYear} ${block.toSeason}:** ${block.summary}`);

      // Always show trust events from blocks
      if (block.trustEvents.length > 0) {
        for (const event of block.trustEvents) {
          sections.push(`  ! ${event.year} ${event.season}: ${event.description} [${event.type}]`);
        }
      }
    }
  }

  // Recent turn summaries
  if (memory.turnSummaries.length > 0) {
    sections.push('\n## Recent Turns');
    for (const s of memory.turnSummaries) {
      const parts: string[] = [`**${s.year} ${s.season}:**`];
      if (s.supplyCentersGained.length > 0) parts.push(`+${s.supplyCentersGained.join(', ')}`);
      if (s.supplyCentersLost.length > 0) parts.push(`-${s.supplyCentersLost.join(', ')}`);
      if (s.diplomaticHighlights.length > 0) parts.push(s.diplomaticHighlights.join('; '));
      sections.push(parts.join(' '));
    }
  }

  return sections.join('\n');
}

/**
 * Run full memory consolidation: turn summaries + note merging.
 * Call this periodically (e.g., every 5 turns or when memory is large).
 */
export async function consolidateMemory(
  memory: AgentMemory,
  llmProvider?: LLMProvider,
  model?: string
): Promise<{ turnBlock: ConsolidatedBlock | null; notesMerged: boolean }> {
  const turnBlock = await consolidateTurnSummaries(memory, llmProvider, model);
  const notesBefore = memory.strategicNotes.length;
  mergeStrategicNotes(memory);
  const notesMerged = memory.strategicNotes.length < notesBefore;

  return { turnBlock, notesMerged };
}

// ============================================================================
// Helpers
// ============================================================================

function seasonOrder(season: Season): number {
  switch (season) {
    case 'SPRING': return 0;
    case 'FALL': return 1;
    case 'WINTER': return 2;
  }
}

function isInRange(
  year: number,
  season: Season,
  fromYear: number,
  fromSeason: Season,
  toYear: number,
  toSeason: Season
): boolean {
  const val = year * 3 + seasonOrder(season);
  const from = fromYear * 3 + seasonOrder(fromSeason);
  const to = toYear * 3 + seasonOrder(toSeason);
  return val >= from && val <= to;
}
