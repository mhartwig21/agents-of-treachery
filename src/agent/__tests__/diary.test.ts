/**
 * Tests for the agent diary consolidation system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Power } from '../../engine/types';
import type { AgentMemory, DiaryEntry, LLMProvider, ConversationMessage } from '../types';
import { createInitialMemory } from '../memory';
import {
  formatPhaseId,
  createDiaryEntry,
  addDiaryEntry,
  shouldConsolidateDiary,
  buildConsolidationPrompt,
  parseConsolidationResponse,
  consolidateDiary,
  getContextDiary,
  estimateDiaryTokens,
  recordNegotiation,
  recordOrders,
  recordReflection,
} from '../diary';

describe('Diary System', () => {
  let memory: AgentMemory;
  const power: Power = 'ENGLAND';

  beforeEach(() => {
    memory = createInitialMemory(power, 'test-game');
  });

  describe('formatPhaseId', () => {
    it('should format Spring Movement phase', () => {
      expect(formatPhaseId(1901, 'SPRING', 'MOVEMENT')).toBe('[S1901M]');
    });

    it('should format Fall Retreat phase', () => {
      expect(formatPhaseId(1902, 'FALL', 'RETREAT')).toBe('[F1902R]');
    });

    it('should format Winter Build phase', () => {
      expect(formatPhaseId(1903, 'WINTER', 'BUILD')).toBe('[W1903B]');
    });

    it('should format Diplomacy phase', () => {
      expect(formatPhaseId(1901, 'SPRING', 'DIPLOMACY')).toBe('[S1901D]');
    });
  });

  describe('createDiaryEntry', () => {
    it('should create a diary entry with correct fields', () => {
      const entry = createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Test content');

      expect(entry.phase).toBe('[S1901M]');
      expect(entry.type).toBe('orders');
      expect(entry.content).toBe('Test content');
      expect(entry.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('addDiaryEntry', () => {
    it('should add entry to both fullPrivateDiary and currentYearDiary', () => {
      const entry = createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Test content');

      addDiaryEntry(memory, entry);

      expect(memory.fullPrivateDiary).toHaveLength(1);
      expect(memory.currentYearDiary).toHaveLength(1);
      expect(memory.fullPrivateDiary[0]).toBe(entry);
      expect(memory.currentYearDiary[0]).toBe(entry);
    });

    it('should preserve fullPrivateDiary after consolidation prep', () => {
      // Add multiple entries
      for (let i = 0; i < 5; i++) {
        const entry = createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', `Entry ${i}`);
        addDiaryEntry(memory, entry);
      }

      expect(memory.fullPrivateDiary).toHaveLength(5);
      expect(memory.currentYearDiary).toHaveLength(5);
    });
  });

  describe('shouldConsolidateDiary', () => {
    it('should return true at end of year (Fall BUILD) with entries', () => {
      addDiaryEntry(memory, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Test'));

      expect(shouldConsolidateDiary(1901, 'FALL', 'BUILD', memory)).toBe(true);
    });

    it('should return true at Winter BUILD with entries', () => {
      addDiaryEntry(memory, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Test'));

      expect(shouldConsolidateDiary(1901, 'WINTER', 'BUILD', memory)).toBe(true);
    });

    it('should return false for non-BUILD phases', () => {
      addDiaryEntry(memory, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Test'));

      expect(shouldConsolidateDiary(1901, 'SPRING', 'MOVEMENT', memory)).toBe(false);
      expect(shouldConsolidateDiary(1901, 'FALL', 'MOVEMENT', memory)).toBe(false);
    });

    it('should return false for Spring BUILD phase', () => {
      addDiaryEntry(memory, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Test'));

      expect(shouldConsolidateDiary(1901, 'SPRING', 'BUILD', memory)).toBe(false);
    });

    it('should return false if no entries to consolidate', () => {
      expect(shouldConsolidateDiary(1901, 'FALL', 'BUILD', memory)).toBe(false);
    });

    it('should return false if year already consolidated', () => {
      addDiaryEntry(memory, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Test'));
      memory.yearSummaries.push({
        year: 1901,
        summary: 'Already consolidated',
        territorialChanges: [],
        diplomaticChanges: [],
        consolidatedAt: new Date(),
      });

      expect(shouldConsolidateDiary(1901, 'FALL', 'BUILD', memory)).toBe(false);
    });
  });

  describe('buildConsolidationPrompt', () => {
    it('should build a prompt with all entries', () => {
      const entries: DiaryEntry[] = [
        createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Moved to Belgium'),
        createDiaryEntry(1901, 'FALL', 'MOVEMENT', 'orders', 'Attacked France'),
      ];

      const prompt = buildConsolidationPrompt(1901, entries);

      expect(prompt).toContain('1901');
      expect(prompt).toContain('Moved to Belgium');
      expect(prompt).toContain('Attacked France');
      expect(prompt).toContain('[S1901M]');
      expect(prompt).toContain('[F1901M]');
    });
  });

  describe('parseConsolidationResponse', () => {
    it('should extract year summary from structured response', () => {
      const response = `SUMMARY: Gained Belgium and Holland. Alliance with France formed.
TERRITORIAL: Gained BEL, Gained HOL
DIPLOMATIC: Alliance with France`;
      const summary = parseConsolidationResponse(response, 1901);

      expect(summary.year).toBe(1901);
      expect(summary.summary).toContain('Gained Belgium and Holland');
      expect(summary.territorialChanges).toContain('Gained BEL');
      expect(summary.diplomaticChanges).toContain('Alliance with France');
    });

    it('should handle response without structured format', () => {
      const response = 'Expanded into Low Countries. Germany hostile.';
      const summary = parseConsolidationResponse(response, 1901);

      expect(summary.year).toBe(1901);
      expect(summary.summary).toBe('Expanded into Low Countries. Germany hostile.');
    });

    it('should handle empty territorial/diplomatic sections', () => {
      const response = `SUMMARY: Quiet year with no major changes.
TERRITORIAL: None
DIPLOMATIC: None`;
      const summary = parseConsolidationResponse(response, 1901);

      expect(summary.territorialChanges).toHaveLength(0);
      expect(summary.diplomaticChanges).toHaveLength(0);
    });
  });

  describe('consolidateDiary', () => {
    it('should create summary and clear currentYearDiary', async () => {
      // Add entries for 1901
      addDiaryEntry(memory, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Took Belgium'));
      addDiaryEntry(memory, createDiaryEntry(1901, 'FALL', 'MOVEMENT', 'orders', 'Took Holland'));

      // Mock LLM provider
      const mockLLM: LLMProvider = {
        async complete() {
          return {
            content: `SUMMARY: Expanded into Low Countries. Strong position.
TERRITORIAL: Gained BEL, Gained HOL
DIPLOMATIC: None`,
            usage: { inputTokens: 100, outputTokens: 20 },
            stopReason: 'end_turn',
          };
        },
      };

      const summary = await consolidateDiary(memory, 'ENGLAND', 1901, mockLLM);

      expect(summary.year).toBe(1901);
      expect(summary.summary).toContain('Low Countries');
      expect(memory.yearSummaries).toHaveLength(1);
      expect(memory.currentYearDiary).toHaveLength(0);
      // Full diary should still have entries plus consolidation entry
      expect(memory.fullPrivateDiary.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle LLM failure gracefully', async () => {
      addDiaryEntry(memory, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', 'Test'));

      const mockLLM: LLMProvider = {
        async complete() {
          throw new Error('LLM unavailable');
        },
      };

      const summary = await consolidateDiary(memory, 'ENGLAND', 1901, mockLLM);

      expect(summary.year).toBe(1901);
      expect(summary.summary).toContain('1901');
      expect(memory.yearSummaries).toHaveLength(1);
      expect(memory.currentYearDiary).toHaveLength(0);
    });

    it('should handle empty entries', async () => {
      const mockLLM: LLMProvider = {
        async complete() {
          return { content: '', usage: { inputTokens: 0, outputTokens: 0 } };
        },
      };

      const summary = await consolidateDiary(memory, 'ENGLAND', 1901, mockLLM);

      expect(summary.year).toBe(1901);
      expect(summary.summary).toContain('No significant events');
    });
  });

  describe('getContextDiary', () => {
    it('should return empty string for empty diary', () => {
      expect(getContextDiary(memory)).toBe('');
    });

    it('should format year summaries', () => {
      memory.yearSummaries.push({
        year: 1901,
        summary: 'Gained Belgium. Allied with France.',
        territorialChanges: ['Gained BEL'],
        diplomaticChanges: ['Alliance with France'],
        consolidatedAt: new Date(),
      });
      memory.yearSummaries.push({
        year: 1902,
        summary: 'Attacked Germany. Lost Holland.',
        territorialChanges: ['Lost HOL'],
        diplomaticChanges: ['War with Germany'],
        consolidatedAt: new Date(),
      });

      const context = getContextDiary(memory);

      expect(context).toContain('Past Years Summary');
      expect(context).toContain('Year 1901');
      expect(context).toContain('Year 1902');
      expect(context).toContain('Gained Belgium');
      expect(context).toContain('Attacked Germany');
    });

    it('should include current year entries', () => {
      addDiaryEntry(memory, createDiaryEntry(1903, 'SPRING', 'MOVEMENT', 'orders', 'Current turn orders'));

      const context = getContextDiary(memory);

      expect(context).toContain('Current Year Diary');
      expect(context).toContain('Current turn orders');
    });

    it('should limit current year entries to 10', () => {
      for (let i = 0; i < 15; i++) {
        addDiaryEntry(memory, createDiaryEntry(1903, 'SPRING', 'MOVEMENT', 'orders', `Entry ${i}`));
      }

      const context = getContextDiary(memory);

      expect(context).toContain('Entry 14'); // Most recent
      expect(context).toContain('Entry 5'); // 10th most recent
      expect(context).not.toContain('Entry 4'); // Older entries omitted
      expect(context).toContain('5 earlier entries');
    });
  });

  describe('estimateDiaryTokens', () => {
    it('should estimate tokens based on context length', () => {
      memory.yearSummaries.push({
        year: 1901,
        summary: 'Test summary with some content here.',
        territorialChanges: [],
        diplomaticChanges: [],
        consolidatedAt: new Date(),
      });

      const tokens = estimateDiaryTokens(memory);

      // Rough estimate: ~4 chars per token
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(100); // Should be small for this content
    });

    it('should return 0 for empty diary', () => {
      expect(estimateDiaryTokens(memory)).toBe(0);
    });
  });

  describe('convenience recording functions', () => {
    describe('recordNegotiation', () => {
      it('should record negotiation entry', () => {
        recordNegotiation(
          memory,
          1901,
          'SPRING',
          'DIPLOMACY',
          'Negotiated alliance with France'
        );

        expect(memory.currentYearDiary).toHaveLength(1);
        expect(memory.currentYearDiary[0].type).toBe('negotiation');
        expect(memory.currentYearDiary[0].content).toContain('Negotiated alliance');
      });
    });

    describe('recordOrders', () => {
      it('should record orders entry', () => {
        recordOrders(
          memory,
          1901,
          'SPRING',
          'MOVEMENT',
          'A LON -> NTH, F ENG -> BEL. Strategic expansion into Belgium.'
        );

        expect(memory.currentYearDiary).toHaveLength(1);
        expect(memory.currentYearDiary[0].type).toBe('orders');
        expect(memory.currentYearDiary[0].content).toContain('A LON -> NTH');
        expect(memory.currentYearDiary[0].content).toContain('Strategic expansion');
      });
    });

    describe('recordReflection', () => {
      it('should record reflection entry', () => {
        recordReflection(memory, 1901, 'FALL', 'MOVEMENT', 'The turn went well overall.');

        expect(memory.currentYearDiary).toHaveLength(1);
        expect(memory.currentYearDiary[0].type).toBe('reflection');
        expect(memory.currentYearDiary[0].content).toBe('The turn went well overall.');
      });
    });
  });

  describe('multi-year scenario', () => {
    it('should handle multi-year game with consolidation', async () => {
      const mockLLM: LLMProvider = {
        async complete({ messages }: { messages: ConversationMessage[] }) {
          // Extract year from the prompt
          const userMsg = messages.find(m => m.role === 'user');
          const yearMatch = userMsg?.content.match(/year (\d+)/);
          const year = yearMatch ? yearMatch[1] : 'unknown';
          return {
            content: `SUMMARY: Events of year ${year}.
TERRITORIAL: None
DIPLOMATIC: None`,
            usage: { inputTokens: 100, outputTokens: 20 },
          };
        },
      };

      // Year 1901
      addDiaryEntry(memory, createDiaryEntry(1901, 'SPRING', 'MOVEMENT', 'orders', '1901 Spring'));
      addDiaryEntry(memory, createDiaryEntry(1901, 'FALL', 'MOVEMENT', 'orders', '1901 Fall'));
      await consolidateDiary(memory, 'ENGLAND', 1901, mockLLM);

      // Year 1902
      addDiaryEntry(memory, createDiaryEntry(1902, 'SPRING', 'MOVEMENT', 'orders', '1902 Spring'));
      addDiaryEntry(memory, createDiaryEntry(1902, 'FALL', 'MOVEMENT', 'orders', '1902 Fall'));
      await consolidateDiary(memory, 'ENGLAND', 1902, mockLLM);

      // Verify state
      expect(memory.yearSummaries).toHaveLength(2);
      expect(memory.yearSummaries[0].year).toBe(1901);
      expect(memory.yearSummaries[1].year).toBe(1902);
      expect(memory.currentYearDiary).toHaveLength(0);
      // Full diary has original entries plus consolidation entries
      expect(memory.fullPrivateDiary.length).toBeGreaterThanOrEqual(4);

      // Verify context output
      const context = getContextDiary(memory);
      expect(context).toContain('Year 1901');
      expect(context).toContain('Year 1902');
    });
  });
});
