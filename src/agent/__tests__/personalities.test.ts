/**
 * Tests for personalities.ts — Power-specific personality configuration.
 *
 * Covers: POWER_PERSONALITIES, POWER_PERSONALITY_PROMPTS,
 * getPowerPersonality, getPowerPersonalityPrompt
 */

import { describe, it, expect } from 'vitest';
import { POWERS } from '../../engine/types';
import type { Power } from '../../engine/types';
import {
  POWER_PERSONALITIES,
  POWER_PERSONALITY_PROMPTS,
  getPowerPersonality,
  getPowerPersonalityPrompt,
} from '../personalities';

describe('POWER_PERSONALITIES', () => {
  it('should have entries for all 7 powers', () => {
    for (const power of POWERS) {
      expect(POWER_PERSONALITIES[power]).toBeDefined();
    }
  });

  it('should have all 6 personality traits for each power', () => {
    const traits = ['cooperativeness', 'aggression', 'patience', 'trustworthiness', 'paranoia', 'deceptiveness'] as const;

    for (const power of POWERS) {
      const p = POWER_PERSONALITIES[power];
      for (const trait of traits) {
        expect(p[trait]).toBeDefined();
        expect(typeof p[trait]).toBe('number');
      }
    }
  });

  it('should keep all trait values in 0-1 range', () => {
    for (const power of POWERS) {
      const p = POWER_PERSONALITIES[power];
      expect(p.cooperativeness).toBeGreaterThanOrEqual(0);
      expect(p.cooperativeness).toBeLessThanOrEqual(1);
      expect(p.aggression).toBeGreaterThanOrEqual(0);
      expect(p.aggression).toBeLessThanOrEqual(1);
      expect(p.patience).toBeGreaterThanOrEqual(0);
      expect(p.patience).toBeLessThanOrEqual(1);
      expect(p.trustworthiness).toBeGreaterThanOrEqual(0);
      expect(p.trustworthiness).toBeLessThanOrEqual(1);
      expect(p.paranoia).toBeGreaterThanOrEqual(0);
      expect(p.paranoia).toBeLessThanOrEqual(1);
      expect(p.deceptiveness).toBeGreaterThanOrEqual(0);
      expect(p.deceptiveness).toBeLessThanOrEqual(1);
    }
  });

  it('should give Russia higher patience than Germany', () => {
    expect(POWER_PERSONALITIES.RUSSIA.patience).toBeGreaterThan(POWER_PERSONALITIES.GERMANY.patience);
  });

  it('should give England higher trustworthiness than Italy', () => {
    expect(POWER_PERSONALITIES.ENGLAND.trustworthiness).toBeGreaterThan(POWER_PERSONALITIES.ITALY.trustworthiness);
  });

  it('should give Turkey higher paranoia than France', () => {
    expect(POWER_PERSONALITIES.TURKEY.paranoia).toBeGreaterThan(POWER_PERSONALITIES.FRANCE.paranoia);
  });
});

describe('POWER_PERSONALITY_PROMPTS', () => {
  it('should have entries for all 7 powers', () => {
    for (const power of POWERS) {
      expect(POWER_PERSONALITY_PROMPTS[power]).toBeDefined();
      expect(typeof POWER_PERSONALITY_PROMPTS[power]).toBe('string');
      expect(POWER_PERSONALITY_PROMPTS[power].length).toBeGreaterThan(100);
    }
  });

  it('should include communication style sections', () => {
    for (const power of POWERS) {
      const prompt = POWER_PERSONALITY_PROMPTS[power];
      expect(prompt).toContain('Communication Style');
      expect(prompt).toContain('Tone:');
      expect(prompt).toContain('Example Messages');
    }
  });

  it('should include example messages for proposing, declining, and warning', () => {
    for (const power of POWERS) {
      const prompt = POWER_PERSONALITY_PROMPTS[power];
      expect(prompt).toContain('Proposing alliance');
      expect(prompt).toContain('Declining');
      expect(prompt).toContain('Warning');
    }
  });

  it('should use distinctive language patterns per power', () => {
    // England should be formal and indirect
    expect(POWER_PERSONALITY_PROMPTS.ENGLAND).toContain('formal');

    // France should be warm and persuasive
    expect(POWER_PERSONALITY_PROMPTS.FRANCE).toContain('Warm');

    // Germany should be direct and businesslike
    expect(POWER_PERSONALITY_PROMPTS.GERMANY).toContain('Direct');

    // Italy should be subtle and opportunistic
    expect(POWER_PERSONALITY_PROMPTS.ITALY).toContain('cunning');

    // Austria should be earnest and alliance-focused
    expect(POWER_PERSONALITY_PROMPTS.AUSTRIA).toContain('sincere');

    // Russia should be measured and patient
    expect(POWER_PERSONALITY_PROMPTS.RUSSIA).toContain('patient');

    // Turkey should be proud and cautious
    expect(POWER_PERSONALITY_PROMPTS.TURKEY).toContain('Proud');
  });
});

describe('getPowerPersonality', () => {
  it('should return a copy, not a reference', () => {
    const p1 = getPowerPersonality('ENGLAND');
    const p2 = getPowerPersonality('ENGLAND');
    expect(p1).not.toBe(p2);
    expect(p1).toEqual(p2);
  });

  it('should return correct personality for each power', () => {
    for (const power of POWERS) {
      const p = getPowerPersonality(power);
      expect(p).toEqual(POWER_PERSONALITIES[power]);
    }
  });

  it('should allow mutation without affecting source', () => {
    const p = getPowerPersonality('FRANCE');
    p.aggression = 1.0;
    expect(POWER_PERSONALITIES.FRANCE.aggression).not.toBe(1.0);
  });
});

describe('getPowerPersonalityPrompt', () => {
  it('should return the prompt string for each power', () => {
    for (const power of POWERS) {
      const prompt = getPowerPersonalityPrompt(power);
      expect(prompt).toBe(POWER_PERSONALITY_PROMPTS[power]);
    }
  });

  it('should return non-empty strings', () => {
    for (const power of POWERS) {
      expect(getPowerPersonalityPrompt(power).length).toBeGreaterThan(0);
    }
  });
});
