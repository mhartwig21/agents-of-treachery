/**
 * Tests for synthesizeRelationshipEvents.
 */

import { describe, it, expect } from 'vitest';
import { synthesizeRelationshipEvents } from '../synthesizeRelationshipEvents';
import type { GameSnapshot } from '../types';

/**
 * Helper to create a minimal GameSnapshot for testing.
 */
function makeSnapshot(overrides: Partial<GameSnapshot> & { id: string }): GameSnapshot {
  return {
    year: 1901,
    season: 'SPRING',
    phase: 'DIPLOMACY',
    gameState: {
      phase: 'spring',
      year: 1901,
      units: [],
      orders: [],
      supplyCenters: {},
    },
    orders: [],
    messages: [],
    timestamp: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('synthesizeRelationshipEvents', () => {
  describe('returns null when synthesis is not possible', () => {
    it('should return null when prevSnapshot is null', () => {
      const current = makeSnapshot({ id: '1901-SPRING-DIPLOMACY' });
      expect(synthesizeRelationshipEvents(null, current)).toBeNull();
    });

    it('should return null when previous phase is not DIPLOMACY', () => {
      const prev = makeSnapshot({ id: '1901-FALL-BUILD', phase: 'BUILD' });
      const current = makeSnapshot({ id: '1902-SPRING-DIPLOMACY' });
      expect(synthesizeRelationshipEvents(prev, current)).toBeNull();
    });

    it('should return null when there are no orders', () => {
      const prev = makeSnapshot({ id: '1901-SPRING-DIPLOMACY', orders: [] });
      const current = makeSnapshot({ id: '1901-SPRING-RETREAT' });
      expect(synthesizeRelationshipEvents(prev, current)).toBeNull();
    });
  });

  describe('orders conversion', () => {
    it('should convert UI orders to engine format', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [
          { type: 'hold', unit: 'lon' },
          { type: 'move', unit: 'par', target: 'bur' },
        ],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [
            { type: 'army', power: 'england', territory: 'lon' },
            { type: 'army', power: 'france', territory: 'par' },
          ],
          orders: [],
          supplyCenters: {},
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [
            { type: 'army', power: 'england', territory: 'lon' },
            { type: 'army', power: 'france', territory: 'bur' },
          ],
          orders: [],
          supplyCenters: {},
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      expect(result!.orders).toEqual([
        { type: 'HOLD', unit: 'LON' },
        { type: 'MOVE', unit: 'PAR', destination: 'BUR' },
      ]);
    });

    it('should convert support orders correctly', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [
          { type: 'support', unit: 'lon', target: 'wal', supportTarget: 'eng' },
          { type: 'move', unit: 'wal', target: 'eng' },
        ],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [
            { type: 'fleet', power: 'england', territory: 'lon' },
            { type: 'army', power: 'england', territory: 'wal' },
          ],
          orders: [],
          supplyCenters: {},
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [
            { type: 'fleet', power: 'england', territory: 'lon' },
            { type: 'army', power: 'england', territory: 'eng' },
          ],
          orders: [],
          supplyCenters: {},
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      expect(result!.orders).toContainEqual({
        type: 'SUPPORT',
        unit: 'LON',
        supportedUnit: 'WAL',
        destination: 'ENG',
      });
    });

    it('should convert convoy orders correctly', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [
          { type: 'convoy', unit: 'eng', target: 'lon', supportTarget: 'bre' },
          { type: 'move', unit: 'lon', target: 'bre' },
        ],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [
            { type: 'fleet', power: 'england', territory: 'eng' },
            { type: 'army', power: 'england', territory: 'lon' },
          ],
          orders: [],
          supplyCenters: {},
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [
            { type: 'fleet', power: 'england', territory: 'eng' },
            { type: 'army', power: 'england', territory: 'bre' },
          ],
          orders: [],
          supplyCenters: {},
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      expect(result!.orders).toContainEqual({
        type: 'CONVOY',
        unit: 'ENG',
        convoyedUnit: 'LON',
        destination: 'BRE',
      });
    });
  });

  describe('movementEvent synthesis', () => {
    it('should produce a MovementResolvedEvent with correct year and season', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        year: 1901,
        season: 'SPRING',
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [{ type: 'army', power: 'france', territory: 'par' }],
          orders: [],
          supplyCenters: {},
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        year: 1901,
        season: 'FALL',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [{ type: 'army', power: 'france', territory: 'bur' }],
          orders: [],
          supplyCenters: {},
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      expect(result!.movementEvent.type).toBe('MOVEMENT_RESOLVED');
      expect(result!.movementEvent.payload.year).toBe(1901);
      expect(result!.movementEvent.payload.season).toBe('SPRING');
    });

    it('should detect successful moves', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [{ type: 'army', power: 'france', territory: 'par' }],
          orders: [],
          supplyCenters: {},
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [{ type: 'army', power: 'france', territory: 'bur' }],
          orders: [],
          supplyCenters: {},
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      const moveResult = result!.movementEvent.payload.results.find(
        (r) => r.order.type === 'MOVE'
      );
      expect(moveResult?.success).toBe(true);
    });

    it('should detect bounced moves', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [
          { type: 'move', unit: 'par', target: 'bur' },
          { type: 'move', unit: 'mun', target: 'bur' },
        ],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [
            { type: 'army', power: 'france', territory: 'par' },
            { type: 'army', power: 'germany', territory: 'mun' },
          ],
          orders: [],
          supplyCenters: {},
        },
      });

      // Both bounced - back to original positions
      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [
            { type: 'army', power: 'france', territory: 'par' },
            { type: 'army', power: 'germany', territory: 'mun' },
          ],
          orders: [],
          supplyCenters: {},
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      const failedMoves = result!.movementEvent.payload.results.filter(
        (r) => !r.success
      );
      expect(failedMoves.length).toBe(2);
    });
  });

  describe('captureEvent synthesis', () => {
    it('should return null captureEvent when no supply centers changed', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [{ type: 'move', unit: 'par', target: 'bur' }],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [{ type: 'army', power: 'france', territory: 'par' }],
          orders: [],
          supplyCenters: { par: 'france' },
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [{ type: 'army', power: 'france', territory: 'bur' }],
          orders: [],
          supplyCenters: { par: 'france' },
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      expect(result!.captureEvent).toBeNull();
    });

    it('should detect supply center captures from neutral', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [{ type: 'move', unit: 'par', target: 'bel' }],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [{ type: 'army', power: 'france', territory: 'par' }],
          orders: [],
          supplyCenters: { par: 'france' },
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [{ type: 'army', power: 'france', territory: 'bel' }],
          orders: [],
          supplyCenters: { par: 'france', bel: 'france' },
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      expect(result!.captureEvent).not.toBeNull();
      expect(result!.captureEvent!.type).toBe('SUPPLY_CENTERS_CAPTURED');
      expect(result!.captureEvent!.payload.changes).toEqual([
        { territory: 'BEL', from: null, to: 'FRANCE' },
      ]);
    });

    it('should detect supply center captures from another power', () => {
      const prev = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        year: 1901,
        season: 'FALL',
        orders: [{ type: 'move', unit: 'bur', target: 'mun' }],
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [
            { type: 'army', power: 'france', territory: 'bur' },
            { type: 'army', power: 'germany', territory: 'mun' },
          ],
          orders: [],
          supplyCenters: { mun: 'germany', par: 'france' },
        },
      });

      const current = makeSnapshot({
        id: '1902-SPRING-DIPLOMACY',
        year: 1902,
        gameState: {
          phase: 'spring',
          year: 1902,
          units: [{ type: 'army', power: 'france', territory: 'mun' }],
          orders: [],
          supplyCenters: { mun: 'france', par: 'france' },
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      expect(result!.captureEvent!.payload.changes).toEqual([
        { territory: 'MUN', from: 'GERMANY', to: 'FRANCE' },
      ]);
    });

    it('should detect multiple captures in one turn', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [
          { type: 'move', unit: 'par', target: 'bel' },
          { type: 'move', unit: 'mar', target: 'spa' },
        ],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [
            { type: 'army', power: 'france', territory: 'par' },
            { type: 'army', power: 'france', territory: 'mar' },
          ],
          orders: [],
          supplyCenters: { par: 'france', mar: 'france' },
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [
            { type: 'army', power: 'france', territory: 'bel' },
            { type: 'army', power: 'france', territory: 'spa' },
          ],
          orders: [],
          supplyCenters: { par: 'france', mar: 'france', bel: 'france', spa: 'france' },
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      expect(result!.captureEvent!.payload.changes).toHaveLength(2);
    });
  });

  describe('unitsByProvince mapping', () => {
    it('should build unitsByProvince from current snapshot units', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [{ type: 'hold', unit: 'lon' }],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [{ type: 'army', power: 'england', territory: 'lon' }],
          orders: [],
          supplyCenters: {},
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [
            { type: 'army', power: 'england', territory: 'lon' },
            { type: 'army', power: 'france', territory: 'par' },
            { type: 'fleet', power: 'germany', territory: 'kie' },
          ],
          orders: [],
          supplyCenters: {},
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      expect(result!.unitsByProvince.get('LON')).toBe('ENGLAND');
      expect(result!.unitsByProvince.get('PAR')).toBe('FRANCE');
      expect(result!.unitsByProvince.get('KIE')).toBe('GERMANY');
      expect(result!.unitsByProvince.size).toBe(3);
    });

    it('should uppercase province keys', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [{ type: 'hold', unit: 'lon' }],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [{ type: 'army', power: 'england', territory: 'lon' }],
          orders: [],
          supplyCenters: {},
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [{ type: 'army', power: 'england', territory: 'lon' }],
          orders: [],
          supplyCenters: {},
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();
      // Should be uppercase, not lowercase
      expect(result!.unitsByProvince.has('LON')).toBe(true);
      expect(result!.unitsByProvince.has('lon')).toBe(false);
    });
  });

  describe('integration with ActionRelationshipEngine', () => {
    it('should produce output compatible with processTurn signature', () => {
      const prev = makeSnapshot({
        id: '1901-SPRING-DIPLOMACY',
        orders: [
          { type: 'support', unit: 'lon', target: 'wal', supportTarget: 'eng' },
          { type: 'move', unit: 'wal', target: 'eng' },
          { type: 'hold', unit: 'par' },
        ],
        gameState: {
          phase: 'spring',
          year: 1901,
          units: [
            { type: 'fleet', power: 'england', territory: 'lon' },
            { type: 'army', power: 'england', territory: 'wal' },
            { type: 'army', power: 'france', territory: 'par' },
          ],
          orders: [],
          supplyCenters: { lon: 'england', par: 'france' },
        },
      });

      const current = makeSnapshot({
        id: '1901-FALL-DIPLOMACY',
        gameState: {
          phase: 'fall',
          year: 1901,
          units: [
            { type: 'fleet', power: 'england', territory: 'lon' },
            { type: 'army', power: 'england', territory: 'eng' },
            { type: 'army', power: 'france', territory: 'par' },
          ],
          orders: [],
          supplyCenters: { lon: 'england', par: 'france' },
        },
      });

      const result = synthesizeRelationshipEvents(prev, current);
      expect(result).not.toBeNull();

      // Verify shape matches processTurn(orders, results, captures, unitsByProvince)
      expect(Array.isArray(result!.orders)).toBe(true);
      expect(result!.movementEvent.type).toBe('MOVEMENT_RESOLVED');
      expect(result!.movementEvent.payload).toHaveProperty('year');
      expect(result!.movementEvent.payload).toHaveProperty('season');
      expect(result!.movementEvent.payload).toHaveProperty('results');
      expect(result!.movementEvent.payload).toHaveProperty('unitMoves');
      expect(result!.movementEvent.payload).toHaveProperty('dislodged');
      expect(result!.captureEvent === null || result!.captureEvent.type === 'SUPPLY_CENTERS_CAPTURED').toBe(true);
      expect(result!.unitsByProvince instanceof Map).toBe(true);
    });
  });
});
