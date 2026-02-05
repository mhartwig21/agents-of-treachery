/**
 * Agent diary consolidation system.
 *
 * Implements a two-layer memory system to prevent context overflow in long games:
 * 1. full_private_diary: Permanent, unabridged record of all entries
 * 2. context_diary: Consolidated version (yearly summaries + current year) for LLM context
 *
 * Consolidation triggers at the end of each game year (after Fall builds).
 *
 * Inspired by GoodStartLabs/AI_Diplomacy agent.py implementation.
 */

import type { Season, Phase, Power } from '../engine/types';
import type { AgentMemory, DiaryEntry, DiaryEntryType, YearSummary, LLMProvider } from './types';

/**
 * Format a game phase as a diary phase identifier.
 * e.g., formatPhaseId(1901, 'SPRING', 'MOVEMENT') => "[S1901M]"
 */
export function formatPhaseId(year: number, season: Season, phase: Phase): string {
  const seasonCode = season === 'SPRING' ? 'S' : season === 'FALL' ? 'F' : 'W';
  const phaseCode = phase === 'DIPLOMACY' ? 'D' : phase === 'MOVEMENT' ? 'M' : phase === 'RETREAT' ? 'R' : 'B';
  return `[${seasonCode}${year}${phaseCode}]`;
}

/**
 * Create a new diary entry.
 */
export function createDiaryEntry(
  year: number,
  season: Season,
  phase: Phase,
  type: DiaryEntryType,
  content: string
): DiaryEntry {
  return {
    phase: formatPhaseId(year, season, phase),
    type,
    content,
    timestamp: new Date(),
  };
}

/**
 * Add a diary entry to agent memory.
 * Entry is added to both fullPrivateDiary and currentYearDiary.
 */
export function addDiaryEntry(memory: AgentMemory, entry: DiaryEntry): void {
  // Initialize diary arrays if needed
  if (!memory.fullPrivateDiary) {
    memory.fullPrivateDiary = [];
  }
  if (!memory.currentYearDiary) {
    memory.currentYearDiary = [];
  }
  if (!memory.yearSummaries) {
    memory.yearSummaries = [];
  }

  // Add to permanent full diary
  memory.fullPrivateDiary.push(entry);

  // Add to current year diary (will be consolidated at year end)
  memory.currentYearDiary.push(entry);
}

/**
 * Add a negotiation diary entry.
 */
export function addNegotiationEntry(
  memory: AgentMemory,
  year: number,
  season: Season,
  phase: Phase,
  content: string
): void {
  const entry = createDiaryEntry(year, season, phase, 'negotiation', content);
  addDiaryEntry(memory, entry);
}

/**
 * Add an orders diary entry.
 */
export function addOrdersEntry(
  memory: AgentMemory,
  year: number,
  season: Season,
  phase: Phase,
  content: string
): void {
  const entry = createDiaryEntry(year, season, phase, 'orders', content);
  addDiaryEntry(memory, entry);
}

/**
 * Add a reflection diary entry.
 */
export function addReflectionEntry(
  memory: AgentMemory,
  year: number,
  season: Season,
  phase: Phase,
  content: string
): void {
  const entry = createDiaryEntry(year, season, phase, 'reflection', content);
  addDiaryEntry(memory, entry);
}

/**
 * Check if it's time to consolidate the diary (end of year).
 * Consolidation happens after the Fall BUILD phase.
 */
export function shouldConsolidate(season: Season, phase: Phase): boolean {
  // Consolidate after Fall builds (or after Winter builds for edge cases)
  return (season === 'FALL' && phase === 'BUILD') || (season === 'WINTER' && phase === 'BUILD');
}

/**
 * Extract the year from a diary entry's phase identifier.
 */
