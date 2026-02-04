/**
 * Game Narrative Report Generation.
 *
 * Analyzes completed game logs to extract key events (alliances, betrayals,
 * turning points) and generates AI-powered story-style narratives suitable
 * for sharing and posting.
 */

import type { Power } from '../engine/types';
import { POWERS } from '../engine/types';
import {
  readGameLogs,
  filterLogsByType,
  type GameLogEntry,
  type DeceptionType,
} from '../server/game-logger';

/**
 * A significant event in the game narrative.
 */
export interface NarrativeEvent {
  /** Game turn: year and season */
  year: number;
  season: string;
  /** Type of event */
  type:
    | 'ALLIANCE_FORMED'
    | 'ALLIANCE_BROKEN'
    | 'BETRAYAL'
    | 'TERRITORY_GAINED'
    | 'TERRITORY_LOST'
    | 'ELIMINATION'
    | 'TURNING_POINT'
    | 'DIPLOMATIC_MESSAGE'
    | 'DECEPTION';
  /** Powers involved */
  powers: Power[];
  /** Human-readable description */
  description: string;
  /** Supporting evidence/quotes */
  evidence?: string;
  /** Importance score (0-1) for prioritizing in narrative */
  importance: number;
}

/**
 * Supply center ownership changes over time.
 */
export interface TerritoryChange {
  year: number;
  season: string;
  province: string;
  fromPower: Power | null;
  toPower: Power;
}

/**
 * Power statistics at a point in time.
 */
export interface PowerSnapshot {
  power: Power;
  supplyCenters: number;
  units: number;
  eliminated: boolean;
}

/**
 * Game narrative context for LLM generation.
 */
export interface NarrativeContext {
  gameId: string;
  gameName?: string;
  /** Winner (if solo victory) */
  winner?: Power;
  /** Whether game ended in draw */
  isDraw: boolean;
  /** Final year of the game */
  finalYear: number;
  /** Final season */
  finalSeason: string;
  /** All significant narrative events */
  events: NarrativeEvent[];
  /** Final supply center counts */
  finalStandings: PowerSnapshot[];
  /** Key quotes from diplomatic messages */
  memorableQuotes: Array<{
    speaker: Power;
    recipient: Power | Power[] | 'all';
    content: string;
    year: number;
    season: string;
  }>;
  /** Summary statistics */
  stats: {
    totalPhases: number;
    totalMessages: number;
    deceptionsDetected: number;
    eliminatedPowers: Power[];
  };
}

/**
 * Generated narrative report.
 */
export interface NarrativeReport {
  /** Game ID */
  gameId: string;
  /** Generated title */
  title: string;
  /** Story-style narrative text */
  narrative: string;
  /** Key events summary */
  keyEvents: NarrativeEvent[];
  /** Final standings */
  standings: PowerSnapshot[];
  /** Generation timestamp */
  generatedAt: Date;
}

/**
 * Extracts narrative context from game logs.
 */
