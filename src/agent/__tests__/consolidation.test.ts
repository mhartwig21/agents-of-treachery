import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  shouldConsolidateTurns,
  extractTrustEvents,
  buildTurnConsolidationPrompt,
  parseConsolidationResponse,
  createFallbackConsolidation,
  consolidateTurnSummaries,
  mergeOldestBlocks,
  mergeStrategicNotes,
  getAllTrustEvents,
  formatConsolidatedMemory,
  consolidateMemory,
  RECENT_TURNS_TO_KEEP,
  CONSOLIDATION_THRESHOLD,
  MAX_CONSOLIDATED_BLOCKS,
} from '../consolidation';
import { createInitialMemory, addTurnSummary, addStrategicNote, recordEvent } from '../memory';
import type { AgentMemory, TurnSummary, MemoryEvent, LLMProvider, TrustAffectingEvent } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTurnSummary(year: number, season: 'SPRING' | 'FALL', overrides?: Partial<TurnSummary>): TurnSummary {
  return {
    year,
    season,
    ordersSubmitted: [`A PAR -> BUR`],
    ordersSucceeded: [`A PAR -> BUR`],
    ordersFailed: [],
    supplyCentersGained: [],
    supplyCentersLost: [],
    unitsBuilt: 0,
    unitsLost: 0,
    diplomaticHighlights: [],
    ...overrides,
  };
}

function fillTurnSummaries(memory: AgentMemory, count: number): void {
  for (let i = 0; i < count; i++) {
    const year = 1901 + Math.floor(i / 2);
    const season = i % 2 === 0 ? 'SPRING' as const : 'FALL' as const;
    addTurnSummary(memory, makeTurnSummary(year, season));
  }
}

function createMockLLM(response: string = 'Consolidated summary of turns.'): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue({
      content: response,
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  };
}

