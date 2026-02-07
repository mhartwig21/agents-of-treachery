/**
 * Order parsing system for agent responses.
 *
 * Parses natural language and structured order formats from agent
 * responses into validated game orders.
 */

import type {
  Power,
  Order,
  MoveOrder,
  RetreatOrder,
  BuildOrder,
  UnitType,
  Coast,
  GameState,
} from '../engine/types';
import { POWERS } from '../engine/types';
import { getProvince, PROVINCES, areAdjacent } from '../engine/map';
import type { DiplomaticAction } from './types';

/**
 * Parse failure record for diagnostics.
 */
export interface ParseFailure {
  line: string;
  error: string;
  timestamp: number;
}

/** In-memory log of recent parse failures for diagnostics. */
const parseFailureLog: ParseFailure[] = [];
const MAX_FAILURE_LOG = 200;

/** Record a parse failure for diagnostics. */
function logParseFailure(line: string, error: string): void {
  parseFailureLog.push({ line, error, timestamp: Date.now() });
  if (parseFailureLog.length > MAX_FAILURE_LOG) {
    parseFailureLog.shift();
  }
}

/** Get recent parse failures (for diagnostics / monitoring). */
export function getParseFailures(): ReadonlyArray<ParseFailure> {
  return parseFailureLog;
}

/** Clear parse failure log (for testing). */
export function clearParseFailures(): void {
  parseFailureLog.length = 0;
}

/**
 * Result of parsing orders from agent response.
 */
export interface ParseResult {
  orders: Order[];
  retreatOrders: RetreatOrder[];
  buildOrders: BuildOrder[];
  diplomaticMessages: DiplomaticAction[];
  errors: string[];
  warnings: string[];
}

/**
 * Province name aliases for flexible parsing.
 */
const PROVINCE_ALIASES: Record<string, string> = {
  // Full names
  'london': 'LON',
  'liverpool': 'LVP',
  'edinburgh': 'EDI',
  'paris': 'PAR',
  'marseilles': 'MAR',
  'marseille': 'MAR',
  'brest': 'BRE',
  'berlin': 'BER',
  'munich': 'MUN',
  'kiel': 'KIE',
  'rome': 'ROM',
  'venice': 'VEN',
  'naples': 'NAP',
  'vienna': 'VIE',
  'budapest': 'BUD',
  'trieste': 'TRI',
  'tripoli': 'TRI', // Common confusion
  'moscow': 'MOS',
  'warsaw': 'WAR',
  'st. petersburg': 'STP',
  'st petersburg': 'STP',
  'stettin': 'STP', // Common mistaken name for St Petersburg
  'sevastopol': 'SEV',
  'constantinople': 'CON',
  'ankara': 'ANK',
  'smyrna': 'SMY',
  'norway': 'NWY',
  'sweden': 'SWE',
  'denmark': 'DEN',
  'holland': 'HOL',
  'netherlands': 'HOL',
  'belgium': 'BEL',
  'spain': 'SPA',
  'portugal': 'POR',
  'tunis': 'TUN',
  'tunisia': 'TUN',
  'serbia': 'SER',
  'rumania': 'RUM',
  'romania': 'RUM',
  'bulgaria': 'BUL',
  'greece': 'GRE',
  'athens': 'GRE', // Common alias
  'clyde': 'CLY',
  'yorkshire': 'YOR',
  'wales': 'WAL',
  'picardy': 'PIC',
  'burgundy': 'BUR',
  'gascony': 'GAS',
  'ruhr': 'RUH',
  'rhineland': 'RUH', // Common mistaken name
  'prussia': 'PRU',
  'east prussia': 'PRU',
  'silesia': 'SIL',
  'piedmont': 'PIE',
  'tuscany': 'TUS',
  'apulia': 'APU',
  'tyrolia': 'TYR',
  'bohemia': 'BOH',
  'galicia': 'GAL',
  'ukraine': 'UKR',
  'livonia': 'LVN',
  'finland': 'FIN',
  'armenia': 'ARM',
  'syria': 'SYR',
  'albania': 'ALB',
  'north africa': 'NAF',
  'north sea': 'NTH',
  'norwegian sea': 'NWG',
  'barents sea': 'BAR',
  'skagerrak': 'SKA',
  'heligoland bight': 'HEL',
  'heligoland': 'HEL',
  'baltic sea': 'BAL',
  'baltic': 'BAL',
  'gulf of bothnia': 'BOT',
  'bothnia': 'BOT',
  'english channel': 'ENG',
  'channel': 'ENG',
  'irish sea': 'IRI',
  'north atlantic ocean': 'NAO',
  'north atlantic': 'NAO',
  'mid-atlantic ocean': 'MAO',
  'mid atlantic': 'MAO',
  'western mediterranean': 'WES',
  'west med': 'WES',
  'gulf of lyon': 'LYO',
  'lyon': 'LYO',
  'tyrrhenian sea': 'TYS',
  'tyrrhenian': 'TYS',
  'ionian sea': 'ION',
  'ionian': 'ION',
  'adriatic sea': 'ADR',
  'adriatic': 'ADR',
  'aegean sea': 'AEG',
  'aegean': 'AEG',
  'eastern mediterranean': 'EAS',
  'east med': 'EAS',
  'black sea': 'BLA',
};

