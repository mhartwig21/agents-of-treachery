/**
 * React context for spectator state management.
 *
 * Provides centralized state for game viewing, replay navigation, and press filtering.
 */

import React, { createContext, useContext, useReducer, useCallback, useEffect, type ReactNode } from 'react';
import {
  type SpectatorState,
  type SpectatorAction,
  type GameHistory,
  type GameSnapshot,
  type PressFilters,
  type LiveAccumulator,
  initialSpectatorState,
  getCurrentSnapshot,
  getActiveGame,
  isViewingLive,
  getLiveAccumulator,
  createEmptyAccumulator,
} from './types';
import type { Message } from '../press/types';
import type { Order as UIOrder } from '../types/game';

/**
 * Reducer for spectator state.
 */
export function spectatorReducer(state: SpectatorState, action: SpectatorAction): SpectatorState {
  switch (action.type) {
    case 'SET_GAMES': {
      const games = new Map<string, GameHistory>();
      for (const game of action.games) {
        games.set(game.gameId, game);
      }
      return { ...state, games };
    }

    case 'ADD_GAME': {
      const games = new Map(state.games);
      games.set(action.game.gameId, action.game);
      return { ...state, games };
    }

    case 'UPDATE_GAME': {
      const existing = state.games.get(action.gameId);
      if (!existing) return state;
      const games = new Map(state.games);
      games.set(action.gameId, { ...existing, ...action.updates });
      return { ...state, games };
    }

    case 'REMOVE_GAME': {
      const games = new Map(state.games);
      games.delete(action.gameId);
      // Clear active game if it was removed
      const activeGameId = state.activeGameId === action.gameId ? null : state.activeGameId;
      return { ...state, games, activeGameId };
    }

    case 'SELECT_GAME': {
      return {
        ...state,
        activeGameId: action.gameId,
        replayPosition: null,
        gameViewTab: 'map',
      };
    }

    case 'SET_REPLAY_POSITION': {
      return { ...state, replayPosition: action.position };
    }

    case 'SEEK_TO_SNAPSHOT': {
      const game = state.activeGameId ? state.games.get(state.activeGameId) : null;
      if (!game) return state;
      const position = game.snapshots.findIndex(s => s.id === action.snapshotId);
      if (position === -1) return state;
      return { ...state, replayPosition: position };
    }

    case 'ADD_SNAPSHOT': {
      const existing = state.games.get(action.gameId);
      if (!existing) return state;
      const games = new Map(state.games);
      games.set(action.gameId, {
        ...existing,
        snapshots: [...existing.snapshots, action.snapshot],
        updatedAt: new Date(),
      });
      // Clear the live accumulator when a snapshot is added (data is now in snapshot)
      const liveAccumulators = new Map(state.liveAccumulators);
      liveAccumulators.delete(action.gameId);
      return { ...state, games, liveAccumulators };
    }

    case 'ACCUMULATE_MESSAGES': {
      const liveAccumulators = new Map(state.liveAccumulators);
      const existing = liveAccumulators.get(action.gameId) ?? createEmptyAccumulator();
      // Deduplicate by message id (if available) to avoid duplicates
      const existingIds = new Set(existing.messages.map(m => m.id));
      const newMessages = action.messages.filter(m => !existingIds.has(m.id));
      liveAccumulators.set(action.gameId, {
        ...existing,
        messages: [...existing.messages, ...newMessages],
      });
      return { ...state, liveAccumulators };
    }

    case 'ACCUMULATE_ORDERS': {
      const liveAccumulators = new Map(state.liveAccumulators);
      const existing = liveAccumulators.get(action.gameId) ?? createEmptyAccumulator();
      // Merge orders by power (replace existing orders for a power)
      const mergedOrders = { ...existing.orders };
      for (const [power, orders] of Object.entries(action.orders)) {
        mergedOrders[power] = orders;
      }
      liveAccumulators.set(action.gameId, {
        ...existing,
        orders: mergedOrders,
      });
      return { ...state, liveAccumulators };
    }

    case 'CLEAR_LIVE_ACCUMULATOR': {
      const liveAccumulators = new Map(state.liveAccumulators);
      liveAccumulators.delete(action.gameId);
      return { ...state, liveAccumulators };
    }

    case 'SET_PRESS_FILTERS': {
      return {
        ...state,
        pressFilters: { ...state.pressFilters, ...action.filters },
      };
    }

    case 'CLEAR_PRESS_FILTERS': {
      return {
        ...state,
        pressFilters: {
          channels: [],
          powers: [],
          searchQuery: '',
          intents: [],
        },
      };
    }

    case 'SET_GAME_VIEW_TAB': {
      return { ...state, gameViewTab: action.tab };
    }

    case 'SET_MOBILE': {
      return { ...state, isMobile: action.isMobile };
    }

    default:
      return state;
  }
}

