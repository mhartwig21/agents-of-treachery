/**
 * Tests for the phase reflection module.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildReflectionPrompt,
  parseReflectionResponse,
  generatePhaseReflection,
  applyReflectionToMemory,
  recordReflectionInDiary,
  formatReflectionForLog,
} from '../reflection';
import { createInitialMemory, updateTrust } from '../memory';
import type { Message } from '../../press/types';
import type { Order, OrderResolution } from '../../engine/types';
import type { LLMProvider, PhaseReflection } from '../types';

describe('Phase Reflection', () => {
  describe('buildReflectionPrompt', () => {
    it('should build a prompt with orders and messages', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');

      const ordersSubmitted = new Map<string, Order[]>([
        ['ENGLAND', [
          { type: 'MOVE', unit: 'LON', destination: 'NTH' },
          { type: 'MOVE', unit: 'EDI', destination: 'NWG' },
        ]],
        ['FRANCE', [
          { type: 'MOVE', unit: 'PAR', destination: 'BUR' },
          { type: 'MOVE', unit: 'BRE', destination: 'ENG' },
        ]],
      ]);

      const orderResults: OrderResolution[] = [
        { order: { type: 'MOVE', unit: 'LON', destination: 'NTH' }, success: true },
        { order: { type: 'MOVE', unit: 'EDI', destination: 'NWG' }, success: true },
      ];

      const messages: Message[] = [
        {
          id: 'msg-1',
          channelId: 'bilateral:ENGLAND:FRANCE',
          sender: 'FRANCE',
          content: 'I will stay out of the English Channel.',
          timestamp: new Date(),
        },
      ];

      const prompt = buildReflectionPrompt(
        'ENGLAND',
        1901,
        'SPRING',
        ordersSubmitted as any,
        orderResults,
        messages,
        memory
      );

      expect(prompt).toContain('ENGLAND');
      expect(prompt).toContain('SPRING 1901');
      expect(prompt).toContain('LON -> NTH');
      expect(prompt).toContain('FRANCE');
      expect(prompt).toContain('stay out of the English Channel');
      expect(prompt).toContain('TRUST_UPDATES:');
      expect(prompt).toContain('OBSERVATIONS:');
    });

    it('should include relationship status and trust level', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');
      updateTrust(memory, 'FRANCE', 0.5, 1901, 'SPRING');

      const ordersSubmitted = new Map<string, Order[]>([
        ['ENGLAND', []],
        ['FRANCE', []],
      ]);

      const prompt = buildReflectionPrompt(
        'ENGLAND',
        1901,
        'SPRING',
        ordersSubmitted as any,
        [],
        [],
        memory
      );

      expect(prompt).toContain('Current trust: 0.50');
      expect(prompt).toContain('High');
      expect(prompt).toContain('ALLY');
    });
  });

  describe('parseReflectionResponse', () => {
    it('should parse a well-formatted response', () => {
      const response = `TRUST_UPDATES:
FRANCE: -0.3 - Promised to stay out of ENG but moved there anyway
GERMANY: +0.1 - Honored DMZ agreement

OBSERVATIONS:
FRANCE: stay out of ENG => moved F BRE -> ENG | betrayal
GERMANY: nothing => held in MUN | neutral

STRATEGIC_SUMMARY:
France broke their promise about the English Channel. Germany remained passive as expected.`;

      const result = parseReflectionResponse(response, 'ENGLAND', 1901, 'SPRING');

      expect(result.power).toBe('ENGLAND');
      expect(result.year).toBe(1901);
      expect(result.season).toBe('SPRING');

      // Trust updates
      expect(result.trustUpdates).toHaveLength(2);
      expect(result.trustUpdates[0]).toEqual({
        power: 'FRANCE',
        delta: -0.3,
        reason: 'Promised to stay out of ENG but moved there anyway',
        isBetrayal: true,
      });
      expect(result.trustUpdates[1]).toEqual({
        power: 'GERMANY',
        delta: 0.1,
        reason: 'Honored DMZ agreement',
        isBetrayal: false,
      });

      // Observations
      expect(result.observations).toHaveLength(2);
      expect(result.observations[0]).toEqual({
        power: 'FRANCE',
        promised: 'stay out of ENG',
        actual: 'moved F BRE -> ENG',
        classification: 'betrayal',
      });
      expect(result.observations[1]).toEqual({
        power: 'GERMANY',
        promised: undefined,
        actual: 'held in MUN',
        classification: 'neutral',
      });

      // Summary
      expect(result.strategicSummary).toContain('France broke their promise');
    });

    it('should handle responses with no trust updates', () => {
      const response = `TRUST_UPDATES:

OBSERVATIONS:
FRANCE: nothing => held position | neutral

STRATEGIC_SUMMARY:
A quiet turn with no significant changes.`;

      const result = parseReflectionResponse(response, 'ENGLAND', 1901, 'SPRING');

      expect(result.trustUpdates).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      expect(result.strategicSummary).toContain('quiet turn');
    });

    it('should identify betrayals based on negative delta or keyword', () => {
      const response = `TRUST_UPDATES:
FRANCE: -0.5 - Attacked despite alliance
GERMANY: -0.1 - Minor coordination failure

OBSERVATIONS:

STRATEGIC_SUMMARY:
France betrayed us.`;

      const result = parseReflectionResponse(response, 'ENGLAND', 1901, 'SPRING');

      expect(result.trustUpdates[0].isBetrayal).toBe(true);
      expect(result.trustUpdates[1].isBetrayal).toBe(false);
    });

    it('should handle malformed responses gracefully', () => {
      const response = 'This is not a properly formatted response.';

      const result = parseReflectionResponse(response, 'ENGLAND', 1901, 'SPRING');

      expect(result.power).toBe('ENGLAND');
      expect(result.trustUpdates).toHaveLength(0);
      expect(result.observations).toHaveLength(0);
      expect(result.strategicSummary).toBe('SPRING 1901 reflection completed.');
    });

    it('should clamp trust delta values to valid range', () => {
      const response = `TRUST_UPDATES:
FRANCE: -5.0 - Extreme betrayal

OBSERVATIONS:

STRATEGIC_SUMMARY:
Major betrayal detected.`;

      const result = parseReflectionResponse(response, 'ENGLAND', 1901, 'SPRING');

      expect(result.trustUpdates[0].delta).toBe(-1);
    });
  });

  describe('generatePhaseReflection', () => {
    it('should generate reflection using LLM', async () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');

      const mockLLM: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: `TRUST_UPDATES:
FRANCE: -0.2 - Did not provide promised support

OBSERVATIONS:
FRANCE: support into BEL => held in PAR | betrayal

STRATEGIC_SUMMARY:
France failed to honor their commitment.`,
        }),
      };

      const ordersSubmitted = new Map<string, Order[]>([
        ['ENGLAND', [{ type: 'MOVE', unit: 'LON', destination: 'NTH' }]],
        ['FRANCE', [{ type: 'HOLD', unit: 'PAR' }]],
      ]) as any;

      const result = await generatePhaseReflection(
        'ENGLAND',
        1901,
        'SPRING',
        ordersSubmitted,
        [],
        [],
        memory,
        mockLLM
      );

      expect(mockLLM.complete).toHaveBeenCalledOnce();
      expect(result.power).toBe('ENGLAND');
      expect(result.trustUpdates).toHaveLength(1);
      expect(result.trustUpdates[0].power).toBe('FRANCE');
    });

    it('should handle LLM failure gracefully', async () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');

      const mockLLM: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      };

      const ordersSubmitted = new Map<string, Order[]>() as any;

      const result = await generatePhaseReflection(
        'ENGLAND',
        1901,
        'SPRING',
        ordersSubmitted,
        [],
        [],
        memory,
        mockLLM
      );

      expect(result.power).toBe('ENGLAND');
      expect(result.trustUpdates).toHaveLength(0);
      expect(result.strategicSummary).toContain('could not be completed');
    });
  });

  describe('applyReflectionToMemory', () => {
    it('should apply trust updates to memory', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');

      const reflection: PhaseReflection = {
        power: 'ENGLAND',
        year: 1901,
        season: 'SPRING',
        trustUpdates: [
          { power: 'FRANCE', delta: -0.3, reason: 'Betrayal', isBetrayal: true },
          { power: 'GERMANY', delta: 0.2, reason: 'Cooperation', isBetrayal: false },
        ],
        observations: [],
        strategicSummary: 'Test summary',
        timestamp: new Date(),
      };

      applyReflectionToMemory(memory, reflection);

      expect(memory.trustLevels.get('FRANCE')).toBe(-0.3);
      expect(memory.trustLevels.get('GERMANY')).toBe(0.2);
    });

    it('should record betrayal events in memory', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');

      const reflection: PhaseReflection = {
        power: 'ENGLAND',
        year: 1901,
        season: 'SPRING',
        trustUpdates: [
          { power: 'FRANCE', delta: -0.5, reason: 'Attacked English Channel', isBetrayal: true },
        ],
        observations: [],
        strategicSummary: 'Test summary',
        timestamp: new Date(),
      };

      applyReflectionToMemory(memory, reflection);

      expect(memory.events).toHaveLength(1);
      expect(memory.events[0].type).toBe('BETRAYAL');
      expect(memory.events[0].powers).toContain('FRANCE');
      expect(memory.events[0].description).toBe('Attacked English Channel');
    });

    it('should update ally/enemy status based on trust', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');

      const reflection: PhaseReflection = {
        power: 'ENGLAND',
        year: 1901,
        season: 'SPRING',
        trustUpdates: [
          { power: 'FRANCE', delta: -0.6, reason: 'Betrayal', isBetrayal: true },
          { power: 'GERMANY', delta: 0.6, reason: 'Strong cooperation', isBetrayal: false },
        ],
        observations: [],
        strategicSummary: 'Test summary',
        timestamp: new Date(),
      };

      applyReflectionToMemory(memory, reflection);

      expect(memory.currentEnemies).toContain('FRANCE');
      expect(memory.currentAllies).toContain('GERMANY');
    });

    it('should clamp trust values to valid range', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');
      // Set initial trust near boundary
      updateTrust(memory, 'FRANCE', 0.9, 1901, 'SPRING');

      const reflection: PhaseReflection = {
        power: 'ENGLAND',
        year: 1901,
        season: 'SPRING',
        trustUpdates: [
          { power: 'FRANCE', delta: 0.5, reason: 'More cooperation', isBetrayal: false },
        ],
        observations: [],
        strategicSummary: 'Test summary',
        timestamp: new Date(),
      };

      applyReflectionToMemory(memory, reflection);

      expect(memory.trustLevels.get('FRANCE')).toBe(1);
    });
  });

  describe('recordReflectionInDiary', () => {
    it('should add reflection entry to diary', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');

      const reflection: PhaseReflection = {
        power: 'ENGLAND',
        year: 1901,
        season: 'SPRING',
        trustUpdates: [
          { power: 'FRANCE', delta: -0.3, reason: 'Broken promise', isBetrayal: true },
        ],
        observations: [
          { power: 'FRANCE', promised: 'DMZ', actual: 'attacked', classification: 'betrayal' },
        ],
        strategicSummary: 'France betrayed our agreement.',
        timestamp: new Date(),
      };

      recordReflectionInDiary(memory, reflection);

      expect(memory.currentYearDiary).toHaveLength(1);
      expect(memory.currentYearDiary[0].type).toBe('reflection');
      expect(memory.currentYearDiary[0].content).toContain('FRANCE -0.30');
      expect(memory.currentYearDiary[0].content).toContain('BETRAYALS');
      expect(memory.currentYearDiary[0].content).toContain('France betrayed');
    });

    it('should handle reflection with no betrayals', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');

      const reflection: PhaseReflection = {
        power: 'ENGLAND',
        year: 1901,
        season: 'SPRING',
        trustUpdates: [
          { power: 'GERMANY', delta: 0.1, reason: 'Cooperation', isBetrayal: false },
        ],
        observations: [],
        strategicSummary: 'Peaceful turn.',
        timestamp: new Date(),
      };

      recordReflectionInDiary(memory, reflection);

      expect(memory.currentYearDiary).toHaveLength(1);
      expect(memory.currentYearDiary[0].content).not.toContain('BETRAYALS');
      expect(memory.currentYearDiary[0].content).toContain('GERMANY +0.10');
    });
  });

  describe('formatReflectionForLog', () => {
    it('should format reflection for console output', () => {
      const reflection: PhaseReflection = {
        power: 'ENGLAND',
        year: 1901,
        season: 'SPRING',
        trustUpdates: [
          { power: 'FRANCE', delta: -0.3, reason: 'Betrayal', isBetrayal: true },
        ],
        observations: [
          { power: 'FRANCE', actual: 'attacked', classification: 'betrayal' },
        ],
        strategicSummary: 'France betrayed us.',
        timestamp: new Date(),
      };

      const output = formatReflectionForLog(reflection);

      expect(output).toContain('[ENGLAND]');
      expect(output).toContain('SPRING 1901');
      expect(output).toContain('FRANCE: -0.30');
      expect(output).toContain('[BETRAYAL]');
      expect(output).toContain('France betrayed us');
    });
  });
});