export function extractNarrativeContext(gameId: string, logsDir?: string): NarrativeContext {
  const logs = readGameLogs(gameId, logsDir);

  if (logs.length === 0) {
    throw new Error(`No logs found for game: ${gameId}`);
  }

  const events: NarrativeEvent[] = [];
  let gameName: string | undefined;
  let winner: Power | undefined;
  let isDraw = false;
  let finalYear = 1901;
  let finalSeason = 'SPRING';

  // Track supply centers per power
  const currentSupply = new Map<Power, Set<string>>();
  for (const power of POWERS) {
    currentSupply.set(power, new Set());
  }

  // Track messages for quotes
  const messages: Array<{
    from: string;
    to: string | string[];
    preview: string;
    year: number;
    season: string;
  }> = [];

  // Track phase info
  let currentYear = 1901;
  let currentSeason = 'SPRING';
  let phaseCount = 0;
  let deceptionCount = 0;
  const eliminatedPowers: Power[] = [];

  // Process logs
  for (const entry of logs) {
    const event = entry.event;

    if (event.type === 'game_started') {
      gameName = event.name;
    }

    if (event.type === 'game_ended') {
      if (event.winner) {
        winner = event.winner as Power;
      }
      isDraw = event.draw ?? false;
    }

    if (event.type === 'phase_started') {
      currentYear = event.year;
      currentSeason = event.season;
      finalYear = Math.max(finalYear, event.year);
      finalSeason = event.season;
      phaseCount++;
    }

    if (event.type === 'message_sent') {
      messages.push({
        from: event.from,
        to: event.to,
        preview: event.preview,
        year: currentYear,
        season: currentSeason,
      });
    }

    if (event.type === 'deception_detected') {
      deceptionCount++;
      events.push({
        year: event.year,
        season: event.season,
        type: 'DECEPTION',
        powers: [event.power as Power, ...(event.targets as Power[])],
        description: `${event.power} deceived ${event.targets.join(' and ')} with ${formatDeceptionType(event.deceptionType)}`,
        evidence: event.evidence.slice(0, 200),
        importance: event.confidence,
      });
    }

    if (event.type === 'diary_entry') {
      // Look for alliance-related keywords in intentions
      const intentions = event.intentions.toLowerCase();
      const reasoning = event.reasoning.toLowerCase();
      const combined = `${intentions} ${reasoning}`;

      // Detect alliance formations
      const allianceMatch = combined.match(
        /(?:ally|alliance|coordinate|cooperate|work together|partnership) with (\w+)/i
      );
      if (allianceMatch) {
        const targetPower = findPowerByName(allianceMatch[1]);
        if (targetPower && targetPower !== event.power) {
          events.push({
            year: event.year,
            season: event.season,
            type: 'ALLIANCE_FORMED',
            powers: [event.power as Power, targetPower],
            description: `${event.power} and ${targetPower} formed an alliance`,
            importance: 0.7,
          });
        }
      }

      // Detect betrayals
      const betrayalMatch = combined.match(
        /(?:betray|stab|break|violate|attack|turn against|surprise) (\w+)/i
      );
      if (betrayalMatch) {
        const targetPower = findPowerByName(betrayalMatch[1]);
        if (targetPower && targetPower !== event.power) {
          events.push({
            year: event.year,
            season: event.season,
            type: 'BETRAYAL',
            powers: [event.power as Power, targetPower],
            description: `${event.power} betrayed ${targetPower}`,
            evidence: extractRelevantQuote(combined, betrayalMatch[0]),
            importance: 0.9,
          });
        }
      }
    }
  }

  // Identify turning points based on deception density and phase events
  const turningPoints = identifyTurningPoints(events, logs);
  events.push(...turningPoints);

  // Sort events by year/season and importance
  events.sort((a, b) => {
    const yearDiff = a.year - b.year;
    if (yearDiff !== 0) return yearDiff;
    const seasonOrder = { SPRING: 0, FALL: 1, WINTER: 2 };
    const seasonDiff =
      (seasonOrder[a.season as keyof typeof seasonOrder] ?? 0) -
      (seasonOrder[b.season as keyof typeof seasonOrder] ?? 0);
    if (seasonDiff !== 0) return seasonDiff;
    return b.importance - a.importance;
  });

  // Deduplicate similar events
  const uniqueEvents = deduplicateEvents(events);

  // Extract memorable quotes
  const memorableQuotes = extractMemorableQuotes(messages);

  // Calculate final standings
  const finalStandings = calculateFinalStandings(logs, eliminatedPowers);

  return {
    gameId,
    gameName,
    winner,
    isDraw,
    finalYear,
    finalSeason,
    events: uniqueEvents,
    finalStandings,
    memorableQuotes,
    stats: {
      totalPhases: phaseCount,
      totalMessages: messages.length,
      deceptionsDetected: deceptionCount,
      eliminatedPowers,
    },
  };
}

/**
 * Generates a narrative report without LLM (pure analysis).
 */
export function generateBasicNarrative(context: NarrativeContext): NarrativeReport {
  const { gameId, gameName, winner, isDraw, finalYear, events, finalStandings, stats } = context;

  // Generate title
  const title = generateTitle(context);

  // Build narrative sections
  const sections: string[] = [];

  // Opening
  sections.push(generateOpening(context));

  // Key events by era
  const earlyGame = events.filter((e) => e.year <= 1903);
  const midGame = events.filter((e) => e.year > 1903 && e.year <= 1907);
  const lateGame = events.filter((e) => e.year > 1907);

  if (earlyGame.length > 0) {
    sections.push('\n## The Early Years (1901-1903)\n');
    sections.push(narrateEvents(earlyGame, 'early'));
  }

  if (midGame.length > 0) {
    sections.push('\n## The Middle Game (1904-1907)\n');
    sections.push(narrateEvents(midGame, 'mid'));
  }

  if (lateGame.length > 0) {
    sections.push('\n## The Endgame\n');
    sections.push(narrateEvents(lateGame, 'late'));
  }

  // Conclusion
  sections.push('\n## Conclusion\n');
  sections.push(generateConclusion(context));

  // Statistics
  sections.push('\n## Game Statistics\n');
  sections.push(generateStatistics(context));

  // Final standings table
  sections.push('\n## Final Standings\n');
  sections.push(generateStandingsTable(finalStandings));

  const narrative = sections.join('\n');

  return {
    gameId,
    title,
    narrative,
    keyEvents: events.filter((e) => e.importance >= 0.7),
    standings: finalStandings,
    generatedAt: new Date(),
  };
}