/**
 * Context value type.
 */
interface SpectatorContextValue {
  state: SpectatorState;
  dispatch: React.Dispatch<SpectatorAction>;

  // Derived state helpers
  currentSnapshot: GameSnapshot | null;
  activeGame: GameHistory | null;
  isLive: boolean;
  liveAccumulator: LiveAccumulator | null;

  // Action helpers
  selectGame: (gameId: string | null) => void;
  seekToPosition: (position: number) => void;
  seekToSnapshot: (snapshotId: string) => void;
  stepForward: () => void;
  stepBackward: () => void;
  goToLive: () => void;
  setPressFilters: (filters: Partial<PressFilters>) => void;
  clearPressFilters: () => void;
  setGameViewTab: (tab: 'map' | 'orders' | 'press' | 'relationships') => void;

  // Game management
  addGame: (game: GameHistory) => void;
  updateGame: (gameId: string, updates: Partial<GameHistory>) => void;
  removeGame: (gameId: string) => void;
  addSnapshot: (gameId: string, snapshot: GameSnapshot) => void;

  // Live accumulator management
  accumulateMessages: (gameId: string, messages: Message[]) => void;
  accumulateOrders: (gameId: string, orders: Record<string, UIOrder[]>) => void;
  clearLiveAccumulator: (gameId: string) => void;
}

const SpectatorContext = createContext<SpectatorContextValue | null>(null);

/**
 * Provider props.
 */
interface SpectatorProviderProps {
  children: ReactNode;
  initialGames?: GameHistory[];
}

/**
 * Provider component for spectator state.
 */
