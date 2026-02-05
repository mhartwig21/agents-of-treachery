/**
 * React hook for controlling the turn resolution animation sequence.
 *
 * Manages a 7-phase state machine that animates the resolution of movement orders,
 * providing visual feedback for conflicts, battles, unit movements, and failures.
 */

import { useReducer, useEffect, useCallback, useRef } from 'react';
import type { MovementResolvedEvent } from '../store/events';
import type { Order, Power } from '../engine/types';
import type { Contender } from '../components/map/ConflictMarker';
import type { LowercasePower } from '../spectator/types';
import { getTerritoryCenter } from '../data/territories';

/**
 * Animation phases in sequence order.
 */
export type AnimationPhase =
  | 'idle'
  | 'show_orders'
  | 'highlight_conflicts'
  | 'resolve_battles'
  | 'animate_moves'
  | 'show_failures'
  | 'show_dislodged'
  | 'complete';

const PHASE_ORDER: AnimationPhase[] = [
  'show_orders',
  'highlight_conflicts',
  'resolve_battles',
  'animate_moves',
  'show_failures',
  'show_dislodged',
  'complete',
];

/**
 * Duration for each phase in milliseconds (at normal speed).
 */
const PHASE_DURATIONS: Record<AnimationPhase, number> = {
  idle: 0,
  show_orders: 2000,
  highlight_conflicts: 2000,
  resolve_battles: 1500, // Per conflict
  animate_moves: 1000,
  show_failures: 1500,
  show_dislodged: 1000,
  complete: 0,
};

/**
 * Speed multipliers.
 */
const SPEED_MULTIPLIERS: Record<'slow' | 'normal' | 'fast', number> = {
  slow: 2.0, // 0.5x speed = 2x duration
  normal: 1.0,
  fast: 0.5, // 2x speed = 0.5x duration
};

/**
 * Conflict data for a contested territory.
 */
interface ConflictData {
  territory: string;
  contenders: Contender[];
  resolved: boolean;
}

/**
 * State for the resolution animation.
 */
export interface ResolutionAnimationState {
  phase: AnimationPhase;

  // Data for each phase
  visibleOrders: Order[];
  conflictTerritories: ConflictData[];
  currentBattle: { territory: string; winner?: Power } | null;
  unitPositions: Map<string, { x: number; y: number }>;
  failedOrders: Map<number, string>;
  dislodgedUnits: Set<string>;

  // Progress
  progress: number; // 0-100 overall
  phaseProgress: number; // 0-100 within current phase
}

/**
 * Controls for the resolution animation.
 */
export interface ResolutionAnimationControls {
  play: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  setSpeed: (speed: 'slow' | 'normal' | 'fast') => void;
}

/**
 * Hook options.
 */
export interface UseResolutionAnimationOptions {
  autoPlay?: boolean;
  speed?: 'slow' | 'normal' | 'fast';
}

/**
 * Internal state including animation control.
 */
interface InternalState extends ResolutionAnimationState {
  isPlaying: boolean;
  speed: 'slow' | 'normal' | 'fast';
  currentBattleIndex: number;
  totalBattles: number;
  event: MovementResolvedEvent | null;
}

type Action =
  | { type: 'SET_EVENT'; event: MovementResolvedEvent | null }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'RESET' }
  | { type: 'SKIP' }
  | { type: 'SET_SPEED'; speed: 'slow' | 'normal' | 'fast' }
  | { type: 'ADVANCE_PHASE' }
  | { type: 'UPDATE_PHASE_PROGRESS'; progress: number }
  | { type: 'ADVANCE_BATTLE' }
  | { type: 'SET_UNIT_POSITIONS'; positions: Map<string, { x: number; y: number }> }
  | { type: 'RESOLVE_CONFLICT'; territory: string };

/**
 * Creates initial state.
 */
