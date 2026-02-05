/**
 * Tests for useResolutionAnimation hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResolutionAnimation } from '../useResolutionAnimation';
import type { MovementResolvedEvent } from '../../store/events';

/**
 * Creates a mock MovementResolvedEvent for testing.
 */
function createMockEvent(overrides: Partial<MovementResolvedEvent['payload']> = {}): MovementResolvedEvent {
  return {
    id: 'test-event-1',
    timestamp: new Date(),
    gameId: 'test-game',
    type: 'MOVEMENT_RESOLVED',
    payload: {
      year: 1901,
      season: 'SPRING',
      results: [
        {
          order: { type: 'MOVE', unit: 'par', destination: 'bur' },
          success: true,
        },
        {
          order: { type: 'HOLD', unit: 'mar' },
          success: true,
        },
      ],
      unitMoves: [
        { power: 'FRANCE', from: 'par', to: 'bur' },
      ],
      dislodged: [],
      ...overrides,
    },
  };
}

describe('useResolutionAnimation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initial state', () => {
    it('should start in idle phase with no event', () => {
      const { result } = renderHook(() => useResolutionAnimation(null));
      const [state] = result.current;

      expect(state.phase).toBe('idle');
      expect(state.progress).toBe(0);
      expect(state.visibleOrders).toHaveLength(0);
    });

    it('should populate state when event is provided', () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));
      const [state] = result.current;

      expect(state.phase).toBe('idle');
      expect(state.visibleOrders).toHaveLength(2);
    });
  });

  describe('Play/Pause controls', () => {
    it('should start playing when play() is called', () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));

      act(() => {
        result.current[1].play();
      });

      expect(result.current[0].phase).toBe('show_orders');
    });

    it('should pause when pause() is called', () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));

      act(() => {
        result.current[1].play();
      });

      const phaseAfterPlay = result.current[0].phase;

      act(() => {
        result.current[1].pause();
      });

      // Phase should remain the same after pause
      expect(result.current[0].phase).toBe(phaseAfterPlay);
    });

    it('should reset to initial state when reset() is called', () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));

      act(() => {
        result.current[1].play();
        vi.advanceTimersByTime(1000);
      });

      act(() => {
        result.current[1].reset();
      });

      expect(result.current[0].phase).toBe('idle');
      expect(result.current[0].progress).toBe(0);
    });
  });

  describe('Skip control', () => {
    it('should skip to complete phase immediately', () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));

      act(() => {
        result.current[1].play();
      });

      act(() => {
        result.current[1].skip();
      });

      expect(result.current[0].phase).toBe('complete');
      expect(result.current[0].progress).toBe(100);
    });

    it('should populate unit positions when skipping', () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));

      act(() => {
        result.current[1].skip();
      });

      // Unit should have moved from par to bur
      expect(result.current[0].unitPositions.size).toBeGreaterThan(0);
    });
  });

  describe('Speed control', () => {
    it('should accept slow speed', () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));

      act(() => {
        result.current[1].setSpeed('slow');
      });

      // Speed change should not affect phase
      expect(result.current[0].phase).toBe('idle');
    });

    it('should accept fast speed', () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));

      act(() => {
        result.current[1].setSpeed('fast');
      });

      expect(result.current[0].phase).toBe('idle');
    });
  });

  describe('Auto-play option', () => {
    it('should auto-play when autoPlay is true', () => {
      const event = createMockEvent();
      const { result } = renderHook(() =>
        useResolutionAnimation(event, { autoPlay: true })
      );

      expect(result.current[0].phase).toBe('show_orders');
    });

    it('should not auto-play when autoPlay is false', () => {
      const event = createMockEvent();
      const { result } = renderHook(() =>
        useResolutionAnimation(event, { autoPlay: false })
      );

      expect(result.current[0].phase).toBe('idle');
    });
  });

  describe('Failed orders', () => {
    it('should track failed orders with reasons', () => {
      const event = createMockEvent({
        results: [
          {
            order: { type: 'MOVE', unit: 'par', destination: 'bur' },
            success: false,
            reason: 'Bounce - multiple units to same destination',
          },
          {
            order: { type: 'MOVE', unit: 'mun', destination: 'bur' },
            success: false,
            reason: 'Bounce - multiple units to same destination',
          },
        ],
        unitMoves: [],
      });

      const { result } = renderHook(() => useResolutionAnimation(event));
      const [state] = result.current;

      expect(state.failedOrders.size).toBe(2);
      expect(state.failedOrders.get(0)).toBe('Bounce - multiple units to same destination');
    });
  });

  describe('Dislodged units', () => {
    it('should track dislodged units', () => {
      const event = createMockEvent({
        dislodged: [
          {
            unit: { type: 'ARMY', power: 'GERMANY', province: 'mun' },
            dislodgedFrom: 'mun',
            retreatOptions: ['boh', 'tyr'],
          },
        ],
      });

      const { result } = renderHook(() => useResolutionAnimation(event));
      const [state] = result.current;

      expect(state.dislodgedUnits.size).toBe(1);
      expect(state.dislodgedUnits.has('mun')).toBe(true);
    });
  });

  describe('Phase progression', () => {
    it('should progress through phases when playing', async () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));

      act(() => {
        result.current[1].play();
      });

      expect(result.current[0].phase).toBe('show_orders');

      // Advance past show_orders phase (2000ms)
      act(() => {
        vi.advanceTimersByTime(2100);
      });

      // Should have advanced (may skip some phases if they have no content)
      expect(result.current[0].phase).not.toBe('show_orders');
    });

    it('should skip empty phases', () => {
      const event = createMockEvent({
        results: [
          {
            order: { type: 'HOLD', unit: 'par' },
            success: true,
          },
        ],
        unitMoves: [],
        dislodged: [],
      });

      const { result } = renderHook(() => useResolutionAnimation(event));

      act(() => {
        result.current[1].play();
      });

      // After show_orders, should skip highlight_conflicts and resolve_battles
      // since there are no conflicts
      act(() => {
        vi.advanceTimersByTime(2100);
      });

      // Should skip to animate_moves or beyond
      expect(['animate_moves', 'show_failures', 'show_dislodged', 'complete']).toContain(
        result.current[0].phase
      );
    });
  });

  describe('Conflict detection', () => {
    it('should detect conflicts when multiple units target same territory', () => {
      const event = createMockEvent({
        results: [
          {
            order: { type: 'MOVE', unit: 'par', destination: 'bur' },
            success: false,
          },
          {
            order: { type: 'MOVE', unit: 'mun', destination: 'bur' },
            success: true,
          },
        ],
        unitMoves: [{ power: 'GERMANY', from: 'mun', to: 'bur' }],
      });

      const { result } = renderHook(() => useResolutionAnimation(event));
      const [state] = result.current;

      expect(state.conflictTerritories.length).toBe(1);
      expect(state.conflictTerritories[0].territory).toBe('bur');
      expect(state.conflictTerritories[0].contenders.length).toBe(2);
    });
  });

  describe('Event changes', () => {
    it('should reset when event changes', () => {
      const event1 = createMockEvent();
      const event2: MovementResolvedEvent = {
        ...createMockEvent(),
        id: 'test-event-2',
      };

      const { result, rerender } = renderHook(
        ({ event }) => useResolutionAnimation(event),
        { initialProps: { event: event1 } }
      );

      act(() => {
        result.current[1].play();
        vi.advanceTimersByTime(1000);
      });

      expect(result.current[0].phase).not.toBe('idle');

      rerender({ event: event2 });

      // Phase should reset with new event
      expect(result.current[0].phase).toBe('idle');
    });

    it('should reset when event becomes null', () => {
      const event = createMockEvent();

      const { result, rerender } = renderHook(
        ({ event }) => useResolutionAnimation(event),
        { initialProps: { event: event as MovementResolvedEvent | null } }
      );

      act(() => {
        result.current[1].play();
      });

      expect(result.current[0].phase).toBe('show_orders');

      rerender({ event: null });

      expect(result.current[0].phase).toBe('idle');
      expect(result.current[0].visibleOrders).toHaveLength(0);
    });
  });

  describe('Progress tracking', () => {
    it('should update phase progress during animation', () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));

      act(() => {
        result.current[1].play();
      });

      expect(result.current[0].phaseProgress).toBe(0);

      // Advance halfway through show_orders (2000ms total)
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Progress should be around 50%
      expect(result.current[0].phaseProgress).toBeGreaterThan(0);
      expect(result.current[0].phaseProgress).toBeLessThanOrEqual(100);
    });

    it('should track overall progress', () => {
      const event = createMockEvent();
      const { result } = renderHook(() => useResolutionAnimation(event));

      expect(result.current[0].progress).toBe(0);

      act(() => {
        result.current[1].skip();
      });

      expect(result.current[0].progress).toBe(100);
    });
  });
});
