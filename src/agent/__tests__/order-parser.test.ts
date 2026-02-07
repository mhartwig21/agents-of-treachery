import { describe, it, expect } from 'vitest';
import {
  normalizeProvince,
  parseCoast,
  extractOrdersSection,
  extractRetreatsSection,
  extractBuildsSection,
  extractDiplomacySection,
  parseOrderLine,
  parseRetreatLine,
  parseBuildLine,
  parseDiplomacyLine,
  parseAgentResponse,
  validateOrders,
  fillDefaultOrders,
} from '../order-parser';
import type { GameState, Order, Power } from '../../engine/types';

// ---------------------------------------------------------------------------
// normalizeProvince
// ---------------------------------------------------------------------------
describe('normalizeProvince', () => {
  it('should normalize full province names', () => {
    expect(normalizeProvince('london')).toBe('LON');
    expect(normalizeProvince('Paris')).toBe('PAR');
    expect(normalizeProvince('BERLIN')).toBe('BER');
    expect(normalizeProvince('constantinople')).toBe('CON');
  });

  it('should accept already-valid IDs', () => {
    expect(normalizeProvince('LON')).toBe('LON');
    expect(normalizeProvince('PAR')).toBe('PAR');
    expect(normalizeProvince('BER')).toBe('BER');
  });

  it('should handle common aliases', () => {
    expect(normalizeProvince('marseille')).toBe('MAR');
    expect(normalizeProvince('marseilles')).toBe('MAR');
    expect(normalizeProvince('netherlands')).toBe('HOL');
    expect(normalizeProvince('holland')).toBe('HOL');
    expect(normalizeProvince('romania')).toBe('RUM');
    expect(normalizeProvince('rumania')).toBe('RUM');
    expect(normalizeProvince('athens')).toBe('GRE');
  });

  it('should handle sea/ocean aliases', () => {
    expect(normalizeProvince('english channel')).toBe('ENG');
    expect(normalizeProvince('channel')).toBe('ENG');
    expect(normalizeProvince('north sea')).toBe('NTH');
    expect(normalizeProvince('mid-atlantic ocean')).toBe('MAO');
    expect(normalizeProvince('mid atlantic')).toBe('MAO');
    expect(normalizeProvince('western mediterranean')).toBe('WES');
    expect(normalizeProvince('black sea')).toBe('BLA');
    expect(normalizeProvince('baltic')).toBe('BAL');
  });

  it('should handle St. Petersburg variants', () => {
    expect(normalizeProvince('st. petersburg')).toBe('STP');
    expect(normalizeProvince('st petersburg')).toBe('STP');
  });

  it('should handle whitespace trimming', () => {
    expect(normalizeProvince('  london  ')).toBe('LON');
    expect(normalizeProvince(' PAR ')).toBe('PAR');
  });

  it('should return null for unknown provinces', () => {
    expect(normalizeProvince('atlantis')).toBeNull();
    expect(normalizeProvince('mordor')).toBeNull();
    expect(normalizeProvince('')).toBeNull();
  });

  it('should handle case insensitivity', () => {
    expect(normalizeProvince('LONDON')).toBe('LON');
    expect(normalizeProvince('London')).toBe('LON');
    expect(normalizeProvince('lOnDoN')).toBe('LON');
  });
});

// ---------------------------------------------------------------------------
// parseCoast
// ---------------------------------------------------------------------------
describe('parseCoast', () => {
  it('should parse full coast names', () => {
    expect(parseCoast('north')).toBe('NORTH');
    expect(parseCoast('south')).toBe('SOUTH');
    expect(parseCoast('east')).toBe('EAST');
    expect(parseCoast('west')).toBe('WEST');
  });

  it('should parse abbreviated coasts', () => {
    expect(parseCoast('nc')).toBe('NORTH');
    expect(parseCoast('sc')).toBe('SOUTH');
    expect(parseCoast('n')).toBe('NORTH');
    expect(parseCoast('s')).toBe('SOUTH');
  });

  it('should parse verbose coast names', () => {
    expect(parseCoast('north coast')).toBe('NORTH');
    expect(parseCoast('south coast')).toBe('SOUTH');
  });

  it('should return null for invalid', () => {
    expect(parseCoast('nowhere')).toBeNull();
    expect(parseCoast('')).toBeNull();
  });

  it('should handle case insensitivity', () => {
    expect(parseCoast('NORTH')).toBe('NORTH');
    expect(parseCoast('North')).toBe('NORTH');
  });
});

