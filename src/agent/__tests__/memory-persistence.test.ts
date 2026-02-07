/**
 * Integration tests: Agent memory persists and consolidates across turns.
 *
 * Verifies that trust levels, events, diary entries, strategic notes,
 * and commitments survive multi-turn games with consolidation and
 * serialization cycles.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createInitialMemory,
  recordEvent,
  addCommitment,
  fulfillCommitment,
  breakCommitment,
  addStrategicNote,
  addTurnSummary,
  getHighPriorityNotes,
  serializeMemory,
  deserializeMemory,
  InMemoryStore,
  MemoryManager,
} from '../memory';
import {
  consolidateMemory,
  getAllTrustEvents,
  CONSOLIDATION_THRESHOLD,
  MAX_CONSOLIDATED_BLOCKS,
} from '../consolidation';
import {
  createDiaryEntry,
  addDiaryEntry,
  consolidateDiary,
  getContextDiary,
  recordNegotiation,
  recordOrders,
  recordReflection,
} from '../diary';
import type { AgentMemory, TurnSummary, LLMProvider } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTurnSummary(year: number, season: 'SPRING' | 'FALL', overrides?: Partial<TurnSummary>): TurnSummary {
  return {
    year,
    season,
    ordersSubmitted: ['A PAR -> BUR'],
    ordersSucceeded: ['A PAR -> BUR'],
    ordersFailed: [],
    supplyCentersGained: [],
    supplyCentersLost: [],
    unitsBuilt: 0,
    unitsLost: 0,
    diplomaticHighlights: [],
    ...overrides,
  };
}

function createMockLLM(response: string = 'Consolidated summary.'): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue({
      content: response,
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  };
}

/** Simulate N game turns, adding turn summaries and running consolidation when needed. */
async function simulateTurns(memory: AgentMemory, count: number, startYear = 1901): Promise<void> {
  for (let i = 0; i < count; i++) {
    const year = startYear + Math.floor(i / 2);
    const season = i % 2 === 0 ? 'SPRING' as const : 'FALL' as const;
    addTurnSummary(memory, makeTurnSummary(year, season));

    if (memory.turnSummaries.length > CONSOLIDATION_THRESHOLD) {
      await consolidateMemory(memory);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Trust levels update after betrayals/cooperation and persist across turns
// ---------------------------------------------------------------------------
describe('Trust persists and consolidates across turns', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should reflect betrayal trust impact after multiple consolidation cycles', async () => {
    // Early betrayal
    recordEvent(memory, {
      year: 1901, season: 'SPRING', type: 'BETRAYAL',
      powers: ['FRANCE'],
      description: 'France broke Channel DMZ',
    }, -0.5);

    expect(memory.trustLevels.get('FRANCE')).toBeCloseTo(-0.5);

    // Play 25 turns with consolidation
    await simulateTurns(memory, 25);

    // Trust level must still reflect the betrayal
    expect(memory.trustLevels.get('FRANCE')).toBeCloseTo(-0.5);
    expect(memory.relationships.get('FRANCE')!.isEnemy).toBe(true);
  });

  it('should accumulate trust from repeated cooperation events', async () => {
    for (let turn = 0; turn < 4; turn++) {
      recordEvent(memory, {
        year: 1901 + turn, season: 'SPRING', type: 'COOPERATION',
        powers: ['GERMANY'],
        description: `Cooperation in turn ${turn}`,
      }, 0.15);
    }

    // 4 * 0.15 = 0.6 → should be ally
    expect(memory.trustLevels.get('GERMANY')).toBeCloseTo(0.6);
    expect(memory.relationships.get('GERMANY')!.isAlly).toBe(true);

    // Consolidate and verify trust survives
    await simulateTurns(memory, 20);

    expect(memory.trustLevels.get('GERMANY')).toBeCloseTo(0.6);
    expect(memory.currentAllies).toContain('GERMANY');
  });

  it('should transition ally→enemy after betrayal and persist through serialization', async () => {
    // Build alliance
    recordEvent(memory, {
      year: 1901, season: 'SPRING', type: 'ALLIANCE_FORMED',
      powers: ['FRANCE'],
      description: 'Entente Cordiale',
    }, 0.6);
    expect(memory.currentAllies).toContain('FRANCE');

    // Major betrayal: -1.2 delta (clamped from 0.6 to -0.6)
    recordEvent(memory, {
      year: 1902, season: 'FALL', type: 'BETRAYAL',
      powers: ['FRANCE'],
      description: 'France stabbed into Channel',
    }, -1.2);
    expect(memory.currentAllies).not.toContain('FRANCE');
    expect(memory.currentEnemies).toContain('FRANCE');

    // Serialize round-trip
    const json = serializeMemory(memory);
    const restored = deserializeMemory(json);

    // 0.6 + (-1.2) = -0.6, clamped to -0.6
    expect(restored.trustLevels.get('FRANCE')).toBeCloseTo(-0.6);
    expect(restored.relationships.get('FRANCE')!.isAlly).toBe(false);
    expect(restored.relationships.get('FRANCE')!.isEnemy).toBe(true);
  });

  it('should preserve trust levels through store save/load cycle with consolidation', async () => {
    const store = new InMemoryStore();

    recordEvent(memory, {
      year: 1901, season: 'SPRING', type: 'COOPERATION',
      powers: ['ITALY'],
      description: 'Lepanto opening',
    }, 0.4);

    await simulateTurns(memory, 15);
    await store.save(memory);

    const loaded = await store.load('ENGLAND', 'game-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.trustLevels.get('ITALY')).toBeCloseTo(0.4);
    expect(loaded!.consolidatedBlocks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Events recorded with correct year/season
// ---------------------------------------------------------------------------
describe('Events record correct year/season across turns', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('FRANCE', 'game-1');
  });

  it('should record events at distinct game phases with correct timestamps', () => {
    const phases: Array<{ year: number; season: 'SPRING' | 'FALL' }> = [
      { year: 1901, season: 'SPRING' },
      { year: 1901, season: 'FALL' },
      { year: 1902, season: 'SPRING' },
      { year: 1903, season: 'FALL' },
    ];

    for (const { year, season } of phases) {
      recordEvent(memory, {
        year, season, type: 'COOPERATION',
        powers: ['ENGLAND'],
        description: `Event at ${year} ${season}`,
      }, 0.05);
    }

    expect(memory.events).toHaveLength(4);
    for (let i = 0; i < phases.length; i++) {
      expect(memory.events[i].year).toBe(phases[i].year);
      expect(memory.events[i].season).toBe(phases[i].season);
    }
  });

  it('should preserve event year/season after serialization round-trip', () => {
    recordEvent(memory, {
      year: 1905, season: 'FALL', type: 'BETRAYAL',
      powers: ['GERMANY'],
      description: 'Late-game betrayal',
    }, -0.5);

    const restored = deserializeMemory(serializeMemory(memory));
    const event = restored.events[0];

    expect(event.year).toBe(1905);
    expect(event.season).toBe('FALL');
    expect(event.type).toBe('BETRAYAL');
    expect(event.description).toBe('Late-game betrayal');
  });

  it('should preserve trust-affecting events through consolidation with correct timestamps', async () => {
    // Record events at different years
    recordEvent(memory, {
      year: 1901, season: 'SPRING', type: 'BETRAYAL',
      powers: ['GERMANY'],
      description: 'Year 1 betrayal',
    }, -0.3);

    recordEvent(memory, {
      year: 1903, season: 'FALL', type: 'ALLIANCE_FORMED',
      powers: ['ENGLAND'],
      description: 'Year 3 alliance',
    }, 0.3);

    // Simulate many turns to trigger multiple consolidation cycles
    await simulateTurns(memory, 30);

    const trustEvents = getAllTrustEvents(memory);

    const betrayal = trustEvents.find(e => e.description === 'Year 1 betrayal');
    expect(betrayal).toBeDefined();
    expect(betrayal!.year).toBe(1901);
    expect(betrayal!.season).toBe('SPRING');

    const alliance = trustEvents.find(e => e.description === 'Year 3 alliance');
    expect(alliance).toBeDefined();
    expect(alliance!.year).toBe(1903);
    expect(alliance!.season).toBe('FALL');
  });
});

// ---------------------------------------------------------------------------
// 3. Diary consolidation merges old entries correctly
// ---------------------------------------------------------------------------
describe('Diary consolidation merges old entries correctly', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should consolidate year entries and preserve fullPrivateDiary', async () => {
    const mockLLM = createMockLLM(
      `SUMMARY: Gained Belgium. Strong opening.
TERRITORIAL: Gained BEL
DIPLOMATIC: Alliance with France`
    );

    // Add entries for 1901
    recordNegotiation(memory, 1901, 'SPRING', 'DIPLOMACY', 'Proposed alliance with France');
    recordOrders(memory, 1901, 'SPRING', 'MOVEMENT', 'A LON -> NTH');
    recordReflection(memory, 1901, 'FALL', 'MOVEMENT', 'Belgium secured');

    const fullCountBefore = memory.fullPrivateDiary.length;
    expect(fullCountBefore).toBe(3);

    await consolidateDiary(memory, 'ENGLAND', 1901, mockLLM);

    // Year summary created
    expect(memory.yearSummaries).toHaveLength(1);
    expect(memory.yearSummaries[0].year).toBe(1901);
    expect(memory.yearSummaries[0].summary).toContain('Belgium');

    // Current year cleared
    expect(memory.currentYearDiary).toHaveLength(0);

    // Full diary preserved (original entries + consolidation entry)
    expect(memory.fullPrivateDiary.length).toBeGreaterThanOrEqual(fullCountBefore);
  });

  it('should consolidate multiple years sequentially', async () => {
    const mockLLM: LLMProvider = {
      complete: vi.fn().mockImplementation(async ({ messages }) => {
        const content = messages.find((m: { role: string }) => m.role === 'user')?.content ?? '';
        const yearMatch = content.match(/year (\d+)/i);
        const year = yearMatch ? yearMatch[1] : '?';
        return {
          content: `SUMMARY: Year ${year} events.\nTERRITORIAL: None\nDIPLOMATIC: None`,
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      }),
    };

    for (let year = 1901; year <= 1905; year++) {
      addDiaryEntry(memory, createDiaryEntry(year, 'SPRING', 'MOVEMENT', 'orders', `${year} spring`));
      addDiaryEntry(memory, createDiaryEntry(year, 'FALL', 'MOVEMENT', 'orders', `${year} fall`));
      await consolidateDiary(memory, 'ENGLAND', year, mockLLM);
    }

    expect(memory.yearSummaries).toHaveLength(5);
    expect(memory.yearSummaries[0].year).toBe(1901);
    expect(memory.yearSummaries[4].year).toBe(1905);
    expect(memory.currentYearDiary).toHaveLength(0);

    // Full diary has all 10 original entries plus 5 consolidation entries
    expect(memory.fullPrivateDiary.length).toBeGreaterThanOrEqual(10);
  });

  it('should produce correct context output after multi-year consolidation', async () => {
    const mockLLM = createMockLLM(
      `SUMMARY: Expanded northward.\nTERRITORIAL: Gained NWY\nDIPLOMATIC: Peace with Russia`
    );

    // Consolidated years
    addDiaryEntry(memory, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Moved north'));
    await consolidateDiary(memory, 'ENGLAND', 1901, mockLLM);

    // Current year (not yet consolidated)
    addDiaryEntry(memory, createDiaryEntry(1902, 'SPRING', 'MOVEMENT', 'orders', 'Current turn'));

    const context = getContextDiary(memory);
    expect(context).toContain('Past Years Summary');
    expect(context).toContain('Year 1901');
    expect(context).toContain('Current Year Diary');
    expect(context).toContain('Current turn');
  });

  it('should preserve diary through serialization after consolidation', async () => {
    const mockLLM = createMockLLM(
      `SUMMARY: Quiet year.\nTERRITORIAL: None\nDIPLOMATIC: None`
    );

    addDiaryEntry(memory, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Spring orders'));
    await consolidateDiary(memory, 'ENGLAND', 1901, mockLLM);

    // Add current year entry
    addDiaryEntry(memory, createDiaryEntry(1902, 'SPRING', 'MOVEMENT', 'orders', 'New year'));

    const restored = deserializeMemory(serializeMemory(memory));

    expect(restored.yearSummaries).toHaveLength(1);
    expect(restored.yearSummaries[0].year).toBe(1901);
    expect(restored.yearSummaries[0].consolidatedAt).toBeInstanceOf(Date);
    expect(restored.currentYearDiary).toHaveLength(1);
    expect(restored.currentYearDiary[0].content).toBe('New year');
    expect(restored.currentYearDiary[0].timestamp).toBeInstanceOf(Date);
    expect(restored.fullPrivateDiary.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. High-priority notes persist through consolidation
// ---------------------------------------------------------------------------
describe('High-priority notes persist through consolidation', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('GERMANY', 'game-1');
  });

  it('should retain HIGH/CRITICAL notes after mergeStrategicNotes', async () => {
    // Add critical note early
    addStrategicNote(memory, {
      year: 1901, season: 'SPRING',
      subject: 'Stab warning',
      content: 'France will stab in Fall 1902',
      priority: 'CRITICAL',
    });

    // Add high note
    addStrategicNote(memory, {
      year: 1901, season: 'FALL',
      subject: 'Russian intentions',
      content: 'Russia building south - no northern threat',
      priority: 'HIGH',
    });

    // Flood with low-priority notes to trigger merging
    for (let i = 0; i < 25; i++) {
      addStrategicNote(memory, {
        year: 1902 + Math.floor(i / 2),
        season: i % 2 === 0 ? 'SPRING' : 'FALL',
        subject: `Observation ${i}`,
        content: `Low priority observation ${i}`,
        priority: 'LOW',
      });
    }

    // Simulate turns to trigger consolidation (which also merges notes)
    await simulateTurns(memory, 15);

    const highNotes = getHighPriorityNotes(memory);
    expect(highNotes.length).toBeGreaterThanOrEqual(2);

    const critical = highNotes.find(n => n.content.includes('France will stab'));
    expect(critical).toBeDefined();
    expect(critical!.priority).toBe('CRITICAL');

    const high = highNotes.find(n => n.content.includes('Russia building south'));
    expect(high).toBeDefined();
    expect(high!.priority).toBe('HIGH');
  });

  it('should preserve high-priority notes through serialization', () => {
    addStrategicNote(memory, {
      year: 1901, season: 'SPRING',
      subject: 'Critical intel',
      content: 'Must not forget this',
      priority: 'CRITICAL',
    });

    const restored = deserializeMemory(serializeMemory(memory));
    const notes = restored.strategicNotes.filter(
      n => n.priority === 'CRITICAL' || n.priority === 'HIGH'
    );

    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe('Must not forget this');
    expect(notes[0].priority).toBe('CRITICAL');
  });

  it('should keep critical notes when many unique subjects force truncation', async () => {
    // Add 5 critical notes
    for (let i = 0; i < 5; i++) {
      addStrategicNote(memory, {
        year: 1901, season: 'SPRING',
        subject: `Critical ${i}`,
        content: `Critical intel ${i}`,
        priority: 'CRITICAL',
      });
    }

    // Add 30 low-priority unique notes to force truncation
    for (let i = 0; i < 30; i++) {
      addStrategicNote(memory, {
        year: 1902, season: 'SPRING',
        subject: `Unique filler ${i}`,
        content: `Filler ${i}`,
        priority: 'LOW',
      });
    }

    await simulateTurns(memory, 15);

    const highNotes = getHighPriorityNotes(memory);
    expect(highNotes.length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < 5; i++) {
      expect(highNotes.some(n => n.content === `Critical intel ${i}`)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Commitments track fulfilled/broken status across turns
// ---------------------------------------------------------------------------
describe('Commitments track fulfilled/broken status across turns', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = createInitialMemory('ENGLAND', 'game-1');
  });

  it('should track fulfilled commitment and its trust impact over multiple turns', async () => {
    const commitment = addCommitment(memory, {
      year: 1901, season: 'SPRING',
      fromPower: 'ENGLAND', toPower: 'FRANCE',
      description: 'Support France into Belgium',
    });

    // Play a few turns
    await simulateTurns(memory, 4);

    // Fulfill the commitment
    fulfillCommitment(memory, commitment.id, 1902, 'FALL');

    expect(commitment.fulfilled).toBe(true);
    expect(memory.events.some(e => e.type === 'PROMISE_KEPT')).toBe(true);

    // Trust should be positive from fulfillment
    expect(memory.trustLevels.get('FRANCE')!).toBeGreaterThan(0);

    // Play more turns with consolidation
    await simulateTurns(memory, 20);

    // Trust impact persists
    expect(memory.trustLevels.get('FRANCE')!).toBeGreaterThan(0);

    // PROMISE_KEPT event survives consolidation
    const trustEvents = getAllTrustEvents(memory);
    expect(trustEvents.some(e => e.type === 'PROMISE_KEPT')).toBe(true);
  });

  it('should track broken commitment and its trust impact over multiple turns', async () => {
    const commitment = addCommitment(memory, {
      year: 1901, season: 'SPRING',
      fromPower: 'ENGLAND', toPower: 'GERMANY',
      description: 'DMZ in Holland',
    });

    breakCommitment(memory, commitment.id, 1901, 'FALL');

    expect(commitment.broken).toBe(true);
    expect(memory.events.some(e => e.type === 'PROMISE_BROKEN')).toBe(true);
    expect(memory.trustLevels.get('GERMANY')!).toBeLessThan(0);

    // Play many turns
    await simulateTurns(memory, 30);

    // Trust impact persists
    expect(memory.trustLevels.get('GERMANY')!).toBeLessThan(0);

    // PROMISE_BROKEN event survives consolidation
    const trustEvents = getAllTrustEvents(memory);
    const broken = trustEvents.find(e => e.type === 'PROMISE_BROKEN');
    expect(broken).toBeDefined();
    expect(broken!.year).toBe(1901);
    expect(broken!.season).toBe('FALL');
  });

  it('should preserve commitment status through serialization', () => {
    const c1 = addCommitment(memory, {
      year: 1901, season: 'SPRING',
      fromPower: 'ENGLAND', toPower: 'FRANCE',
      description: 'Support into Belgium',
    });
    fulfillCommitment(memory, c1.id, 1901, 'FALL');

    const c2 = addCommitment(memory, {
      year: 1902, season: 'SPRING',
      fromPower: 'ENGLAND', toPower: 'GERMANY',
      description: 'DMZ Rhineland',
    });
    breakCommitment(memory, c2.id, 1902, 'FALL');

    addCommitment(memory, {
      year: 1903, season: 'SPRING',
      fromPower: 'ENGLAND', toPower: 'RUSSIA',
      description: 'Non-aggression pact',
      expiresYear: 1905, expiresSeason: 'WINTER',
    });

    const restored = deserializeMemory(serializeMemory(memory));

    const fulfilled = restored.activeCommitments.find(c => c.description === 'Support into Belgium');
    expect(fulfilled).toBeDefined();
    expect(fulfilled!.fulfilled).toBe(true);

    const broken = restored.activeCommitments.find(c => c.description === 'DMZ Rhineland');
    expect(broken).toBeDefined();
    expect(broken!.broken).toBe(true);

    const active = restored.activeCommitments.find(c => c.description === 'Non-aggression pact');
    expect(active).toBeDefined();
    expect(active!.fulfilled).toBeFalsy();
    expect(active!.broken).toBeFalsy();
    expect(active!.expiresYear).toBe(1905);
  });

  it('should handle multiple commitments to different powers across turns', async () => {
    const commitments = [
      addCommitment(memory, {
        year: 1901, season: 'SPRING',
        fromPower: 'ENGLAND', toPower: 'FRANCE',
        description: 'Support Belgium',
      }),
      addCommitment(memory, {
        year: 1901, season: 'SPRING',
        fromPower: 'ENGLAND', toPower: 'GERMANY',
        description: 'DMZ Holland',
      }),
      addCommitment(memory, {
        year: 1902, season: 'SPRING',
        fromPower: 'ENGLAND', toPower: 'RUSSIA',
        description: 'Convoy to Norway',
      }),
    ];

    await simulateTurns(memory, 6);

    fulfillCommitment(memory, commitments[0].id, 1903, 'SPRING');
    breakCommitment(memory, commitments[1].id, 1903, 'FALL');
    // commitments[2] stays active

    await simulateTurns(memory, 20);

    // France trust up (cooperation via fulfilled promise)
    expect(memory.trustLevels.get('FRANCE')!).toBeGreaterThan(0);
    // Germany trust down (broken promise)
    expect(memory.trustLevels.get('GERMANY')!).toBeLessThan(0);
    // Russia trust unchanged (commitment still active)
    expect(memory.trustLevels.get('RUSSIA')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Full cross-turn integration: everything persists together
// ---------------------------------------------------------------------------
describe('Full multi-turn persistence integration', () => {
  it('should maintain all memory facets through a 10-year simulated game', async () => {
    const memory = createInitialMemory('ENGLAND', 'game-1');
    const mockLLM = createMockLLM(
      `SUMMARY: Year events.\nTERRITORIAL: None\nDIPLOMATIC: None`
    );

    // Year 1901: Form alliance, make commitment
    recordEvent(memory, {
      year: 1901, season: 'SPRING', type: 'ALLIANCE_FORMED',
      powers: ['FRANCE'], description: 'Anglo-French alliance',
    }, 0.5);
    const commitment = addCommitment(memory, {
      year: 1901, season: 'SPRING',
      fromPower: 'ENGLAND', toPower: 'FRANCE',
      description: 'Support into Belgium',
    });
    addStrategicNote(memory, {
      year: 1901, season: 'SPRING',
      subject: 'Grand strategy', content: 'Focus on northern expansion',
      priority: 'HIGH',
    });
    recordNegotiation(memory, 1901, 'SPRING', 'DIPLOMACY', 'Alliance with France agreed');
    addTurnSummary(memory, makeTurnSummary(1901, 'SPRING', {
      supplyCentersGained: ['Norway'],
    }));

    // Year 1901 Fall: Fulfill commitment
    fulfillCommitment(memory, commitment.id, 1901, 'FALL');
    recordOrders(memory, 1901, 'FALL', 'MOVEMENT', 'F NTH -> NWY');
    addTurnSummary(memory, makeTurnSummary(1901, 'FALL'));
    await consolidateDiary(memory, 'ENGLAND', 1901, mockLLM);

    // Years 1902-1905: Simulate turns
    for (let year = 1902; year <= 1905; year++) {
      addDiaryEntry(memory, createDiaryEntry(year, 'SPRING', 'MOVEMENT', 'orders', `${year} orders`));
      addTurnSummary(memory, makeTurnSummary(year, 'SPRING'));
      addTurnSummary(memory, makeTurnSummary(year, 'FALL'));
      await consolidateDiary(memory, 'ENGLAND', year, mockLLM);

      if (memory.turnSummaries.length > CONSOLIDATION_THRESHOLD) {
        await consolidateMemory(memory);
      }
    }

    // Year 1906: Betrayal
    recordEvent(memory, {
      year: 1906, season: 'FALL', type: 'BETRAYAL',
      powers: ['FRANCE'], description: 'France stabbed into Channel',
    }, -0.8);
    addStrategicNote(memory, {
      year: 1906, season: 'FALL',
      subject: 'France is treacherous', content: 'Never trust France again',
      priority: 'CRITICAL',
    });

    // Years 1907-1910: More turns
    for (let year = 1907; year <= 1910; year++) {
      addTurnSummary(memory, makeTurnSummary(year, 'SPRING'));
      addTurnSummary(memory, makeTurnSummary(year, 'FALL'));
      if (memory.turnSummaries.length > CONSOLIDATION_THRESHOLD) {
        await consolidateMemory(memory);
      }
    }

    // --- Verify all facets ---

    // Trust: alliance + fulfillment + betrayal = 0.5 + 0.1 - 0.8 = -0.2
    expect(memory.trustLevels.get('FRANCE')).toBeCloseTo(-0.2);

    // Trust events: both alliance and betrayal preserved
    const trustEvents = getAllTrustEvents(memory);
    expect(trustEvents.some(e => e.description === 'Anglo-French alliance')).toBe(true);
    expect(trustEvents.some(e => e.description === 'France stabbed into Channel')).toBe(true);

    // Commitment status preserved
    expect(commitment.fulfilled).toBe(true);

    // High priority notes survived
    const highNotes = getHighPriorityNotes(memory);
    expect(highNotes.some(n => n.content === 'Focus on northern expansion')).toBe(true);
    expect(highNotes.some(n => n.content === 'Never trust France again')).toBe(true);

    // Diary: year summaries accumulated
    expect(memory.yearSummaries.length).toBeGreaterThanOrEqual(1);

    // Consolidation bounds respected
    expect(memory.turnSummaries.length).toBeLessThanOrEqual(CONSOLIDATION_THRESHOLD);
    expect(memory.consolidatedBlocks.length).toBeLessThanOrEqual(MAX_CONSOLIDATED_BLOCKS);

    // Serialize round-trip preserves everything
    const restored = deserializeMemory(serializeMemory(memory));
    expect(restored.trustLevels.get('FRANCE')).toBeCloseTo(-0.2);
    expect(restored.yearSummaries.length).toBe(memory.yearSummaries.length);
    expect(restored.consolidatedBlocks.length).toBe(memory.consolidatedBlocks.length);
    expect(restored.strategicNotes.some(n => n.priority === 'CRITICAL')).toBe(true);
  });

  it('should persist complete state through MemoryManager across sessions', async () => {
    const store = new InMemoryStore();
    const manager = new MemoryManager(store);

    // Session 1: Setup game state
    const mem1 = await manager.getMemory('ENGLAND', 'game-1');
    recordEvent(mem1, {
      year: 1901, season: 'SPRING', type: 'COOPERATION',
      powers: ['FRANCE'], description: 'Joint naval operation',
    }, 0.3);
    addCommitment(mem1, {
      year: 1901, season: 'SPRING',
      fromPower: 'ENGLAND', toPower: 'FRANCE',
      description: 'Support Belgium',
    });
    addStrategicNote(mem1, {
      year: 1901, season: 'SPRING',
      subject: 'Key intel', content: 'Germany plans east',
      priority: 'HIGH',
    });
    addDiaryEntry(mem1, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Session 1 orders'));
    await simulateTurns(mem1, 8);
    await manager.saveMemory(mem1);

    // Simulate session break
    manager.clearCache();

    // Session 2: Load and verify
    const mem2 = await manager.getMemory('ENGLAND', 'game-1');

    expect(mem2.trustLevels.get('FRANCE')).toBeCloseTo(0.3);
    expect(mem2.activeCommitments.some(c => c.description === 'Support Belgium')).toBe(true);
    expect(mem2.strategicNotes.some(n => n.content === 'Germany plans east')).toBe(true);
    expect(mem2.fullPrivateDiary.some(e => e.content === 'Session 1 orders')).toBe(true);
    expect(mem2.turnSummaries.length).toBeGreaterThan(0);
  });
});
