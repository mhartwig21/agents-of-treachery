import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  getCompressionLevel,
  compressRules,
  compressStrategy,
  compressPowerStrategy,
  compressOrderFormat,
  compressGuidelines,
  compressGameState,
  compressDiaryContext,
  getRelevantPowers,
  getMaxRecentEvents,
  getMaxDiaryEntries,
  getMaxYearSummaries,
  getMaxRecentMessages,
} from '../context-compression';
import { buildSystemPrompt, buildTurnPrompt, getPromptContextStats } from '../prompts';
import type { AgentMemory, AgentGameView, YearSummary, DiaryEntry } from '../types';
import { DEFAULT_PERSONALITY } from '../types';
import type { Power, Phase } from '../../engine/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemory(overrides: Partial<AgentMemory> = {}): AgentMemory {
  return {
    power: 'FRANCE' as Power,
    gameId: 'test-game',
    lastUpdated: { year: 1901, season: 'SPRING', phase: 'MOVEMENT' },
    trustLevels: new Map<Power, number>([
      ['ENGLAND', 0.5],
      ['GERMANY', -0.2],
      ['ITALY', 0],
      ['AUSTRIA', 0],
      ['RUSSIA', 0],
      ['TURKEY', 0],
    ]),
    relationships: new Map(),
    events: [],
    activeCommitments: [],
    strategicNotes: [],
    strategicGoals: [],
    territoryPriorities: [],
    currentAllies: ['ENGLAND' as Power],
    currentEnemies: ['GERMANY' as Power],
    turnSummaries: [],
    fullPrivateDiary: [],
    yearSummaries: [],
    currentYearDiary: [],
    ...overrides,
  } as AgentMemory;
}