/**
 * System prompt for LLM narrative generation.
 */
export const NARRATIVE_SYSTEM_PROMPT = `You are a skilled storyteller writing an engaging narrative about a game of Diplomacy.
Your task is to transform game events into a compelling story suitable for sharing online.

Style guidelines:
- Write in third person past tense
- Use vivid language and dramatic pacing
- Highlight betrayals, alliances, and turning points
- Include relevant quotes from diplomatic messages when available
- Balance drama with accuracy - don't invent events
- Use power names (England, France, etc.) as if they were characters
- Create section headers for major phases of the game
- Keep total length between 800-1500 words

Structure:
1. Opening hook - set the stage
2. Early game alliances and positioning
3. Mid-game betrayals and power shifts
4. Climactic endgame
5. Conclusion with final outcome`;

/**
 * Formats context for LLM prompt.
 */
export function formatContextForLLM(context: NarrativeContext): string {
  const lines: string[] = [];

  lines.push('# Game Context');
  lines.push(`Game: ${context.gameName || context.gameId}`);
  lines.push(`Duration: 1901 to ${context.finalYear}`);

  if (context.winner) {
    lines.push(`Outcome: ${context.winner} achieved solo victory`);
  } else if (context.isDraw) {
    lines.push('Outcome: Game ended in a draw');
  }

  lines.push('');
  lines.push('# Key Events (chronological)');
  for (const event of context.events.slice(0, 30)) {
    lines.push(
      `- ${event.season} ${event.year}: ${event.description}${event.evidence ? ` ("${event.evidence.slice(0, 100)}...")` : ''}`
    );
  }

  if (context.memorableQuotes.length > 0) {
    lines.push('');
    lines.push('# Notable Diplomatic Messages');
    for (const quote of context.memorableQuotes.slice(0, 10)) {
      const recipient = Array.isArray(quote.recipient)
        ? quote.recipient.join(', ')
        : quote.recipient;
      lines.push(`- ${quote.speaker} to ${recipient}: "${quote.content}"`);
    }
  }

  lines.push('');
  lines.push('# Final Standings');
  for (const standing of context.finalStandings) {
    const status = standing.eliminated
      ? '(eliminated)'
      : `${standing.supplyCenters} supply centers`;
    lines.push(`- ${standing.power}: ${status}`);
  }

  lines.push('');
  lines.push('# Statistics');
  lines.push(`- Total phases played: ${context.stats.totalPhases}`);
  lines.push(`- Diplomatic messages exchanged: ${context.stats.totalMessages}`);
  lines.push(`- Deceptions detected: ${context.stats.deceptionsDetected}`);
  if (context.stats.eliminatedPowers.length > 0) {
    lines.push(`- Eliminated powers: ${context.stats.eliminatedPowers.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Formats the narrative report as markdown.
 */
export function formatNarrativeAsMarkdown(report: NarrativeReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  lines.push('');
  lines.push(
    `*Generated on ${report.generatedAt.toLocaleDateString()} at ${report.generatedAt.toLocaleTimeString()}*`
  );
  lines.push('');
  lines.push(report.narrative);

  return lines.join('\n');
}

// ============================================================================
// Helper functions
// ============================================================================

function formatDeceptionType(type: DeceptionType): string {
  const names: Record<DeceptionType, string> = {
    INTENTIONAL_LIE: 'an intentional lie',
    CONTRADICTORY_CLAIM: 'contradictory claims',
    BROKEN_PROMISE: 'a broken promise',
    MISDIRECTION: 'misdirection',
  };
  return names[type] || type.toLowerCase();
}

function findPowerByName(name: string): Power | null {
  const normalized = name.toUpperCase();
  for (const power of POWERS) {
    if (power === normalized || power.startsWith(normalized)) {
      return power;
    }
  }
  // Handle common abbreviations and variants
  const aliases: Record<string, Power> = {
    ENG: 'ENGLAND',
    FRA: 'FRANCE',
    GER: 'GERMANY',
    ITA: 'ITALY',
    AUS: 'AUSTRIA',
    RUS: 'RUSSIA',
    TUR: 'TURKEY',
    BRITAIN: 'ENGLAND',
    BRITISH: 'ENGLAND',
    FRENCH: 'FRANCE',
    GERMAN: 'GERMANY',
    ITALIAN: 'ITALY',
    AUSTRIAN: 'AUSTRIA',
    RUSSIAN: 'RUSSIA',
    TURKISH: 'TURKEY',
    OTTOMAN: 'TURKEY',
  };
  return aliases[normalized] || null;
}

function extractRelevantQuote(text: string, matchedPhrase: string): string {
  const index = text.indexOf(matchedPhrase.toLowerCase());
  if (index === -1) return '';

  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + matchedPhrase.length + 100);
  return text.slice(start, end).trim();
}

function identifyTurningPoints(
  existingEvents: NarrativeEvent[],
  _logs: GameLogEntry[]
): NarrativeEvent[] {
  const turningPoints: NarrativeEvent[] = [];

  // Find years with multiple betrayals or deceptions
  const eventsByYear = new Map<number, NarrativeEvent[]>();
  for (const event of existingEvents) {
    if (!eventsByYear.has(event.year)) {
      eventsByYear.set(event.year, []);
    }
    eventsByYear.get(event.year)!.push(event);
  }

  for (const [year, yearEvents] of eventsByYear) {
    const betrayals = yearEvents.filter((e) => e.type === 'BETRAYAL' || e.type === 'DECEPTION');
    if (betrayals.length >= 2) {
      turningPoints.push({
        year,
        season: 'FALL',
        type: 'TURNING_POINT',
        powers: [...new Set(betrayals.flatMap((e) => e.powers))],
        description: `${year} marked a dramatic shift in alliances with multiple betrayals`,
        importance: 0.85,
      });
    }
  }

  return turningPoints;
}

function deduplicateEvents(events: NarrativeEvent[]): NarrativeEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.year}-${event.season}-${event.type}-${event.powers.sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractMemorableQuotes(
  messages: Array<{
    from: string;
    to: string | string[];
    preview: string;
    year: number;
    season: string;
  }>
): NarrativeContext['memorableQuotes'] {
  // Look for dramatic or significant messages
  const keywords = [
    'betray',
    'alliance',
    'trust',
    'promise',
    'attack',
    'help',
    'together',
    'war',
    'peace',
    'friend',
    'enemy',
    'stab',
  ];

  const memorable = messages
    .filter((m) => {
      const lower = m.preview.toLowerCase();
      return keywords.some((kw) => lower.includes(kw)) && m.preview.length > 30;
    })
    .slice(0, 15)
    .map((m) => ({
      speaker: m.from as Power,
      recipient: (Array.isArray(m.to) ? m.to : [m.to]) as Power[],
      content: m.preview.slice(0, 200),
      year: m.year,
      season: m.season,
    }));

  return memorable;
}

function calculateFinalStandings(
  logs: GameLogEntry[],
  eliminatedPowers: Power[]
): PowerSnapshot[] {
  // Find the last llm_response for each power to estimate unit count
  const lastActivity = new Map<Power, { year: number; season: string }>();
  const powerStats = new Map<Power, PowerSnapshot>();

  for (const power of POWERS) {
    powerStats.set(power, {
      power,
      supplyCenters: 0,
      units: 0,
      eliminated: eliminatedPowers.includes(power),
    });
  }

  // Track activity to infer elimination
  for (const entry of logs) {
    const event = entry.event;
    if (event.type === 'llm_response' || event.type === 'orders_submitted') {
      const power = (event as { power: string }).power as Power;
      if (POWERS.includes(power)) {
        lastActivity.set(power, {
          year: 0, // We'll infer from phase_started
          season: 'SPRING',
        });
      }
    }
    if (event.type === 'phase_started') {
      // Update year/season for tracking
      for (const power of lastActivity.keys()) {
        lastActivity.set(power, { year: event.year, season: event.season });
      }
    }
  }

  // Find game end info
  const gameEnded = logs.find((e) => e.event.type === 'game_ended');
  if (gameEnded?.event.type === 'game_ended' && gameEnded.event.winner) {
    const winnerStats = powerStats.get(gameEnded.event.winner as Power);
    if (winnerStats) {
      winnerStats.supplyCenters = 18; // Solo victory threshold
    }
  }

  return Array.from(powerStats.values()).sort(
    (a, b) => b.supplyCenters - a.supplyCenters
  );
}

function generateTitle(context: NarrativeContext): string {
  if (context.winner) {
    const titles = [
      `The Rise of ${context.winner}: A Diplomacy Chronicle`,
      `${context.winner}'s Triumph: The ${context.finalYear} Campaign`,
      `Victory Through ${context.stats.deceptionsDetected > 5 ? 'Deception' : 'Strategy'}: ${context.winner}'s Path to Glory`,
    ];
    return titles[Math.floor(Math.random() * titles.length)];
  }
  if (context.isDraw) {
    return `Stalemate: The ${context.finalYear} Diplomatic Standoff`;
  }
  return `The ${context.gameName || context.gameId} Chronicles`;
}