/**
 * Coast aliases.
 */
const COAST_ALIASES: Record<string, Coast> = {
  'north': 'NORTH',
  'south': 'SOUTH',
  'east': 'EAST',
  'west': 'WEST',
  'nc': 'NORTH',
  'sc': 'SOUTH',
  'ec': 'EAST',
  'wc': 'WEST',
  'n': 'NORTH',
  's': 'SOUTH',
  'e': 'EAST',
  'w': 'WEST',
  'north coast': 'NORTH',
  'south coast': 'SOUTH',
  'east coast': 'EAST',
  'west coast': 'WEST',
};

/**
 * Compute Levenshtein edit distance between two strings.
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Normalize a province name to its ID.
 * Uses exact matching first, then fuzzy matching for close misspellings.
 */
export function normalizeProvince(input: string): string | null {
  const normalized = input.trim().toLowerCase();

  if (!normalized) return null;

  // Check direct alias match
  if (PROVINCE_ALIASES[normalized]) {
    return PROVINCE_ALIASES[normalized];
  }

  // Check if it's already a valid ID
  const upper = input.trim().toUpperCase();
  if (PROVINCES.find(p => p.id === upper)) {
    return upper;
  }

  // Try partial match on province name or id
  const province = PROVINCES.find(p =>
    p.name.toLowerCase() === normalized ||
    p.id.toLowerCase() === normalized
  );

  if (province) return province.id;

  // Fuzzy match: try alias keys with edit distance <= 2
  // Only for inputs of length >= 4 to avoid false positives on short strings
  if (normalized.length >= 4) {
    let bestAlias: string | null = null;
    let bestDist = Infinity;
    for (const [alias, id] of Object.entries(PROVINCE_ALIASES)) {
      if (Math.abs(alias.length - normalized.length) > 2) continue;
      const dist = editDistance(normalized, alias);
      if (dist <= 2 && dist < bestDist) {
        bestDist = dist;
        bestAlias = id;
      }
    }
    if (bestAlias) return bestAlias;

    // Fuzzy match on province names
    let bestProvince: string | null = null;
    bestDist = Infinity;
    for (const p of PROVINCES) {
      const pName = p.name.toLowerCase();
      if (Math.abs(pName.length - normalized.length) > 2) continue;
      const dist = editDistance(normalized, pName);
      if (dist <= 2 && dist < bestDist) {
        bestDist = dist;
        bestProvince = p.id;
      }
    }
    if (bestProvince) return bestProvince;
  }

  return null;
}

/**
 * Parse a coast from text.
 */
export function parseCoast(input: string): Coast | null {
  const normalized = input.trim().toLowerCase();
  return COAST_ALIASES[normalized] ?? null;
}

/**
 * Extract the orders section from agent response.
 */
