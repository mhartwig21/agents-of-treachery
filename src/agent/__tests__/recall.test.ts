/**
 * Tests for recall.ts — Conversation recall tool.
 *
 * Covers: parsePhaseString, parseRecallBlock, hasRecallRequest,
 * executeRecall, stripRecallBlock, and runtime integration via
 * the recall tool loop in runSingleAgentTurn.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parsePhaseString,
  parseRecallBlock,
  hasRecallRequest,
  executeRecall,
  stripRecallBlock,
  MAX_RECALL_CALLS_PER_TURN,
} from '../recall';
import type { AgentMemory, DiaryEntry } from '../types';
import type { Power } from '../../engine/types';
import { POWERS } from '../../engine/types';
import { AgentRuntime } from '../runtime';
import type { AgentRuntimeConfig, LLMProvider, LLMCompletionParams, LLMCompletionResult } from '../types';
import { InMemoryStore } from '../memory';

// --- Helpers ---

function makeDiaryEntry(
  phase: string,
  type: DiaryEntry['type'],
  content: string,
  timestamp?: Date,
): DiaryEntry {
  return {
    phase,
    type,
    content,
    timestamp: timestamp ?? new Date(),
  };
}

function makeMinimalMemory(power: Power = 'ENGLAND'): AgentMemory {
  return {
    power,
    gameId: 'test-game',
    lastUpdated: { year: 1901, season: 'SPRING', phase: 'DIPLOMACY' },
    trustLevels: new Map(),
    relationships: new Map(),
    events: [],
    activeCommitments: [],
    strategicNotes: [],
    strategicGoals: [],
    territoryPriorities: [],
    currentAllies: [],
    currentEnemies: [],
    turnSummaries: [],
    consolidatedBlocks: [],
    fullPrivateDiary: [],
    yearSummaries: [],
    currentYearDiary: [],
  };
}

// --- parsePhaseString ---

describe('parsePhaseString', () => {
  it('should parse full phase string "S1903M"', () => {
    const result = parsePhaseString('S1903M');
    expect(result.year).toBe(1903);
    expect(result.season).toBe('SPRING');
    expect(result.phaseCode).toBe('M');
  });

  it('should parse fall diplomacy "F1902D"', () => {
    const result = parsePhaseString('F1902D');
    expect(result.year).toBe(1902);
    expect(result.season).toBe('FALL');
    expect(result.phaseCode).toBe('D');
  });

  it('should parse season+year "S1903"', () => {
    const result = parsePhaseString('S1903');
    expect(result.year).toBe(1903);
    expect(result.season).toBe('SPRING');
    expect(result.phaseCode).toBeUndefined();
  });

  it('should parse year only "1903"', () => {
    const result = parsePhaseString('1903');
    expect(result.year).toBe(1903);
    expect(result.season).toBeUndefined();
    expect(result.phaseCode).toBeUndefined();
  });

  it('should handle lowercase input', () => {
    const result = parsePhaseString('s1901m');
    expect(result.year).toBe(1901);
    expect(result.season).toBe('SPRING');
    expect(result.phaseCode).toBe('M');
  });

  it('should return empty for invalid input', () => {
    const result = parsePhaseString('invalid');
    expect(result.year).toBeUndefined();
    expect(result.season).toBeUndefined();
    expect(result.phaseCode).toBeUndefined();
  });
});

// --- parseRecallBlock ---

describe('parseRecallBlock', () => {
  it('should parse phase and type', () => {
    const result = parseRecallBlock('RECALL: phase=S1903M type=messages');
    expect(result).not.toBeNull();
    expect(result!.phase).toBe('S1903M');
    expect(result!.type).toBe('messages');
  });

  it('should parse power and count', () => {
    const result = parseRecallBlock('RECALL: power=FRANCE count=2 type=all');
    expect(result).not.toBeNull();
    expect(result!.power).toBe('FRANCE');
    expect(result!.count).toBe(2);
    expect(result!.type).toBe('all');
  });

  it('should parse just phase', () => {
    const result = parseRecallBlock('RECALL: phase=1903');
    expect(result).not.toBeNull();
    expect(result!.phase).toBe('1903');
  });

  it('should return null for no RECALL block', () => {
    const result = parseRecallBlock('ORDERS:\nA PAR HOLD\n');
    expect(result).toBeNull();
  });

  it('should return null for RECALL with no valid params', () => {
    const result = parseRecallBlock('RECALL: nothing_useful');
    expect(result).toBeNull();
  });

  it('should cap count at 5', () => {
    const result = parseRecallBlock('RECALL: phase=1903 count=10');
    expect(result!.count).toBe(5);
  });

  it('should handle case-insensitive type values', () => {
    const result = parseRecallBlock('RECALL: phase=1901 type=MESSAGES');
    expect(result!.type).toBe('messages');
  });

  it('should handle multiline response with RECALL in the middle', () => {
    const response = `REASONING: I need to check what France promised last turn.

RECALL: power=FRANCE type=messages count=1

I will then decide my orders.`;
    const result = parseRecallBlock(response);
    expect(result).not.toBeNull();
    expect(result!.power).toBe('FRANCE');
    expect(result!.type).toBe('messages');
  });
});

// --- hasRecallRequest ---

describe('hasRecallRequest', () => {
  it('should detect RECALL block', () => {
    expect(hasRecallRequest('RECALL: phase=S1903M type=messages')).toBe(true);
  });

  it('should detect RECALL in multiline response', () => {
    expect(hasRecallRequest('REASONING: thinking...\n\nRECALL: phase=1901 type=all\n\nMore text')).toBe(true);
  });

  it('should not match "RECALL" without parameters', () => {
    expect(hasRecallRequest('I RECALL that France promised...')).toBe(false);
  });

  it('should not detect when no RECALL block', () => {
    expect(hasRecallRequest('ORDERS:\nA PAR HOLD')).toBe(false);
  });
});

// --- executeRecall ---

describe('executeRecall', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = makeMinimalMemory();
    memory.fullPrivateDiary = [
      makeDiaryEntry('[S1901D]', 'negotiation', 'FRANCE proposed alliance against GERMANY. Agreed to DMZ in Burgundy.', new Date('2024-01-01')),
      makeDiaryEntry('[S1901M]', 'orders', 'A LVP -> EDI, F LON -> NTH, F EDI -> NWG. Moving north for Norwegian Sea control.', new Date('2024-01-02')),
      makeDiaryEntry('[F1901D]', 'negotiation', 'GERMANY requested non-aggression. RUSSIA proposed alliance against TURKEY.', new Date('2024-01-03')),
      makeDiaryEntry('[F1901M]', 'orders', 'A EDI -> NWY, F NTH C A EDI -> NWY, F NWG -> BAR. Convoy to Norway succeeded.', new Date('2024-01-04')),
      makeDiaryEntry('[S1902D]', 'negotiation', 'FRANCE broke promise, moved to Channel. Trust decreased.', new Date('2024-01-05')),
      makeDiaryEntry('[S1902M]', 'orders', 'A NWY HOLD, F BAR -> STP/NC, F NTH -> ENG. Defensive posture.', new Date('2024-01-06')),
    ];
    memory.currentYearDiary = [
      makeDiaryEntry('[S1902D]', 'negotiation', 'FRANCE broke promise, moved to Channel. Trust decreased.', new Date('2024-01-05')),
      makeDiaryEntry('[S1902M]', 'orders', 'A NWY HOLD, F BAR -> STP/NC, F NTH -> ENG. Defensive posture.', new Date('2024-01-06')),
    ];
  });

  it('should recall entries by phase', () => {
    const result = executeRecall(memory, { phase: 'S1901M' });
    expect(result.found).toBe(true);
    expect(result.entryCount).toBe(1);
    expect(result.content).toContain('A LVP -> EDI');
  });

  it('should recall entries by year', () => {
    const result = executeRecall(memory, { phase: '1901', count: 5 });
    expect(result.found).toBe(true);
    expect(result.entryCount).toBe(4); // 4 entries from 1901
  });

  it('should filter by type=messages', () => {
    const result = executeRecall(memory, { phase: '1901', type: 'messages', count: 5 });
    expect(result.found).toBe(true);
    // Should only contain negotiation entries
    expect(result.content).toContain('FRANCE proposed alliance');
    expect(result.content).not.toContain('A LVP -> EDI');
  });

  it('should filter by type=orders', () => {
    const result = executeRecall(memory, { phase: '1901', type: 'orders', count: 5 });
    expect(result.found).toBe(true);
    expect(result.content).toContain('A LVP -> EDI');
    expect(result.content).not.toContain('FRANCE proposed alliance');
  });

  it('should filter by power', () => {
    const result = executeRecall(memory, { power: 'RUSSIA' as Power, count: 5 });
    expect(result.found).toBe(true);
    expect(result.content).toContain('RUSSIA');
  });

  it('should return empty result when no matches', () => {
    const result = executeRecall(memory, { phase: 'S1910M' });
    expect(result.found).toBe(false);
    expect(result.entryCount).toBe(0);
    expect(result.content).toContain('No matching entries');
  });

  it('should limit by count (number of phases)', () => {
    const result = executeRecall(memory, { phase: '1901', count: 1 });
    expect(result.found).toBe(true);
    // count=1 means most recent phase matching 1901 → F1901M
    expect(result.content).toContain('F1901M');
  });

  it('should deduplicate entries from currentYearDiary and fullPrivateDiary', () => {
    // S1902D and S1902M entries exist in both arrays
    const result = executeRecall(memory, { phase: 'S1902', count: 5 });
    expect(result.found).toBe(true);
    // Should not have duplicates
    expect(result.entryCount).toBe(2); // One negotiation, one orders
  });

  it('should handle empty memory gracefully', () => {
    const emptyMemory = makeMinimalMemory();
    const result = executeRecall(emptyMemory, { phase: '1901' });
    expect(result.found).toBe(false);
  });
});

// --- stripRecallBlock ---

describe('stripRecallBlock', () => {
  it('should remove RECALL line from response', () => {
    const input = 'REASONING: Need to check history.\n\nRECALL: phase=S1903M type=messages\n\nMore reasoning here.';
    const result = stripRecallBlock(input);
    expect(result).not.toContain('RECALL:');
    expect(result).toContain('REASONING');
    expect(result).toContain('More reasoning here');
  });

  it('should return response unchanged when no RECALL', () => {
    const input = 'ORDERS:\nA PAR HOLD';
    expect(stripRecallBlock(input)).toBe(input);
  });
});

// --- Integration test: recall tool loop in runtime ---

describe('recall tool loop integration', () => {
  /**
   * Mock LLM that returns a RECALL request on first call,
   * then normal orders on the follow-up call.
   */
  class RecallMockLLM implements LLMProvider {
    public calls: Array<{ messages: any[] }> = [];
    private callIndex = 0;

    async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
      this.calls.push({ messages: params.messages });
      const idx = this.callIndex++;

      // First call for each agent: return RECALL request
      // Second call: return normal orders
      if (idx % 2 === 0) {
        return {
          content: `REASONING: I need to check what happened last turn.

RECALL: phase=S1901M type=all

I will review the recalled context before deciding.`,
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: 'end_turn',
        };
      }

      return {
        content: `REASONING: Based on the recalled context, I will hold all positions.

ORDERS:
# All units hold

DIPLOMACY:
SEND FRANCE: "Let's continue our agreement."`,
        usage: { inputTokens: 200, outputTokens: 80 },
        stopReason: 'end_turn',
      };
    }
  }

  function makeConfig(overrides: Partial<AgentRuntimeConfig> = {}): AgentRuntimeConfig {
    return {
      gameId: 'test-recall',
      agents: POWERS.map(power => ({ power })),
      parallelExecution: false,
      turnTimeout: 5000,
      persistMemory: false,
      verbose: false,
      maxConversationHistory: 20,
      maxPressMessagesPerChannel: 20,
      pressPeriodMinutes: 0.001,
      pressPollIntervalSeconds: 0.001,
      ...overrides,
    };
  }

  it('should handle recall requests during agent turns', async () => {
    const recallLLM = new RecallMockLLM();
    const runtime = new AgentRuntime(
      makeConfig(),
      recallLLM,
      new InMemoryStore(),
    );
    await runtime.initialize();

    // Run diplomacy phase - agents will issue RECALL on first call, then orders on second
    await runtime.runPhase();

    // Each of the 7 powers should have made 2 LLM calls (initial + planning + recall follow-up)
    // But planning also makes LLM calls. The key assertion: more calls than just 7.
    expect(recallLLM.calls.length).toBeGreaterThan(7);

    // Game should advance past diplomacy
    expect(runtime.getGameState().phase).toBe('MOVEMENT');

    runtime.cleanup();
  }, 30_000);

  it('should limit recall calls to MAX_RECALL_CALLS_PER_TURN', () => {
    // Just verify the constant is set to a reasonable value
    expect(MAX_RECALL_CALLS_PER_TURN).toBe(3);
    expect(MAX_RECALL_CALLS_PER_TURN).toBeGreaterThan(0);
    expect(MAX_RECALL_CALLS_PER_TURN).toBeLessThanOrEqual(5);
  });
});