export function extractYearFromPhase(phase: string): number {
  const match = phase.match(/\[([SFW])(\d{4})/);
  return match ? parseInt(match[2], 10) : 1901;
}

/**
 * Build the consolidation prompt for the LLM.
 */
export function buildConsolidationPrompt(year: number, entries: DiaryEntry[]): string {
  const entriesText = entries
    .map(e => `${e.phase} [${e.type}]: ${e.content}`)
    .join('\n\n');

  return `You are consolidating a Diplomacy agent's diary for year ${year}.

Review these diary entries and create a concise summary (2-3 key points maximum).

DIARY ENTRIES FOR ${year}:
${entriesText}

Create a summary that captures:
1. Major territorial changes (supply centers gained/lost)
2. Key diplomatic developments (alliances formed/broken, betrayals)
3. Strategic shifts or important decisions

Format your response EXACTLY as:
SUMMARY: [2-3 sentence summary of the year]
TERRITORIAL: [comma-separated list of territorial changes, or "None"]
DIPLOMATIC: [comma-separated list of diplomatic changes, or "None"]

Keep it concise - this will be used for context in future turns.`;
}

/**
 * Parse the consolidation response from the LLM.
 */
export function parseConsolidationResponse(response: string, year: number): YearSummary {
  const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?=TERRITORIAL:|$)/s);
  const territorialMatch = response.match(/TERRITORIAL:\s*(.+?)(?=DIPLOMATIC:|$)/s);
  const diplomaticMatch = response.match(/DIPLOMATIC:\s*(.+?)$/s);

  // If there's no structured format, use the raw response as the summary
  const hasStructuredFormat = summaryMatch || territorialMatch || diplomaticMatch;
  const summary = summaryMatch?.[1]?.trim() ||
    (hasStructuredFormat ? `Year ${year} completed.` : response.trim());

  const territorialText = territorialMatch?.[1]?.trim() || 'None';
  const diplomaticText = diplomaticMatch?.[1]?.trim() || 'None';

  const territorialChanges = territorialText === 'None'
    ? []
    : territorialText.split(',').map(s => s.trim()).filter(s => s);

  const diplomaticChanges = diplomaticText === 'None'
    ? []
    : diplomaticText.split(',').map(s => s.trim()).filter(s => s);

  return {
    year,
    summary,
    territorialChanges,
    diplomaticChanges,
    consolidatedAt: new Date(),
  };
}

/**
 * Consolidate the current year's diary entries into a summary.
 * Uses LLM to create a concise summary of the year's events.
 */
export async function consolidateYear(
  memory: AgentMemory,
  year: number,
  llmProvider: LLMProvider
): Promise<YearSummary> {
  const entries = memory.currentYearDiary || [];

  // If no entries, create a minimal summary
  if (entries.length === 0) {
    return {
      year,
      summary: `Year ${year}: No significant events recorded.`,
      territorialChanges: [],
      diplomaticChanges: [],
      consolidatedAt: new Date(),
    };
  }

  // Build and send consolidation prompt
  const prompt = buildConsolidationPrompt(year, entries);

  try {
    const response = await llmProvider.complete({
      messages: [
        { role: 'user', content: prompt, timestamp: new Date() },
      ],
      maxTokens: 500,
      temperature: 0.3, // Lower temperature for more consistent summaries
    });

    return parseConsolidationResponse(response.content, year);
  } catch (error) {
    // Fallback to basic summary if LLM fails
    console.warn(`Diary consolidation failed for year ${year}:`, error);
    return createFallbackSummary(year, entries);
  }
}

/**
 * Create a fallback summary without LLM (for error cases).
 */
function createFallbackSummary(year: number, entries: DiaryEntry[]): YearSummary {
  const negotiationCount = entries.filter(e => e.type === 'negotiation').length;
  const ordersCount = entries.filter(e => e.type === 'orders').length;

  return {
    year,
    summary: `Year ${year}: ${negotiationCount} diplomatic exchanges, ${ordersCount} order phases completed.`,
    territorialChanges: [],
    diplomaticChanges: [],
    consolidatedAt: new Date(),
  };
}

/**
 * Perform end-of-year diary consolidation.
 * Summarizes current year entries and prepares for the new year.
 */
export async function performYearEndConsolidation(
  memory: AgentMemory,
  completedYear: number,
  llmProvider: LLMProvider
): Promise<void> {
  // Initialize arrays if needed
  if (!memory.yearSummaries) {
    memory.yearSummaries = [];
  }

  // Consolidate the completed year
  const summary = await consolidateYear(memory, completedYear, llmProvider);

  // Add consolidation entry to full diary
  const consolidationEntry = createDiaryEntry(
    completedYear,
    'WINTER' as Season,
    'BUILD' as Phase,
    'consolidation',
    `Year ${completedYear} consolidated: ${summary.summary}`
  );
  memory.fullPrivateDiary.push(consolidationEntry);

  // Add summary to year summaries
  memory.yearSummaries.push(summary);

  // Clear current year diary for the new year
  memory.currentYearDiary = [];
}

/**
 * Get the context diary for inclusion in LLM prompts.
 * Returns yearly summaries + current year full entries.
 */
