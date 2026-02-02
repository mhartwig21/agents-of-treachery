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
import { getProvince, PROVINCES, areAdjacent } from '../engine/map';

/**
 * Result of parsing orders from agent response.
 */
export interface ParseResult {
  orders: Order[];
  retreatOrders: RetreatOrder[];
  buildOrders: BuildOrder[];
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
  'moscow': 'MOS',
  'warsaw': 'WAR',
  'st. petersburg': 'STP',
  'st petersburg': 'STP',
  'sevastopol': 'SEV',
  'constantinople': 'CON',
  'ankara': 'ANK',
  'smyrna': 'SMY',
  'norway': 'NWY',
  'sweden': 'SWE',
  'denmark': 'DEN',
  'holland': 'HOL',
  'belgium': 'BEL',
  'spain': 'SPA',
  'portugal': 'POR',
  'tunis': 'TUN',
  'serbia': 'SER',
  'rumania': 'RUM',
  'romania': 'RUM',
  'bulgaria': 'BUL',
  'greece': 'GRE',
  'clyde': 'CLY',
  'yorkshire': 'YOR',
  'wales': 'WAL',
  'picardy': 'PIC',
  'burgundy': 'BUR',
  'gascony': 'GAS',
  'ruhr': 'RUH',
  'prussia': 'PRU',
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
 * Normalize a province name to its ID.
 */
export function normalizeProvince(input: string): string | null {
  const normalized = input.trim().toLowerCase();

  // Check direct alias match
  if (PROVINCE_ALIASES[normalized]) {
    return PROVINCE_ALIASES[normalized];
  }

  // Check if it's already a valid ID
  const upper = input.trim().toUpperCase();
  if (PROVINCES.find(p => p.id === upper)) {
    return upper;
  }

  // Try partial match
  const province = PROVINCES.find(p =>
    p.name.toLowerCase() === normalized ||
    p.id.toLowerCase() === normalized
  );

  return province?.id ?? null;
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
  // Look for ORDERS: section
  const ordersMatch = response.match(/ORDERS:\s*([\s\S]*?)(?=(?:RETREATS:|BUILDS:|REASONING:|$))/i);
  if (ordersMatch) {
    return ordersMatch[1].trim();
  }

  // Look for code block with orders
  const codeBlockMatch = response.match(/```(?:\w*\n)?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  return null;
}

/**
 * Extract the retreats section from agent response.
 */
export function extractRetreatsSection(response: string): string | null {
  const retreatsMatch = response.match(/RETREATS:\s*([\s\S]*?)(?=(?:ORDERS:|BUILDS:|REASONING:|$))/i);
  if (retreatsMatch) {
    return retreatsMatch[1].trim();
  }
  return null;
}

/**
 * Extract the builds section from agent response.
 */
export function extractBuildsSection(response: string): string | null {
  const buildsMatch = response.match(/BUILDS:\s*([\s\S]*?)(?=(?:ORDERS:|RETREATS:|REASONING:|$))/i);
  if (buildsMatch) {
    return buildsMatch[1].trim();
  }
  return null;
}

/**
 * Parse a single order line.
 */
export function parseOrderLine(line: string): {
  order: Order | null;
  error: string | null;
} {
  // Clean up the line
  let cleaned = line.trim();
  if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('//')) {
    return { order: null, error: null };
  }

  // Remove leading dashes or bullets
  cleaned = cleaned.replace(/^[-*•]\s*/, '');

  // Try to find the action keyword and split there
  const actionKeywords = ['HOLD', 'SUPPORT', 'CONVOY', '->'];
  let actionIndex = -1;

  for (const kw of actionKeywords) {
    const idx = cleaned.toUpperCase().indexOf(` ${kw}`);
    if (idx !== -1 && (actionIndex === -1 || idx < actionIndex)) {
      actionIndex = idx;
    }
  }

  // Special case: check for "->" without space
  const arrowIdx = cleaned.indexOf('->');
  if (arrowIdx !== -1 && (actionIndex === -1 || arrowIdx < actionIndex)) {
    actionIndex = arrowIdx;
  }

  if (actionIndex === -1) {
    // No action keyword found, try simple format
    return parseSimpleOrder(cleaned);
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
    return { order: null, error: `Unknown province: ${unitPart}` };
  }

  // Parse the action
  return parseAction(unitProvince, actionPart);
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

  // HOLD
  if (/^(HOLD|H)$/i.test(action)) {
    return {
      order: { type: 'HOLD', unit },
      error: null,
    };
  }

  // MOVE: -> Destination or MOVE Destination
  const moveMatch = action.match(/^(?:->|-|MOVE\s+)([A-Za-z\s.]+?)(?:\s*\(([^)]+)\))?(?:\s+VIA\s+CONVOY)?$/i);
  if (moveMatch) {
    const destination = normalizeProvince(moveMatch[1]);
    if (!destination) {
      return { order: null, error: `Unknown destination: ${moveMatch[1]}` };
    }

    const coast = moveMatch[2] ? parseCoast(moveMatch[2]) : undefined;
    const viaConvoy = /VIA\s+CONVOY/i.test(action);

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

  // CONVOY: CONVOY [Unit] [Province] -> [Destination]
  const convoyMatch = action.match(/^CONVOY\s+([AF])?\s*([A-Za-z\s.]+?)\s*(?:->|-|to)\s*([A-Za-z\s.]+)$/i);
  if (convoyMatch) {
    const convoyedProvince = normalizeProvince(convoyMatch[2]);
    const destination = normalizeProvince(convoyMatch[3]);

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
  let cleaned = line.trim();
  if (!cleaned || cleaned.startsWith('#')) {
    return { order: null, error: null };
  }

  cleaned = cleaned.replace(/^[-*•]\s*/, '');

  // DISBAND: [Unit] [Province] DISBAND
  const disbandMatch = cleaned.match(/^([AF])?\s*([A-Za-z\s.]+?)\s+DISBAND$/i);
  if (disbandMatch) {
    const province = normalizeProvince(disbandMatch[2]);
    if (province) {
      return { order: { unit: province }, error: null };
    }
  }

  // RETREAT: [Unit] [Province] -> [Destination]
  const retreatMatch = cleaned.match(/^([AF])?\s*([A-Za-z\s.]+?)\s*(?:->|-|to)\s*([A-Za-z\s.]+)$/i);
  if (retreatMatch) {
    const unit = normalizeProvince(retreatMatch[2]);
    const destination = normalizeProvince(retreatMatch[3]);

    if (unit && destination) {
      return { order: { unit, destination }, error: null };
    }
  }

  return { order: null, error: `Could not parse retreat: ${line}` };
}

/**
 * Parse a build order line.
 */
export function parseBuildLine(line: string): {
  order: BuildOrder | null;
  error: string | null;
} {
  let cleaned = line.trim();
  if (!cleaned || cleaned.startsWith('#')) {
    return { order: null, error: null };
  }

  cleaned = cleaned.replace(/^[-*•]\s*/, '');

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

  return { order: null, error: `Could not parse build: ${line}` };
}

/**
 * Parse all orders from an agent response.
 */
export function parseAgentResponse(response: string): ParseResult {
  const result: ParseResult = {
    orders: [],
    retreatOrders: [],
    buildOrders: [],
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
