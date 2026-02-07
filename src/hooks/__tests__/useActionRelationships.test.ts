/**
 * Tests for useActionRelationships hook.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useActionRelationships } from '../useActionRelationships';
import type { GameEvent } from '../../store/events';
import { createEventBase } from '../../store/events';

/**
 * Helper to create a minimal event base.
 */
function eventBase(): { id: string; timestamp: Date; gameId: string } {
  return createEventBase('test-game');
}

/**
 * Creates a standard game creation event with 1901 starting positions.
 */
function gameCreatedEvent(): GameEvent {
  return {
    ...eventBase(),
    type: 'GAME_CREATED',
    payload: {
      initialUnits: [
        { type: 'FLEET', power: 'ENGLAND', province: 'LON' },
        { type: 'FLEET', power: 'ENGLAND', province: 'EDI' },
        { type: 'ARMY', power: 'ENGLAND', province: 'LVP' },
        { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
        { type: 'ARMY', power: 'FRANCE', province: 'MAR' },
        { type: 'FLEET', power: 'FRANCE', province: 'BRE' },
        { type: 'ARMY', power: 'GERMANY', province: 'BER' },
        { type: 'ARMY', power: 'GERMANY', province: 'MUN' },
        { type: 'FLEET', power: 'GERMANY', province: 'KIE' },
      ],
      supplyCenters: {
        LON: 'ENGLAND', EDI: 'ENGLAND', LVP: 'ENGLAND',
        PAR: 'FRANCE', MAR: 'FRANCE', BRE: 'FRANCE',
        BER: 'GERMANY', MUN: 'GERMANY', KIE: 'GERMANY',
      },
    },
  };
}

describe('useActionRelationships', () => {
  it('returns empty relationships when no events provided', () => {
    const { result } = renderHook(() =>
      useActionRelationships({
        events: [],
        currentYear: 1901,
        currentSeason: 'SPRING',
      })
    );

    // Should still return all 21 power pairs (7 choose 2)
    expect(result.current.relationships).toHaveLength(21);
    expect(result.current.betrayals).toHaveLength(0);

    // All relationships should be neutral with score 0
    for (const rel of result.current.relationships) {
      expect(rel.score).toBe(0);
      expect(rel.status).toBe('neutral');
      expect(rel.betrayalDetected).toBe(false);
    }
  });

  it('returns all 21 power pairs after game creation', () => {
    const { result } = renderHook(() =>
      useActionRelationships({
        events: [gameCreatedEvent()],
        currentYear: 1901,
        currentSeason: 'SPRING',
      })
    );

    expect(result.current.relationships).toHaveLength(21);
    expect(result.current.betrayals).toHaveLength(0);
  });

  it('detects positive relationships from support orders', () => {
    const events: GameEvent[] = [
      gameCreatedEvent(),
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND',
          orders: [
            { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'ENG' },
          ],
          year: 1901,
          season: 'SPRING',
        },
      },
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'FRANCE',
          orders: [
            { type: 'MOVE', unit: 'BRE', destination: 'ENG' },
          ],
          year: 1901,
          season: 'SPRING',
        },
      },
      {
        ...eventBase(),
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'ENG' }, success: true },
            { order: { type: 'MOVE', unit: 'BRE', destination: 'ENG' }, success: true },
          ],
          unitMoves: [{ power: 'FRANCE', from: 'BRE', to: 'ENG' }],
          dislodged: [],
        },
      },
      {
        ...eventBase(),
        type: 'PHASE_ADVANCED',
        payload: {
          fromYear: 1901, fromSeason: 'SPRING', fromPhase: 'MOVEMENT',
          toYear: 1901, toSeason: 'FALL', toPhase: 'DIPLOMACY',
        },
      },
    ];

    const { result } = renderHook(() =>
      useActionRelationships({
        events,
        currentYear: 1901,
        currentSeason: 'FALL',
      })
    );

    // Find England-France relationship
    const engFra = result.current.relationships.find(
      r => (r.power1 === 'ENGLAND' && r.power2 === 'FRANCE') ||
           (r.power1 === 'FRANCE' && r.power2 === 'ENGLAND')
    );

    expect(engFra).toBeDefined();
    expect(engFra!.score).toBeGreaterThan(0);
  });

  it('detects negative relationships from attacks', () => {
    const events: GameEvent[] = [
      gameCreatedEvent(),
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'GERMANY',
          orders: [
            { type: 'MOVE', unit: 'MUN', destination: 'MAR' },
          ],
          year: 1901,
          season: 'SPRING',
        },
      },
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'FRANCE',
          orders: [
            { type: 'HOLD', unit: 'MAR' },
          ],
          year: 1901,
          season: 'SPRING',
        },
      },
      {
        ...eventBase(),
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: { type: 'MOVE', unit: 'MUN', destination: 'MAR' }, success: false, reason: 'Bounced' },
            { order: { type: 'HOLD', unit: 'MAR' }, success: true },
          ],
          unitMoves: [],
          dislodged: [],
        },
      },
      {
        ...eventBase(),
        type: 'PHASE_ADVANCED',
        payload: {
          fromYear: 1901, fromSeason: 'SPRING', fromPhase: 'MOVEMENT',
          toYear: 1901, toSeason: 'FALL', toPhase: 'DIPLOMACY',
        },
      },
    ];

    const { result } = renderHook(() =>
      useActionRelationships({
        events,
        currentYear: 1901,
        currentSeason: 'FALL',
      })
    );

    const gerFra = result.current.relationships.find(
      r => (r.power1 === 'FRANCE' && r.power2 === 'GERMANY') ||
           (r.power1 === 'GERMANY' && r.power2 === 'FRANCE')
    );

    expect(gerFra).toBeDefined();
    expect(gerFra!.score).toBeLessThan(0);
  });

  it('tracks supply center captures', () => {
    const events: GameEvent[] = [
      gameCreatedEvent(),
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'GERMANY',
          orders: [{ type: 'MOVE', unit: 'MUN', destination: 'BUR' }],
          year: 1901,
          season: 'SPRING',
        },
      },
      {
        ...eventBase(),
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: { type: 'MOVE', unit: 'MUN', destination: 'BUR' }, success: true },
          ],
          unitMoves: [{ power: 'GERMANY', from: 'MUN', to: 'BUR' }],
          dislodged: [],
        },
      },
      {
        ...eventBase(),
        type: 'PHASE_ADVANCED',
        payload: {
          fromYear: 1901, fromSeason: 'SPRING', fromPhase: 'MOVEMENT',
          toYear: 1901, toSeason: 'FALL', toPhase: 'DIPLOMACY',
        },
      },
      // Fall: Germany moves BUR -> MAR, capturing it
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'GERMANY',
          orders: [{ type: 'MOVE', unit: 'BUR', destination: 'MAR' }],
          year: 1901,
          season: 'FALL',
        },
      },
      {
        ...eventBase(),
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'FALL',
          results: [
            { order: { type: 'MOVE', unit: 'BUR', destination: 'MAR' }, success: true },
          ],
          unitMoves: [{ power: 'GERMANY', from: 'BUR', to: 'MAR' }],
          dislodged: [{ unit: { type: 'ARMY', power: 'FRANCE', province: 'MAR' }, dislodgedFrom: 'MAR', retreatOptions: ['GAS'] }],
        },
      },
      {
        ...eventBase(),
        type: 'SUPPLY_CENTERS_CAPTURED',
        payload: {
          year: 1901,
          season: 'FALL',
          changes: [{ territory: 'MAR', from: 'FRANCE', to: 'GERMANY' }],
        },
      },
      {
        ...eventBase(),
        type: 'PHASE_ADVANCED',
        payload: {
          fromYear: 1901, fromSeason: 'FALL', fromPhase: 'MOVEMENT',
          toYear: 1901, toSeason: 'FALL', toPhase: 'RETREAT',
        },
      },
    ];

    const { result } = renderHook(() =>
      useActionRelationships({
        events,
        currentYear: 1902,
        currentSeason: 'SPRING',
      })
    );

    const gerFra = result.current.relationships.find(
      r => (r.power1 === 'FRANCE' && r.power2 === 'GERMANY') ||
           (r.power1 === 'GERMANY' && r.power2 === 'FRANCE')
    );

    expect(gerFra).toBeDefined();
    // Attack + capture should result in strongly negative score
    expect(gerFra!.score).toBeLessThan(-5);
  });

  it('filters events by current year/season for replay mode', () => {
    const events: GameEvent[] = [
      gameCreatedEvent(),
      // Spring 1901: England supports France
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND',
          orders: [
            { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'ENG' },
          ],
          year: 1901,
          season: 'SPRING',
        },
      },
      {
        ...eventBase(),
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'ENG' }, success: true },
            { order: { type: 'MOVE', unit: 'BRE', destination: 'ENG' }, success: true },
          ],
          unitMoves: [{ power: 'FRANCE', from: 'BRE', to: 'ENG' }],
          dislodged: [],
        },
      },
      {
        ...eventBase(),
        type: 'PHASE_ADVANCED',
        payload: {
          fromYear: 1901, fromSeason: 'SPRING', fromPhase: 'MOVEMENT',
          toYear: 1901, toSeason: 'FALL', toPhase: 'DIPLOMACY',
        },
      },
      // Fall 1901: Germany attacks France (should be excluded if viewing Spring 1901)
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'GERMANY',
          orders: [{ type: 'MOVE', unit: 'MUN', destination: 'MAR' }],
          year: 1901,
          season: 'FALL',
        },
      },
      {
        ...eventBase(),
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'FALL',
          results: [
            { order: { type: 'MOVE', unit: 'MUN', destination: 'MAR' }, success: false },
            { order: { type: 'HOLD', unit: 'MAR' }, success: true },
          ],
          unitMoves: [],
          dislodged: [],
        },
      },
      {
        ...eventBase(),
        type: 'PHASE_ADVANCED',
        payload: {
          fromYear: 1901, fromSeason: 'FALL', fromPhase: 'MOVEMENT',
          toYear: 1902, toSeason: 'SPRING', toPhase: 'DIPLOMACY',
        },
      },
    ];

    // View at Spring 1901 - should only see Spring 1901 events
    const { result: springResult } = renderHook(() =>
      useActionRelationships({
        events,
        currentYear: 1901,
        currentSeason: 'SPRING',
      })
    );

    // Germany-France should be neutral when viewing only Spring 1901
    const gerFraSpring = springResult.current.relationships.find(
      r => (r.power1 === 'FRANCE' && r.power2 === 'GERMANY') ||
           (r.power1 === 'GERMANY' && r.power2 === 'FRANCE')
    );
    expect(gerFraSpring!.score).toBe(0);

    // View at Fall 1901 - should include Fall events
    const { result: fallResult } = renderHook(() =>
      useActionRelationships({
        events,
        currentYear: 1901,
        currentSeason: 'FALL',
      })
    );

    const gerFraFall = fallResult.current.relationships.find(
      r => (r.power1 === 'FRANCE' && r.power2 === 'GERMANY') ||
           (r.power1 === 'GERMANY' && r.power2 === 'FRANCE')
    );
    expect(gerFraFall!.score).toBeLessThan(0);
  });

  it('memoizes results when inputs do not change', () => {
    const events: GameEvent[] = [gameCreatedEvent()];

    const { result, rerender } = renderHook(() =>
      useActionRelationships({
        events,
        currentYear: 1901,
        currentSeason: 'SPRING',
      })
    );

    const firstResult = result.current;
    rerender();
    const secondResult = result.current;

    // Same reference means useMemo cache hit
    expect(firstResult).toBe(secondResult);
  });

  it('recalculates when events change', () => {
    const initialEvents: GameEvent[] = [gameCreatedEvent()];

    const { result, rerender } = renderHook(
      ({ events }) =>
        useActionRelationships({
          events,
          currentYear: 1901,
          currentSeason: 'SPRING',
        }),
      { initialProps: { events: initialEvents } }
    );

    const firstResult = result.current;

    const updatedEvents: GameEvent[] = [
      ...initialEvents,
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND',
          orders: [{ type: 'HOLD', unit: 'LON' }],
          year: 1901,
          season: 'SPRING',
        },
      },
    ];

    rerender({ events: updatedEvents });
    const secondResult = result.current;

    // Different reference means useMemo recalculated
    expect(firstResult).not.toBe(secondResult);
  });

  it('tracks betrayals from support-then-stab patterns', () => {
    const events: GameEvent[] = [
      gameCreatedEvent(),
      // Spring 1901: England supports France
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND',
          orders: [
            { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'ENG' },
          ],
          year: 1901,
          season: 'SPRING',
        },
      },
      {
        ...eventBase(),
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: { type: 'SUPPORT', unit: 'LON', supportedUnit: 'BRE', destination: 'ENG' }, success: true },
            { order: { type: 'MOVE', unit: 'BRE', destination: 'ENG' }, success: true },
          ],
          unitMoves: [{ power: 'FRANCE', from: 'BRE', to: 'ENG' }],
          dislodged: [],
        },
      },
      {
        ...eventBase(),
        type: 'PHASE_ADVANCED',
        payload: {
          fromYear: 1901, fromSeason: 'SPRING', fromPhase: 'MOVEMENT',
          toYear: 1901, toSeason: 'FALL', toPhase: 'DIPLOMACY',
        },
      },
      // Fall 1901: England attacks France (stab!)
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'ENGLAND',
          orders: [
            { type: 'MOVE', unit: 'LON', destination: 'ENG' },
          ],
          year: 1901,
          season: 'FALL',
        },
      },
      {
        ...eventBase(),
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'FALL',
          results: [
            { order: { type: 'MOVE', unit: 'LON', destination: 'ENG' }, success: true },
          ],
          unitMoves: [{ power: 'ENGLAND', from: 'LON', to: 'ENG' }],
          dislodged: [{ unit: { type: 'FLEET', power: 'FRANCE', province: 'ENG' }, dislodgedFrom: 'ENG', retreatOptions: ['BRE'] }],
        },
      },
      {
        ...eventBase(),
        type: 'PHASE_ADVANCED',
        payload: {
          fromYear: 1901, fromSeason: 'FALL', fromPhase: 'MOVEMENT',
          toYear: 1901, toSeason: 'FALL', toPhase: 'RETREAT',
        },
      },
    ];

    const { result } = renderHook(() =>
      useActionRelationships({
        events,
        currentYear: 1902,
        currentSeason: 'SPRING',
      })
    );

    const engFra = result.current.relationships.find(
      r => (r.power1 === 'ENGLAND' && r.power2 === 'FRANCE') ||
           (r.power1 === 'FRANCE' && r.power2 === 'ENGLAND')
    );

    expect(engFra).toBeDefined();
    expect(engFra!.betrayalDetected).toBe(true);
    expect(engFra!.score).toBeLessThan(0);
  });

  it('handles builds and disbands in unit tracking', () => {
    const events: GameEvent[] = [
      gameCreatedEvent(),
      {
        ...eventBase(),
        type: 'BUILDS_RESOLVED',
        payload: {
          year: 1901,
          unitsBuilt: [
            { power: 'ENGLAND', province: 'LON', unitType: 'FLEET' },
          ],
          unitsDisbanded: [
            { power: 'FRANCE', province: 'BRE' },
          ],
        },
      },
    ];

    // Should not throw - builds/disbands should be handled gracefully
    const { result } = renderHook(() =>
      useActionRelationships({
        events,
        currentYear: 1902,
        currentSeason: 'SPRING',
      })
    );

    expect(result.current.relationships).toHaveLength(21);
  });

  it('handles retreat resolution in unit tracking', () => {
    const events: GameEvent[] = [
      gameCreatedEvent(),
      {
        ...eventBase(),
        type: 'RETREATS_RESOLVED',
        payload: {
          year: 1901,
          season: 'FALL',
          retreatResults: [
            {
              unit: { type: 'ARMY', power: 'FRANCE', province: 'MAR' },
              destination: 'GAS',
              success: true,
            },
          ],
        },
      },
    ];

    // Should not throw - retreats should be handled gracefully
    const { result } = renderHook(() =>
      useActionRelationships({
        events,
        currentYear: 1902,
        currentSeason: 'SPRING',
      })
    );

    expect(result.current.relationships).toHaveLength(21);
  });

  it('processes pending movement without PHASE_ADVANCED', () => {
    // Simulates viewing results mid-phase before phase advance
    const events: GameEvent[] = [
      gameCreatedEvent(),
      {
        ...eventBase(),
        type: 'ORDERS_SUBMITTED',
        payload: {
          power: 'GERMANY',
          orders: [{ type: 'MOVE', unit: 'MUN', destination: 'MAR' }],
          year: 1901,
          season: 'SPRING',
        },
      },
      {
        ...eventBase(),
        type: 'MOVEMENT_RESOLVED',
        payload: {
          year: 1901,
          season: 'SPRING',
          results: [
            { order: { type: 'MOVE', unit: 'MUN', destination: 'MAR' }, success: false },
            { order: { type: 'HOLD', unit: 'MAR' }, success: true },
          ],
          unitMoves: [],
          dislodged: [],
        },
      },
      // No PHASE_ADVANCED yet
    ];

    const { result } = renderHook(() =>
      useActionRelationships({
        events,
        currentYear: 1901,
        currentSeason: 'SPRING',
      })
    );

    // Should still process the movement results
    const gerFra = result.current.relationships.find(
      r => (r.power1 === 'FRANCE' && r.power2 === 'GERMANY') ||
           (r.power1 === 'GERMANY' && r.power2 === 'FRANCE')
    );
    expect(gerFra!.score).toBeLessThan(0);
  });
});