export function extractOrdersSection(response: string): string | null {
  // Look for ORDERS: section (with optional markdown heading markers)
  const ordersMatch = response.match(/(?:#{1,3}\s*)?ORDERS:\s*([\s\S]*?)(?=(?:RETREATS:|BUILDS:|REASONING:|DIPLOMACY:|$))/i);
  if (ordersMatch) {
    let content = ordersMatch[1].trim();
    // Remove any trailing code block markers
    content = content.replace(/```\s*$/g, '');
    return content;
  }

  // Look for code block with orders
  const codeBlockMatch = response.match(/```(?:\w*\n)?([\s\S]*?)```/);
  if (codeBlockMatch) {
    let content = codeBlockMatch[1].trim();
    // Strip "ORDERS:" prefix if it appears at the start of the code block
    content = content.replace(/^ORDERS:\s*/i, '');
    return content;
  }

  // Last resort: look for lines that look like orders (A/F followed by province patterns)
  // This handles responses where the LLM just outputs orders without a section header
  const orderLinePattern = /^[•\-*\d.)]*\s*[AF]\s+[A-Z]{3}\s+(?:HOLD|SUPPORT|CONVOY|->|H$|MOVE)/im;
  if (orderLinePattern.test(response)) {
    // Extract all lines that look like orders
    const lines = response.split('\n');
    const orderLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[•\-*\d.)]*\s*[AF]\s+[A-Za-z]/i.test(trimmed)) {
        orderLines.push(trimmed);
      }
    }
    if (orderLines.length > 0) {
      return orderLines.join('\n');
    }
  }

  return null;
}

/**
 * Extract the retreats section from agent response.
 */
export function extractRetreatsSection(response: string): string | null {
  const retreatsMatch = response.match(/RETREATS:\s*([\s\S]*?)(?=(?:ORDERS:|BUILDS:|REASONING:|DIPLOMACY:|$))/i);
  if (retreatsMatch) {
    return retreatsMatch[1].trim();
  }
  return null;
}

/**
 * Extract the builds section from agent response.
 */
export function extractBuildsSection(response: string): string | null {
  const buildsMatch = response.match(/BUILDS:\s*([\s\S]*?)(?=(?:ORDERS:|RETREATS:|REASONING:|DIPLOMACY:|$))/i);
  if (buildsMatch) {
    return buildsMatch[1].trim();
  }
  return null;
}

/**
 * Extract the diplomacy section from agent response.
 */
export function extractDiplomacySection(response: string): string | null {
  const diplomacyMatch = response.match(/DIPLOMACY:\s*([\s\S]*?)(?=(?:ORDERS:|RETREATS:|BUILDS:|REASONING:|$))/i);
  if (diplomacyMatch) {
    return diplomacyMatch[1].trim();
  }
  return null;
}

/**
 * Clean raw order line: strip markdown, numbering, bullets, and normalize whitespace.
 */
function cleanOrderLine(line: string): string {
  let cleaned = line.trim();

  // Strip markdown bold/italic
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1');
  cleaned = cleaned.replace(/__(.+?)__/g, '$1');
  cleaned = cleaned.replace(/\*(.+?)\*/g, '$1');
  cleaned = cleaned.replace(/_(.+?)_/g, '$1');

  // Strip inline backticks
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // Remove numbered list prefixes: "1.", "2)", "1:", etc.
  cleaned = cleaned.replace(/^\d+[.):\-]\s*/, '');

  // Remove leading dashes, asterisks, or bullets
  cleaned = cleaned.replace(/^[-*•]\s*/, '');

  // Normalize unicode arrows to ->
  cleaned = cleaned.replace(/[→⇒⟶]/g, '->');

  // Normalize "Army" / "Fleet" to A / F
  cleaned = cleaned.replace(/^Army\s+/i, 'A ');
  cleaned = cleaned.replace(/^Fleet\s+/i, 'F ');
  // Also handle within support/convoy: "SUPPORT Army" -> "SUPPORT A"
  cleaned = cleaned.replace(/\bArmy\s+/gi, 'A ');
  cleaned = cleaned.replace(/\bFleet\s+/gi, 'F ');

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ');

  return cleaned.trim();
}

/**
 * Parse a single order line.
 */
export function parseOrderLine(line: string): {
  order: Order | null;
  error: string | null;
} {
  // Clean up the line
  let cleaned = cleanOrderLine(line);
  if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('//')) {
    return { order: null, error: null };
  }

  // Normalize "MOVE TO" and "MOVES TO" to "->"
  cleaned = cleaned.replace(/\s+MOVES?\s+TO\s+/gi, ' -> ');
  // Normalize "MOVE" followed by destination to "->"
  cleaned = cleaned.replace(/\s+MOVE\s+(?!.*(?:SUPPORT|CONVOY|HOLD))/gi, ' -> ');

  // Normalize shorthand: S -> SUPPORT, C -> CONVOY
  // Only when S or C appears as a standalone word between province-like tokens
  cleaned = cleaned.replace(/\s+S\s+(?=[AF]\s|[A-Z]{3})/i, ' SUPPORT ');
  cleaned = cleaned.replace(/\s+C\s+(?=[AF]\s|[A-Z]{3})/i, ' CONVOY ');

  // Try to find the action keyword and split there
  // Include 'H' as a keyword for HOLD shorthand
  const actionKeywords = ['HOLD', 'SUPPORT', 'CONVOY', '->', 'H'];
  let actionIndex = -1;

  for (const kw of actionKeywords) {
    const idx = cleaned.toUpperCase().indexOf(` ${kw}`);
    if (idx !== -1 && (actionIndex === -1 || idx < actionIndex)) {
      // For single-char keywords (H), verify it's at end of line or followed by space
      // to avoid matching province names containing H
      if (kw === 'H') {
        const afterH = idx + 2; // position after " H"
        if (afterH < cleaned.length && cleaned[afterH] !== ' ' && cleaned[afterH] !== '\t') {
          continue; // 'H' is part of a longer word, skip
        }
      }
      actionIndex = idx;
    }
  }

  // Special case: check for "->" without space
  const arrowIdx = cleaned.indexOf('->');
  if (arrowIdx !== -1 && (actionIndex === -1 || arrowIdx < actionIndex)) {
    actionIndex = arrowIdx;
  }

  // Also check for single dash move pattern: "A PAR - BUR" (but not "->")
  if (actionIndex === -1) {
    const singleDashMatch = cleaned.match(/^([AF]?\s*[A-Za-z\s.]+?)\s+-\s+([A-Za-z\s.]+)$/i);
    if (singleDashMatch) {
      // Rewrite as arrow notation and re-parse
      cleaned = cleaned.replace(/\s+-\s+/, ' -> ');
      const newArrowIdx = cleaned.indexOf('->');
      if (newArrowIdx !== -1) {
        actionIndex = newArrowIdx;
      }
    }
  }

  if (actionIndex === -1) {
    // No action keyword found, try simple format
    const result = parseSimpleOrder(cleaned);
    if (result.error) {
      logParseFailure(line, result.error);
    }
    return result;
  }

  // Extract unit part (before action)
  const unitPart = cleaned.slice(0, actionIndex).trim();
  const actionPart = cleaned.slice(actionIndex).trim();

  // Parse unit type and location
  const unitTypeMatch = unitPart.match(/^([AF])\s+(.+)$/i);
  let unitProvince: string | null;

  if (unitTypeMatch) {
    unitProvince = normalizeProvince(unitTypeMatch[2].trim());
  } else {
    // Try without unit type prefix
    unitProvince = normalizeProvince(unitPart);
  }

  if (!unitProvince) {
    const error = `Unknown province: ${unitPart}`;
    logParseFailure(line, error);
    return { order: null, error };
  }

  // Parse the action
  const result = parseAction(unitProvince, actionPart);
  if (result.error) {
    logParseFailure(line, result.error);
  }
  return result;
}

/**
 * Parse a simple order format (just province names).
 */
function parseSimpleOrder(line: string): { order: Order | null; error: string | null } {
  // Format: "Province HOLD" or "Province -> Destination"
  const holdMatch = line.match(/^([A-Za-z\s.]+?)\s+HOLD$/i);
  if (holdMatch) {
    const province = normalizeProvince(holdMatch[1]);
    if (province) {
      return { order: { type: 'HOLD', unit: province }, error: null };
    }
  }

  const moveMatch = line.match(/^([A-Za-z\s.]+?)\s*(?:->|-|to)\s*([A-Za-z\s.]+?)(?:\s*\(([^)]+)\))?(?:\s+VIA\s+CONVOY)?$/i);
  if (moveMatch) {
    const unitProvince = normalizeProvince(moveMatch[1]);
    const destination = normalizeProvince(moveMatch[2]);
    const coast = moveMatch[3] ? parseCoast(moveMatch[3]) : undefined;
    const viaConvoy = /VIA\s+CONVOY/i.test(line);

    if (unitProvince && destination) {
      const order: MoveOrder = {
        type: 'MOVE',
        unit: unitProvince,
        destination,
      };
      if (coast) order.destinationCoast = coast;
      if (viaConvoy) order.viaConvoy = true;
      return { order, error: null };
    }
  }

  return { order: null, error: `Could not parse order: ${line}` };
}

/**
 * Parse the action part of an order.
 */
function parseAction(
  unit: string,
  actionStr: string
): { order: Order | null; error: string | null } {
  const action = actionStr.trim();

  // HOLD (including "H" shorthand and "HOLDS")
  if (/^(HOLD|HOLDS|H)$/i.test(action)) {
    return {
      order: { type: 'HOLD', unit },
      error: null,
    };
  }

  // MOVE: -> Destination or MOVE Destination (with optional VIA CONVOY)
  // First, strip VIA CONVOY from the action string for cleaner parsing
  const viaConvoy = /VIA\s+CONVOY/i.test(action);
  const actionClean = action.replace(/\s+VIA\s+CONVOY/gi, '').trim();

  const moveMatch = actionClean.match(/^(?:->|-|M\s+|MOVE\s+)([A-Za-z\s.\-]+?)(?:\s*\(([^)]+)\))?$/i);
  if (moveMatch) {
    const destination = normalizeProvince(moveMatch[1]);
    if (!destination) {
      return { order: null, error: `Unknown destination: ${moveMatch[1]}` };
    }

    const coast = moveMatch[2] ? parseCoast(moveMatch[2]) : undefined;

    const order: MoveOrder = {
      type: 'MOVE',
      unit,
      destination,
    };
    if (coast) order.destinationCoast = coast;
    if (viaConvoy) order.viaConvoy = true;

    return { order, error: null };
  }

  // SUPPORT HOLD: SUPPORT [Unit] [Province]
  const supportHoldMatch = action.match(/^SUPPORT\s+([AF])?\s*([A-Za-z\s.]+?)(?:\s+HOLD)?$/i);
  if (supportHoldMatch && !action.includes('->') && !action.toLowerCase().includes(' to ')) {
    const supportedProvince = normalizeProvince(supportHoldMatch[2]);
    if (!supportedProvince) {
      return { order: null, error: `Unknown supported unit: ${supportHoldMatch[2]}` };
    }

    return {
      order: {
        type: 'SUPPORT',
        unit,
        supportedUnit: supportedProvince,
      },
      error: null,
    };
  }

  // SUPPORT MOVE: SUPPORT [Unit] [Province] -> [Destination]
  const supportMoveMatch = action.match(/^SUPPORT\s+([AF])?\s*([A-Za-z\s.]+?)\s*(?:->|-|to)\s*([A-Za-z\s.]+)$/i);
  if (supportMoveMatch) {
    const supportedProvince = normalizeProvince(supportMoveMatch[2]);
    const destination = normalizeProvince(supportMoveMatch[3]);

    if (!supportedProvince) {
      return { order: null, error: `Unknown supported unit: ${supportMoveMatch[2]}` };
    }
    if (!destination) {
      return { order: null, error: `Unknown support destination: ${supportMoveMatch[3]}` };
    }

    return {
      order: {
        type: 'SUPPORT',
        unit,
        supportedUnit: supportedProvince,
        destination,
      },
      error: null,
    };
  }

  // CONVOY: CONVOY [Unit] [Province] -> [Destination] (VIA CONVOY)?
  const convoyMatch = action.match(/^CONVOY\s+([AF])?\s*([A-Za-z\s.]+?)\s*(?:->|-|to)\s*([A-Za-z\s.]+?)(?:\s+VIA\s+CONVOY)?$/i);
  if (convoyMatch) {
    const convoyedProvince = normalizeProvince(convoyMatch[2]);
    // Strip VIA CONVOY from destination if somehow included
    const destStr = convoyMatch[3].replace(/\s+VIA\s+CONVOY$/i, '').trim();
    const destination = normalizeProvince(destStr);

    if (!convoyedProvince) {
      return { order: null, error: `Unknown convoyed unit: ${convoyMatch[2]}` };
    }
    if (!destination) {
      return { order: null, error: `Unknown convoy destination: ${convoyMatch[3]}` };
    }

    return {
      order: {
        type: 'CONVOY',
        unit,
        convoyedUnit: convoyedProvince,
        destination,
      },
      error: null,
    };
  }

  return { order: null, error: `Could not parse action: ${action}` };
}

/**
 * Parse a retreat order line.
 */
export function parseRetreatLine(line: string): {
  order: RetreatOrder | null;
  error: string | null;
} {
  let cleaned = cleanOrderLine(line);
  if (!cleaned || cleaned.startsWith('#')) {
    return { order: null, error: null };
  }

  // DISBAND: [Unit] [Province] DISBAND
  const disbandMatch = cleaned.match(/^([AF])?\s*([A-Za-z\s.]+?)\s+DISBAND$/i);
  if (disbandMatch) {
    const province = normalizeProvince(disbandMatch[2]);
    if (province) {
      return { order: { unit: province }, error: null };
    }
  }

  // RETREAT: [Unit] [Province] -> [Destination]
  const retreatMatch = cleaned.match(/^([AF])?\s*([A-Za-z\s.]+?)\s*(?:->|→|-|to)\s*([A-Za-z\s.]+)$/i);
  if (retreatMatch) {
    const unit = normalizeProvince(retreatMatch[2]);
    const destination = normalizeProvince(retreatMatch[3]);

    if (unit && destination) {
      return { order: { unit, destination }, error: null };
    }
  }

  const error = `Could not parse retreat: ${line}`;
  logParseFailure(line, error);
  return { order: null, error };
}

/**
 * Parse a build order line.
 */
export function parseBuildLine(line: string): {
  order: BuildOrder | null;
  error: string | null;
} {
  let cleaned = cleanOrderLine(line);
  if (!cleaned || cleaned.startsWith('#')) {
    return { order: null, error: null };
  }

  // DISBAND: DISBAND [Unit] [Province]
  const disbandMatch = cleaned.match(/^DISBAND\s+([AF])?\s*([A-Za-z\s.]+?)(?:\s*\(([^)]+)\))?$/i);
  if (disbandMatch) {
    const province = normalizeProvince(disbandMatch[2]);
    if (province) {
      return {
        order: { type: 'DISBAND', province },
        error: null,
      };
    }
  }

  // BUILD: BUILD [A/F] [Province]
  const buildMatch = cleaned.match(/^BUILD\s+([AF])\s+([A-Za-z\s.]+?)(?:\s*\(([^)]+)\))?$/i);
  if (buildMatch) {
    const unitType: UnitType = buildMatch[1].toUpperCase() === 'A' ? 'ARMY' : 'FLEET';
    const province = normalizeProvince(buildMatch[2]);
    const coast = buildMatch[3] ? parseCoast(buildMatch[3]) : undefined;

    if (province) {
      const order: BuildOrder = {
        type: 'BUILD',
        province,
        unitType,
      };
      if (coast) order.coast = coast;
      return { order, error: null };
    }
  }

  const error = `Could not parse build: ${line}`;
  logParseFailure(line, error);
  return { order: null, error };
}

/**
 * Normalize a power name to its canonical form.
 */
function normalizePower(input: string): Power | null {
  const normalized = input.trim().toUpperCase();
  if (POWERS.includes(normalized as Power)) {
    return normalized as Power;
  }
  return null;
}

/**
 * Valid negotiation stages for tracking deal progression.
 */
const NEGOTIATION_STAGES = ['OPENING', 'COUNTER', 'FINAL', 'ACCEPT', 'REJECT'] as const;
type NegotiationStage = typeof NEGOTIATION_STAGES[number];

/**
 * Extract negotiation stage from message content.
 * Looks for [OPENING], [COUNTER], [FINAL], [ACCEPT], [REJECT] tags.
 */
function extractNegotiationStage(content: string): NegotiationStage | undefined {
  const stageMatch = content.match(/\[(OPENING|COUNTER|FINAL|ACCEPT|REJECT)\]/i);
  if (stageMatch) {
    return stageMatch[1].toUpperCase() as NegotiationStage;
  }
  return undefined;
}

/**
 * Extract conditional clause from message content.
 * Looks for "IF <condition> THEN <commitment>" patterns.
 */
function extractConditionalClause(content: string): { condition: string; commitment: string } | undefined {
  // Match "IF <condition>, THEN <commitment>" or "IF <condition> THEN <commitment>"
  const conditionalMatch = content.match(/\bIF\s+(.+?),?\s+THEN\s+(.+?)(?:\.|$)/i);
  if (conditionalMatch) {
    return {
      condition: conditionalMatch[1].trim(),
      commitment: conditionalMatch[2].trim(),
    };
  }
  return undefined;
}

/**
 * Parse a diplomacy line (SEND command).
 *
 * Expected format: SEND POWER: "message"
 * Examples:
 *   SEND FRANCE: "I propose we form an alliance"
 *   SEND GERMANY: "[COUNTER] Your proposal doesn't work. IF you stay out of Belgium THEN I support Munich."
 */
export function parseDiplomacyLine(line: string): {
  action: DiplomaticAction | null;
  error: string | null;
} {
  let cleaned = line.trim();
  if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('//')) {
    return { action: null, error: null };
  }

  // Remove leading dashes, bullets, or numbered prefixes
  cleaned = cleaned.replace(/^\d+[.):\-]\s*/, '');
  cleaned = cleaned.replace(/^[-*•]\s*/, '');

  // Parse SEND POWER: "message" format
  const sendMatch = cleaned.match(/^SEND\s+([A-Za-z]+):\s*"([^"]+)"$/i);
  if (sendMatch) {
    const targetPower = normalizePower(sendMatch[1]);
    const content = sendMatch[2];

    if (!targetPower) {
      return { action: null, error: `Unknown power: ${sendMatch[1]}` };
    }

    // Extract negotiation metadata from message content
    const negotiationStage = extractNegotiationStage(content);
    const conditional = extractConditionalClause(content);

    return {
      action: {
        type: 'SEND_MESSAGE',
        targetPowers: [targetPower],
        content,
        negotiationStage,
        conditional,
      },
      error: null,
    };
  }

  // Also support single-quoted messages
  const sendMatchSingleQuote = cleaned.match(/^SEND\s+([A-Za-z]+):\s*'([^']+)'$/i);
  if (sendMatchSingleQuote) {
    const targetPower = normalizePower(sendMatchSingleQuote[1]);
    const content = sendMatchSingleQuote[2];

    if (!targetPower) {
      return { action: null, error: `Unknown power: ${sendMatchSingleQuote[1]}` };
    }

    // Extract negotiation metadata from message content
    const negotiationStage = extractNegotiationStage(content);
    const conditional = extractConditionalClause(content);

    return {
      action: {
        type: 'SEND_MESSAGE',
        targetPowers: [targetPower],
        content,
        negotiationStage,
        conditional,
      },
      error: null,
    };
  }

  // If line starts with SEND but doesn't match, report error
  if (/^SEND\s/i.test(cleaned)) {
    return { action: null, error: `Could not parse diplomacy: ${line}` };
  }

  // Empty or non-SEND line, not an error
  return { action: null, error: null };
}

/**
 * Parse all orders from an agent response.
 */
export function parseAgentResponse(response: string): ParseResult {
  const result: ParseResult = {
    orders: [],
    retreatOrders: [],
    buildOrders: [],
    diplomaticMessages: [],
    errors: [],
    warnings: [],
  };

  // Extract and parse orders section
  const ordersSection = extractOrdersSection(response);
  if (ordersSection) {
    const lines = ordersSection.split('\n');
    for (const line of lines) {
      const { order, error } = parseOrderLine(line);
      if (order) {
        result.orders.push(order);
      } else if (error) {
        result.errors.push(error);
      }
    }
  }

  // Extract and parse retreats section
  const retreatsSection = extractRetreatsSection(response);
  if (retreatsSection) {
    const lines = retreatsSection.split('\n');
    for (const line of lines) {
      const { order, error } = parseRetreatLine(line);
      if (order) {
        result.retreatOrders.push(order);
      } else if (error) {
        result.errors.push(error);
      }
    }
  }

  // Extract and parse builds section
  const buildsSection = extractBuildsSection(response);
  if (buildsSection) {
    const lines = buildsSection.split('\n');
    for (const line of lines) {
      const { order, error } = parseBuildLine(line);
      if (order) {
        result.buildOrders.push(order);
      } else if (error) {
        result.errors.push(error);
      }
    }
  }

  // Extract and parse diplomacy section
  const diplomacySection = extractDiplomacySection(response);
  if (diplomacySection) {
    const lines = diplomacySection.split('\n');
    for (const line of lines) {
      const { action, error } = parseDiplomacyLine(line);
      if (action) {
        result.diplomaticMessages.push(action);
      } else if (error) {
        result.errors.push(error);
      }
    }
  }

  return result;
}

/**
 * Validate parsed orders against game state.
 */
export function validateOrders(
  orders: Order[],
  state: GameState,
  power: Power
): { valid: Order[]; errors: string[] } {
  const valid: Order[] = [];
  const errors: string[] = [];

  const myUnits = state.units.filter(u => u.power === power);
  const myUnitProvinces = new Set(myUnits.map(u => u.province));

  for (const order of orders) {
    // Check if we have a unit at this location
    if (!myUnitProvinces.has(order.unit)) {
      errors.push(`No unit at ${order.unit}`);
      continue;
    }

    const unit = myUnits.find(u => u.province === order.unit)!;

    // Validate based on order type
    switch (order.type) {
      case 'HOLD':
        valid.push(order);
        break;

      case 'MOVE':
        // Check adjacency
        if (!areAdjacent(order.unit, order.destination, unit.coast, order.destinationCoast)) {
          errors.push(`${order.unit} cannot reach ${order.destination}`);
        } else {
          valid.push(order);
        }
        break;

      case 'SUPPORT':
        // Check if supported unit exists
        const supportedUnit = state.units.find(u => u.province === order.supportedUnit);
        if (!supportedUnit) {
          errors.push(`No unit at ${order.supportedUnit} to support`);
        } else {
          valid.push(order);
        }
        break;

      case 'CONVOY':
        // Check if unit is a fleet in a sea province
        if (unit.type !== 'FLEET') {
          errors.push(`Only fleets can convoy`);
        } else {
          const prov = getProvince(order.unit);
          if (prov?.type !== 'SEA') {
            errors.push(`${order.unit} is not a sea province`);
          } else {
            valid.push(order);
          }
        }
        break;
    }
  }

  return { valid, errors };
}

/**
 * Fill in default HOLD orders for units without orders.
 */
export function fillDefaultOrders(
  orders: Order[],
  state: GameState,
  power: Power
): Order[] {
  const result = [...orders];
  const orderedUnits = new Set(orders.map(o => o.unit));

  const myUnits = state.units.filter(u => u.power === power);

  for (const unit of myUnits) {
    if (!orderedUnits.has(unit.province)) {
      result.push({ type: 'HOLD', unit: unit.province });
    }
  }

  return result;
}