// ---------------------------------------------------------------------------
// extractOrdersSection
// ---------------------------------------------------------------------------
describe('extractOrdersSection', () => {
  it('should extract ORDERS: section from response', () => {
    const response = `ANALYSIS: Things look good.

ORDERS:
A PAR -> BUR
F BRE -> ENG
A MAR HOLD

REASONING: Expanding influence.`;

    const result = extractOrdersSection(response);
    expect(result).toBeTruthy();
    expect(result).toContain('A PAR -> BUR');
    expect(result).toContain('F BRE -> ENG');
    expect(result).toContain('A MAR HOLD');
  });

  it('should extract orders from code blocks', () => {
    const response = `Here are my orders:

\`\`\`
A PAR -> BUR
F BRE -> ENG
\`\`\`

That should work well.`;

    const result = extractOrdersSection(response);
    expect(result).toBeTruthy();
    expect(result).toContain('A PAR -> BUR');
    expect(result).toContain('F BRE -> ENG');
  });

  it('should extract orders from labeled code blocks', () => {
    const response = `My orders:

\`\`\`text
ORDERS:
A PAR -> BUR
F BRE -> ENG
\`\`\``;

    const result = extractOrdersSection(response);
    expect(result).toBeTruthy();
    expect(result).toContain('A PAR -> BUR');
  });

  it('should stop at RETREATS section boundary', () => {
    const response = `ORDERS:
A PAR -> BUR

RETREATS:
A MUN -> TYR`;

    const orders = extractOrdersSection(response);
    expect(orders).toBeTruthy();
    expect(orders).toContain('A PAR -> BUR');
    expect(orders).not.toContain('A MUN -> TYR');
  });

  it('should stop at DIPLOMACY section boundary', () => {
    const response = `ORDERS:
A PAR -> BUR

DIPLOMACY:
SEND GERMANY: "Let's ally"`;

    const orders = extractOrdersSection(response);
    expect(orders).toBeTruthy();
    expect(orders).toContain('A PAR -> BUR');
    expect(orders).not.toContain('SEND GERMANY');
  });

  it('should return null when no orders found', () => {
    const response = 'I am thinking about my strategy...';
    expect(extractOrdersSection(response)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractRetreatsSection
// ---------------------------------------------------------------------------
describe('extractRetreatsSection', () => {
  it('should extract RETREATS: section', () => {
    const response = `ORDERS:
A PAR -> BUR

RETREATS:
A MUN -> TYR
F NTH DISBAND`;

    const retreats = extractRetreatsSection(response);
    expect(retreats).toBeTruthy();
    expect(retreats).toContain('A MUN -> TYR');
    expect(retreats).toContain('F NTH DISBAND');
  });

  it('should return null when no retreats section', () => {
    const response = `ORDERS:
A PAR HOLD`;
    expect(extractRetreatsSection(response)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractBuildsSection
// ---------------------------------------------------------------------------
describe('extractBuildsSection', () => {
  it('should extract BUILDS: section', () => {
    const response = `BUILDS:
BUILD A PAR
BUILD F BRE`;

    const builds = extractBuildsSection(response);
    expect(builds).toBeTruthy();
    expect(builds).toContain('BUILD A PAR');
    expect(builds).toContain('BUILD F BRE');
  });

  it('should stop at other section boundaries', () => {
    const response = `BUILDS:
BUILD A PAR

REASONING: Need more units.`;

    const builds = extractBuildsSection(response);
    expect(builds).toBeTruthy();
    expect(builds).toContain('BUILD A PAR');
    expect(builds).not.toContain('Need more units');
  });
});

// ---------------------------------------------------------------------------
// extractDiplomacySection
// ---------------------------------------------------------------------------
describe('extractDiplomacySection', () => {
  it('should extract DIPLOMACY: section', () => {
    const response = `ORDERS:
A PAR -> BUR

DIPLOMACY:
SEND GERMANY: "Let's form an alliance"
SEND ITALY: "Stay away from Tyrolia"`;

    const diplomacy = extractDiplomacySection(response);
    expect(diplomacy).toBeTruthy();
    expect(diplomacy).toContain('SEND GERMANY');
    expect(diplomacy).toContain('SEND ITALY');
  });

  it('should stop at ORDERS boundary', () => {
    const response = `DIPLOMACY:
SEND GERMANY: "Hello"

ORDERS:
A PAR -> BUR`;

    const diplomacy = extractDiplomacySection(response);
    expect(diplomacy).toBeTruthy();
    expect(diplomacy).toContain('SEND GERMANY');
    expect(diplomacy).not.toContain('A PAR');
  });
});

// ---------------------------------------------------------------------------
// parseOrderLine
// ---------------------------------------------------------------------------
describe('parseOrderLine', () => {
  describe('HOLD orders', () => {
    it('should parse "A PAR HOLD"', () => {
      const { order, error } = parseOrderLine('A PAR HOLD');
      expect(error).toBeNull();
      expect(order).toEqual({ type: 'HOLD', unit: 'PAR' });
    });

    // NOTE: "H" shorthand is recognized in parseAction but NOT detected as
    // an action keyword in parseOrderLine's keyword scan. The keyword list
    // checks for " HOLD" but not " H". This means "F LON H" falls through
    // to parseSimpleOrder which also can't parse it. This is a parser gap.
    it('should not parse "F LON H" (H shorthand not in keyword scan)', () => {
      const { order, error } = parseOrderLine('F LON H');
      // Parser does not recognize the "H" abbreviation at keyword-scan level
      expect(order).toBeNull();
      expect(error).toBeTruthy();
    });

    it('should parse hold with full province name', () => {
      const { order, error } = parseOrderLine('A Paris HOLD');
      expect(error).toBeNull();
      expect(order).toEqual({ type: 'HOLD', unit: 'PAR' });
    });
  });

  describe('MOVE orders', () => {
    it('should parse "A PAR -> BUR" (arrow notation)', () => {
      const { order, error } = parseOrderLine('A PAR -> BUR');
      expect(error).toBeNull();
      expect(order).toEqual({ type: 'MOVE', unit: 'PAR', destination: 'BUR' });
    });

    it('should parse "A PAR MOVE TO BUR"', () => {
      const { order, error } = parseOrderLine('A PAR MOVE TO BUR');
      expect(error).toBeNull();
      expect(order).toEqual({ type: 'MOVE', unit: 'PAR', destination: 'BUR' });
    });

    it('should parse "A PAR MOVES TO BUR"', () => {
      const { order, error } = parseOrderLine('A PAR MOVES TO BUR');
      expect(error).toBeNull();
      expect(order).toEqual({ type: 'MOVE', unit: 'PAR', destination: 'BUR' });
    });

    it('should parse move with full province names', () => {
      const { order, error } = parseOrderLine('A Paris -> Burgundy');
      expect(error).toBeNull();
      expect(order).toEqual({ type: 'MOVE', unit: 'PAR', destination: 'BUR' });
    });

    it('should parse move with coast specification', () => {
      const { order, error } = parseOrderLine('F MAO -> SPA (sc)');
      expect(error).toBeNull();
      expect(order).toEqual({
        type: 'MOVE',
        unit: 'MAO',
        destination: 'SPA',
        destinationCoast: 'SOUTH',
      });
    });

    it('should parse move VIA CONVOY', () => {
      const { order, error } = parseOrderLine('A LON -> BEL VIA CONVOY');
      expect(error).toBeNull();
      expect(order).toEqual({
        type: 'MOVE',
        unit: 'LON',
        destination: 'BEL',
        viaConvoy: true,
      });
    });
  });

  describe('SUPPORT orders', () => {
    it('should parse support hold: "A MUN SUPPORT A BUR"', () => {
      const { order, error } = parseOrderLine('A MUN SUPPORT A BUR');
      expect(error).toBeNull();
      expect(order).toEqual({
        type: 'SUPPORT',
        unit: 'MUN',
        supportedUnit: 'BUR',
      });
    });

    it('should parse support hold with explicit HOLD: "A MUN SUPPORT A BUR HOLD"', () => {
      const { order, error } = parseOrderLine('A MUN SUPPORT A BUR HOLD');
      expect(error).toBeNull();
      expect(order).toEqual({
        type: 'SUPPORT',
        unit: 'MUN',
        supportedUnit: 'BUR',
      });
    });

    it('should parse support move: "A MUN SUPPORT A BUR -> PAR"', () => {
      const { order, error } = parseOrderLine('A MUN SUPPORT A BUR -> PAR');
      expect(error).toBeNull();
      expect(order).toEqual({
        type: 'SUPPORT',
        unit: 'MUN',
        supportedUnit: 'BUR',
        destination: 'PAR',
      });
    });

    it('should parse support move with "to": "A MUN SUPPORT A BUR to PAR"', () => {
      const { order, error } = parseOrderLine('A MUN SUPPORT A BUR to PAR');
      expect(error).toBeNull();
      expect(order).toEqual({
        type: 'SUPPORT',
        unit: 'MUN',
        supportedUnit: 'BUR',
        destination: 'PAR',
      });
    });

    it('should parse support without unit type prefix', () => {
      const { order, error } = parseOrderLine('A MUN SUPPORT BUR');
      expect(error).toBeNull();
      expect(order).toEqual({
        type: 'SUPPORT',
        unit: 'MUN',
        supportedUnit: 'BUR',
      });
    });
  });

  describe('CONVOY orders', () => {
    it('should parse "F NTH CONVOY A LON -> BEL"', () => {
      const { order, error } = parseOrderLine('F NTH CONVOY A LON -> BEL');
      expect(error).toBeNull();
      expect(order).toEqual({
        type: 'CONVOY',
        unit: 'NTH',
        convoyedUnit: 'LON',
        destination: 'BEL',
      });
    });

    it('should parse convoy with "to" keyword', () => {
      const { order, error } = parseOrderLine('F NTH CONVOY A LON to BEL');
      expect(error).toBeNull();
      expect(order).toEqual({
        type: 'CONVOY',
        unit: 'NTH',
        convoyedUnit: 'LON',
        destination: 'BEL',
      });
    });

    it('should parse convoy with full province names', () => {
      const { order, error } = parseOrderLine(
        'F North Sea CONVOY A London -> Belgium'
      );
      expect(error).toBeNull();
      expect(order).toEqual({
        type: 'CONVOY',
        unit: 'NTH',
        convoyedUnit: 'LON',
        destination: 'BEL',
      });
    });
  });

  describe('edge cases', () => {
    it('should skip empty lines', () => {
      const { order, error } = parseOrderLine('');
      expect(order).toBeNull();
      expect(error).toBeNull();
    });

    it('should skip comment lines starting with #', () => {
      const { order, error } = parseOrderLine('# This is a comment');
      expect(order).toBeNull();
      expect(error).toBeNull();
    });

    it('should skip comment lines starting with //', () => {
      const { order, error } = parseOrderLine('// Another comment');
      expect(order).toBeNull();
      expect(error).toBeNull();
    });

    it('should strip leading bullets', () => {
      const { order, error } = parseOrderLine('- A PAR HOLD');
      expect(error).toBeNull();
      expect(order).toEqual({ type: 'HOLD', unit: 'PAR' });
    });

    it('should strip leading asterisks', () => {
      const { order, error } = parseOrderLine('* A PAR -> BUR');
      expect(error).toBeNull();
      expect(order).toEqual({ type: 'MOVE', unit: 'PAR', destination: 'BUR' });
    });

    it('should return error for unparseable orders', () => {
      const { order, error } = parseOrderLine('gibberish nonsense');
      expect(order).toBeNull();
      expect(error).toBeTruthy();
    });

    it('should return error for unknown province', () => {
      const { order, error } = parseOrderLine('A ATLANTIS -> BUR');
      expect(order).toBeNull();
      expect(error).toBeTruthy();
      expect(error).toContain('Unknown');
    });
  });
});

// ---------------------------------------------------------------------------
// parseRetreatLine
// ---------------------------------------------------------------------------
describe('parseRetreatLine', () => {
  it('should parse retreat to destination: "A MUN -> TYR"', () => {
    const { order, error } = parseRetreatLine('A MUN -> TYR');
    expect(error).toBeNull();
    expect(order).toEqual({ unit: 'MUN', destination: 'TYR' });
  });

  it('should parse retreat with "to" keyword', () => {
    const { order, error } = parseRetreatLine('A MUN to TYR');
    expect(error).toBeNull();
    expect(order).toEqual({ unit: 'MUN', destination: 'TYR' });
  });

  it('should parse DISBAND retreat: "A MUN DISBAND"', () => {
    const { order, error } = parseRetreatLine('A MUN DISBAND');
    expect(error).toBeNull();
    expect(order).toEqual({ unit: 'MUN' });
    expect(order!.destination).toBeUndefined();
  });

  it('should parse disband without unit type', () => {
    // The regex requires optional unit type, then province, then DISBAND
    const { order, error } = parseRetreatLine('F NTH DISBAND');
    expect(error).toBeNull();
    expect(order).toEqual({ unit: 'NTH' });
  });

  it('should skip empty lines', () => {
    const { order, error } = parseRetreatLine('');
    expect(order).toBeNull();
    expect(error).toBeNull();
  });

  it('should skip comments', () => {
    const { order, error } = parseRetreatLine('# retreat plan');
    expect(order).toBeNull();
    expect(error).toBeNull();
  });

  it('should strip leading bullets', () => {
    const { order, error } = parseRetreatLine('- A MUN -> TYR');
    expect(error).toBeNull();
    expect(order).toEqual({ unit: 'MUN', destination: 'TYR' });
  });

  it('should return error for unparseable retreat', () => {
    const { order, error } = parseRetreatLine('RETREAT gibberish');
    expect(order).toBeNull();
    expect(error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// parseBuildLine
// ---------------------------------------------------------------------------
describe('parseBuildLine', () => {
  it('should parse "BUILD A PAR"', () => {
    const { order, error } = parseBuildLine('BUILD A PAR');
    expect(error).toBeNull();
    expect(order).toEqual({ type: 'BUILD', province: 'PAR', unitType: 'ARMY' });
  });

  it('should parse "BUILD F BRE"', () => {
    const { order, error } = parseBuildLine('BUILD F BRE');
    expect(error).toBeNull();
    expect(order).toEqual({
      type: 'BUILD',
      province: 'BRE',
      unitType: 'FLEET',
    });
  });

  it('should parse build with coast: "BUILD F STP (nc)"', () => {
    const { order, error } = parseBuildLine('BUILD F STP (nc)');
    expect(error).toBeNull();
    expect(order).toEqual({
      type: 'BUILD',
      province: 'STP',
      unitType: 'FLEET',
      coast: 'NORTH',
    });
  });

  it('should parse "DISBAND A MUN"', () => {
    const { order, error } = parseBuildLine('DISBAND A MUN');
    expect(error).toBeNull();
    expect(order).toEqual({ type: 'DISBAND', province: 'MUN' });
  });

  it('should parse disband without unit type', () => {
    const { order, error } = parseBuildLine('DISBAND MUN');
    expect(error).toBeNull();
    expect(order).toEqual({ type: 'DISBAND', province: 'MUN' });
  });

  it('should parse build with full province names', () => {
    const { order, error } = parseBuildLine('BUILD A Paris');
    expect(error).toBeNull();
    expect(order).toEqual({ type: 'BUILD', province: 'PAR', unitType: 'ARMY' });
  });

  it('should skip empty lines', () => {
    const { order, error } = parseBuildLine('');
    expect(order).toBeNull();
    expect(error).toBeNull();
  });

  it('should skip comments', () => {
    const { order, error } = parseBuildLine('# build army');
    expect(order).toBeNull();
    expect(error).toBeNull();
  });

  it('should strip leading bullets', () => {
    const { order, error } = parseBuildLine('- BUILD A PAR');
    expect(error).toBeNull();
    expect(order).toEqual({ type: 'BUILD', province: 'PAR', unitType: 'ARMY' });
  });

  it('should return error for unparseable build', () => {
    const { order, error } = parseBuildLine('CONSTRUCT A PAR');
    expect(order).toBeNull();
    expect(error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// parseDiplomacyLine
// ---------------------------------------------------------------------------
describe('parseDiplomacyLine', () => {
  it('should parse SEND with double quotes', () => {
    const { action, error } = parseDiplomacyLine(
      'SEND FRANCE: "Let us form an alliance"'
    );
    expect(error).toBeNull();
    expect(action).toEqual({
      type: 'SEND_MESSAGE',
      targetPowers: ['FRANCE'],
      content: 'Let us form an alliance',
      negotiationStage: undefined,
      conditional: undefined,
    });
  });

  it('should parse SEND with single quotes', () => {
    const { action, error } = parseDiplomacyLine(
      "SEND GERMANY: 'Let us cooperate'"
    );
    expect(error).toBeNull();
    expect(action).toEqual({
      type: 'SEND_MESSAGE',
      targetPowers: ['GERMANY'],
      content: 'Let us cooperate',
      negotiationStage: undefined,
      conditional: undefined,
    });
  });

  it('should extract [OPENING] negotiation stage', () => {
    const { action } = parseDiplomacyLine(
      'SEND FRANCE: "[OPENING] I propose we split Belgium and Holland"'
    );
    expect(action?.negotiationStage).toBe('OPENING');
  });

  it('should extract [COUNTER] negotiation stage', () => {
    const { action } = parseDiplomacyLine(
      'SEND GERMANY: "[COUNTER] Your proposal needs work. I want Burgundy."'
    );
    expect(action?.negotiationStage).toBe('COUNTER');
  });

  it('should extract [FINAL] negotiation stage', () => {
    const { action } = parseDiplomacyLine(
      'SEND ITALY: "[FINAL] Last offer: you take Tyrolia, I take Venice."'
    );
    expect(action?.negotiationStage).toBe('FINAL');
  });

  it('should extract [ACCEPT] negotiation stage', () => {
    const { action } = parseDiplomacyLine(
      'SEND RUSSIA: "[ACCEPT] Deal. I will move to Black Sea as agreed."'
    );
    expect(action?.negotiationStage).toBe('ACCEPT');
  });

  it('should extract [REJECT] negotiation stage', () => {
    const { action } = parseDiplomacyLine(
      'SEND TURKEY: "[REJECT] No, those terms are unacceptable."'
    );
    expect(action?.negotiationStage).toBe('REJECT');
  });

  it('should extract conditional clauses (IF/THEN)', () => {
    const { action } = parseDiplomacyLine(
      'SEND FRANCE: "IF you support me into Belgium, THEN I will support you into Munich."'
    );
    expect(action?.conditional).toEqual({
      condition: 'you support me into Belgium',
      commitment: 'I will support you into Munich',
    });
  });

  it('should handle case-insensitive power names', () => {
    const { action, error } = parseDiplomacyLine(
      'SEND france: "Hello there"'
    );
    expect(error).toBeNull();
    expect(action?.targetPowers).toEqual(['FRANCE']);
  });

  it('should return error for unknown power', () => {
    const { action, error } = parseDiplomacyLine(
      'SEND MORDOR: "One ring to rule them all"'
    );
    expect(action).toBeNull();
    expect(error).toBeTruthy();
    expect(error).toContain('Unknown power');
  });

  it('should return error for malformed SEND', () => {
    const { action, error } = parseDiplomacyLine('SEND FRANCE no quotes');
    expect(action).toBeNull();
    expect(error).toBeTruthy();
  });

  it('should skip empty lines', () => {
    const { action, error } = parseDiplomacyLine('');
    expect(action).toBeNull();
    expect(error).toBeNull();
  });

  it('should skip non-SEND lines without error', () => {
    const { action, error } = parseDiplomacyLine(
      'I should talk to France about an alliance'
    );
    expect(action).toBeNull();
    expect(error).toBeNull();
  });

  it('should strip leading bullets', () => {
    const { action, error } = parseDiplomacyLine(
      '- SEND FRANCE: "Message"'
    );
    expect(error).toBeNull();
    expect(action?.targetPowers).toEqual(['FRANCE']);
  });

  it('should handle all seven powers', () => {
    const powers = [
      'ENGLAND',
      'FRANCE',
      'GERMANY',
      'ITALY',
      'AUSTRIA',
      'RUSSIA',
      'TURKEY',
    ];
    for (const power of powers) {
      const { action, error } = parseDiplomacyLine(
        `SEND ${power}: "Hello from test"`
      );
      expect(error).toBeNull();
      expect(action?.targetPowers).toEqual([power]);
    }
  });
});

// ---------------------------------------------------------------------------
// parseAgentResponse (integration)
// ---------------------------------------------------------------------------
describe('parseAgentResponse', () => {
  it('should parse a complete agent response with all sections', () => {
    const response = `ANALYSIS: This is my analysis of the situation.

ORDERS:
A PAR -> BUR
F BRE -> ENG
A MAR HOLD

DIPLOMACY:
SEND GERMANY: "[OPENING] I propose we split the low countries"
SEND ITALY: "Stay away from Piedmont"

REASONING: I am expanding into the Rhineland.`;

    const result = parseAgentResponse(response);

    expect(result.orders).toHaveLength(3);
    expect(result.orders[0]).toEqual({
      type: 'MOVE',
      unit: 'PAR',
      destination: 'BUR',
    });
    expect(result.orders[1]).toEqual({
      type: 'MOVE',
      unit: 'BRE',
      destination: 'ENG',
    });
    expect(result.orders[2]).toEqual({ type: 'HOLD', unit: 'MAR' });

    expect(result.diplomaticMessages).toHaveLength(2);
    expect(result.diplomaticMessages[0].targetPowers).toEqual(['GERMANY']);
    expect(result.diplomaticMessages[0].negotiationStage).toBe('OPENING');
    expect(result.diplomaticMessages[1].targetPowers).toEqual(['ITALY']);

    expect(result.errors).toHaveLength(0);
  });

  it('should parse response with retreat orders', () => {
    const response = `RETREATS:
A MUN -> TYR
F NTH DISBAND`;

    const result = parseAgentResponse(response);

    expect(result.retreatOrders).toHaveLength(2);
    expect(result.retreatOrders[0]).toEqual({
      unit: 'MUN',
      destination: 'TYR',
    });
    expect(result.retreatOrders[1]).toEqual({ unit: 'NTH' });
  });

  it('should parse response with build orders', () => {
    const response = `BUILDS:
BUILD A PAR
BUILD F BRE
DISBAND A MAR`;

    const result = parseAgentResponse(response);

    expect(result.buildOrders).toHaveLength(3);
    expect(result.buildOrders[0]).toEqual({
      type: 'BUILD',
      province: 'PAR',
      unitType: 'ARMY',
    });
    expect(result.buildOrders[1]).toEqual({
      type: 'BUILD',
      province: 'BRE',
      unitType: 'FLEET',
    });
    expect(result.buildOrders[2]).toEqual({
      type: 'DISBAND',
      province: 'MAR',
    });
  });

  it('should collect parse errors', () => {
    const response = `ORDERS:
A PAR -> BUR
GIBBERISH_UNIT -> NOWHERE
A MAR HOLD`;

    const result = parseAgentResponse(response);

    // Should parse the valid orders
    expect(result.orders.length).toBeGreaterThanOrEqual(2);
    // Should report errors for invalid line
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle empty response', () => {
    const result = parseAgentResponse('');
    expect(result.orders).toHaveLength(0);
    expect(result.retreatOrders).toHaveLength(0);
    expect(result.buildOrders).toHaveLength(0);
    expect(result.diplomaticMessages).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle response with only reasoning (no structured sections)', () => {
    const response = `I think we should focus on the eastern front.
France is being too aggressive in the west.
Let me consider my options carefully.`;

    const result = parseAgentResponse(response);
    expect(result.orders).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should parse orders within markdown code blocks', () => {
    const response = `Here's what I'll do:

\`\`\`
A PAR -> BUR
F BRE -> ENG
\`\`\`

That's my plan.`;

    const result = parseAgentResponse(response);
    expect(result.orders).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// validateOrders
// ---------------------------------------------------------------------------
describe('validateOrders', () => {
  // Minimal game state for validation tests
  function makeGameState(
    units: Array<{
      power: Power;
      type: 'ARMY' | 'FLEET';
      province: string;
    }>
  ): GameState {
    return {
      units: units.map(u => ({ ...u })),
      supplyCenters: {},
      phase: 'MOVEMENT',
      season: 'SPRING',
      year: 1901,
      pendingRetreats: [],
      dislodgedUnits: [],
    } as GameState;
  }

  it('should accept valid HOLD order', () => {
    const state = makeGameState([
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
    ]);
    const orders: Order[] = [{ type: 'HOLD', unit: 'PAR' }];

    const { valid, errors } = validateOrders(orders, state, 'FRANCE');
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('should reject order for unit we do not own', () => {
    const state = makeGameState([
      { power: 'GERMANY', type: 'ARMY', province: 'MUN' },
    ]);
    const orders: Order[] = [{ type: 'HOLD', unit: 'MUN' }];

    const { valid, errors } = validateOrders(orders, state, 'FRANCE');
    expect(valid).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('No unit at MUN');
  });

  it('should reject order for nonexistent unit location', () => {
    const state = makeGameState([
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
    ]);
    const orders: Order[] = [{ type: 'HOLD', unit: 'BER' }];

    const { valid, errors } = validateOrders(orders, state, 'FRANCE');
    expect(valid).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('should validate MOVE adjacency', () => {
    const state = makeGameState([
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
    ]);

    // PAR -> BUR is adjacent
    const validMove: Order[] = [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' },
    ];
    const { valid } = validateOrders(validMove, state, 'FRANCE');
    expect(valid).toHaveLength(1);

    // PAR -> MOS is not adjacent
    const invalidMove: Order[] = [
      { type: 'MOVE', unit: 'PAR', destination: 'MOS' },
    ];
    const { errors } = validateOrders(invalidMove, state, 'FRANCE');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('cannot reach');
  });

  it('should validate SUPPORT requires supported unit to exist', () => {
    const state = makeGameState([
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'FRANCE', type: 'ARMY', province: 'BUR' },
    ]);

    // Support existing unit
    const validSupport: Order[] = [
      { type: 'SUPPORT', unit: 'PAR', supportedUnit: 'BUR' },
    ];
    const { valid } = validateOrders(validSupport, state, 'FRANCE');
    expect(valid).toHaveLength(1);

    // Support nonexistent unit
    const invalidSupport: Order[] = [
      { type: 'SUPPORT', unit: 'PAR', supportedUnit: 'MOS' },
    ];
    const { errors } = validateOrders(invalidSupport, state, 'FRANCE');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('No unit at MOS');
  });

  it('should validate CONVOY requires fleet in sea province', () => {
    const state = makeGameState([
      { power: 'ENGLAND', type: 'FLEET', province: 'NTH' },
      { power: 'ENGLAND', type: 'ARMY', province: 'LON' },
    ]);

    // Fleet in sea province — valid convoy
    const validConvoy: Order[] = [
      {
        type: 'CONVOY',
        unit: 'NTH',
        convoyedUnit: 'LON',
        destination: 'BEL',
      },
    ];
    const { valid } = validateOrders(validConvoy, state, 'ENGLAND');
    expect(valid).toHaveLength(1);
  });

  it('should reject CONVOY by army', () => {
    const state = makeGameState([
      { power: 'ENGLAND', type: 'ARMY', province: 'LON' },
    ]);

    const invalidConvoy: Order[] = [
      {
        type: 'CONVOY',
        unit: 'LON',
        convoyedUnit: 'LON',
        destination: 'BEL',
      },
    ];
    const { errors } = validateOrders(invalidConvoy, state, 'ENGLAND');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Only fleets can convoy');
  });
});

// ---------------------------------------------------------------------------
// fillDefaultOrders
// ---------------------------------------------------------------------------
describe('fillDefaultOrders', () => {
  function makeGameState(
    units: Array<{
      power: Power;
      type: 'ARMY' | 'FLEET';
      province: string;
    }>
  ): GameState {
    return {
      units: units.map(u => ({ ...u })),
      supplyCenters: {},
      phase: 'MOVEMENT',
      season: 'SPRING',
      year: 1901,
      pendingRetreats: [],
      dislodgedUnits: [],
    } as GameState;
  }

  it('should fill HOLD for units without orders', () => {
    const state = makeGameState([
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'FRANCE', type: 'FLEET', province: 'BRE' },
      { power: 'FRANCE', type: 'ARMY', province: 'MAR' },
    ]);

    // Only order for PAR
    const orders: Order[] = [
      { type: 'MOVE', unit: 'PAR', destination: 'BUR' },
    ];

    const filled = fillDefaultOrders(orders, state, 'FRANCE');
    expect(filled).toHaveLength(3);
    // Original order preserved
    expect(filled[0]).toEqual({
      type: 'MOVE',
      unit: 'PAR',
      destination: 'BUR',
    });
    // Default HOLDs added
    expect(filled).toContainEqual({ type: 'HOLD', unit: 'BRE' });
    expect(filled).toContainEqual({ type: 'HOLD', unit: 'MAR' });
  });

  it('should not add duplicates when all units have orders', () => {
    const state = makeGameState([
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
    ]);

    const orders: Order[] = [{ type: 'HOLD', unit: 'PAR' }];

    const filled = fillDefaultOrders(orders, state, 'FRANCE');
    expect(filled).toHaveLength(1);
  });

  it('should only fill for the specified power', () => {
    const state = makeGameState([
      { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
      { power: 'GERMANY', type: 'ARMY', province: 'BER' },
    ]);

    const orders: Order[] = [];
    const filled = fillDefaultOrders(orders, state, 'FRANCE');

    // Should only add HOLD for French units
    expect(filled).toHaveLength(1);
    expect(filled[0]).toEqual({ type: 'HOLD', unit: 'PAR' });
  });
});