// ---------------------------------------------------------------------------
// shouldConsolidateTurns
// ---------------------------------------------------------------------------
describe('shouldConsolidateTurns', () => {
  it('should return false when below threshold', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    fillTurnSummaries(memory, 5);
    expect(shouldConsolidateTurns(memory)).toBe(false);
  });

  it('should return false at exactly threshold', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    fillTurnSummaries(memory, CONSOLIDATION_THRESHOLD);
    expect(shouldConsolidateTurns(memory)).toBe(false);
  });

  it('should return true above threshold', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    fillTurnSummaries(memory, CONSOLIDATION_THRESHOLD + 1);
    expect(shouldConsolidateTurns(memory)).toBe(true);
  });

  it('should return true with many summaries', () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    fillTurnSummaries(memory, 30);
    expect(shouldConsolidateTurns(memory)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractTrustEvents
// ---------------------------------------------------------------------------
describe('extractTrustEvents', () => {
  it('should extract betrayal events from memory events', () => {
    const summaries = [
      makeTurnSummary(1901, 'SPRING'),
      makeTurnSummary(1901, 'FALL'),
    ];

    const memoryEvents: MemoryEvent[] = [
      {
        year: 1901,
        season: 'FALL',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'France attacked Channel despite alliance',
        impactOnTrust: -0.5,
      },
    ];

    const events = extractTrustEvents(summaries, memoryEvents);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('BETRAYAL');
    expect(events[0].description).toBe('France attacked Channel despite alliance');
    expect(events[0].trustImpact).toBe(-0.5);
  });

  it('should extract promise kept/broken events', () => {
    const summaries = [makeTurnSummary(1902, 'SPRING')];
    const memoryEvents: MemoryEvent[] = [
      {
        year: 1902,
        season: 'SPRING',
        type: 'PROMISE_KEPT',
        powers: ['GERMANY'],
        description: 'Germany honored support agreement',
        impactOnTrust: 0.2,
      },
      {
        year: 1902,
        season: 'SPRING',
        type: 'PROMISE_BROKEN',
        powers: ['RUSSIA'],
        description: 'Russia broke DMZ agreement',
        impactOnTrust: -0.4,
      },
    ];

    const events = extractTrustEvents(summaries, memoryEvents);
    expect(events).toHaveLength(2);
    expect(events.some(e => e.type === 'PROMISE_KEPT')).toBe(true);
    expect(events.some(e => e.type === 'PROMISE_BROKEN')).toBe(true);
  });

  it('should extract alliance formed/broken events', () => {
    const summaries = [makeTurnSummary(1901, 'SPRING')];
    const memoryEvents: MemoryEvent[] = [
      {
        year: 1901,
        season: 'SPRING',
        type: 'ALLIANCE_FORMED',
        powers: ['FRANCE'],
        description: 'Entente Cordiale formed',
        impactOnTrust: 0.3,
      },
      {
        year: 1901,
        season: 'SPRING',
        type: 'ALLIANCE_BROKEN',
        powers: ['GERMANY'],
        description: 'Germany broke alliance',
        impactOnTrust: -0.5,
      },
    ];

    const events = extractTrustEvents(summaries, memoryEvents);
    expect(events).toHaveLength(2);
  });

  it('should ignore non-trust-affecting events', () => {
    const summaries = [makeTurnSummary(1901, 'SPRING')];
    const memoryEvents: MemoryEvent[] = [
      {
        year: 1901,
        season: 'SPRING',
        type: 'COOPERATION',
        powers: ['FRANCE'],
        description: 'Routine cooperation',
        impactOnTrust: 0.1,
      },
      {
        year: 1901,
        season: 'SPRING',
        type: 'ATTACK',
        powers: ['GERMANY'],
        description: 'Attacked Munich',
        impactOnTrust: -0.2,
      },
    ];

    const events = extractTrustEvents(summaries, memoryEvents);
    expect(events).toHaveLength(0);
  });

  it('should only extract events within the summary time range', () => {
    const summaries = [makeTurnSummary(1902, 'SPRING'), makeTurnSummary(1902, 'FALL')];
    const memoryEvents: MemoryEvent[] = [
      {
        year: 1901,
        season: 'FALL',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'Earlier betrayal - outside range',
        impactOnTrust: -0.3,
      },
      {
        year: 1902,
        season: 'SPRING',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'In-range betrayal',
        impactOnTrust: -0.3,
      },
      {
        year: 1903,
        season: 'SPRING',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'Later betrayal - outside range',
        impactOnTrust: -0.3,
      },
    ];

    const events = extractTrustEvents(summaries, memoryEvents);
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe('In-range betrayal');
  });

  it('should extract betrayal hints from diplomatic highlights', () => {
    const summaries = [
      makeTurnSummary(1901, 'FALL', {
        diplomaticHighlights: ['France betrayed our alliance in the Channel'],
      }),
    ];

    const events = extractTrustEvents(summaries, []);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('BETRAYAL');
    expect(events[0].description).toContain('betrayed');
  });

  it('should not duplicate events from highlights when already in memory events', () => {
    const summaries = [
      makeTurnSummary(1901, 'FALL', {
        diplomaticHighlights: ['France betrayed alliance'],
      }),
    ];
    const memoryEvents: MemoryEvent[] = [
      {
        year: 1901,
        season: 'FALL',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'France betrayed alliance',
        impactOnTrust: -0.3,
      },
    ];

    const events = extractTrustEvents(summaries, memoryEvents);
    expect(events).toHaveLength(1);
  });

  it('should return empty for empty summaries', () => {
    expect(extractTrustEvents([], [])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildTurnConsolidationPrompt
// ---------------------------------------------------------------------------
describe('buildTurnConsolidationPrompt', () => {
  it('should include power name', () => {
    const summaries = [makeTurnSummary(1901, 'SPRING')];
    const prompt = buildTurnConsolidationPrompt('ENGLAND', summaries);
    expect(prompt).toContain('ENGLAND');
  });

  it('should include turn details', () => {
    const summaries = [
      makeTurnSummary(1901, 'SPRING', {
        ordersSucceeded: ['A LON -> NTH'],
        supplyCentersGained: ['Norway'],
      }),
    ];
    const prompt = buildTurnConsolidationPrompt('ENGLAND', summaries);
    expect(prompt).toContain('1901 SPRING');
    expect(prompt).toContain('Norway');
  });

  it('should include diplomatic highlights', () => {
    const summaries = [
      makeTurnSummary(1901, 'FALL', {
        diplomaticHighlights: ['Formed alliance with France'],
      }),
    ];
    const prompt = buildTurnConsolidationPrompt('ENGLAND', summaries);
    expect(prompt).toContain('Formed alliance with France');
  });

  it('should include failed orders', () => {
    const summaries = [
      makeTurnSummary(1901, 'SPRING', {
        ordersFailed: ['A PAR -> BUR (bounced)'],
      }),
    ];
    const prompt = buildTurnConsolidationPrompt('FRANCE', summaries);
    expect(prompt).toContain('Failed');
    expect(prompt).toContain('bounced');
  });
});

// ---------------------------------------------------------------------------
// parseConsolidationResponse
// ---------------------------------------------------------------------------
describe('parseConsolidationResponse', () => {
  it('should trim whitespace', () => {
    expect(parseConsolidationResponse('  summary text  \n')).toBe('summary text');
  });

  it('should handle multi-line responses', () => {
    const response = 'Line 1.\nLine 2.\nLine 3.';
    expect(parseConsolidationResponse(response)).toBe(response);
  });
});

// ---------------------------------------------------------------------------
// createFallbackConsolidation
// ---------------------------------------------------------------------------
describe('createFallbackConsolidation', () => {
  it('should create a block from summaries', () => {
    const summaries = [
      makeTurnSummary(1901, 'SPRING', { supplyCentersGained: ['Norway'] }),
      makeTurnSummary(1901, 'FALL', { supplyCentersGained: ['Belgium'] }),
    ];

    const block = createFallbackConsolidation(summaries, []);
    expect(block.fromYear).toBe(1901);
    expect(block.fromSeason).toBe('SPRING');
    expect(block.toYear).toBe(1901);
    expect(block.toSeason).toBe('FALL');
    expect(block.netSCsGained).toContain('Norway');
    expect(block.netSCsGained).toContain('Belgium');
    expect(block.summary).toContain('1901');
  });

  it('should calculate net SC changes', () => {
    const summaries = [
      makeTurnSummary(1901, 'SPRING', { supplyCentersGained: ['Norway'] }),
      makeTurnSummary(1901, 'FALL', { supplyCentersLost: ['Norway'] }),
    ];

    const block = createFallbackConsolidation(summaries, []);
    // Norway gained then lost = net zero
    expect(block.netSCsGained).not.toContain('Norway');
    expect(block.netSCsLost).not.toContain('Norway');
  });

  it('should include trust events', () => {
    const summaries = [makeTurnSummary(1901, 'SPRING')];
    const trustEvents: TrustAffectingEvent[] = [
      {
        year: 1901,
        season: 'SPRING',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'France stabbed',
        trustImpact: -0.3,
      },
    ];

    const block = createFallbackConsolidation(summaries, trustEvents);
    expect(block.trustEvents).toHaveLength(1);
    expect(block.summary).toContain('betrayal');
  });

  it('should include order statistics', () => {
    const summaries = [
      makeTurnSummary(1901, 'SPRING', {
        ordersSubmitted: ['A PAR -> BUR', 'A MAR -> SPA'],
        ordersFailed: ['A MAR -> SPA'],
      }),
    ];

    const block = createFallbackConsolidation(summaries, []);
    expect(block.summary).toContain('2 orders');
    expect(block.summary).toContain('1 failed');
  });

  it('should include unit build/loss stats', () => {
    const summaries = [
      makeTurnSummary(1901, 'FALL', { unitsBuilt: 2, unitsLost: 1 }),
    ];

    const block = createFallbackConsolidation(summaries, []);
    expect(block.summary).toContain('+2/-1');
  });

  it('should include diplomatic highlights', () => {
    const summaries = [
      makeTurnSummary(1901, 'SPRING', {
        diplomaticHighlights: ['Proposed alliance with France'],
      }),
    ];

    const block = createFallbackConsolidation(summaries, []);
    expect(block.summary).toContain('Proposed alliance with France');
  });

  it('should throw for empty summaries', () => {
    expect(() => createFallbackConsolidation([], [])).toThrow('Cannot consolidate empty summaries');
  });

  it('should set consolidatedAt to current time', () => {
    const before = new Date();
    const block = createFallbackConsolidation([makeTurnSummary(1901, 'SPRING')], []);
    const after = new Date();
    expect(block.consolidatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(block.consolidatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ---------------------------------------------------------------------------
// consolidateTurnSummaries
// ---------------------------------------------------------------------------
describe('consolidateTurnSummaries', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should return null when below threshold', async () => {
    fillTurnSummaries(memory, 5);
    const result = await consolidateTurnSummaries(memory);
    expect(result).toBeNull();
    expect(memory.turnSummaries).toHaveLength(5);
  });

  it('should consolidate when above threshold (no LLM)', async () => {
    fillTurnSummaries(memory, 15);
    const result = await consolidateTurnSummaries(memory);

    expect(result).not.toBeNull();
    expect(memory.turnSummaries).toHaveLength(RECENT_TURNS_TO_KEEP);
    expect(memory.consolidatedBlocks).toHaveLength(1);
  });

  it('should keep the most recent turns unconsolidated', async () => {
    fillTurnSummaries(memory, 15);

    // Record the last 5 summaries for comparison
    const lastFive = memory.turnSummaries.slice(-RECENT_TURNS_TO_KEEP);

    await consolidateTurnSummaries(memory);

    // The remaining summaries should match the last 5
    expect(memory.turnSummaries).toHaveLength(RECENT_TURNS_TO_KEEP);
    for (let i = 0; i < RECENT_TURNS_TO_KEEP; i++) {
      expect(memory.turnSummaries[i].year).toBe(lastFive[i].year);
      expect(memory.turnSummaries[i].season).toBe(lastFive[i].season);
    }
  });

  it('should use LLM for summarization when provided', async () => {
    const llm = createMockLLM('England expanded aggressively into Scandinavia.');
    fillTurnSummaries(memory, 15);

    const result = await consolidateTurnSummaries(memory, llm);

    expect(result).not.toBeNull();
    expect(result!.summary).toBe('England expanded aggressively into Scandinavia.');
    expect(llm.complete).toHaveBeenCalledOnce();
  });

  it('should fall back to deterministic when LLM fails', async () => {
    const llm: LLMProvider = {
      complete: vi.fn().mockRejectedValue(new Error('API error')),
    };
    fillTurnSummaries(memory, 15);

    const result = await consolidateTurnSummaries(memory, llm);

    expect(result).not.toBeNull();
    // Should have a fallback summary (contains year range)
    expect(result!.summary).toContain('1901');
  });

  it('should preserve trust events through consolidation', async () => {
    fillTurnSummaries(memory, 15);

    // Add a betrayal event in the range that will be consolidated
    recordEvent(memory, {
      year: 1901,
      season: 'FALL',
      type: 'BETRAYAL',
      powers: ['FRANCE'],
      description: 'France stabbed us in the Channel',
    }, -0.5);

    const result = await consolidateTurnSummaries(memory);

    expect(result).not.toBeNull();
    expect(result!.trustEvents.length).toBeGreaterThan(0);
    expect(result!.trustEvents.some(e => e.description.includes('Channel'))).toBe(true);
  });

  it('should handle multiple consecutive consolidations', async () => {
    // First batch
    fillTurnSummaries(memory, 15);
    await consolidateTurnSummaries(memory);
    expect(memory.consolidatedBlocks).toHaveLength(1);

    // Add more summaries
    for (let i = 0; i < 10; i++) {
      addTurnSummary(memory, makeTurnSummary(1910 + Math.floor(i / 2), i % 2 === 0 ? 'SPRING' : 'FALL'));
    }

    // Second consolidation
    await consolidateTurnSummaries(memory);
    expect(memory.consolidatedBlocks).toHaveLength(2);
    expect(memory.turnSummaries).toHaveLength(RECENT_TURNS_TO_KEEP);
  });

  it('should initialize consolidatedBlocks if missing', async () => {
    fillTurnSummaries(memory, 15);
    // Simulate old memory without consolidatedBlocks
    delete (memory as any).consolidatedBlocks;

    const result = await consolidateTurnSummaries(memory);
    expect(result).not.toBeNull();
    expect(memory.consolidatedBlocks).toBeDefined();
    expect(memory.consolidatedBlocks.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// mergeOldestBlocks
// ---------------------------------------------------------------------------
describe('mergeOldestBlocks', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should do nothing with fewer than 2 blocks', () => {
    memory.consolidatedBlocks = [{
      fromYear: 1901,
      fromSeason: 'SPRING',
      toYear: 1902,
      toSeason: 'FALL',
      summary: 'Block 1',
      trustEvents: [],
      netSCsGained: ['Norway'],
      netSCsLost: [],
      consolidatedAt: new Date(),
    }];

    mergeOldestBlocks(memory);
    expect(memory.consolidatedBlocks).toHaveLength(1);
  });

  it('should merge the two oldest blocks', () => {
    memory.consolidatedBlocks = [
      {
        fromYear: 1901,
        fromSeason: 'SPRING',
        toYear: 1902,
        toSeason: 'FALL',
        summary: 'Early expansion',
        trustEvents: [],
        netSCsGained: ['Norway'],
        netSCsLost: [],
        consolidatedAt: new Date(),
      },
      {
        fromYear: 1903,
        fromSeason: 'SPRING',
        toYear: 1904,
        toSeason: 'FALL',
        summary: 'Mid-game consolidation',
        trustEvents: [],
        netSCsGained: ['Belgium'],
        netSCsLost: ['Norway'],
        consolidatedAt: new Date(),
      },
      {
        fromYear: 1905,
        fromSeason: 'SPRING',
        toYear: 1906,
        toSeason: 'FALL',
        summary: 'Third block',
        trustEvents: [],
        netSCsGained: [],
        netSCsLost: [],
        consolidatedAt: new Date(),
      },
    ];

    mergeOldestBlocks(memory);

    expect(memory.consolidatedBlocks).toHaveLength(2);
    // First block should span 1901-1904
    expect(memory.consolidatedBlocks[0].fromYear).toBe(1901);
    expect(memory.consolidatedBlocks[0].toYear).toBe(1904);
    // Third block should be untouched
    expect(memory.consolidatedBlocks[1].fromYear).toBe(1905);
  });

  it('should merge SC changes with net cancellation', () => {
    memory.consolidatedBlocks = [
      {
        fromYear: 1901,
        fromSeason: 'SPRING',
        toYear: 1902,
        toSeason: 'FALL',
        summary: 'Block 1',
        trustEvents: [],
        netSCsGained: ['Norway', 'Belgium'],
        netSCsLost: [],
        consolidatedAt: new Date(),
      },
      {
        fromYear: 1903,
        fromSeason: 'SPRING',
        toYear: 1904,
        toSeason: 'FALL',
        summary: 'Block 2',
        trustEvents: [],
        netSCsGained: [],
        netSCsLost: ['Norway'],
        consolidatedAt: new Date(),
      },
    ];

    mergeOldestBlocks(memory);

    // Norway gained then lost = cancelled
    expect(memory.consolidatedBlocks[0].netSCsGained).not.toContain('Norway');
    expect(memory.consolidatedBlocks[0].netSCsLost).not.toContain('Norway');
    // Belgium still gained
    expect(memory.consolidatedBlocks[0].netSCsGained).toContain('Belgium');
  });

  it('should merge trust events without duplicates', () => {
    const sharedEvent: TrustAffectingEvent = {
      year: 1902,
      season: 'FALL',
      type: 'BETRAYAL',
      powers: ['FRANCE'],
      description: 'France stabbed',
      trustImpact: -0.3,
    };

    memory.consolidatedBlocks = [
      {
        fromYear: 1901,
        fromSeason: 'SPRING',
        toYear: 1902,
        toSeason: 'FALL',
        summary: 'Block 1',
        trustEvents: [sharedEvent],
        netSCsGained: [],
        netSCsLost: [],
        consolidatedAt: new Date(),
      },
      {
        fromYear: 1903,
        fromSeason: 'SPRING',
        toYear: 1904,
        toSeason: 'FALL',
        summary: 'Block 2',
        trustEvents: [
          sharedEvent, // duplicate
          {
            year: 1903,
            season: 'SPRING',
            type: 'PROMISE_BROKEN',
            powers: ['GERMANY'],
            description: 'Germany broke DMZ',
            trustImpact: -0.4,
          },
        ],
        netSCsGained: [],
        netSCsLost: [],
        consolidatedAt: new Date(),
      },
    ];

    mergeOldestBlocks(memory);

    expect(memory.consolidatedBlocks[0].trustEvents).toHaveLength(2);
  });

  it('should combine summaries with separator', () => {
    memory.consolidatedBlocks = [
      {
        fromYear: 1901,
        fromSeason: 'SPRING',
        toYear: 1902,
        toSeason: 'FALL',
        summary: 'Early game',
        trustEvents: [],
        netSCsGained: [],
        netSCsLost: [],
        consolidatedAt: new Date(),
      },
      {
        fromYear: 1903,
        fromSeason: 'SPRING',
        toYear: 1904,
        toSeason: 'FALL',
        summary: 'Mid game',
        trustEvents: [],
        netSCsGained: [],
        netSCsLost: [],
        consolidatedAt: new Date(),
      },
    ];

    mergeOldestBlocks(memory);

    expect(memory.consolidatedBlocks[0].summary).toContain('Early game');
    expect(memory.consolidatedBlocks[0].summary).toContain('Mid game');
    expect(memory.consolidatedBlocks[0].summary).toContain(' | ');
  });
});

// ---------------------------------------------------------------------------
// mergeStrategicNotes
// ---------------------------------------------------------------------------
describe('mergeStrategicNotes', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('FRANCE', 'game-1');
  });

  it('should not merge when under limit', () => {
    addStrategicNote(memory, {
      year: 1901,
      season: 'SPRING',
      subject: 'German threat',
      content: 'Germany may attack',
      priority: 'HIGH',
    });

    mergeStrategicNotes(memory, 20);
    expect(memory.strategicNotes).toHaveLength(1);
  });

  it('should merge notes with same subject', () => {
    // Add multiple notes with same subject to exceed limit
    for (let i = 0; i < 25; i++) {
      addStrategicNote(memory, {
        year: 1901 + Math.floor(i / 2),
        season: i % 2 === 0 ? 'SPRING' : 'FALL',
        subject: i < 10 ? 'German threat' : `Note ${i}`,
        content: `Content ${i}`,
        priority: i % 3 === 0 ? 'HIGH' : 'MEDIUM',
      });
    }

    mergeStrategicNotes(memory, 20);

    // Should have reduced count
    expect(memory.strategicNotes.length).toBeLessThanOrEqual(20);
    // German threat notes should be merged into one
    const germanNotes = memory.strategicNotes.filter(
      n => n.subject.toLowerCase() === 'german threat'
    );
    expect(germanNotes).toHaveLength(1);
    expect(germanNotes[0].content).toContain('[Also:');
  });

  it('should keep highest priority when merging', () => {
    for (let i = 0; i < 25; i++) {
      addStrategicNote(memory, {
        year: 1901,
        season: 'SPRING',
        subject: i < 15 ? 'Same subject' : `Other ${i}`,
        content: `Content ${i}`,
        priority: i === 5 ? 'CRITICAL' : 'LOW',
      });
    }

    mergeStrategicNotes(memory, 20);

    const merged = memory.strategicNotes.find(
      n => n.subject.toLowerCase() === 'same subject'
    );
    expect(merged).toBeDefined();
    expect(merged!.priority).toBe('CRITICAL');
  });

  it('should truncate to maxNotes when too many unique subjects', () => {
    for (let i = 0; i < 30; i++) {
      addStrategicNote(memory, {
        year: 1901,
        season: 'SPRING',
        subject: `Unique subject ${i}`,
        content: `Content ${i}`,
        priority: i < 5 ? 'CRITICAL' : i < 15 ? 'HIGH' : 'LOW',
      });
    }

    mergeStrategicNotes(memory, 15);
    expect(memory.strategicNotes).toHaveLength(15);

    // Should keep the highest priority ones
    const hasCritical = memory.strategicNotes.some(n => n.priority === 'CRITICAL');
    expect(hasCritical).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAllTrustEvents
// ---------------------------------------------------------------------------
describe('getAllTrustEvents', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should return events from consolidated blocks', () => {
    memory.consolidatedBlocks = [{
      fromYear: 1901,
      fromSeason: 'SPRING',
      toYear: 1903,
      toSeason: 'FALL',
      summary: 'Early game',
      trustEvents: [{
        year: 1902,
        season: 'FALL',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'Old betrayal',
        trustImpact: -0.5,
      }],
      netSCsGained: [],
      netSCsLost: [],
      consolidatedAt: new Date(),
    }];

    const events = getAllTrustEvents(memory);
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe('Old betrayal');
  });

  it('should return events from recent memory events', () => {
    memory.events.push({
      year: 1905,
      season: 'SPRING',
      type: 'BETRAYAL',
      powers: ['GERMANY'],
      description: 'Recent betrayal',
      impactOnTrust: -0.3,
    });

    const events = getAllTrustEvents(memory);
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe('Recent betrayal');
  });

  it('should combine events from blocks and recent, deduplicating', () => {
    memory.consolidatedBlocks = [{
      fromYear: 1901,
      fromSeason: 'SPRING',
      toYear: 1903,
      toSeason: 'FALL',
      summary: 'Block',
      trustEvents: [{
        year: 1902,
        season: 'FALL',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'Shared event',
        trustImpact: -0.3,
      }],
      netSCsGained: [],
      netSCsLost: [],
      consolidatedAt: new Date(),
    }];

    memory.events.push({
      year: 1902,
      season: 'FALL',
      type: 'BETRAYAL',
      powers: ['FRANCE'],
      description: 'Shared event', // duplicate
      impactOnTrust: -0.3,
    });

    memory.events.push({
      year: 1905,
      season: 'SPRING',
      type: 'ALLIANCE_FORMED',
      powers: ['GERMANY'],
      description: 'New alliance',
      impactOnTrust: 0.3,
    });

    const events = getAllTrustEvents(memory);
    expect(events).toHaveLength(2); // deduplicated
  });

  it('should remember betrayals from 15+ turns back', async () => {
    // Simulate a long game with an early betrayal
    recordEvent(memory, {
      year: 1901,
      season: 'FALL',
      type: 'BETRAYAL',
      powers: ['FRANCE'],
      description: 'France stabbed us early',
    }, -0.5);

    // Fill 30+ turns of summaries
    fillTurnSummaries(memory, 35);

    // Run consolidation multiple times to simulate long game
    await consolidateTurnSummaries(memory);
    // Add more and consolidate again
    for (let i = 0; i < 15; i++) {
      addTurnSummary(memory, makeTurnSummary(1920 + Math.floor(i / 2), i % 2 === 0 ? 'SPRING' : 'FALL'));
    }
    await consolidateTurnSummaries(memory);

    // The early betrayal should still be accessible
    const events = getAllTrustEvents(memory);
    const earlyBetrayal = events.find(e => e.description === 'France stabbed us early');
    expect(earlyBetrayal).toBeDefined();
    expect(earlyBetrayal!.year).toBe(1901);
  });
});

// ---------------------------------------------------------------------------
// formatConsolidatedMemory
// ---------------------------------------------------------------------------
describe('formatConsolidatedMemory', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should format consolidated blocks', () => {
    memory.consolidatedBlocks = [{
      fromYear: 1901,
      fromSeason: 'SPRING',
      toYear: 1903,
      toSeason: 'FALL',
      summary: 'Expanded into Scandinavia',
      trustEvents: [],
      netSCsGained: ['Norway', 'Sweden'],
      netSCsLost: [],
      consolidatedAt: new Date(),
    }];

    const text = formatConsolidatedMemory(memory);
    expect(text).toContain('Historical Summary');
    expect(text).toContain('1901 SPRING - 1903 FALL');
    expect(text).toContain('Expanded into Scandinavia');
  });

  it('should format trust events within blocks', () => {
    memory.consolidatedBlocks = [{
      fromYear: 1901,
      fromSeason: 'SPRING',
      toYear: 1903,
      toSeason: 'FALL',
      summary: 'Summary',
      trustEvents: [{
        year: 1902,
        season: 'FALL',
        type: 'BETRAYAL',
        powers: ['FRANCE'],
        description: 'France backstabbed us',
        trustImpact: -0.5,
      }],
      netSCsGained: [],
      netSCsLost: [],
      consolidatedAt: new Date(),
    }];

    const text = formatConsolidatedMemory(memory);
    expect(text).toContain('France backstabbed us');
    expect(text).toContain('BETRAYAL');
  });

  it('should format recent turn summaries', () => {
    addTurnSummary(memory, makeTurnSummary(1905, 'SPRING', {
      supplyCentersGained: ['Munich'],
      diplomaticHighlights: ['Allied with Germany'],
    }));

    const text = formatConsolidatedMemory(memory);
    expect(text).toContain('Recent Turns');
    expect(text).toContain('1905 SPRING');
    expect(text).toContain('+Munich');
  });

  it('should return empty string for empty memory', () => {
    const text = formatConsolidatedMemory(memory);
    expect(text).toBe('');
  });

  it('should show both blocks and recent turns', () => {
    memory.consolidatedBlocks = [{
      fromYear: 1901,
      fromSeason: 'SPRING',
      toYear: 1903,
      toSeason: 'FALL',
      summary: 'Historical',
      trustEvents: [],
      netSCsGained: [],
      netSCsLost: [],
      consolidatedAt: new Date(),
    }];
    addTurnSummary(memory, makeTurnSummary(1905, 'SPRING'));

    const text = formatConsolidatedMemory(memory);
    expect(text).toContain('Historical Summary');
    expect(text).toContain('Recent Turns');
  });
});

// ---------------------------------------------------------------------------
// consolidateMemory (full integration)
// ---------------------------------------------------------------------------
describe('consolidateMemory', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should consolidate turns and merge notes together', async () => {
    fillTurnSummaries(memory, 15);

    // Add many notes to trigger merging
    for (let i = 0; i < 25; i++) {
      addStrategicNote(memory, {
        year: 1901,
        season: 'SPRING',
        subject: i < 10 ? 'Same topic' : `Topic ${i}`,
        content: `Content ${i}`,
        priority: 'MEDIUM',
      });
    }

    const result = await consolidateMemory(memory);

    expect(result.turnBlock).not.toBeNull();
    expect(result.notesMerged).toBe(true);
  });

  it('should work with LLM provider', async () => {
    const llm = createMockLLM('LLM consolidated summary.');
    fillTurnSummaries(memory, 15);

    const result = await consolidateMemory(memory, llm);

    expect(result.turnBlock).not.toBeNull();
    expect(result.turnBlock!.summary).toBe('LLM consolidated summary.');
  });

  it('should handle no consolidation needed gracefully', async () => {
    fillTurnSummaries(memory, 3);

    const result = await consolidateMemory(memory);

    expect(result.turnBlock).toBeNull();
    expect(result.notesMerged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 30+ turn game simulation (exit criteria)
// ---------------------------------------------------------------------------
describe('30+ turn game without overflow', () => {
  it('should handle a 40-turn game without memory overflow', async () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');

    // Simulate 40 turns
    for (let turn = 0; turn < 40; turn++) {
      const year = 1901 + Math.floor(turn / 2);
      const season = turn % 2 === 0 ? 'SPRING' as const : 'FALL' as const;

      // Add turn summary
      addTurnSummary(memory, makeTurnSummary(year, season, {
        supplyCentersGained: turn % 5 === 0 ? [`SC-${turn}`] : [],
        diplomaticHighlights: [`Turn ${turn} diplomacy`],
      }));

      // Add some events
      if (turn % 7 === 0) {
        recordEvent(memory, {
          year,
          season,
          type: 'BETRAYAL',
          powers: ['FRANCE'],
          description: `Betrayal at turn ${turn}`,
        }, -0.3);
      }

      // Add strategic notes
      if (turn % 3 === 0) {
        addStrategicNote(memory, {
          year,
          season,
          subject: turn % 6 === 0 ? 'Recurring topic' : `Topic ${turn}`,
          content: `Strategy thought ${turn}`,
          priority: 'MEDIUM',
        });
      }

      // Run consolidation periodically (every 5 turns after threshold)
      if (memory.turnSummaries.length > CONSOLIDATION_THRESHOLD) {
        await consolidateMemory(memory);
      }
    }

    // Final consolidation
    await consolidateMemory(memory);

    // Verify constraints
    expect(memory.turnSummaries.length).toBeLessThanOrEqual(CONSOLIDATION_THRESHOLD);
    expect(memory.consolidatedBlocks.length).toBeLessThanOrEqual(MAX_CONSOLIDATED_BLOCKS);
    expect(memory.strategicNotes.length).toBeLessThanOrEqual(20);

    // Verify we can still find early betrayals
    const allTrustEvents = getAllTrustEvents(memory);
    const earlyBetrayals = allTrustEvents.filter(e => e.description.includes('turn 0'));
    expect(earlyBetrayals.length).toBeGreaterThan(0);
  });

  it('should remember a turn-1 betrayal after 35 turns', async () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');

    // Record betrayal at turn 1
    recordEvent(memory, {
      year: 1901,
      season: 'SPRING',
      type: 'BETRAYAL',
      powers: ['FRANCE'],
      description: 'France attacked English Channel turn 1',
    }, -0.5);

    // Simulate 35 more turns with periodic consolidation
    for (let turn = 0; turn < 35; turn++) {
      const year = 1901 + Math.floor(turn / 2);
      const season = turn % 2 === 0 ? 'SPRING' as const : 'FALL' as const;
      addTurnSummary(memory, makeTurnSummary(year, season));

      if (memory.turnSummaries.length > CONSOLIDATION_THRESHOLD) {
        await consolidateMemory(memory);
      }
    }

    // The turn-1 betrayal must still be accessible
    const events = getAllTrustEvents(memory);
    const found = events.find(e => e.description === 'France attacked English Channel turn 1');
    expect(found).toBeDefined();
    expect(found!.year).toBe(1901);
    expect(found!.season).toBe('SPRING');
    expect(found!.type).toBe('BETRAYAL');
  });
});

// ---------------------------------------------------------------------------
// addTurnSummary integration (no longer caps at 10)
// ---------------------------------------------------------------------------
describe('addTurnSummary (updated behavior)', () => {
  it('should not cap at 10 anymore', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');

    for (let i = 0; i < 15; i++) {
      addTurnSummary(memory, makeTurnSummary(
        1901 + Math.floor(i / 2),
        i % 2 === 0 ? 'SPRING' : 'FALL'
      ));
    }

    // Should now keep all 15 (consolidation module handles trimming)
    expect(memory.turnSummaries).toHaveLength(15);
  });

  it('should initialize consolidatedBlocks if missing', () => {
    const memory = createInitialMemory('FRANCE', 'game-1');
    delete (memory as any).consolidatedBlocks;

    addTurnSummary(memory, makeTurnSummary(1901, 'SPRING'));

    expect(memory.consolidatedBlocks).toBeDefined();
    expect(memory.consolidatedBlocks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('consolidation constants', () => {
  it('should have sensible defaults', () => {
    expect(RECENT_TURNS_TO_KEEP).toBe(5);
    expect(CONSOLIDATION_THRESHOLD).toBe(10);
    expect(MAX_CONSOLIDATED_BLOCKS).toBe(6);
    expect(RECENT_TURNS_TO_KEEP).toBeLessThan(CONSOLIDATION_THRESHOLD);
  });
});