function createInitialState(): InternalState {
  return {
    phase: 'idle',
    visibleOrders: [],
    conflictTerritories: [],
    currentBattle: null,
    unitPositions: new Map(),
    failedOrders: new Map(),
    dislodgedUnits: new Set(),
    progress: 0,
    phaseProgress: 0,
    isPlaying: false,
    speed: 'normal',
    currentBattleIndex: 0,
    totalBattles: 0,
    event: null,
  };
}

/**
 * Derives conflict data from resolution results.
 */
function deriveConflicts(event: MovementResolvedEvent): ConflictData[] {
  const { results } = event.payload;

  // Group move orders by their destination
  const destinationMap = new Map<string, Array<{ order: Order; success: boolean; power: Power }>>();

  for (const result of results) {
    if (result.order.type === 'MOVE') {
      const dest = result.order.destination;
      if (!destinationMap.has(dest)) {
        destinationMap.set(dest, []);
      }
      // Infer power from the unit location - we'll need to look up the order context
      // For now, we don't have direct access to power, so we'll track it differently
      destinationMap.get(dest)!.push({
        order: result.order,
        success: result.success,
        power: 'ENGLAND' as Power, // Placeholder - will be filled in from context
      });
    }
  }

  // Find territories with multiple competing moves
  const conflicts: ConflictData[] = [];
  for (const [territory, moves] of destinationMap) {
    if (moves.length > 1) {
      // Calculate strength for each contender (1 base + support count)
      const contenders: Contender[] = moves.map((move) => {
        // Count supports for this move
        const supportCount = results.filter(
          (r) =>
            r.order.type === 'SUPPORT' &&
            r.order.destination === territory &&
            r.success
        ).length;

        return {
          power: move.order.unit.toLowerCase() as LowercasePower, // Territory as power proxy
          strength: 1 + supportCount,
          isWinner: move.success,
        };
      });

      conflicts.push({
        territory,
        contenders,
        resolved: false,
      });
    }
  }

  return conflicts;
}

/**
 * Derives failed orders from results.
 */
function deriveFailedOrders(event: MovementResolvedEvent): Map<number, string> {
  const failed = new Map<number, string>();
  event.payload.results.forEach((result, index) => {
    if (!result.success && result.reason) {
      failed.set(index, result.reason);
    }
  });
  return failed;
}

/**
 * Derives dislodged units.
 */
function deriveDislodgedUnits(event: MovementResolvedEvent): Set<string> {
  return new Set(event.payload.dislodged.map((d) => d.dislodgedFrom));
}

/**
 * Calculates target positions for unit moves.
 */
function calculateTargetPositions(
  event: MovementResolvedEvent
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  for (const move of event.payload.unitMoves) {
    const targetCenter = getTerritoryCenter(move.to.toLowerCase());
    if (targetCenter) {
      positions.set(move.from.toLowerCase(), { x: targetCenter.x, y: targetCenter.y });
    }
  }

  return positions;
}

/**
 * Determines if a phase should be skipped (has no content).
 */
function shouldSkipPhase(phase: AnimationPhase, state: InternalState): boolean {
  switch (phase) {
    case 'highlight_conflicts':
    case 'resolve_battles':
      return state.conflictTerritories.length === 0;
    case 'show_failures':
      return state.failedOrders.size === 0;
    case 'show_dislodged':
      return state.dislodgedUnits.size === 0;
    default:
      return false;
  }
}

/**
 * Reducer for animation state.
 */
