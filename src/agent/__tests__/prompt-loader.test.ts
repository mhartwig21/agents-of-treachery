/**
 * Tests for the external prompt loader.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PromptLoader, getPromptLoader, setPromptLoader } from '../prompt-loader';

describe('PromptLoader', () => {
  const testPromptsDir = path.join(process.cwd(), 'prompts');

  describe('load', () => {
    it('loads a base prompt file', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      const content = loader.load('rules.md');

      expect(content).toContain('Diplomacy Game Rules');
      expect(content).toContain('Victory Condition');
    });

    it('loads a prompt with variable substitution', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      const content = loader.load('phases/movement.md', {
        unitList: 'A PAR, F BRE, A MAR',
        unitExamples: 'A PAR HOLD\nF BRE HOLD',
      });

      expect(content).toContain('A PAR, F BRE, A MAR');
      expect(content).toContain('A PAR HOLD');
    });

    it('preserves unmatched variables', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      const content = loader.load('phases/movement.md', {
        unitList: 'A PAR',
        // unitExamples not provided
      });

      expect(content).toContain('A PAR');
      expect(content).toContain('{{unitExamples}}');
    });
  });

  describe('loadPowerPersonality', () => {
    it('loads power personality from powers directory', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      const content = loader.loadPowerPersonality('ENGLAND');

      expect(content).toContain('British diplomacy');
      expect(content).toContain('island fortress');
    });

    it('loads personality for each power', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      const powers = ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'] as const;

      for (const power of powers) {
        const content = loader.loadPowerPersonality(power);
        expect(content.length).toBeGreaterThan(0);
      }
    });
  });

  describe('loadPowerStrategy', () => {
    it('loads power strategy from base/powers directory', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      const content = loader.loadPowerStrategy('ENGLAND');

      expect(content).toContain('England Strategy');
      expect(content).toContain('Strengths');
    });
  });

  describe('loadPhaseInstructions', () => {
    it('loads diplomacy phase instructions', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      const content = loader.loadPhaseInstructions('diplomacy');

      expect(content).toContain('Diplomacy Phase');
      expect(content).toContain('DIPLOMACY:');
    });

    it('loads movement phase instructions with variables', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      const content = loader.loadPhaseInstructions('movement', {
        unitList: 'A PAR, F BRE',
        unitExamples: 'A PAR HOLD\nF BRE -> ENG',
      });

      expect(content).toContain('Submit Orders');
      expect(content).toContain('A PAR, F BRE');
    });

    it('loads retreat phase instructions', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      const content = loader.loadPhaseInstructions('retreat');

      expect(content).toContain('Submit Retreats');
      expect(content).toContain('RETREATS:');
    });

    it('loads build phase instructions', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      const content = loader.loadPhaseInstructions('build', {
        buildCount: '2',
        availableLocations: 'PAR, BRE, MAR',
      });

      expect(content).toContain('Build Units');
      expect(content).toContain('2');
    });
  });

  describe('model family support', () => {
    it('defaults to base model family', () => {
      const loader = new PromptLoader({ promptsDir: testPromptsDir });
      expect(loader.getModelFamily()).toBe('base');
    });

    it('can be configured with a model family', () => {
      const loader = new PromptLoader({
        promptsDir: testPromptsDir,
        modelFamily: 'claude',
      });
      expect(loader.getModelFamily()).toBe('claude');
    });

    it('creates a new loader with different model family', () => {
      const baseLoader = new PromptLoader({ promptsDir: testPromptsDir });
      const claudeLoader = baseLoader.withModelFamily('claude');

      expect(baseLoader.getModelFamily()).toBe('base');
      expect(claudeLoader.getModelFamily()).toBe('claude');
    });

    it('falls back to base when model-specific file does not exist', () => {
      const loader = new PromptLoader({
        promptsDir: testPromptsDir,
        modelFamily: 'claude', // No claude-specific rules.md exists
      });
      const content = loader.load('rules.md');

      // Should still load from base/rules.md
      expect(content).toContain('Diplomacy Game Rules');
    });
  });

  describe('caching', () => {
    it('caches loaded prompts', () => {
      const loader = new PromptLoader({
        promptsDir: testPromptsDir,
        hotReload: false,
      });

      // Load twice
      const content1 = loader.load('rules.md');
      const content2 = loader.load('rules.md');

      expect(content1).toBe(content2);
    });

    it('clears cache when requested', () => {
      const loader = new PromptLoader({
        promptsDir: testPromptsDir,
        hotReload: false,
      });

      loader.load('rules.md');
      loader.clearCache();

      // Should reload from disk (we can't easily verify this without mocking fs)
      const content = loader.load('rules.md');
      expect(content).toContain('Diplomacy Game Rules');
    });
  });

  describe('default loader', () => {
    let originalLoader: ReturnType<typeof getPromptLoader> | null = null;

    beforeEach(() => {
      originalLoader = getPromptLoader();
    });

    afterEach(() => {
      setPromptLoader(originalLoader);
    });

    it('provides a default loader instance', () => {
      const loader = getPromptLoader();
      expect(loader).toBeInstanceOf(PromptLoader);
    });

    it('allows setting a custom default loader', () => {
      const customLoader = new PromptLoader({
        promptsDir: testPromptsDir,
        modelFamily: 'claude',
      });
      setPromptLoader(customLoader);

      expect(getPromptLoader()).toBe(customLoader);
    });
  });
});
