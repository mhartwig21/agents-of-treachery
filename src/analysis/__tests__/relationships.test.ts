/**
 * Tests for the ActionRelationshipEngine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ActionRelationshipEngine,
  createRelationshipEngine,
} from '../relationships';
import type { Power, Order, SupportOrder, MoveOrder, ConvoyOrder } from '../../engine/types';
import type { MovementResolvedEvent, SupplyCentersCapturedEvent } from '../../store/events';

describe('ActionRelationshipEngine', () => {
  let engine: ActionRelationshipEngine;

  beforeEach(() => {
    engine = createRelationshipEngine();
  });

  describe('initialization', () => {
    it('should start with neutral relationships', () => {
      const rel = engine.getRelationship('ENGLAND', 'FRANCE');
      expect(rel.score).toBe(0);
      expect(rel.status).toBe('neutral');
      expect(rel.betrayalDetected).toBe(false);
      expect(rel.recentActions).toEqual([]);
    });

    it('should have relationships for all power pairs', () => {
      const all = engine.getAllRelationships();
      // 7 powers = 21 pairs (7 choose 2)
      expect(all.length).toBe(21);
    });
  });

  describe('support analysis', () => {
    it('should detect direct support as positive signal', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
        ['PIC', 'FRANCE'],
      ]);

      const orders: Order[] = [
        { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
        { type: 'MOVE', unit: 'BRE', destination: 'PIC' } as MoveOrder,
      ];

      const results: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: orders[0], success: true },
            { order: orders[1], success: true },
          ],
          unitMoves: [],
          dislodged: [],
        },
      };

      engine.processTurn(orders, results, null, unitsByProvince);

      const rel = engine.getRelationship('ENGLAND', 'FRANCE');
      expect(rel.score).toBeGreaterThan(0);
      expect(rel.recentActions.length).toBe(1);
      expect(rel.recentActions[0].type).toBe('DIRECT_SUPPORT');
    });

    it('should not count failed supports', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
      ]);

      const orders: Order[] = [
        { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
      ];

      const results: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: orders[0], success: false, reason: 'Support cut' },
          ],
          unitMoves: [],
          dislodged: [],
        },
      };

      engine.processTurn(orders, results, null, unitsByProvince);

      const rel = engine.getRelationship('ENGLAND', 'FRANCE');
      expect(rel.score).toBe(0);
    });
  });

  describe('attack analysis', () => {
    it('should detect attacks as negative signal', () => {
      const unitsByProvince = new Map<string, Power>([
        ['PAR', 'FRANCE'],
        ['BUR', 'GERMANY'],
      ]);

      const orders: Order[] = [
        { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      ];

      const results: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: orders[0], success: false, reason: 'Bounced' },
          ],
          unitMoves: [],
          dislodged: [],
        },
      };

      engine.processTurn(orders, results, null, unitsByProvince);

      const rel = engine.getRelationship('FRANCE', 'GERMANY');
      expect(rel.score).toBeLessThan(0);
      expect(rel.recentActions.some(a => a.type === 'ATTACK')).toBe(true);
    });

    it('should detect blocked moves', () => {
      const unitsByProvince = new Map<string, Power>([
        ['PAR', 'FRANCE'],
        ['BUR', 'GERMANY'],
      ]);

      const orders: Order[] = [
        { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      ];

      const results: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: orders[0], success: false, reason: 'Bounced' },
          ],
          unitMoves: [],
          dislodged: [],
        },
      };

      engine.processTurn(orders, results, null, unitsByProvince);

      const rel = engine.getRelationship('FRANCE', 'GERMANY');
      expect(rel.recentActions.some(a => a.type === 'BLOCKED_MOVE')).toBe(true);
    });
  });

  describe('convoy analysis', () => {
    it('should detect successful convoys as positive signal', () => {
      const unitsByProvince = new Map<string, Power>([
        ['ENG', 'ENGLAND'],
        ['LON', 'FRANCE'],
      ]);

      const orders: Order[] = [
        { type: 'CONVOY', unit: 'ENG', convoyedUnit: 'LON', destination: 'BEL' } as ConvoyOrder,
        { type: 'MOVE', unit: 'LON', destination: 'BEL', viaConvoy: true } as MoveOrder,
      ];

      const results: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: orders[0], success: true },
            { order: orders[1], success: true },
          ],
          unitMoves: [],
          dislodged: [],
        },
      };

      engine.processTurn(orders, results, null, unitsByProvince);

      const rel = engine.getRelationship('ENGLAND', 'FRANCE');
      expect(rel.score).toBeGreaterThan(0);
      expect(rel.recentActions.some(a => a.type === 'SUCCESSFUL_CONVOY')).toBe(true);
    });
  });

  describe('capture analysis', () => {
    it('should detect supply center captures as strong negative signal', () => {
      const unitsByProvince = new Map<string, Power>([
        ['MUN', 'FRANCE'],
      ]);

      const results: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'FALL',
          results: [],
          unitMoves: [],
          dislodged: [],
        },
      };

      const captures: SupplyCentersCapturedEvent = {
        id: 'evt_2',
        timestamp: new Date(),
        gameId: 'test',
        type: 'SUPPLY_CENTERS_CAPTURED',
        payload: {
          year: 1901,
          season: 'FALL',
          changes: [
            { territory: 'MUN', from: 'GERMANY', to: 'FRANCE' },
          ],
        },
      };

      engine.processTurn([], results, captures, unitsByProvince);

      const rel = engine.getRelationship('FRANCE', 'GERMANY');
      expect(rel.score).toBeLessThan(0);
      expect(rel.recentActions.some(a => a.type === 'SUCCESSFUL_CAPTURE')).toBe(true);
    });
  });

  describe('cut support analysis', () => {
    it('should detect cut supports as negative signal', () => {
      const unitsByProvince = new Map<string, Power>([
        ['PAR', 'FRANCE'],
        ['BUR', 'GERMANY'],
      ]);

      const orders: Order[] = [
        { type: 'SUPPORT', unit: 'BUR', supportedUnit: 'MUN', destination: 'BOH' } as SupportOrder,
        { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
      ];

      const results: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: orders[0], success: false, reason: 'Support cut' },
            { order: orders[1], success: false, reason: 'Bounced' },
          ],
          unitMoves: [],
          dislodged: [],
        },
      };

      engine.processTurn(orders, results, null, unitsByProvince);

      const rel = engine.getRelationship('FRANCE', 'GERMANY');
      expect(rel.recentActions.some(a => a.type === 'CUT_SUPPORT')).toBe(true);
    });
  });

  describe('relationship status', () => {
    it('should classify positive relationships as allies', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
      ]);

      // Process multiple supports to build up positive relationship
      for (let i = 0; i < 4; i++) {
        const orders: Order[] = [
          { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
        ];

        const results: MovementResolvedEvent = {
          id: `evt_${i}`,
          timestamp: new Date(),
          gameId: 'test',
          type: 'MOVEMENT_RESOLVED',
          payload: {
            year: 1901 + i,
            season: 'SPRING',
            results: [{ order: orders[0], success: true }],
            unitMoves: [],
            dislodged: [],
          },
        };

        engine.processTurn(orders, results, null, unitsByProvince);
      }

      const rel = engine.getRelationship('ENGLAND', 'FRANCE');
      expect(rel.status).toBe('ally');
    });

    it('should classify negative relationships as enemies', () => {
      const unitsByProvince = new Map<string, Power>([
        ['PAR', 'FRANCE'],
        ['BUR', 'GERMANY'],
      ]);

      // Process multiple attacks
      for (let i = 0; i < 4; i++) {
        const orders: Order[] = [
          { type: 'MOVE', unit: 'PAR', destination: 'BUR' } as MoveOrder,
        ];

        const results: MovementResolvedEvent = {
          id: `evt_${i}`,
          timestamp: new Date(),
          gameId: 'test',
          type: 'MOVEMENT_RESOLVED',
          payload: {
            year: 1901 + i,
            season: 'SPRING',
            results: [{ order: orders[0], success: false }],
            unitMoves: [],
            dislodged: [],
          },
        };

        engine.processTurn(orders, results, null, unitsByProvince);
      }

      const rel = engine.getRelationship('FRANCE', 'GERMANY');
      expect(rel.status).toBe('enemy');
    });
  });

  describe('score decay', () => {
    it('should decay scores over time', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
      ]);

      // Build up a significant score with multiple supports
      for (let i = 0; i < 5; i++) {
        const orders: Order[] = [
          { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
        ];

        const results: MovementResolvedEvent = {
          id: `evt_${i}`,
          timestamp: new Date(),
          gameId: 'test',
          type: 'MOVEMENT_RESOLVED',
          payload: {
            year: 1901,
            season: 'SPRING',
            results: [{ order: orders[0], success: true }],
            unitMoves: [],
            dislodged: [],
          },
        };

        engine.processTurn(orders, results, null, unitsByProvince);
      }

      const scoreBeforeDecay = engine.getRelationship('ENGLAND', 'FRANCE').score;

      // Process multiple turns with no actions to trigger significant decay
      for (let i = 0; i < 5; i++) {
        const emptyResults: MovementResolvedEvent = {
          id: `evt_decay_${i}`,
          timestamp: new Date(),
          gameId: 'test',
          type: 'MOVEMENT_RESOLVED',
          payload: {
            year: 1902 + i,
            season: 'SPRING',
            results: [],
            unitMoves: [],
            dislodged: [],
          },
        };

        engine.processTurn([], emptyResults, null, unitsByProvince);
      }

      const scoreAfterDecay = engine.getRelationship('ENGLAND', 'FRANCE').score;

      // After 5 turns of decay (0.85^5 ≈ 0.44), score should be significantly lower
      expect(scoreAfterDecay).toBeLessThan(scoreBeforeDecay);
    });
  });

  describe('betrayal detection', () => {
    it('should detect support then stab pattern', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
        ['ENG', 'ENGLAND'],
      ]);

      // First turn: England supports France
      const orders1: Order[] = [
        { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
      ];

      const results1: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [{ order: orders1[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };

      // Process orders submitted to track for betrayal detection
      engine.processOrdersSubmitted({
        id: 'evt_orders_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND',
          orders: orders1,
          year: 1901,
          season: 'SPRING',
        },
      });

      engine.processTurn(orders1, results1, null, unitsByProvince);

      // Second turn: England attacks France
      const orders2: Order[] = [
        { type: 'MOVE', unit: 'ENG', destination: 'BRE' } as MoveOrder,
      ];

      const results2: MovementResolvedEvent = {
        id: 'evt_2',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'FALL',
          results: [{ order: orders2[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };

      engine.processTurn(orders2, results2, null, unitsByProvince);

      const rel = engine.getRelationship('ENGLAND', 'FRANCE');
      expect(rel.betrayalDetected).toBe(true);
      expect(rel.recentActions.some(a => a.type === 'SUPPORT_THEN_STAB')).toBe(true);
    });
  });

  describe('getRelationshipsForPower', () => {
    it('should return sorted relationships for a power', () => {
      const rels = engine.getRelationshipsForPower('ENGLAND');

      expect(rels.length).toBe(6); // 6 other powers
      expect(rels.every(r => r.otherPower !== 'ENGLAND')).toBe(true);
    });
  });

  describe('getBetrayals', () => {
    it('should return empty array when no betrayals', () => {
      const betrayals = engine.getBetrayals();
      expect(betrayals).toEqual([]);
    });

    it('should return betrayal events after a stab', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
        ['ENG', 'ENGLAND'],
      ]);

      // First turn: England supports France
      const orders1: Order[] = [
        { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
      ];

      engine.processOrdersSubmitted({
        id: 'evt_orders_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND',
          orders: orders1,
          year: 1901,
          season: 'SPRING',
        },
      });

      const results1: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [{ order: orders1[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };
      engine.processTurn(orders1, results1, null, unitsByProvince);

      // Second turn: England attacks France
      const orders2: Order[] = [
        { type: 'MOVE', unit: 'ENG', destination: 'BRE' } as MoveOrder,
      ];

      const results2: MovementResolvedEvent = {
        id: 'evt_2',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'FALL',
          results: [{ order: orders2[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };
      engine.processTurn(orders2, results2, null, unitsByProvince);

      const betrayals = engine.getBetrayals();
      expect(betrayals.length).toBeGreaterThan(0);
      expect(betrayals[0].betrayer).toBe('ENGLAND');
      expect(betrayals[0].victim).toBe('FRANCE');
    });
  });

  describe('getAllBetrayalDetails', () => {
    it('should return detailed betrayal info with type and evidence', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
        ['ENG', 'ENGLAND'],
      ]);

      // Set up and execute a stab
      const orders1: Order[] = [
        { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
      ];

      engine.processOrdersSubmitted({
        id: 'evt_orders_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND',
          orders: orders1,
          year: 1901,
          season: 'SPRING',
        },
      });

      const results1: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [{ order: orders1[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };
      engine.processTurn(orders1, results1, null, unitsByProvince);

      const orders2: Order[] = [
        { type: 'MOVE', unit: 'ENG', destination: 'BRE' } as MoveOrder,
      ];

      const results2: MovementResolvedEvent = {
        id: 'evt_2',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'FALL',
          results: [{ order: orders2[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };
      engine.processTurn(orders2, results2, null, unitsByProvince);

      const details = engine.getAllBetrayalDetails();
      expect(details.length).toBeGreaterThan(0);
      expect(details[0].type).toBe('CLASSIC_STAB');
      expect(details[0].evidence.length).toBeGreaterThan(0);
      expect(details[0].id).toBeDefined();
      expect(details[0].severity).toBeGreaterThan(0);
    });
  });

  describe('getBetrayalsForPower', () => {
    it('should return betrayals categorized by role', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
        ['ENG', 'ENGLAND'],
      ]);

      // Set up and execute a stab
      const orders1: Order[] = [
        { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
      ];

      engine.processOrdersSubmitted({
        id: 'evt_orders_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND',
          orders: orders1,
          year: 1901,
          season: 'SPRING',
        },
      });

      const results1: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [{ order: orders1[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };
      engine.processTurn(orders1, results1, null, unitsByProvince);

      const orders2: Order[] = [
        { type: 'MOVE', unit: 'ENG', destination: 'BRE' } as MoveOrder,
      ];

      const results2: MovementResolvedEvent = {
        id: 'evt_2',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'FALL',
          results: [{ order: orders2[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };
      engine.processTurn(orders2, results2, null, unitsByProvince);

      const englandBetrayals = engine.getBetrayalsForPower('ENGLAND');
      expect(englandBetrayals.asBetrayer.length).toBeGreaterThan(0);
      expect(englandBetrayals.asVictim.length).toBe(0);

      const franceBetrayals = engine.getBetrayalsForPower('FRANCE');
      expect(franceBetrayals.asBetrayer.length).toBe(0);
      expect(franceBetrayals.asVictim.length).toBeGreaterThan(0);
    });
  });

  describe('getMostRecentBetrayal', () => {
    it('should return null when no betrayals between powers', () => {
      const betrayal = engine.getMostRecentBetrayal('ENGLAND', 'GERMANY');
      expect(betrayal).toBeNull();
    });

    it('should return most recent betrayal between powers', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
        ['ENG', 'ENGLAND'],
      ]);

      // Execute a stab
      const orders1: Order[] = [
        { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
      ];

      engine.processOrdersSubmitted({
        id: 'evt_orders_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND',
          orders: orders1,
          year: 1901,
          season: 'SPRING',
        },
      });

      const results1: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [{ order: orders1[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };
      engine.processTurn(orders1, results1, null, unitsByProvince);

      const orders2: Order[] = [
        { type: 'MOVE', unit: 'ENG', destination: 'BRE' } as MoveOrder,
      ];

      const results2: MovementResolvedEvent = {
        id: 'evt_2',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'FALL',
          results: [{ order: orders2[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };
      engine.processTurn(orders2, results2, null, unitsByProvince);

      const betrayal = engine.getMostRecentBetrayal('ENGLAND', 'FRANCE');
      expect(betrayal).not.toBeNull();
      expect(betrayal?.betrayer).toBe('ENGLAND');
      expect(betrayal?.victim).toBe('FRANCE');
    });
  });

  describe('reset', () => {
    it('should reset all relationships to neutral', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
      ]);

      const orders: Order[] = [
        { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
      ];

      const results: MovementResolvedEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        gameId: 'test',
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [{ order: orders[0], success: true }],
          unitMoves: [],
          dislodged: [],
        },
      };

      engine.processTurn(orders, results, null, unitsByProvince);
      expect(engine.getRelationship('ENGLAND', 'FRANCE').score).not.toBe(0);

      engine.reset();

      expect(engine.getRelationship('ENGLAND', 'FRANCE').score).toBe(0);
      expect(engine.getRelationship('ENGLAND', 'FRANCE').status).toBe('neutral');
    });
  });

  describe('score clamping', () => {
    it('should clamp scores to -100 to +100 range', () => {
      const unitsByProvince = new Map<string, Power>([
        ['LON', 'ENGLAND'],
        ['BRE', 'FRANCE'],
      ]);

      // Process many supports to exceed +100
      for (let i = 0; i < 50; i++) {
        const orders: Order[] = [
          { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'PIC' } as SupportOrder,
        ];

        const results: MovementResolvedEvent = {
          id: `evt_${i}`,
          timestamp: new Date(),
          gameId: 'test',
          type: 'MOVEMENT_RESOLVED',
          payload: {
            year: 1901,
            season: i % 2 === 0 ? 'SPRING' : 'FALL',
            results: [{ order: orders[0], success: true }],
            unitMoves: [],
            dislodged: [],
          },
        };

        engine.processTurn(orders, results, null, unitsByProvince);
      }

      const rel = engine.getRelationship('ENGLAND', 'FRANCE');
      expect(rel.score).toBeLessThanOrEqual(100);
      expect(rel.score).toBeGreaterThanOrEqual(-100);
    });
  });
});