export function getContextDiary(memory: AgentMemory): string {
  const sections: string[] = [];

  // Add year summaries (past years)
  if (memory.yearSummaries && memory.yearSummaries.length > 0) {
    sections.push('## Past Years Summary');
    for (const summary of memory.yearSummaries) {
      sections.push(`**Year ${summary.year}:** ${summary.summary}`);
      if (summary.territorialChanges.length > 0) {
        sections.push(`  Territorial: ${summary.territorialChanges.join(', ')}`);
      }
      if (summary.diplomaticChanges.length > 0) {
        sections.push(`  Diplomatic: ${summary.diplomaticChanges.join(', ')}`);
      }
    }
  }

  // Add current year entries (full detail)
  if (memory.currentYearDiary && memory.currentYearDiary.length > 0) {
    sections.push('\n## Current Year Diary');
    // Only include the most recent entries to stay within context limits
    const recentEntries = memory.currentYearDiary.slice(-10);
    for (const entry of recentEntries) {
      sections.push(`${entry.phase} [${entry.type}]: ${entry.content}`);
    }
    if (memory.currentYearDiary.length > 10) {
      sections.push(`... and ${memory.currentYearDiary.length - 10} earlier entries this year`);
    }
  }

  return sections.length > 0 ? sections.join('\n') : '';
}

/**
 * Get statistics about diary size for monitoring.
 */
export function getDiaryStats(memory: AgentMemory): {
  fullDiaryEntries: number;
  yearSummaries: number;
  currentYearEntries: number;
  estimatedTokens: number;
} {
  const fullDiaryEntries = memory.fullPrivateDiary?.length || 0;
  const yearSummaries = memory.yearSummaries?.length || 0;
  const currentYearEntries = memory.currentYearDiary?.length || 0;

  // Rough token estimate (4 chars per token average)
  const contextDiary = getContextDiary(memory);
  const estimatedTokens = Math.ceil(contextDiary.length / 4);

  return {
    fullDiaryEntries,
    yearSummaries,
    currentYearEntries,
    estimatedTokens,
  };
}

/**
 * Initialize diary fields on agent memory if not present.
 */
export function initializeDiary(memory: AgentMemory): void {
  if (!memory.fullPrivateDiary) {
    memory.fullPrivateDiary = [];
  }
  if (!memory.yearSummaries) {
    memory.yearSummaries = [];
  }
  if (!memory.currentYearDiary) {
    memory.currentYearDiary = [];
  }
}

// ============================================================================
// Alias exports for backward compatibility with runtime.ts
// ============================================================================

/**
 * Check if diary should be consolidated.
 * Alias for shouldConsolidate with additional memory parameter for checking
 * if this year has already been consolidated.
 */
export function shouldConsolidateDiary(
  year: number,
  season: Season,
  phase: Phase,
  memory: AgentMemory
): boolean {
  // Don't consolidate if not end of year
  if (!shouldConsolidate(season, phase)) {
    return false;
  }

  // Don't consolidate if we already have a summary for this year
  const existingSummary = memory.yearSummaries?.find(s => s.year === year);
  if (existingSummary) {
    return false;
  }

  // Don't consolidate if there are no entries for this year
  if (!memory.currentYearDiary || memory.currentYearDiary.length === 0) {
    return false;
  }

  return true;
}

/**
 * Consolidate the diary for a power.
 * Alias for performYearEndConsolidation.
 */
export async function consolidateDiary(
  memory: AgentMemory,
  _power: Power,
  year: number,
  llmProvider: LLMProvider
): Promise<YearSummary> {
  const summary = await consolidateYear(memory, year, llmProvider);

  // Add consolidation entry to full diary
  const consolidationEntry = createDiaryEntry(
    year,
    'WINTER' as Season,
    'BUILD' as Phase,
    'consolidation',
    `Year ${year} consolidated: ${summary.summary}`
  );
  memory.fullPrivateDiary.push(consolidationEntry);

  // Add summary to year summaries
  if (!memory.yearSummaries) {
    memory.yearSummaries = [];
  }
  memory.yearSummaries.push(summary);

  // Clear current year diary for the new year
  memory.currentYearDiary = [];

  return summary;
}

/**
 * Record an orders entry. Alias for addOrdersEntry.
 */
export function recordOrders(
  memory: AgentMemory,
  year: number,
  season: Season,
  phase: Phase,
  content: string
): void {
  addOrdersEntry(memory, year, season, phase, content);
}

/**
 * Record a reflection entry. Alias for addReflectionEntry.
 */
export function recordReflection(
  memory: AgentMemory,
  year: number,
  season: Season,
  phase: Phase,
  content: string
): void {
  addReflectionEntry(memory, year, season, phase, content);
}

/**
 * Record a negotiation entry. Alias for addNegotiationEntry.
 */
export function recordNegotiation(
  memory: AgentMemory,
  year: number,
  season: Season,
  phase: Phase,
  content: string
): void {
  addNegotiationEntry(memory, year, season, phase, content);
}

/**
 * Estimate tokens in the context diary. Alias for getDiaryStats().estimatedTokens.
 */
export function estimateDiaryTokens(memory: AgentMemory): number {
  return getDiaryStats(memory).estimatedTokens;
}