function reducer(state: InternalState, action: Action): InternalState {
  switch (action.type) {
    case 'SET_EVENT': {
      if (!action.event) {
        return createInitialState();
      }

      const conflicts = deriveConflicts(action.event);
      const failedOrders = deriveFailedOrders(action.event);
      const dislodgedUnits = deriveDislodgedUnits(action.event);

      return {
        ...createInitialState(),
        event: action.event,
        visibleOrders: action.event.payload.results.map((r) => r.order),
        conflictTerritories: conflicts,
        failedOrders,
        dislodgedUnits,
        totalBattles: conflicts.length,
      };
    }

    case 'PLAY':
      if (state.phase === 'idle' && state.event) {
        return { ...state, isPlaying: true, phase: 'show_orders' };
      }
      return { ...state, isPlaying: true };

    case 'PAUSE':
      return { ...state, isPlaying: false };

    case 'RESET':
      if (!state.event) return state;
      return reducer(state, { type: 'SET_EVENT', event: state.event });

    case 'SKIP':
      return {
        ...state,
        phase: 'complete',
        isPlaying: false,
        progress: 100,
        phaseProgress: 100,
        conflictTerritories: state.conflictTerritories.map((c) => ({
          ...c,
          resolved: true,
        })),
        unitPositions: state.event ? calculateTargetPositions(state.event) : new Map(),
      };

    case 'SET_SPEED':
      return { ...state, speed: action.speed };

    case 'ADVANCE_PHASE': {
      let currentIndex = PHASE_ORDER.indexOf(state.phase);
      if (currentIndex === -1 || currentIndex >= PHASE_ORDER.length - 1) {
        return { ...state, phase: 'complete', isPlaying: false, progress: 100 };
      }

      // Find the next phase that has content (skip empty phases)
      let nextPhase: AnimationPhase;
      do {
        currentIndex++;
        if (currentIndex >= PHASE_ORDER.length) {
          return { ...state, phase: 'complete', isPlaying: false, progress: 100 };
        }
        nextPhase = PHASE_ORDER[currentIndex];
      } while (shouldSkipPhase(nextPhase, state));

      // Update current battle for resolve_battles phase
      let currentBattle = state.currentBattle;
      if (nextPhase === 'resolve_battles' && state.conflictTerritories.length > 0) {
        const firstConflict = state.conflictTerritories[0];
        const winner = firstConflict.contenders.find((c) => c.isWinner);
        currentBattle = {
          territory: firstConflict.territory,
          winner: winner ? (winner.power.toUpperCase() as Power) : undefined,
        };
      }

      // Calculate unit positions for animate_moves phase
      let unitPositions = state.unitPositions;
      if (nextPhase === 'animate_moves' && state.event) {
        unitPositions = calculateTargetPositions(state.event);
      }

      const newProgress = ((currentIndex + 1) / PHASE_ORDER.length) * 100;

      return {
        ...state,
        phase: nextPhase,
        phaseProgress: 0,
        progress: Math.min(newProgress, 100),
        currentBattle,
        unitPositions,
        currentBattleIndex: nextPhase === 'resolve_battles' ? 0 : state.currentBattleIndex,
      };
    }

    case 'UPDATE_PHASE_PROGRESS':
      return { ...state, phaseProgress: action.progress };

    case 'ADVANCE_BATTLE': {
      const nextIndex = state.currentBattleIndex + 1;
      if (nextIndex >= state.totalBattles) {
        return reducer(state, { type: 'ADVANCE_PHASE' });
      }

      const nextConflict = state.conflictTerritories[nextIndex];
      const winner = nextConflict.contenders.find((c) => c.isWinner);

      // Mark previous conflict as resolved
      const updatedConflicts = state.conflictTerritories.map((c, i) =>
        i < nextIndex ? { ...c, resolved: true } : c
      );

      return {
        ...state,
        currentBattleIndex: nextIndex,
        currentBattle: {
          territory: nextConflict.territory,
          winner: winner ? (winner.power.toUpperCase() as Power) : undefined,
        },
        conflictTerritories: updatedConflicts,
        phaseProgress: 0,
      };
    }

    case 'RESOLVE_CONFLICT': {
      return {
        ...state,
        conflictTerritories: state.conflictTerritories.map((c) =>
          c.territory === action.territory ? { ...c, resolved: true } : c
        ),
      };
    }

    case 'SET_UNIT_POSITIONS':
      return { ...state, unitPositions: action.positions };

    default:
      return state;
  }
}

