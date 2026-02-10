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

import type { Season, Phase, Power, GameState } from '../engine/types';
import type { AgentMemory, DiaryEntry, DiaryEntryType, YearSummary, LLMProvider } from './types';

/**
 * Context for generating game-state-aware yearly summaries.
 */
export interface YearlyGameContext {
  /** Supply centers owned at end of year */
  currentSCs: string[];
  /** Supply centers gained this year */
  gainedSCs: string[];
  /** Supply centers lost this year */
  lostSCs: string[];
  /** Current alliance status from memory */
  alliances: Map<Power, 'solid' | 'shaky' | 'deteriorating' | 'none'>;
  /** Betrayal events from this year */
  betrayals: string[];
  /** Total SC count */
  totalSCs: number;
}

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
 * Extract alliance status from memory trust levels.
 */
function getAllianceStatus(trust: number): 'solid' | 'shaky' | 'deteriorating' | 'none' {
  if (trust >= 0.6) return 'solid';
  if (trust >= 0.3) return 'shaky';
  if (trust >= 0) return 'deteriorating';
  return 'none';
}

/**
 * Extract yearly game context from game state and memory.
 */
export function extractYearlyGameContext(
  power: Power,
  gameState: GameState,
  memory: AgentMemory,
  previousYearSCs?: string[]
): YearlyGameContext {
  // Get current SCs for this power
  const currentSCs: string[] = [];
  for (const [province, owner] of gameState.supplyCenters) {
    if (owner === power) {
      currentSCs.push(province);
    }
  }

  // Calculate gained/lost SCs compared to previous year
  const prevSCs = previousYearSCs || [];
  const gainedSCs = currentSCs.filter(sc => !prevSCs.includes(sc));
  const lostSCs = prevSCs.filter(sc => !currentSCs.includes(sc));

  // Extract alliance status from trust levels
  const alliances = new Map<Power, 'solid' | 'shaky' | 'deteriorating' | 'none'>();
  for (const [targetPower, trust] of memory.trustLevels) {
    if (targetPower !== power) {
      alliances.set(targetPower, getAllianceStatus(trust));
    }
  }

  // Extract betrayals from memory events this year
  const betrayals: string[] = [];
  for (const event of memory.events) {
    if (event.year === gameState.year && event.type === 'BETRAYAL') {
      betrayals.push(event.description);
    }
  }

  return {
    currentSCs,
    gainedSCs,
    lostSCs,
    alliances,
    betrayals,
    totalSCs: currentSCs.length,
  };
}

/**
 * Build an enhanced consolidation prompt with game state context.
 */
export function buildEnhancedConsolidationPrompt(
  year: number,
  power: Power,
  entries: DiaryEntry[],
  gameContext: YearlyGameContext
): string {
  const entriesText = entries
    .map(e => `${e.phase} [${e.type}]: ${e.content}`)
    .join('\n\n');

  // Format SC changes
  const gainedStr = gameContext.gainedSCs.length > 0
    ? gameContext.gainedSCs.join(', ')
    : 'None';
  const lostStr = gameContext.lostSCs.length > 0
    ? gameContext.lostSCs.join(', ')
    : 'None';
  const scDelta = gameContext.gainedSCs.length - gameContext.lostSCs.length;
  const scDeltaStr = scDelta >= 0 ? `+${scDelta}` : `${scDelta}`;

  // Format alliance status
  const allianceLines: string[] = [];
  for (const [targetPower, status] of gameContext.alliances) {
    if (status !== 'none') {
      allianceLines.push(`${targetPower}: ${status}`);
    }
  }
  const alliancesStr = allianceLines.length > 0
    ? allianceLines.join(', ')
    : 'None established';

  // Format betrayals
  const betrayalsStr = gameContext.betrayals.length > 0
    ? gameContext.betrayals.join('; ')
    : 'None';

  return `You are consolidating a Diplomacy agent's diary for ${power} in year ${year}.

GAME STATE CONTEXT:
- Supply Centers: ${gameContext.totalSCs} total
- Gained: ${gainedStr} (${scDeltaStr} SCs, now at ${gameContext.totalSCs})
- Lost: ${lostStr}
- Alliances: ${alliancesStr}
- Betrayals: ${betrayalsStr}

DIARY ENTRIES FOR ${year}:
${entriesText}

Create a strategic summary using this EXACT format:
Year ${year} Summary:
- Gained: [SCs gained, or "None"] ([change] SCs, now at [total])
- Lost: [SCs lost, or "None"]
- Alliances: [power (status), power (status), or "None"]
- Betrayals: [brief description, or "None"]
- Key events: [1-2 most important events]
- Strategic position: [1 sentence assessment]

IMPORTANT: Match the format exactly. Be concise.`;
}

