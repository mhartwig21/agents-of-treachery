/**
 * Tests for the strategic planning module.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildPlanningPrompt,
  parsePlanResponse,
  generateStrategicPlan,
  recordPlanInDiary,
  formatPlanForPrompt,
} from '../planning';
import { createInitialMemory, updateTrust } from '../memory';
import { createInitialState } from '../../engine/game';
import type { LLMProvider, StrategicPlan } from '../types';

describe('Strategic Planning', () => {
  describe('buildPlanningPrompt', () => {
    it('should build a prompt with board position and relationships', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');
      const gameState = createInitialState();

      const prompt = buildPlanningPrompt(
        'ENGLAND',
        1901,
        'SPRING',
        memory,
        gameState
      );

      expect(prompt).toContain('ENGLAND');
      expect(prompt).toContain('SPRING 1901');
      expect(prompt).toContain('STRATEGIC PLAN');
      expect(prompt).toContain('OBJECTIVES:');
      expect(prompt).toContain('DIPLOMATIC_STRATEGY:');
      expect(prompt).toContain('MILITARY_PLAN:');
      expect(prompt).toContain('CONTINGENCIES:');
    });

    it('should include unit positions', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');
      const gameState = createInitialState();

      const prompt = buildPlanningPrompt(
        'ENGLAND',
        1901,
        'SPRING',
        memory,
        gameState
      );

      // England starts with F LON, F EDI, A LVP
      expect(prompt).toContain('LON');
      expect(prompt).toContain('EDI');
      expect(prompt).toContain('LVP');
    });

    it('should include relationship context', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');
      updateTrust(memory, 'FRANCE', 0.6, 1901, 'SPRING');

      const gameState = createInitialState();

      const prompt = buildPlanningPrompt(
        'ENGLAND',
        1901,
        'SPRING',
        memory,
        gameState
      );

      expect(prompt).toContain('FRANCE');
      expect(prompt).toContain('Relationships');
    });

    it('should include previous plan if available', () => {
      const memory = createInitialMemory('ENGLAND', 'test-game');
      memory.currentTurnPlan = {
        power: 'ENGLAND',
        year: 1901,
        season: 'SPRING',
        objectives: ['Secure Norway', 'Alliance with France'],
        diplomaticStrategy: 'Propose Channel DMZ',
        militaryPlan: 'Move F LON -> NTH',
        contingencies: 'Fall back if France attacks',
        manifesto: 'test manifesto',
        timestamp: new Date(),
      };

      const gameState = createInitialState();

      const prompt = buildPlanningPrompt(
        'ENGLAND',
        1901,
        'FALL',
        memory,
        gameState
      );

      expect(prompt).toContain('Previous Turn Plan');
      expect(prompt).toContain('Secure Norway');
    });
  });

  describe('parsePlanResponse', () => {
    it('should parse a well-formatted response', () => {
      const response = `OBJECTIVES:
- Secure Norway via F NTH
- Form alliance with France against Germany
- Protect home waters

DIPLOMATIC_STRATEGY:
Propose to France a DMZ in the English Channel. Offer support into Belgium in exchange for French neutrality in the north. Approach Germany cautiously - gather intelligence on their intentions toward Holland.

MILITARY_PLAN:
Move F LON -> NTH to secure Norway in Fall. Move F EDI -> NWG for northern coverage. Hold A LVP for now - potential move to Yorkshire if Channel threatened.

CONTINGENCIES:
If France moves to ENG despite DMZ agreement, immediately ally with Germany. If Russia moves fleet south, accelerate Norway grab before they can contest.`;

      const plan = parsePlanResponse(response, 'ENGLAND', 1901, 'SPRING');

      expect(plan.power).toBe('ENGLAND');
      expect(plan.year).toBe(1901);
      expect(plan.season).toBe('SPRING');
      expect(plan.objectives).toHaveLength(3);
      expect(plan.objectives[0]).toContain('Norway');
      expect(plan.diplomaticStrategy).toContain('France');
      expect(plan.diplomaticStrategy).toContain('DMZ');
      expect(plan.militaryPlan).toContain('NTH');
      expect(plan.contingencies).toContain('France moves to ENG');
    });

    it('should handle missing sections with fallbacks', () => {
      const response = 'Some unstructured text without proper sections.';

      const plan = parsePlanResponse(response, 'FRANCE', 1901, 'SPRING');

      expect(plan.power).toBe('FRANCE');
      expect(plan.objectives.length).toBeGreaterThan(0);
      expect(plan.diplomaticStrategy).toBeTruthy();
      expect(plan.militaryPlan).toBeTruthy();
      expect(plan.contingencies).toBeTruthy();
    });

    it('should parse objectives with various bullet formats', () => {
      const response = `OBJECTIVES:
1. First objective
2. Second objective
* Third objective
- Fourth objective

DIPLOMATIC_STRATEGY:
Talk to everyone.

MILITARY_PLAN:
Hold everything.

CONTINGENCIES:
Run away.`;

      const plan = parsePlanResponse(response, 'GERMANY', 1901, 'SPRING');

      expect(plan.objectives).toHaveLength(4);
      expect(plan.objectives[0]).toBe('First objective');
      expect(plan.objectives[1]).toBe('Second objective');
      expect(plan.objectives[2]).toBe('Third objective');
      expect(plan.objectives[3]).toBe('Fourth objective');
    });

    it('should preserve the full manifesto text', () => {
      const response = `OBJECTIVES:
- Test objective

DIPLOMATIC_STRATEGY:
Test strategy.

MILITARY_PLAN:
Test plan.

CONTINGENCIES:
Test contingency.`;

      const plan = parsePlanResponse(response, 'ITALY', 1902, 'FALL');

      expect(plan.manifesto).toBe(response);
    });
  });

  describe('generateStrategicPlan', () => {
    it('should call LLM and return a parsed plan', async () => {
      const mockLLM: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          content: `OBJECTIVES:
- Secure Belgium
- Alliance with England

DIPLOMATIC_STRATEGY:
Propose Anglo-French alliance.

MILITARY_PLAN:
Move A PAR -> PIC, F BRE -> ENG.

CONTINGENCIES:
If England hostile, retreat to defensive line.`,
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
      };

      const memory = createInitialMemory('FRANCE', 'test-game');
      const gameState = createInitialState();

      const plan = await generateStrategicPlan(
        'FRANCE',
        1901,
        'SPRING',
        memory,
        gameState,
        mockLLM
      );

      expect(plan.power).toBe('FRANCE');
      expect(plan.objectives).toContain('Secure Belgium');
      expect(mockLLM.complete).toHaveBeenCalledOnce();
    });

    it('should return fallback plan on LLM failure', async () => {
      const mockLLM: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('LLM timeout')),
      };

      const memory = createInitialMemory('RUSSIA', 'test-game');
      const gameState = createInitialState();

      const plan = await generateStrategicPlan(
        'RUSSIA',
        1901,
        'SPRING',
        memory,
        gameState,
        mockLLM
      );

      expect(plan.power).toBe('RUSSIA');
      expect(plan.objectives.length).toBeGreaterThan(0);
      expect(plan.manifesto).toContain('Planning failed');
    });
  });

  describe('recordPlanInDiary', () => {
    it('should add a planning entry to the diary', () => {
      const memory = createInitialMemory('GERMANY', 'test-game');

      const plan: StrategicPlan = {
        power: 'GERMANY',
        year: 1901,
        season: 'SPRING',
        objectives: ['Secure Holland', 'Alliance with Russia'],
        diplomaticStrategy: 'Propose eastern alliance.',
        militaryPlan: 'Move to Holland and Denmark.',
        contingencies: 'Hold if threatened.',
        manifesto: 'test',
        timestamp: new Date(),
      };

      recordPlanInDiary(memory, plan);

      expect(memory.fullPrivateDiary).toHaveLength(1);
      expect(memory.fullPrivateDiary[0].type).toBe('planning');
      expect(memory.fullPrivateDiary[0].content).toContain('Secure Holland');
      expect(memory.currentYearDiary).toHaveLength(1);
    });
  });

  describe('formatPlanForPrompt', () => {
    it('should format plan as readable markdown', () => {
      const plan: StrategicPlan = {
        power: 'AUSTRIA',
        year: 1901,
        season: 'SPRING',
        objectives: ['Survive opening', 'Alliance with Russia'],
        diplomaticStrategy: 'Propose Russo-Austrian alliance against Turkey.',
        militaryPlan: 'Move to Serbia, hold Vienna.',
        contingencies: 'If Italy attacks, seek German help.',
        manifesto: 'test',
        timestamp: new Date(),
      };

      const formatted = formatPlanForPrompt(plan);

      expect(formatted).toContain('Strategic Plan');
      expect(formatted).toContain('Survive opening');
      expect(formatted).toContain('Alliance with Russia');
      expect(formatted).toContain('Russo-Austrian alliance');
      expect(formatted).toContain('Serbia');
      expect(formatted).toContain('If Italy attacks');
      expect(formatted).toContain('Execute this plan');
    });
  });
});