function makeGameView(overrides: Partial<AgentGameView> = {}): AgentGameView {
  return {
    viewingPower: 'FRANCE' as Power,
    year: 1901,
    season: 'SPRING',
    phase: 'MOVEMENT' as Phase,
    myUnits: [
      { type: 'ARMY', province: 'PAR', adjacentProvinces: ['BUR', 'PIC', 'GAS'] },
      { type: 'FLEET', province: 'BRE', adjacentProvinces: ['ENG', 'MAO', 'PIC', 'GAS'] },
      { type: 'ARMY', province: 'MAR', adjacentProvinces: ['BUR', 'GAS', 'PIE', 'SPA'] },
    ],
    otherUnits: new Map([
      ['ENGLAND' as Power, [
        { type: 'FLEET' as const, province: 'LON', adjacentProvinces: ['ENG', 'WAL', 'YOR'] },
        { type: 'FLEET' as const, province: 'EDI', adjacentProvinces: ['NTH', 'NWG', 'YOR', 'CLY'] },
        { type: 'ARMY' as const, province: 'LVP', adjacentProvinces: ['WAL', 'YOR', 'EDI', 'CLY'] },
      ]],
      ['GERMANY' as Power, [
        { type: 'ARMY' as const, province: 'BER', adjacentProvinces: ['MUN', 'SIL', 'PRU', 'KIE'] },
        { type: 'ARMY' as const, province: 'MUN', adjacentProvinces: ['BUR', 'RUH', 'KIE', 'BER', 'BOH', 'TYR'] },
        { type: 'FLEET' as const, province: 'KIE', adjacentProvinces: ['HOL', 'HEL', 'DEN', 'BER', 'MUN'] },
      ]],
      ['ITALY' as Power, [
        { type: 'ARMY' as const, province: 'ROM', adjacentProvinces: ['VEN', 'TUS', 'NAP'] },
        { type: 'ARMY' as const, province: 'VEN', adjacentProvinces: ['TRI', 'TYR', 'PIE', 'TUS', 'ROM'] },
        { type: 'FLEET' as const, province: 'NAP', adjacentProvinces: ['TYS', 'ION', 'ROM'] },
      ]],
      ['AUSTRIA' as Power, [
        { type: 'ARMY' as const, province: 'VIE', adjacentProvinces: ['BOH', 'GAL', 'BUD', 'TRI', 'TYR'] },
        { type: 'ARMY' as const, province: 'BUD', adjacentProvinces: ['VIE', 'GAL', 'RUM', 'SER', 'TRI'] },
        { type: 'FLEET' as const, province: 'TRI', adjacentProvinces: ['VEN', 'ADR', 'ALB', 'SER', 'BUD', 'VIE', 'TYR'] },
      ]],
      ['RUSSIA' as Power, [
        { type: 'ARMY' as const, province: 'MOS', adjacentProvinces: ['STP', 'LVN', 'WAR', 'UKR', 'SEV'] },
        { type: 'ARMY' as const, province: 'WAR', adjacentProvinces: ['MOS', 'LVN', 'PRU', 'SIL', 'GAL', 'UKR'] },
        { type: 'FLEET' as const, province: 'STP', adjacentProvinces: ['NWY', 'BAR', 'FIN', 'BOT', 'LVN', 'MOS'] },
        { type: 'FLEET' as const, province: 'SEV', adjacentProvinces: ['RUM', 'BLA', 'ARM', 'UKR', 'MOS'] },
      ]],
      ['TURKEY' as Power, [
        { type: 'ARMY' as const, province: 'CON', adjacentProvinces: ['BUL', 'AEG', 'SMY', 'ANK'] },
        { type: 'ARMY' as const, province: 'SMY', adjacentProvinces: ['CON', 'AEG', 'EAS', 'SYR', 'ARM', 'ANK'] },
        { type: 'FLEET' as const, province: 'ANK', adjacentProvinces: ['CON', 'BLA', 'ARM'] },
      ]],
    ]),
    supplyCenters: new Map([
      ['FRANCE' as Power, ['PAR', 'BRE', 'MAR']],
      ['ENGLAND' as Power, ['LON', 'EDI', 'LVP']],
      ['GERMANY' as Power, ['BER', 'MUN', 'KIE']],
      ['ITALY' as Power, ['ROM', 'VEN', 'NAP']],
      ['AUSTRIA' as Power, ['VIE', 'BUD', 'TRI']],
      ['RUSSIA' as Power, ['MOS', 'WAR', 'STP', 'SEV']],
      ['TURKEY' as Power, ['CON', 'SMY', 'ANK']],
    ]),
    supplyCenterCounts: new Map([
      ['FRANCE' as Power, 3],
      ['ENGLAND' as Power, 3],
      ['GERMANY' as Power, 3],
      ['ITALY' as Power, 3],
      ['AUSTRIA' as Power, 3],
      ['RUSSIA' as Power, 4],
      ['TURKEY' as Power, 3],
    ]),
    unitCounts: new Map([
      ['FRANCE' as Power, 3],
      ['ENGLAND' as Power, 3],
      ['GERMANY' as Power, 3],
      ['ITALY' as Power, 3],
      ['AUSTRIA' as Power, 3],
      ['RUSSIA' as Power, 4],
      ['TURKEY' as Power, 3],
    ]),
    ...overrides,
  };
}

function makeDiaryEntry(phase: string, type: 'negotiation' | 'orders' | 'reflection', content: string): DiaryEntry {
  return { phase, type, content, timestamp: new Date() };
}