function generateOpening(context: NarrativeContext): string {
  const year = context.finalYear;
  const phases = context.stats.totalPhases;
  const messages = context.stats.totalMessages;

  let opening = `# ${generateTitle(context)}\n\n`;
  opening += `In the spring of 1901, seven great powers stood poised on the brink of war. `;
  opening += `What followed was a ${year - 1901 + 1}-year struggle spanning ${phases} phases `;
  opening += `and ${messages} diplomatic exchanges.\n\n`;

  if (context.winner) {
    opening += `In the end, only ${context.winner} would stand triumphant, `;
    opening += `having navigated a web of alliances and betrayals to claim ultimate victory.\n`;
  } else if (context.isDraw) {
    opening += `The great powers ground each other to exhaustion, `;
    opening += `with no single nation able to achieve dominance.\n`;
  }

  return opening;
}

function narrateEvents(events: NarrativeEvent[], era: 'early' | 'mid' | 'late'): string {
  if (events.length === 0) return '';

  const lines: string[] = [];

  // Group by importance
  const highImportance = events.filter((e) => e.importance >= 0.8);
  const mediumImportance = events.filter((e) => e.importance >= 0.6 && e.importance < 0.8);

  for (const event of [...highImportance, ...mediumImportance].slice(0, 8)) {
    let text = `In ${event.season} ${event.year}, ${event.description}. `;
    if (event.evidence) {
      text += `*"${event.evidence.slice(0, 100)}..."*\n\n`;
    } else {
      text += '\n\n';
    }
    lines.push(text);
  }

  return lines.join('');
}