/**
 * Hook for controlling the turn resolution animation sequence.
 *
 * @param resolvedEvent - The MovementResolvedEvent to animate, or null to reset
 * @param options - Animation options
 * @returns A tuple of [state, controls]
 *
 * @example
 * ```tsx
 * function TurnResolutionPlayer({ event }) {
 *   const [state, controls] = useResolutionAnimation(event, { autoPlay: true });
 *
 *   return (
 *     <div>
 *       <DiplomacyMap
 *         animationMode={state.phase !== 'idle' && state.phase !== 'complete'}
 *         animationState={{
 *           dislodgedUnits: state.dislodgedUnits,
 *           unitPositions: state.unitPositions,
 *           failedOrders: state.failedOrders,
 *           conflictTerritories: state.conflictTerritories,
 *         }}
 *       />
 *       <button onClick={controls.play}>Play</button>
 *       <button onClick={controls.pause}>Pause</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useResolutionAnimation(
  resolvedEvent: MovementResolvedEvent | null,
  options: UseResolutionAnimationOptions = {}
): [ResolutionAnimationState, ResolutionAnimationControls] {
  const { autoPlay = false, speed: initialSpeed = 'normal' } = options;

  const [state, dispatch] = useReducer(reducer, createInitialState());
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastEventIdRef = useRef<string | null>(null);

  // Handle event changes
  useEffect(() => {
    const eventId = resolvedEvent?.id ?? null;
    if (eventId !== lastEventIdRef.current) {
      lastEventIdRef.current = eventId;
      dispatch({ type: 'SET_EVENT', event: resolvedEvent });

      if (autoPlay && resolvedEvent) {
        dispatch({ type: 'PLAY' });
      }
    }
  }, [resolvedEvent, autoPlay]);

  // Set initial speed
  useEffect(() => {
    dispatch({ type: 'SET_SPEED', speed: initialSpeed });
  }, [initialSpeed]);

  // Animation loop
  useEffect(() => {
    if (!state.isPlaying || state.phase === 'idle' || state.phase === 'complete') {
      return;
    }

    const speedMultiplier = SPEED_MULTIPLIERS[state.speed];
    let duration: number;

    if (state.phase === 'resolve_battles') {
      duration = PHASE_DURATIONS.resolve_battles * speedMultiplier;
    } else {
      duration = PHASE_DURATIONS[state.phase] * speedMultiplier;
    }

    startTimeRef.current = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTimeRef.current;
      const progress = Math.min((elapsed / duration) * 100, 100);

      dispatch({ type: 'UPDATE_PHASE_PROGRESS', progress });

      if (progress >= 100) {
        if (state.phase === 'resolve_battles') {
          dispatch({ type: 'RESOLVE_CONFLICT', territory: state.currentBattle?.territory ?? '' });
          dispatch({ type: 'ADVANCE_BATTLE' });
        } else {
          dispatch({ type: 'ADVANCE_PHASE' });
        }
      } else {
        timerRef.current = requestAnimationFrame(animate);
      }
    };

    timerRef.current = requestAnimationFrame(animate);

    return () => {
      if (timerRef.current !== null) {
        cancelAnimationFrame(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state.isPlaying, state.phase, state.speed, state.currentBattleIndex]);

  // Controls
  const play = useCallback(() => dispatch({ type: 'PLAY' }), []);
  const pause = useCallback(() => dispatch({ type: 'PAUSE' }), []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);
  const skip = useCallback(() => dispatch({ type: 'SKIP' }), []);
  const setSpeed = useCallback(
    (speed: 'slow' | 'normal' | 'fast') => dispatch({ type: 'SET_SPEED', speed }),
    []
  );

  // Extract public state (without internal fields)
  const publicState: ResolutionAnimationState = {
    phase: state.phase,
    visibleOrders: state.visibleOrders,
    conflictTerritories: state.conflictTerritories,
    currentBattle: state.currentBattle,
    unitPositions: state.unitPositions,
    failedOrders: state.failedOrders,
    dislodgedUnits: state.dislodgedUnits,
    progress: state.progress,
    phaseProgress: state.phaseProgress,
  };

  const controls: ResolutionAnimationControls = {
    play,
    pause,
    reset,
    skip,
    setSpeed,
  };

  return [publicState, controls];
}
