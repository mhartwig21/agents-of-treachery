/**
 * Tests for game narrative report generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractNarrativeContext,
  generateBasicNarrative,
  formatNarrativeAsMarkdown,
  formatContextForLLM,
  NARRATIVE_SYSTEM_PROMPT,
  type NarrativeContext,
  type NarrativeEvent,
} from '../narrative';
import * as gameLogger from '../../server/game-logger';

// Mock game logs for testing
const mockGameLogs: gameLogger.GameLogEntry[] = [
  {
    timestamp: '2024-01-01T00:00:00.000Z',
    gameId: 'test-game',
    event: { type: 'game_started', gameId: 'test-game', name: 'Test Game', powers: ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'] },
  },
  {
    timestamp: '2024-01-01T00:01:00.000Z',
    gameId: 'test-game',
    event: { type: 'phase_started', phase: 'DIPLOMACY', year: 1901, season: 'SPRING' },
  },
  {
    timestamp: '2024-01-01T00:02:00.000Z',
    gameId: 'test-game',
    event: { type: 'message_sent', from: 'ENGLAND', to: 'FRANCE', preview: 'Let us form an alliance against Germany' },
  },
  {
    timestamp: '2024-01-01T00:03:00.000Z',
    gameId: 'test-game',
    event: {
      type: 'diary_entry',
      power: 'ENGLAND',
      model: 'test-model',
      year: 1901,
      season: 'SPRING',
      phase: 'DIPLOMACY',
      intentions: 'I will ally with France against Germany.',
      reasoning: 'Germany is a threat.',
      analysis: 'The board favors an early alliance.',
    },
  },
  {
    timestamp: '2024-01-01T00:04:00.000Z',
    gameId: 'test-game',
    event: { type: 'phase_resolved', phase: 'DIPLOMACY', year: 1901, season: 'SPRING' },
  },
  {
    timestamp: '2024-01-01T00:05:00.000Z',
    gameId: 'test-game',
    event: { type: 'phase_started', phase: 'DIPLOMACY', year: 1902, season: 'SPRING' },
  },
  {
    timestamp: '2024-01-01T00:06:00.000Z',
    gameId: 'test-game',
    event: {
      type: 'diary_entry',
      power: 'FRANCE',
      model: 'test-model',
      year: 1902,
      season: 'SPRING',
      phase: 'DIPLOMACY',
      intentions: 'I will betray England and attack the Channel.',
      reasoning: 'England has grown too powerful.',
      analysis: 'Time to stab.',
    },
  },
  {
    timestamp: '2024-01-01T00:07:00.000Z',
    gameId: 'test-game',
    event: {
      type: 'deception_detected',
      power: 'FRANCE',
      model: 'test-model',
      deceptionType: 'BROKEN_PROMISE',
      targets: ['ENGLAND'],
      year: 1902,
      season: 'SPRING',
      evidence: 'I will betray England and attack the Channel.',
      confidence: 0.9,
    },
  },
  {
    timestamp: '2024-01-01T00:08:00.000Z',
    gameId: 'test-game',
    event: { type: 'message_sent', from: 'FRANCE', to: 'ENGLAND', preview: 'I promise to support your move to Norway' },
  },
  {
    timestamp: '2024-01-01T00:09:00.000Z',
    gameId: 'test-game',
    event: { type: 'phase_started', phase: 'DIPLOMACY', year: 1905, season: 'FALL' },
  },
  {
    timestamp: '2024-01-01T00:10:00.000Z',
    gameId: 'test-game',
    event: { type: 'game_ended', gameId: 'test-game', winner: 'FRANCE' },
  },
];

describe('Narrative Generation', () => {
  beforeEach(() => {
    vi.spyOn(gameLogger, 'readGameLogs').mockReturnValue(mockGameLogs);
  });

  describe('extractNarrativeContext', () => {
    it('extracts basic game information', () => {
      const context = extractNarrativeContext('test-game');

      expect(context.gameId).toBe('test-game');
      expect(context.gameName).toBe('Test Game');
      expect(context.winner).toBe('FRANCE');
      expect(context.isDraw).toBe(false);
    });

    it('tracks final year and season', () => {
      const context = extractNarrativeContext('test-game');

      expect(context.finalYear).toBe(1905);
    });

    it('extracts narrative events from diary entries', () => {
      const context = extractNarrativeContext('test-game');

      // Should detect alliance formation from diary
      const allianceEvent = context.events.find(
        (e) => e.type === 'ALLIANCE_FORMED' && e.powers.includes('FRANCE')
      );
      expect(allianceEvent).toBeDefined();
    });

    it('extracts deception events', () => {
      const context = extractNarrativeContext('test-game');

      const deceptionEvent = context.events.find((e) => e.type === 'DECEPTION');
      expect(deceptionEvent).toBeDefined();
      expect(deceptionEvent?.powers).toContain('FRANCE');
      expect(deceptionEvent?.powers).toContain('ENGLAND');
    });

    it('extracts betrayal events from diary intentions', () => {
      const context = extractNarrativeContext('test-game');

      const betrayalEvent = context.events.find(
        (e) => e.type === 'BETRAYAL' && e.powers.includes('FRANCE')
      );
      expect(betrayalEvent).toBeDefined();
      expect(betrayalEvent?.description).toContain('betrayed');
    });

    it('collects game statistics', () => {
      const context = extractNarrativeContext('test-game');

      expect(context.stats.totalPhases).toBeGreaterThan(0);
      expect(context.stats.totalMessages).toBe(2);
      expect(context.stats.deceptionsDetected).toBe(1);
    });

    it('extracts memorable quotes from messages', () => {
      const context = extractNarrativeContext('test-game');

      expect(context.memorableQuotes.length).toBeGreaterThan(0);
      const allianceQuote = context.memorableQuotes.find((q) =>
        q.content.toLowerCase().includes('alliance')
      );
      expect(allianceQuote).toBeDefined();
    });

    it('throws error for missing game', () => {
      vi.spyOn(gameLogger, 'readGameLogs').mockReturnValue([]);

      expect(() => extractNarrativeContext('nonexistent')).toThrow(
        'No logs found for game: nonexistent'
      );
    });
  });

  describe('generateBasicNarrative', () => {
    it('generates a narrative report', () => {
      const context = extractNarrativeContext('test-game');
      const report = generateBasicNarrative(context);

      expect(report.gameId).toBe('test-game');
      expect(report.title).toBeTruthy();
      expect(report.narrative).toBeTruthy();
      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    it('includes game title mentioning winner', () => {
      const context = extractNarrativeContext('test-game');
      const report = generateBasicNarrative(context);

      expect(report.title).toContain('FRANCE');
    });

    it('generates narrative with sections', () => {
      const context = extractNarrativeContext('test-game');
      const report = generateBasicNarrative(context);

      expect(report.narrative).toContain('## ');
      expect(report.narrative).toContain('Conclusion');
    });

    it('includes statistics table', () => {
      const context = extractNarrativeContext('test-game');
      const report = generateBasicNarrative(context);

      expect(report.narrative).toContain('| Statistic | Value |');
    });

    it('includes final standings', () => {
      const context = extractNarrativeContext('test-game');
      const report = generateBasicNarrative(context);

      expect(report.narrative).toContain('Final Standings');
      expect(report.narrative).toContain('| Power |');
    });

    it('filters key events by importance', () => {
      const context = extractNarrativeContext('test-game');
      const report = generateBasicNarrative(context);

      // All key events should have high importance
      for (const event of report.keyEvents) {
        expect(event.importance).toBeGreaterThanOrEqual(0.7);
      }
    });
  });

  describe('formatNarrativeAsMarkdown', () => {
    it('formats report as valid markdown', () => {
      const context = extractNarrativeContext('test-game');
      const report = generateBasicNarrative(context);
      const markdown = formatNarrativeAsMarkdown(report);

      expect(markdown).toContain('# '); // Has title
      expect(markdown).toContain('*Generated on'); // Has timestamp
      expect(markdown).toContain(report.narrative);
    });
  });

  describe('formatContextForLLM', () => {
    it('formats context for LLM prompt', () => {
      const context = extractNarrativeContext('test-game');
      const formatted = formatContextForLLM(context);

      expect(formatted).toContain('# Game Context');
      expect(formatted).toContain('# Key Events');
      expect(formatted).toContain('# Final Standings');
      expect(formatted).toContain('FRANCE');
    });

    it('includes memorable quotes', () => {
      const context = extractNarrativeContext('test-game');
      const formatted = formatContextForLLM(context);

      expect(formatted).toContain('# Notable Diplomatic Messages');
    });

    it('includes statistics', () => {
      const context = extractNarrativeContext('test-game');
      const formatted = formatContextForLLM(context);

      expect(formatted).toContain('# Statistics');
      expect(formatted).toContain('phases played');
    });
  });

  describe('NARRATIVE_SYSTEM_PROMPT', () => {
    it('provides storytelling guidance', () => {
      expect(NARRATIVE_SYSTEM_PROMPT).toContain('storyteller');
      expect(NARRATIVE_SYSTEM_PROMPT).toContain('Diplomacy');
    });

    it('specifies structure requirements', () => {
      expect(NARRATIVE_SYSTEM_PROMPT).toContain('Opening');
      expect(NARRATIVE_SYSTEM_PROMPT).toContain('Conclusion');
    });

    it('specifies length guidelines', () => {
      expect(NARRATIVE_SYSTEM_PROMPT).toContain('800-1500 words');
    });
  });
});

describe('NarrativeEvent types', () => {
  it('supports all required event types', () => {
    const eventTypes: NarrativeEvent['type'][] = [
      'ALLIANCE_FORMED',
      'ALLIANCE_BROKEN',
      'BETRAYAL',
      'TERRITORY_GAINED',
      'TERRITORY_LOST',
      'ELIMINATION',
      'TURNING_POINT',
      'DIPLOMATIC_MESSAGE',
      'DECEPTION',
    ];

    // Just verify the types compile
    for (const type of eventTypes) {
      const event: NarrativeEvent = {
        year: 1901,
        season: 'SPRING',
        type,
        powers: ['ENGLAND'],
        description: 'test',
        importance: 0.5,
      };
      expect(event.type).toBe(type);
    }
  });
});

describe('Edge cases', () => {
  it('handles game with draw outcome', () => {
    const drawLogs: gameLogger.GameLogEntry[] = [
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        gameId: 'draw-game',
        event: { type: 'game_started', gameId: 'draw-game', name: 'Draw Game', powers: ['ENGLAND', 'FRANCE'] },
      },
      {
        timestamp: '2024-01-01T00:01:00.000Z',
        gameId: 'draw-game',
        event: { type: 'phase_started', phase: 'DIPLOMACY', year: 1901, season: 'SPRING' },
      },
      {
        timestamp: '2024-01-01T00:02:00.000Z',
        gameId: 'draw-game',
        event: { type: 'game_ended', gameId: 'draw-game', draw: true },
      },
    ];

    vi.spyOn(gameLogger, 'readGameLogs').mockReturnValue(drawLogs);

    const context = extractNarrativeContext('draw-game');
    expect(context.isDraw).toBe(true);
    expect(context.winner).toBeUndefined();

    const report = generateBasicNarrative(context);
    // Should mention draw/stalemate/no victor
    expect(
      report.narrative.includes('draw') ||
      report.narrative.includes('Stalemate') ||
      report.narrative.includes('no clear victor')
    ).toBe(true);
  });

  it('handles game with no messages', () => {
    const noMessagesLogs: gameLogger.GameLogEntry[] = [
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        gameId: 'quiet-game',
        event: { type: 'game_started', gameId: 'quiet-game', name: 'Quiet Game', powers: ['ENGLAND'] },
      },
      {
        timestamp: '2024-01-01T00:01:00.000Z',
        gameId: 'quiet-game',
        event: { type: 'phase_started', phase: 'DIPLOMACY', year: 1901, season: 'SPRING' },
      },
      {
        timestamp: '2024-01-01T00:02:00.000Z',
        gameId: 'quiet-game',
        event: { type: 'game_ended', gameId: 'quiet-game', winner: 'ENGLAND' },
      },
    ];

    vi.spyOn(gameLogger, 'readGameLogs').mockReturnValue(noMessagesLogs);

    const context = extractNarrativeContext('quiet-game');
    expect(context.stats.totalMessages).toBe(0);
    expect(context.memorableQuotes.length).toBe(0);

    const report = generateBasicNarrative(context);
    expect(report.narrative).toBeTruthy();
  });

  it('handles game with no deceptions', () => {
    const honestLogs: gameLogger.GameLogEntry[] = [
      {
        timestamp: '2024-01-01T00:00:00.000Z',
        gameId: 'honest-game',
        event: { type: 'game_started', gameId: 'honest-game', name: 'Honest Game', powers: ['ENGLAND'] },
      },
      {
        timestamp: '2024-01-01T00:01:00.000Z',
        gameId: 'honest-game',
        event: { type: 'phase_started', phase: 'DIPLOMACY', year: 1901, season: 'SPRING' },
      },
      {
        timestamp: '2024-01-01T00:02:00.000Z',
        gameId: 'honest-game',
        event: {
          type: 'diary_entry',
          power: 'ENGLAND',
          model: 'test',
          year: 1901,
          season: 'SPRING',
          phase: 'DIPLOMACY',
          intentions: 'I will be honest with everyone.',
          reasoning: 'Honesty is the best policy.',
          analysis: 'No need for deception.',
        },
      },
      {
        timestamp: '2024-01-01T00:03:00.000Z',
        gameId: 'honest-game',
        event: { type: 'game_ended', gameId: 'honest-game', winner: 'ENGLAND' },
      },
    ];

    vi.spyOn(gameLogger, 'readGameLogs').mockReturnValue(honestLogs);

    const context = extractNarrativeContext('honest-game');
    expect(context.stats.deceptionsDetected).toBe(0);
  });
});