function generateConclusion(context: NarrativeContext): string {
  let conclusion = '';

  if (context.winner) {
    conclusion += `After ${context.finalYear - 1901 + 1} years of conflict, ${context.winner} emerged victorious. `;
    if (context.stats.deceptionsDetected > 3) {
      conclusion += `The path to victory was paved with deception - `;
      conclusion += `${context.stats.deceptionsDetected} instances of intentional misdirection were detected throughout the game. `;
    }
  } else if (context.isDraw) {
    conclusion += `The game concluded in ${context.finalYear} with no clear victor. `;
    conclusion += `The remaining powers had reached an equilibrium that none could break. `;
  }

  if (context.stats.eliminatedPowers.length > 0) {
    conclusion += `\n\nThe following powers were eliminated during the game: `;
    conclusion += `${context.stats.eliminatedPowers.join(', ')}. `;
  }

  return conclusion;
}

function generateStatistics(context: NarrativeContext): string {
  const lines: string[] = [];

  lines.push(`| Statistic | Value |`);
  lines.push(`|-----------|-------|`);
  lines.push(`| Duration | ${1901} - ${context.finalYear} |`);
  lines.push(`| Total Phases | ${context.stats.totalPhases} |`);
  lines.push(`| Diplomatic Messages | ${context.stats.totalMessages} |`);
  lines.push(`| Deceptions Detected | ${context.stats.deceptionsDetected} |`);

  return lines.join('\n');
}

function generateStandingsTable(standings: PowerSnapshot[]): string {
  const lines: string[] = [];

  lines.push(`| Power | Supply Centers | Status |`);
  lines.push(`|-------|----------------|--------|`);

  for (const standing of standings) {
    const status = standing.eliminated ? 'Eliminated' : 'Active';
    lines.push(`| ${standing.power} | ${standing.supplyCenters} | ${status} |`);
  }

  return lines.join('\n');
}
