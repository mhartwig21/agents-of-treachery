/**
 * Tests for game replay export.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameStore } from '../game-store';
import {
  exportGameReplay,
  serializeReplay,
  deserializeReplay,
  REPLAY_FORMAT_VERSION,
} from '../replay-exporter';
import type { GameReplay } from '../replay-exporter';
import type { Unit, Power, Order } from '../../engine/types';
import type { DiaryEntry, YearSummary } from '../../agent/types';

describe('GameReplayExporter', () => {
  let store: GameStore;

  const initialUnits: Unit[] = [
    { type: 'FLEET', power: 'ENGLAND', province: 'LON' },
    { type: 'FLEET', power: 'ENGLAND', province: 'EDI' },
    { type: 'ARMY', power: 'ENGLAND', province: 'LVP' },
    { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
    { type: 'ARMY', power: 'FRANCE', province: 'MAR' },
    { type: 'FLEET', power: 'FRANCE', province: 'BRE' },
  ];

  const initialSupplyCenters = new Map<string, Power>([
    ['LON', 'ENGLAND'],
    ['EDI', 'ENGLAND'],
    ['LVP', 'ENGLAND'],
    ['PAR', 'FRANCE'],
    ['MAR', 'FRANCE'],
    ['BRE', 'FRANCE'],
  ]);

  beforeEach(() => {
    store = new GameStore('test-game');
    store.initializeGame(initialUnits, initialSupplyCenters);
  });

  describe('exportGameReplay', () => {
    it('should export a game with correct metadata', () => {
      store.endGame('ENGLAND', false, 1905);

      const replay = exportGameReplay(store);

      expect(replay.metadata.formatVersion).toBe(REPLAY_FORMAT_VERSION);
      expect(replay.metadata.gameId).toBe('test-game');
      expect(replay.metadata.startYear).toBe(1901);
      expect(replay.metadata.endYear).toBe(1905);
      expect(replay.metadata.winner).toBe('ENGLAND');
      expect(replay.metadata.isDraw).toBe(false);
      expect(replay.metadata.variant).toBe('standard');
      expect(replay.metadata.exportedAt).toBeTruthy();
    });

    it('should export a draw game', () => {
      store.endGame(undefined, true, 1910);

      const replay = exportGameReplay(store);

      expect(replay.metadata.winner).toBeUndefined();
      expect(replay.metadata.isDraw).toBe(true);
      expect(replay.metadata.endYear).toBe(1910);
    });

    it('should build phases from movement resolution events', () => {
      const orders: Order[] = [
        { type: 'MOVE', unit: 'EDI', destination: 'NTH' },
        { type: 'HOLD', unit: 'LON' },
        { type: 'MOVE', unit: 'LVP', destination: 'YOR' },
      ];
      store.submitOrders('ENGLAND', orders, 1901, 'SPRING');
      store.submitOrders('FRANCE', [
        { type: 'MOVE', unit: 'PAR', destination: 'BUR' },
        { type: 'HOLD', unit: 'MAR' },
        { type: 'MOVE', unit: 'BRE', destination: 'MAO' },
      ], 1901, 'SPRING');

      store.resolveMovement(
        1901, 'SPRING',
        [
          { order: { type: 'MOVE', unit: 'EDI', destination: 'NTH' }, success: true },
          { order: { type: 'HOLD', unit: 'LON' }, success: true },
          { order: { type: 'MOVE', unit: 'LVP', destination: 'YOR' }, success: true },
          { order: { type: 'MOVE', unit: 'PAR', destination: 'BUR' }, success: true },
          { order: { type: 'HOLD', unit: 'MAR' }, success: true },
          { order: { type: 'MOVE', unit: 'BRE', destination: 'MAO' }, success: true },
        ],
        [
          { power: 'ENGLAND', from: 'EDI', to: 'NTH' },
          { power: 'ENGLAND', from: 'LVP', to: 'YOR' },
          { power: 'FRANCE', from: 'PAR', to: 'BUR' },
          { power: 'FRANCE', from: 'BRE', to: 'MAO' },
        ],
        []
      );

      const replay = exportGameReplay(store);

      expect(replay.phases).toHaveLength(1);
      const phase = replay.phases[0];
      expect(phase.year).toBe(1901);
      expect(phase.season).toBe('SPRING');
      expect(phase.phase).toBe('MOVEMENT');
      expect(phase.orders['ENGLAND']).toHaveLength(3);
      expect(phase.orders['FRANCE']).toHaveLength(3);
      expect(phase.results).toBeDefined();
      expect(phase.results).toHaveLength(6);
    });

    it('should include dislodged units in phases', () => {
      store.submitOrders('FRANCE', [
        { type: 'HOLD', unit: 'PAR' },
      ], 1901, 'SPRING');

      store.resolveMovement(
        1901, 'SPRING',
        [{ order: { type: 'HOLD', unit: 'PAR' }, success: false }],
        [],
        [{
          unit: { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
          dislodgedFrom: 'BUR',
          retreatOptions: ['PIC', 'GAS'],
        }]
      );

      const replay = exportGameReplay(store);
      const phase = replay.phases[0];

      expect(phase.dislodged).toBeDefined();
      expect(phase.dislodged).toHaveLength(1);
      expect(phase.dislodged![0].unit.power).toBe('FRANCE');
      expect(phase.dislodged![0].retreatOptions).toContain('PIC');
    });

    it('should include builds and disbands', () => {
      store.resolveBuilds(
        1901,
        [{ power: 'ENGLAND', province: 'LON', unitType: 'FLEET' }],
        [{ power: 'FRANCE', province: 'MAR' }]
      );

      const replay = exportGameReplay(store);
      const buildPhase = replay.phases.find(p => p.phase === 'BUILD');

      expect(buildPhase).toBeDefined();
      expect(buildPhase!.builds).toHaveLength(1);
      expect(buildPhase!.builds![0].power).toBe('ENGLAND');
      expect(buildPhase!.builds![0].unitType).toBe('FLEET');
      expect(buildPhase!.disbands).toHaveLength(1);
      expect(buildPhase!.disbands![0].power).toBe('FRANCE');
    });

    it('should track supply center changes', () => {
      store.captureSupplyCenters(1901, 'FALL', [
        { territory: 'BEL', from: null, to: 'ENGLAND' },
        { territory: 'SPA', from: null, to: 'FRANCE' },
      ]);

      store.resolveMovement(
        1901, 'FALL',
        [],
        [],
        []
      );

      const replay = exportGameReplay(store);
      const fallPhase = replay.phases[0];

      expect(fallPhase.supplyCenters['BEL']).toBe('ENGLAND');
      expect(fallPhase.supplyCenters['SPA']).toBe('FRANCE');
    });
  });

  describe('messages', () => {
    it('should include messages by default', () => {
      store.recordMessage('msg-1', 'bilateral:ENGLAND:FRANCE', 'ENGLAND', 'Let us ally');
      store.recordMessage('msg-2', 'bilateral:ENGLAND:FRANCE', 'FRANCE', 'Agreed');

      const replay = exportGameReplay(store);

      expect(replay.messages).toHaveLength(2);
      expect(replay.messages[0].sender).toBe('ENGLAND');
      expect(replay.messages[0].content).toBe('Let us ally');
      expect(replay.messages[1].sender).toBe('FRANCE');
    });

    it('should exclude messages when option is false', () => {
      store.recordMessage('msg-1', 'bilateral:ENGLAND:FRANCE', 'ENGLAND', 'Secret');

      const replay = exportGameReplay(store, { includeMessages: false });

      expect(replay.messages).toHaveLength(0);
    });

    it('should filter messages by power', () => {
      store.recordMessage('msg-1', 'bilateral:ENGLAND:FRANCE', 'ENGLAND', 'From England');
      store.recordMessage('msg-2', 'bilateral:ENGLAND:FRANCE', 'FRANCE', 'From France');
      store.recordMessage('msg-3', 'bilateral:GERMANY:FRANCE', 'GERMANY', 'From Germany');

      const replay = exportGameReplay(store, { messagePowerFilter: ['ENGLAND'] });

      expect(replay.messages).toHaveLength(1);
      expect(replay.messages[0].sender).toBe('ENGLAND');
    });
  });

  describe('agent reasoning', () => {
    it('should include agent reasoning when provided', () => {
      const agentData = new Map<Power, { diary: DiaryEntry[]; yearSummaries: YearSummary[] }>();
      agentData.set('ENGLAND', {
        diary: [
          {
            phase: '[S1901M]',
            type: 'negotiation',
            content: 'Proposed alliance with France',
            timestamp: new Date(),
          },
          {
            phase: '[S1901M]',
            type: 'orders',
            content: 'Moving fleet to North Sea',
            timestamp: new Date(),
          },
        ],
        yearSummaries: [
          {
            year: 1901,
            summary: 'Strong opening, allied with France',
            territorialChanges: ['Gained BEL'],
            diplomaticChanges: ['Alliance with France'],
            consolidatedAt: new Date(),
          },
        ],
      });

      const replay = exportGameReplay(store, { includeAgentReasoning: true }, agentData);

      expect(replay.agentReasoning).toBeDefined();
      expect(replay.agentReasoning!['ENGLAND']).toBeDefined();
      expect(replay.agentReasoning!['ENGLAND'].fullDiary).toHaveLength(2);
      expect(replay.agentReasoning!['ENGLAND'].yearSummaries).toHaveLength(1);
      expect(replay.agentReasoning!['ENGLAND'].yearSummaries[0].summary).toBe(
        'Strong opening, allied with France'
      );
    });

    it('should exclude agent reasoning when option is false', () => {
      const agentData = new Map<Power, { diary: DiaryEntry[]; yearSummaries: YearSummary[] }>();
      agentData.set('ENGLAND', { diary: [], yearSummaries: [] });

      const replay = exportGameReplay(store, { includeAgentReasoning: false }, agentData);

      expect(replay.agentReasoning).toBeUndefined();
    });

    it('should omit agent reasoning when no data provided', () => {
      const replay = exportGameReplay(store);

      expect(replay.agentReasoning).toBeUndefined();
    });
  });

  describe('serialization', () => {
    it('should round-trip through JSON serialization', () => {
      store.submitOrders('ENGLAND', [
        { type: 'MOVE', unit: 'EDI', destination: 'NTH' },
      ], 1901, 'SPRING');

      store.resolveMovement(
        1901, 'SPRING',
        [{ order: { type: 'MOVE', unit: 'EDI', destination: 'NTH' }, success: true }],
        [{ power: 'ENGLAND', from: 'EDI', to: 'NTH' }],
        []
      );

      store.recordMessage('msg-1', 'global', 'ENGLAND', 'Hello world');
      store.endGame('ENGLAND', false, 1905);

      const replay = exportGameReplay(store);
      const json = serializeReplay(replay);
      const restored = deserializeReplay(json);

      expect(restored.metadata.gameId).toBe('test-game');
      expect(restored.metadata.winner).toBe('ENGLAND');
      expect(restored.phases).toHaveLength(1);
      expect(restored.messages).toHaveLength(1);
      expect(restored.messages[0].content).toBe('Hello world');
    });

    it('should produce valid JSON', () => {
      store.endGame(undefined, true, 1901);

      const replay = exportGameReplay(store);
      const json = serializeReplay(replay);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should reject unsupported format versions', () => {
      const futureReplay: GameReplay = {
        metadata: {
          formatVersion: 999,
          exportedAt: new Date().toISOString(),
          gameId: 'test',
          startYear: 1901,
          endYear: 1901,
          isDraw: false,
          totalPhases: 0,
          totalMessages: 0,
          variant: 'standard',
        },
        phases: [],
        messages: [],
      };

      const json = JSON.stringify(futureReplay);

      expect(() => deserializeReplay(json)).toThrow('Unsupported replay format version 999');
    });

    it('should reject invalid format without version', () => {
      const json = JSON.stringify({ metadata: {} });

      expect(() => deserializeReplay(json)).toThrow('missing metadata.formatVersion');
    });
  });

  describe('phase counting', () => {
    it('should count phases in metadata', () => {
      // Two movement phases
      store.submitOrders('ENGLAND', [{ type: 'HOLD', unit: 'LON' }], 1901, 'SPRING');
      store.resolveMovement(1901, 'SPRING', [
        { order: { type: 'HOLD', unit: 'LON' }, success: true },
      ], [], []);

      store.advancePhase(1901, 'SPRING', 'MOVEMENT', 1901, 'FALL', 'DIPLOMACY');

      store.submitOrders('ENGLAND', [{ type: 'HOLD', unit: 'LON' }], 1901, 'FALL');
      store.resolveMovement(1901, 'FALL', [
        { order: { type: 'HOLD', unit: 'LON' }, success: true },
      ], [], []);

      const replay = exportGameReplay(store);

      expect(replay.metadata.totalPhases).toBe(2);
      expect(replay.phases).toHaveLength(2);
    });
  });

  describe('support and convoy orders', () => {
    it('should export support orders correctly', () => {
      const supportOrder: Order = {
        type: 'SUPPORT',
        unit: 'LON',
        supportedUnit: 'EDI',
        destination: 'NTH',
      };
      store.submitOrders('ENGLAND', [supportOrder], 1901, 'SPRING');

      store.resolveMovement(1901, 'SPRING', [
        { order: supportOrder, success: true },
      ], [], []);

      const replay = exportGameReplay(store);
      const phase = replay.phases[0];
      const engOrders = phase.orders['ENGLAND'];

      expect(engOrders).toHaveLength(1);
      expect(engOrders[0].type).toBe('SUPPORT');
      expect(engOrders[0].supportedUnit).toBe('EDI');
      expect(engOrders[0].supportDestination).toBe('NTH');
    });

    it('should export convoy orders correctly', () => {
      const convoyOrder: Order = {
        type: 'CONVOY',
        unit: 'LON',
        convoyedUnit: 'LVP',
        destination: 'BEL',
      };
      store.submitOrders('ENGLAND', [convoyOrder], 1901, 'SPRING');

      store.resolveMovement(1901, 'SPRING', [
        { order: convoyOrder, success: true },
      ], [], []);

      const replay = exportGameReplay(store);
      const engOrders = replay.phases[0].orders['ENGLAND'];

      expect(engOrders[0].type).toBe('CONVOY');
      expect(engOrders[0].convoyedUnit).toBe('LVP');
      expect(engOrders[0].destination).toBe('BEL');
    });
  });

  describe('game without end event', () => {
    it('should handle games that have not ended', () => {
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1903, 'FALL', 'MOVEMENT');

      const replay = exportGameReplay(store);

      expect(replay.metadata.endYear).toBe(1903);
      expect(replay.metadata.winner).toBeUndefined();
      expect(replay.metadata.isDraw).toBe(false);
    });
  });
});
