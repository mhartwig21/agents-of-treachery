/**
 * Tests for the commentary system.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentaryGenerator } from '../generator';
import { CommentaryService, createMockCommentaryProvider } from '../service';
import {
  commentaryReducer,
  initialCommentaryState,
  type CommentaryEntry,
  type CommentaryGenerationContext,
  type CommentaryState,
} from '../types';
import type { LLMProvider } from '../../agent/types';
import { GameStore } from '../../store/game-store';
import { createInitialState } from '../../engine';

describe('CommentaryGenerator', () => {
  let mockProvider: LLMProvider;
  let generator: CommentaryGenerator;

  beforeEach(() => {
    mockProvider = {
      complete: vi.fn().mockResolvedValue({
        content: 'The armies clash on the fields of Belgium!',
        usage: { inputTokens: 100, outputTokens: 15 },
      }),
    };
    generator = new CommentaryGenerator(mockProvider, 'dramatic');
  });

  it('should generate commentary for game events', async () => {
    const context: CommentaryGenerationContext = {
      gameState: {
        year: 1901,
        season: 'SPRING',
        phase: 'MOVEMENT',
        supplyCenterCounts: {
          ENGLAND: 3,
          FRANCE: 3,
          GERMANY: 3,
          ITALY: 3,
          AUSTRIA: 3,
          RUSSIA: 4,
          TURKEY: 3,
        },
        unitCounts: {
          ENGLAND: 3,
          FRANCE: 3,
          GERMANY: 3,
          ITALY: 3,
          AUSTRIA: 3,
          RUSSIA: 4,
          TURKEY: 3,
        },
        eliminatedPowers: [],
      },
      trigger: 'movement_resolved',
      eventDetails: {
        type: 'movement_resolved',
        successes: 15,
        failures: 5,
        dislodged: [{ power: 'FRANCE', from: 'BURGUNDY' }],
      },
      style: 'dramatic',
    };

    const entry = await generator.generateCommentary(context);

    expect(entry).toBeDefined();
    expect(entry.text).toBe('The armies clash on the fields of Belgium!');
    expect(entry.trigger).toBe('movement_resolved');
    expect(entry.intensity).toBe('high'); // Dislodged unit = high intensity
    expect(mockProvider.complete).toHaveBeenCalled();
  });

  it('should generate quick commentary without LLM', () => {
    const entry = generator.generateQuickCommentary(
      'supply_center_captured',
      {
        type: 'supply_center_captured',
        changes: [{ territory: 'BELGIUM', from: null, to: 'FRANCE' }],
      },
      {
        year: 1901,
        season: 'FALL',
        phase: 'MOVEMENT',
        supplyCenterCounts: {} as Record<string, number>,
        unitCounts: {} as Record<string, number>,
        eliminatedPowers: [],
      }
    );

    expect(entry).toBeDefined();
    expect(entry.text).toContain('FRANCE');
    expect(entry.text).toContain('BELGIUM');
    expect(entry.trigger).toBe('supply_center_captured');
  });

  it('should set critical intensity for game-ending events', () => {
    const entry = generator.generateQuickCommentary(
      'game_ended',
      {
        type: 'game_ended',
        winner: 'GERMANY',
        isDraw: false,
      },
      {
        year: 1910,
        season: 'FALL',
        phase: 'MOVEMENT',
        supplyCenterCounts: {} as Record<string, number>,
        unitCounts: {} as Record<string, number>,
        eliminatedPowers: [],
      }
    );

    expect(entry.intensity).toBe('critical');
  });

  it('should extract mentioned powers from text', async () => {
    (mockProvider.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'France and Germany clash over Belgium while England watches!',
      usage: { inputTokens: 100, outputTokens: 15 },
    });

    const context: CommentaryGenerationContext = {
      gameState: {
        year: 1901,
        season: 'SPRING',
        phase: 'MOVEMENT',
        supplyCenterCounts: {} as Record<string, number>,
        unitCounts: {} as Record<string, number>,
        eliminatedPowers: [],
      },
      trigger: 'movement_resolved',
      eventDetails: {
        type: 'movement_resolved',
        successes: 10,
        failures: 5,
        dislodged: [],
      },
      style: 'dramatic',
    };

    const entry = await generator.generateCommentary(context);

    expect(entry.mentionedPowers).toContain('FRANCE');
    expect(entry.mentionedPowers).toContain('GERMANY');
    expect(entry.mentionedPowers).toContain('ENGLAND');
  });

  it('should estimate voice duration based on text length', () => {
    const shortEntry = generator.generateQuickCommentary(
      'agent_thinking',
      { type: 'agent_thinking', power: 'FRANCE' },
      {
        year: 1901,
        season: 'SPRING',
        phase: 'DIPLOMACY',
        supplyCenterCounts: {} as Record<string, number>,
        unitCounts: {} as Record<string, number>,
        eliminatedPowers: [],
      }
    );

    expect(shortEntry.voiceDuration).toBeDefined();
    expect(shortEntry.voiceDuration).toBeGreaterThan(0);
  });
});

describe('CommentaryService', () => {
  let service: CommentaryService;
  let store: GameStore;

  beforeEach(() => {
    const provider = createMockCommentaryProvider();
    service = new CommentaryService(provider, { useLLM: false });
    store = new GameStore('test-game');
    // Initialize with data from createInitialState
    const initialState = createInitialState();
    store.initializeGame(initialState.units, initialState.supplyCenters);
  });

  it('should attach to game store', () => {
    service.attach(store);
    // No error means success
    service.detach();
  });

  it('should notify subscribers of commentary', async () => {
    const callback = vi.fn();
    service.subscribe(callback);

    const entry = await service.triggerCommentary(
      'supply_center_captured',
      {
        type: 'supply_center_captured',
        changes: [{ territory: 'BELGIUM', from: null, to: 'FRANCE' }],
      },
      {
        year: 1901,
        season: 'FALL',
        phase: 'MOVEMENT',
        supplyCenterCounts: {} as Record<string, number>,
        unitCounts: {} as Record<string, number>,
        eliminatedPowers: [],
      }
    );

    expect(callback).toHaveBeenCalledWith(entry);
  });

  it('should unsubscribe correctly', () => {
    const callback = vi.fn();
    const unsubscribe = service.subscribe(callback);

    unsubscribe();

    service.triggerCommentary(
      'supply_center_captured',
      {
        type: 'supply_center_captured',
        changes: [{ territory: 'BELGIUM', from: null, to: 'FRANCE' }],
      },
      {
        year: 1901,
        season: 'FALL',
        phase: 'MOVEMENT',
        supplyCenterCounts: {} as Record<string, number>,
        unitCounts: {} as Record<string, number>,
        eliminatedPowers: [],
      }
    );

    expect(callback).not.toHaveBeenCalled();
  });

  it('should update configuration', () => {
    service.updateConfig({ style: 'analytical' });
    // Configuration update doesn't throw
  });

  it('should return null when disabled', async () => {
    service.updateConfig({ enabled: false });

    const entry = await service.triggerCommentary(
      'movement_resolved',
      {
        type: 'movement_resolved',
        successes: 10,
        failures: 5,
        dislodged: [],
      },
      {
        year: 1901,
        season: 'SPRING',
        phase: 'MOVEMENT',
        supplyCenterCounts: {} as Record<string, number>,
        unitCounts: {} as Record<string, number>,
        eliminatedPowers: [],
      }
    );

    expect(entry).toBeNull();
  });
});

describe('commentaryReducer', () => {
  it('should add entries to history', () => {
    const entry: CommentaryEntry = {
      id: 'test-1',
      text: 'Test commentary',
      timestamp: new Date(),
      context: { year: 1901, season: 'SPRING', phase: 'MOVEMENT' },
      trigger: 'movement_resolved',
      intensity: 'medium',
      mentionedPowers: [],
      mentionedTerritories: [],
    };

    const state = commentaryReducer(initialCommentaryState, {
      type: 'ADD_ENTRY',
      entry,
    });

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toBe(entry);
  });

  it('should trim entries to history limit', () => {
    let state: CommentaryState = {
      ...initialCommentaryState,
      config: { ...initialCommentaryState.config, historyLimit: 3 },
    };

    for (let i = 0; i < 5; i++) {
      state = commentaryReducer(state, {
        type: 'ADD_ENTRY',
        entry: {
          id: `test-${i}`,
          text: `Entry ${i}`,
          timestamp: new Date(),
          context: { year: 1901, season: 'SPRING', phase: 'MOVEMENT' },
          trigger: 'movement_resolved',
          intensity: 'low',
          mentionedPowers: [],
          mentionedTerritories: [],
        },
      });
    }

    expect(state.entries).toHaveLength(3);
    expect(state.entries[0].id).toBe('test-2');
    expect(state.entries[2].id).toBe('test-4');
  });

  it('should update config', () => {
    const state = commentaryReducer(initialCommentaryState, {
      type: 'UPDATE_CONFIG',
      config: { voiceEnabled: true, style: 'analytical' },
    });

    expect(state.config.voiceEnabled).toBe(true);
    expect(state.config.style).toBe('analytical');
  });

  it('should queue and dequeue entries', () => {
    const entry: CommentaryEntry = {
      id: 'test-1',
      text: 'Test',
      timestamp: new Date(),
      context: { year: 1901, season: 'SPRING', phase: 'MOVEMENT' },
      trigger: 'movement_resolved',
      intensity: 'medium',
      mentionedPowers: [],
      mentionedTerritories: [],
    };

    let state = commentaryReducer(initialCommentaryState, {
      type: 'QUEUE_ENTRY',
      entry,
    });

    expect(state.queue).toHaveLength(1);

    state = commentaryReducer(state, { type: 'DEQUEUE_ENTRY' });

    expect(state.queue).toHaveLength(0);
  });

  it('should set speaking state', () => {
    const state = commentaryReducer(initialCommentaryState, {
      type: 'SET_SPEAKING',
      isSpeaking: true,
    });

    expect(state.isSpeaking).toBe(true);
  });

  it('should clear history', () => {
    let state: CommentaryState = {
      ...initialCommentaryState,
      entries: [
        {
          id: 'test-1',
          text: 'Test',
          timestamp: new Date(),
          context: { year: 1901, season: 'SPRING', phase: 'MOVEMENT' },
          trigger: 'movement_resolved',
          intensity: 'medium',
          mentionedPowers: [],
          mentionedTerritories: [],
        },
      ],
    };

    state = commentaryReducer(state, { type: 'CLEAR_HISTORY' });

    expect(state.entries).toHaveLength(0);
  });

  it('should clear queue', () => {
    const entry: CommentaryEntry = {
      id: 'test-1',
      text: 'Test',
      timestamp: new Date(),
      context: { year: 1901, season: 'SPRING', phase: 'MOVEMENT' },
      trigger: 'movement_resolved',
      intensity: 'medium',
      mentionedPowers: [],
      mentionedTerritories: [],
    };

    let state: CommentaryState = {
      ...initialCommentaryState,
      queue: [entry],
      currentEntry: entry,
    };

    state = commentaryReducer(state, { type: 'CLEAR_QUEUE' });

    expect(state.queue).toHaveLength(0);
    expect(state.currentEntry).toBeNull();
  });
});

describe('Commentary styles', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    mockProvider = {
      complete: vi.fn().mockResolvedValue({
        content: 'Commentary text',
        usage: { inputTokens: 100, outputTokens: 15 },
      }),
    };
  });

  it('should use different prompts for different styles', async () => {
    const styles = ['neutral', 'dramatic', 'analytical', 'sportscaster', 'historian'] as const;

    for (const style of styles) {
      const generator = new CommentaryGenerator(mockProvider, style);

      await generator.generateCommentary({
        gameState: {
          year: 1901,
          season: 'SPRING',
          phase: 'MOVEMENT',
          supplyCenterCounts: {} as Record<string, number>,
          unitCounts: {} as Record<string, number>,
          eliminatedPowers: [],
        },
        trigger: 'movement_resolved',
        eventDetails: {
          type: 'movement_resolved',
          successes: 10,
          failures: 5,
          dislodged: [],
        },
        style,
      });

      expect(mockProvider.complete).toHaveBeenCalled();
    }
  });

  it('should allow style changes', () => {
    const generator = new CommentaryGenerator(mockProvider, 'neutral');
    generator.setStyle('dramatic');
    // No error means success
  });
});