function makeYearSummary(year: number): YearSummary {
  return {
    year,
    summary: `Year ${year} Summary:\n- Gained: BEL (+1 SCs, now at ${3 + year - 1901})\n- Lost: None\n- Alliances: ENGLAND (solid)\n- Key events: Expanded into Low Countries`,
    territorialChanges: ['Gained: BEL'],
    diplomaticChanges: ['ENGLAND alliance maintained'],
    consolidatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------
describe('estimateTokens', () => {
  it('should estimate ~1 token per 4 characters', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('a')).toBe(1); // rounds up
  });

  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getCompressionLevel
// ---------------------------------------------------------------------------
describe('getCompressionLevel', () => {
  it('should return none for turns 0-3', () => {
    expect(getCompressionLevel(0)).toBe('none');
    expect(getCompressionLevel(1)).toBe('none');
    expect(getCompressionLevel(3)).toBe('none');
  });

  it('should return moderate for turns 4-8', () => {
    expect(getCompressionLevel(4)).toBe('moderate');
    expect(getCompressionLevel(6)).toBe('moderate');
    expect(getCompressionLevel(8)).toBe('moderate');
  });

  it('should return aggressive for turns 9+', () => {
    expect(getCompressionLevel(9)).toBe('aggressive');
    expect(getCompressionLevel(15)).toBe('aggressive');
    expect(getCompressionLevel(30)).toBe('aggressive');
  });
});

// ---------------------------------------------------------------------------
// compressRules
// ---------------------------------------------------------------------------
describe('compressRules', () => {
  const fullRules = 'A very long set of rules with many details about Diplomacy gameplay...';

  it('should return full rules at none level', () => {
    expect(compressRules(fullRules, 'none')).toBe(fullRules);
  });

  it('should return shorter text at moderate level', () => {
    const compressed = compressRules(fullRules, 'moderate');
    expect(compressed).toContain('Rules Reference');
    expect(compressed).toContain('Victory');
    expect(compressed.length).toBeLessThan(1000);
  });

  it('should return minimal text at aggressive level', () => {
    const compressed = compressRules(fullRules, 'aggressive');
    expect(compressed).toContain('Rules');
    expect(compressed.length).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// compressStrategy
// ---------------------------------------------------------------------------
describe('compressStrategy', () => {
  const fullStrategy = 'Full strategic concepts including alliance formation and common openings...';

  it('should return full strategy at none level', () => {
    expect(compressStrategy(fullStrategy, 'none')).toBe(fullStrategy);
  });

  it('should be shorter at moderate level', () => {
    const compressed = compressStrategy(fullStrategy, 'moderate');
    expect(compressed.length).toBeLessThan(fullStrategy.length + 200); // moderate has fixed text
  });

  it('should be very short at aggressive level', () => {
    const compressed = compressStrategy(fullStrategy, 'aggressive');
    expect(compressed.length).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// compressPowerStrategy
// ---------------------------------------------------------------------------
describe('compressPowerStrategy', () => {
  const fullPower = 'Detailed power-specific strategy for France...';

  it('should return full at none and moderate', () => {
    expect(compressPowerStrategy(fullPower, 'none')).toBe(fullPower);
    expect(compressPowerStrategy(fullPower, 'moderate')).toBe(fullPower);
  });

  it('should return empty at aggressive', () => {
    expect(compressPowerStrategy(fullPower, 'aggressive')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// compressOrderFormat
// ---------------------------------------------------------------------------
describe('compressOrderFormat', () => {
  const fullFormat = 'Very detailed order format with many examples and edge cases...';

  it('should shrink at each level', () => {
    const moderate = compressOrderFormat(fullFormat, 'moderate');
    const aggressive = compressOrderFormat(fullFormat, 'aggressive');
    expect(moderate.length).toBeLessThan(fullFormat.length + 400); // moderate has fixed text
    expect(aggressive.length).toBeLessThan(moderate.length);
  });
});

// ---------------------------------------------------------------------------
// compressGuidelines
// ---------------------------------------------------------------------------
describe('compressGuidelines', () => {
  const fullGuidelines = 'Long response guidelines...';

  it('should return empty at aggressive', () => {
    expect(compressGuidelines(fullGuidelines, 'aggressive')).toBe('');
  });

  it('should be shorter at moderate', () => {
    const moderate = compressGuidelines(fullGuidelines, 'moderate');
    expect(moderate).toContain('strategically');
  });
});

// ---------------------------------------------------------------------------
// getRelevantPowers
// ---------------------------------------------------------------------------
describe('getRelevantPowers', () => {
  it('should include allies and enemies', () => {
    const view = makeGameView();
    const memory = makeMemory({
      currentAllies: ['ENGLAND' as Power],
      currentEnemies: ['GERMANY' as Power],
    });
    const relevant = getRelevantPowers(view, memory);
    expect(relevant.has('ENGLAND')).toBe(true);
    expect(relevant.has('GERMANY')).toBe(true);
  });

  it('should include adjacent powers', () => {
    const view = makeGameView();
    const memory = makeMemory({ currentAllies: [], currentEnemies: [] });
    const relevant = getRelevantPowers(view, memory);
    // Germany has unit in MUN which is adjacent to BUR (our unit in PAR can reach BUR)
    // Italy has unit in VEN adjacent to PIE (our MAR can reach PIE)
    expect(relevant.has('GERMANY')).toBe(true);
    expect(relevant.has('ITALY')).toBe(true);
  });

  it('should include powers with >= 12 SCs', () => {
    const view = makeGameView({
      supplyCenterCounts: new Map([
        ['FRANCE' as Power, 3],
        ['RUSSIA' as Power, 14],
        ['ENGLAND' as Power, 3],
        ['GERMANY' as Power, 3],
        ['ITALY' as Power, 3],
        ['AUSTRIA' as Power, 3],
        ['TURKEY' as Power, 3],
      ]),
    });
    const memory = makeMemory({ currentAllies: [], currentEnemies: [] });
    const relevant = getRelevantPowers(view, memory);
    expect(relevant.has('RUSSIA')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compressGameState
// ---------------------------------------------------------------------------
describe('compressGameState', () => {
  it('should return empty string for none level (use default builder)', () => {
    const view = makeGameView();
    expect(compressGameState(view, 'none')).toBe('');
  });

  it('should include all powers at moderate level', () => {
    const view = makeGameView();
    const result = compressGameState(view, 'moderate');
    expect(result).toContain('ENGLAND:');
    expect(result).toContain('GER:');
    expect(result).toContain('You (');
  });

  it('should summarize non-relevant powers at aggressive level', () => {
    const view = makeGameView();
    const relevant = new Set<Power>(['GERMANY' as Power, 'ENGLAND' as Power]);
    const result = compressGameState(view, 'aggressive', relevant);
    // Germany and England should be detailed with compact notation
    expect(result).toContain('GER:');
    expect(result).toContain('ENGLAND:');
    // Turkey should be in summary line
    expect(result).toContain('TUR:');
    expect(result).toContain('Others:');
  });

  it('should always include own units in compact notation', () => {
    const view = makeGameView();
    const relevant = new Set<Power>();
    const result = compressGameState(view, 'aggressive', relevant);
    expect(result).toContain('A:PAR');
    expect(result).toContain('F:BRE');
    expect(result).toContain('MAR');
  });
});

// ---------------------------------------------------------------------------
// compressDiaryContext
// ---------------------------------------------------------------------------
describe('compressDiaryContext', () => {
  it('should return empty for none level (use default)', () => {
    const memory = makeMemory();
    expect(compressDiaryContext(memory, 'none')).toBe('');
  });

  it('should limit year summaries in aggressive mode', () => {
    const memory = makeMemory({
      yearSummaries: [
        makeYearSummary(1901),
        makeYearSummary(1902),
        makeYearSummary(1903),
        makeYearSummary(1904),
        makeYearSummary(1905),
      ],
    });
    const result = compressDiaryContext(memory, 'aggressive');
    // Should only include last 3
    expect(result).toContain('Year 1903');
    expect(result).toContain('Year 1904');
    expect(result).toContain('Year 1905');
    expect(result).toContain('2 earlier years omitted');
    expect(result).not.toContain('Year 1901:');
    expect(result).not.toContain('Year 1902:');
  });

  it('should limit diary entries in moderate mode', () => {
    const entries: DiaryEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push(makeDiaryEntry(`[S1905M]`, 'orders', `Order set ${i} with various details`));
    }
    const memory = makeMemory({ currentYearDiary: entries });
    const result = compressDiaryContext(memory, 'moderate');
    // Should limit to 6 entries
    expect(result).toContain('4 earlier entries omitted');
  });

  it('should truncate long entries in aggressive mode', () => {
    const longContent = 'A'.repeat(200);
    const memory = makeMemory({
      currentYearDiary: [makeDiaryEntry('[S1905M]', 'orders', longContent)],
    });
    const result = compressDiaryContext(memory, 'aggressive');
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(longContent.length);
  });
});

// ---------------------------------------------------------------------------
// Limits config
// ---------------------------------------------------------------------------
describe('compression limits', () => {
  it('should reduce event count with compression', () => {
    expect(getMaxRecentEvents('none')).toBe(5);
    expect(getMaxRecentEvents('moderate')).toBe(3);
    expect(getMaxRecentEvents('aggressive')).toBe(2);
  });

  it('should reduce diary entries with compression', () => {
    expect(getMaxDiaryEntries('none')).toBe(10);
    expect(getMaxDiaryEntries('moderate')).toBe(6);
    expect(getMaxDiaryEntries('aggressive')).toBe(4);
  });

  it('should reduce year summaries with compression', () => {
    expect(getMaxYearSummaries('none')).toBe(Infinity);
    expect(getMaxYearSummaries('moderate')).toBe(5);
    expect(getMaxYearSummaries('aggressive')).toBe(3);
  });

  it('should reduce message count with compression', () => {
    expect(getMaxRecentMessages('none')).toBe(Infinity);
    expect(getMaxRecentMessages('moderate')).toBe(10);
    expect(getMaxRecentMessages('aggressive')).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Integration: buildSystemPrompt with compression
// ---------------------------------------------------------------------------
describe('buildSystemPrompt with compression', () => {
  it('should produce shorter prompts at higher turn numbers', () => {
    const fullPrompt = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY, undefined, 0);
    const moderatePrompt = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY, undefined, 5);
    const aggressivePrompt = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY, undefined, 10);

    expect(moderatePrompt.length).toBeLessThan(fullPrompt.length);
    expect(aggressivePrompt.length).toBeLessThan(moderatePrompt.length);
  });

  it('should always include the power name', () => {
    const prompt = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY, undefined, 20);
    expect(prompt).toContain('FRANCE');
  });

  it('should always include basic order syntax', () => {
    const prompt = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY, undefined, 20);
    expect(prompt.toLowerCase()).toContain('hold');
  });

  it('should omit power strategy in aggressive mode', () => {
    const aggressive = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY, undefined, 10);
    // Full power strategy section has "France Strategy" header
    expect(aggressive).not.toContain('France Strategy');
  });
});

// ---------------------------------------------------------------------------
// Integration: buildTurnPrompt with compression
// ---------------------------------------------------------------------------
describe('buildTurnPrompt with compression', () => {
  it('should produce shorter prompts at higher turn numbers', () => {
    const view = makeGameView();
    const memory = makeMemory({
      yearSummaries: [makeYearSummary(1901), makeYearSummary(1902)],
      currentYearDiary: Array.from({ length: 8 }, (_, i) =>
        makeDiaryEntry(`[S1903M]`, 'orders', `Order details for turn ${i} with various strategic notes`)
      ),
      events: Array.from({ length: 6 }, (_, i) => ({
        year: 1901 + Math.floor(i / 3),
        season: 'SPRING' as const,
        type: 'COOPERATION' as const,
        powers: ['ENGLAND' as Power],
        description: `Event ${i}: cooperation with England in the north`,
        impactOnTrust: 0.1,
      })),
    });
    const fullPrompt = buildTurnPrompt(view, memory, [], 'MOVEMENT', undefined, 0);
    const moderatePrompt = buildTurnPrompt(view, memory, [], 'MOVEMENT', undefined, 5);
    const aggressivePrompt = buildTurnPrompt(view, memory, [], 'MOVEMENT', undefined, 10);

    expect(moderatePrompt.length).toBeLessThan(fullPrompt.length);
    expect(aggressivePrompt.length).toBeLessThan(moderatePrompt.length);
  });

  it('should always include phase instructions', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT', undefined, 20);
    expect(prompt).toContain('Submit Orders');
  });

  it('should always include own units', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const prompt = buildTurnPrompt(view, memory, [], 'MOVEMENT', undefined, 20);
    expect(prompt).toContain('A PAR');
    expect(prompt).toContain('F BRE');
  });

  it('should limit messages in aggressive mode', () => {
    const view = makeGameView();
    const memory = makeMemory();
    const messages: string[] = [];
    for (let i = 0; i < 15; i++) {
      messages.push(`FROM ENGLAND: "Message ${i}"`);
    }
    const prompt = buildTurnPrompt(view, memory, messages, 'DIPLOMACY', undefined, 10);
    // Should only include last 6 messages in aggressive mode
    expect(prompt).toContain('Message 14');
    expect(prompt).toContain('Message 9');
    expect(prompt).not.toContain('Message 0');
  });
});

// ---------------------------------------------------------------------------
// Context stats
// ---------------------------------------------------------------------------
describe('getPromptContextStats', () => {
  it('should return compression level based on turn number', () => {
    const stats = getPromptContextStats('system prompt text', 'turn prompt text', 5);
    expect(stats.compressionLevel).toBe('moderate');
    expect(stats.turnNumber).toBe(5);
    expect(stats.systemPromptTokens).toBeGreaterThan(0);
    expect(stats.turnPromptTokens).toBeGreaterThan(0);
    expect(stats.totalTokens).toBe(stats.systemPromptTokens + stats.turnPromptTokens);
  });

  it('should show low compression ratio for compressed prompts', () => {
    const stats = getPromptContextStats('short', 'short turn', 15);
    expect(stats.compressionRatio).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: compression targets
// ---------------------------------------------------------------------------
describe('compression targets', () => {
  it('should achieve significant compression at turn 10', () => {
    const view = makeGameView();
    const memory = makeMemory({
      yearSummaries: [
        makeYearSummary(1901),
        makeYearSummary(1902),
        makeYearSummary(1903),
      ],
      currentYearDiary: Array.from({ length: 8 }, (_, i) =>
        makeDiaryEntry(`[S1904M]`, 'orders', `Order details for turn ${i}`)
      ),
      events: Array.from({ length: 10 }, (_, i) => ({
        year: 1901 + Math.floor(i / 3),
        season: 'SPRING' as const,
        type: 'COOPERATION' as const,
        powers: ['ENGLAND' as Power],
        description: `Event ${i}: cooperation occurred`,
        impactOnTrust: 0.1,
      })),
    });

    const fullSystem = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY, undefined, 0);
    const fullTurn = buildTurnPrompt(view, memory, [], 'MOVEMENT', undefined, 0);
    const fullTotal = fullSystem.length + fullTurn.length;

    const compressedSystem = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY, undefined, 10);
    const compressedTurn = buildTurnPrompt(view, memory, [], 'MOVEMENT', undefined, 10);
    const compressedTotal = compressedSystem.length + compressedTurn.length;

    const ratio = compressedTotal / fullTotal;
    // Should be significantly compressed
    expect(ratio).toBeLessThan(0.75);
  });

  it('aggressive mode should produce substantially smaller system prompt', () => {
    const full = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY, undefined, 0);
    const aggressive = buildSystemPrompt('FRANCE', DEFAULT_PERSONALITY, undefined, 10);

    // Aggressive should be less than 50% of full
    expect(aggressive.length / full.length).toBeLessThan(0.5);
  });
});