export function SpectatorProvider({ children, initialGames = [] }: SpectatorProviderProps) {
  const [state, dispatch] = useReducer(spectatorReducer, {
    ...initialSpectatorState,
    games: new Map(initialGames.map(g => [g.gameId, g])),
  });

  // Detect mobile layout
  useEffect(() => {
    const checkMobile = () => {
      dispatch({ type: 'SET_MOBILE', isMobile: window.innerWidth < 768 });
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Derived state
  const currentSnapshot = getCurrentSnapshot(state);
  const activeGame = getActiveGame(state);
  const isLive = isViewingLive(state);
  const liveAccumulator = getLiveAccumulator(state);

  // Action helpers
  const selectGame = useCallback((gameId: string | null) => {
    dispatch({ type: 'SELECT_GAME', gameId });
  }, []);

  const seekToPosition = useCallback((position: number) => {
    dispatch({ type: 'SET_REPLAY_POSITION', position });
  }, []);

  const seekToSnapshot = useCallback((snapshotId: string) => {
    dispatch({ type: 'SEEK_TO_SNAPSHOT', snapshotId });
  }, []);

  const stepForward = useCallback(() => {
    if (!activeGame || state.replayPosition === null) return;
    const nextPos = Math.min(state.replayPosition + 1, activeGame.snapshots.length - 1);
    dispatch({ type: 'SET_REPLAY_POSITION', position: nextPos });
  }, [activeGame, state.replayPosition]);

  const stepBackward = useCallback(() => {
    // If at latest position, scrub back to second-to-last snapshot
    if (state.replayPosition === null) {
      if (!activeGame || activeGame.snapshots.length < 2) return;
      dispatch({ type: 'SET_REPLAY_POSITION', position: activeGame.snapshots.length - 2 });
      return;
    }
    const prevPos = Math.max(state.replayPosition - 1, 0);
    dispatch({ type: 'SET_REPLAY_POSITION', position: prevPos });
  }, [state.replayPosition, activeGame]);

  const goToLive = useCallback(() => {
    dispatch({ type: 'SET_REPLAY_POSITION', position: null });
  }, []);

  const setPressFilters = useCallback((filters: Partial<PressFilters>) => {
    dispatch({ type: 'SET_PRESS_FILTERS', filters });
  }, []);

  const clearPressFilters = useCallback(() => {
    dispatch({ type: 'CLEAR_PRESS_FILTERS' });
  }, []);

  const setGameViewTab = useCallback((tab: 'map' | 'orders' | 'press' | 'relationships') => {
    dispatch({ type: 'SET_GAME_VIEW_TAB', tab });
  }, []);

  const addGame = useCallback((game: GameHistory) => {
    dispatch({ type: 'ADD_GAME', game });
  }, []);

  const updateGame = useCallback((gameId: string, updates: Partial<GameHistory>) => {
    dispatch({ type: 'UPDATE_GAME', gameId, updates });
  }, []);

  const removeGame = useCallback((gameId: string) => {
    dispatch({ type: 'REMOVE_GAME', gameId });
  }, []);

  const addSnapshot = useCallback((gameId: string, snapshot: GameSnapshot) => {
    dispatch({ type: 'ADD_SNAPSHOT', gameId, snapshot });
  }, []);

  const accumulateMessages = useCallback((gameId: string, messages: Message[]) => {
    dispatch({ type: 'ACCUMULATE_MESSAGES', gameId, messages });
  }, []);

  const accumulateOrders = useCallback((gameId: string, orders: Record<string, UIOrder[]>) => {
    dispatch({ type: 'ACCUMULATE_ORDERS', gameId, orders });
  }, []);

  const clearLiveAccumulator = useCallback((gameId: string) => {
    dispatch({ type: 'CLEAR_LIVE_ACCUMULATOR', gameId });
  }, []);

  const value: SpectatorContextValue = {
    state,
    dispatch,
    currentSnapshot,
    activeGame,
    isLive,
    liveAccumulator,
    selectGame,
    seekToPosition,
    seekToSnapshot,
    stepForward,
    stepBackward,
    goToLive,
    setPressFilters,
    clearPressFilters,
    setGameViewTab,
    addGame,
    updateGame,
    removeGame,
    addSnapshot,
    accumulateMessages,
    accumulateOrders,
    clearLiveAccumulator,
  };

  return (
    <SpectatorContext.Provider value={value}>
      {children}
    </SpectatorContext.Provider>
  );
}

/**
 * Hook to access spectator context.
 */
export function useSpectator(): SpectatorContextValue {
  const context = useContext(SpectatorContext);
  if (!context) {
    throw new Error('useSpectator must be used within a SpectatorProvider');
  }
  return context;
}

/**
 * Hook for replay controls with auto-play support.
 */
export function useReplayControls(autoPlaySpeed: number = 1000) {
  const {
    state,
    activeGame,
    isLive,
    seekToPosition,
    stepForward,
    stepBackward,
    goToLive,
  } = useSpectator();

  const [isPlaying, setIsPlaying] = React.useState(false);

  // Auto-play effect
  useEffect(() => {
    if (!isPlaying || isLive || !activeGame) return;

    const interval = setInterval(() => {
      const currentPos = state.replayPosition ?? 0;
      if (currentPos >= activeGame.snapshots.length - 1) {
        setIsPlaying(false);
      } else {
        stepForward();
      }
    }, autoPlaySpeed);

    return () => clearInterval(interval);
  }, [isPlaying, isLive, activeGame, state.replayPosition, stepForward, autoPlaySpeed]);

  const play = useCallback(() => {
    if (isLive) {
      // Start from beginning when at latest position
      seekToPosition(0);
    }
    setIsPlaying(true);
  }, [isLive, seekToPosition]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  return {
    isPlaying,
    play,
    pause,
    togglePlay,
    stepForward,
    stepBackward,
    goToLive,
    seekToPosition,
    currentPosition: state.replayPosition,
    totalSnapshots: activeGame?.snapshots.length ?? 0,
    isLive,
  };
}