/**
 * Parse the enhanced consolidation response from the LLM.
 */
export function parseEnhancedConsolidationResponse(
  response: string,
  year: number,
  gameContext: YearlyGameContext
): YearSummary {
  // The summary is the entire formatted response
  const lines = response.trim().split('\n');

  // Extract key information from the response
  const territorialChanges: string[] = [];
  const diplomaticChanges: string[] = [];

  // Look for Gained/Lost lines for territorial
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('gained:') && !lowerLine.includes('none')) {
      const match = line.match(/Gained:\s*(.+?)(?:\s*\(|$)/i);
      if (match && match[1].trim().toLowerCase() !== 'none') {
        territorialChanges.push(`Gained: ${match[1].trim()}`);
      }
    }
    if (lowerLine.includes('lost:') && !lowerLine.includes('none')) {
      const match = line.match(/Lost:\s*(.+?)$/i);
      if (match && match[1].trim().toLowerCase() !== 'none') {
        territorialChanges.push(`Lost: ${match[1].trim()}`);
      }
    }
    if (lowerLine.includes('alliances:') && !lowerLine.includes('none')) {
      const match = line.match(/Alliances:\s*(.+?)$/i);
      if (match && match[1].trim().toLowerCase() !== 'none') {
        diplomaticChanges.push(match[1].trim());
      }
    }
    if (lowerLine.includes('betrayals:') && !lowerLine.includes('none')) {
      const match = line.match(/Betrayals:\s*(.+?)$/i);
      if (match && match[1].trim().toLowerCase() !== 'none') {
        diplomaticChanges.push(`Betrayal: ${match[1].trim()}`);
      }
    }
  }

  // Use game context to ensure accurate SC info even if LLM response is imperfect
  if (territorialChanges.length === 0 && gameContext.gainedSCs.length > 0) {
    territorialChanges.push(`Gained: ${gameContext.gainedSCs.join(', ')}`);
  }
  if (gameContext.lostSCs.length > 0) {
    const hasLost = territorialChanges.some(t => t.toLowerCase().includes('lost:'));
    if (!hasLost) {
      territorialChanges.push(`Lost: ${gameContext.lostSCs.join(', ')}`);
    }
  }

  return {
    year,
    summary: response.trim(),
    territorialChanges,
    diplomaticChanges,
    consolidatedAt: new Date(),
  };
}

/**
 * Generate a game-state-aware yearly summary.
 */
export async function generateYearlySummary(
  power: Power,
  year: number,
  diaryEntries: DiaryEntry[],
  gameState: GameState,
  memory: AgentMemory,
  llmProvider: LLMProvider,
  previousYearSCs?: string[],
  model?: string
): Promise<YearSummary> {
  // Extract game context
  const gameContext = extractYearlyGameContext(power, gameState, memory, previousYearSCs);

  // If no entries, create a minimal summary with game state info
  if (diaryEntries.length === 0) {
    const scDelta = gameContext.gainedSCs.length - gameContext.lostSCs.length;
    const scDeltaStr = scDelta >= 0 ? `+${scDelta}` : `${scDelta}`;

    return {
      year,
      summary: `Year ${year} Summary:
- Gained: ${gameContext.gainedSCs.length > 0 ? gameContext.gainedSCs.join(', ') : 'None'} (${scDeltaStr} SCs, now at ${gameContext.totalSCs})
- Lost: ${gameContext.lostSCs.length > 0 ? gameContext.lostSCs.join(', ') : 'None'}
- Alliances: None established
- Betrayals: None
- Key events: No significant events recorded
- Strategic position: Position maintained`,
      territorialChanges: gameContext.gainedSCs.length > 0 || gameContext.lostSCs.length > 0
        ? [...gameContext.gainedSCs.map(sc => `Gained: ${sc}`), ...gameContext.lostSCs.map(sc => `Lost: ${sc}`)]
        : [],
      diplomaticChanges: [],
      consolidatedAt: new Date(),
    };
  }

  // Build enhanced prompt with game state
  const prompt = buildEnhancedConsolidationPrompt(year, power, diaryEntries, gameContext);

  try {
    const response = await llmProvider.complete({
      messages: [
        { role: 'user', content: prompt, timestamp: new Date() },
      ],
      model,
      maxTokens: 500,
      temperature: 0.3,
    });

    return parseEnhancedConsolidationResponse(response.content, year, gameContext);
  } catch (error) {
    // Fallback to basic summary with game state info
    console.warn(`Enhanced yearly summary generation failed for year ${year}:`, error);
    return createGameStateAwareFallback(year, diaryEntries, gameContext);
  }
}

/**
 * Create a fallback summary using game state context (for error cases).
 */
function createGameStateAwareFallback(
  year: number,
  entries: DiaryEntry[],
  gameContext: YearlyGameContext
): YearSummary {
  const negotiationCount = entries.filter(e => e.type === 'negotiation').length;
  const scDelta = gameContext.gainedSCs.length - gameContext.lostSCs.length;
  const scDeltaStr = scDelta >= 0 ? `+${scDelta}` : `${scDelta}`;

  return {
    year,
    summary: `Year ${year} Summary:
- Gained: ${gameContext.gainedSCs.length > 0 ? gameContext.gainedSCs.join(', ') : 'None'} (${scDeltaStr} SCs, now at ${gameContext.totalSCs})
- Lost: ${gameContext.lostSCs.length > 0 ? gameContext.lostSCs.join(', ') : 'None'}
- Alliances: See diplomatic notes
- Betrayals: ${gameContext.betrayals.length > 0 ? gameContext.betrayals.join('; ') : 'None'}
- Key events: ${negotiationCount} diplomatic exchanges
- Strategic position: Review required`,
    territorialChanges: [
      ...(gameContext.gainedSCs.length > 0 ? [`Gained: ${gameContext.gainedSCs.join(', ')}`] : []),
      ...(gameContext.lostSCs.length > 0 ? [`Lost: ${gameContext.lostSCs.join(', ')}`] : []),
    ],
    diplomaticChanges: gameContext.betrayals,
    consolidatedAt: new Date(),
  };
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
  llmProvider: LLMProvider,
  model?: string
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
      model,
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
  llmProvider: LLMProvider,
  model?: string
): Promise<void> {
  // Initialize arrays if needed
  if (!memory.yearSummaries) {
    memory.yearSummaries = [];
  }

  // Consolidate the completed year
  const summary = await consolidateYear(memory, completedYear, llmProvider, model);

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
  power: Power,
  year: number,
  llmProvider: LLMProvider,
  gameState?: GameState,
  previousYearSCs?: string[],
  model?: string
): Promise<YearSummary> {
  // Use enhanced summary generation when game state is available
  const summary = gameState
    ? await generateYearlySummary(
        power,
        year,
        memory.currentYearDiary || [],
        gameState,
        memory,
        llmProvider,
        previousYearSCs,
        model
      )
    : await consolidateYear(memory, year, llmProvider, model);

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
