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
  initialSpectatorState,
  getCurrentSnapshot,
  getActiveGame,
  isViewingLive,
} from './types';

/**
 * Reducer for spectator state.
 */
function spectatorReducer(state: SpectatorState, action: SpectatorAction): SpectatorState {
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
        viewMode: 'live',
        replayPosition: null,
        gameViewTab: 'map',
      };
    }

    case 'SET_VIEW_MODE': {
      if (action.mode === 'live') {
        return { ...state, viewMode: 'live', replayPosition: null };
      }
      // When switching to replay, start at the latest snapshot
      const game = state.activeGameId ? state.games.get(state.activeGameId) : null;
      const position = game ? game.snapshots.length - 1 : null;
      return { ...state, viewMode: 'replay', replayPosition: position };
    }

    case 'SET_REPLAY_POSITION': {
      return { ...state, replayPosition: action.position };
    }

    case 'SEEK_TO_SNAPSHOT': {
      const game = state.activeGameId ? state.games.get(state.activeGameId) : null;
      if (!game) return state;
      const position = game.snapshots.findIndex(s => s.id === action.snapshotId);
      if (position === -1) return state;
      return { ...state, viewMode: 'replay', replayPosition: position };
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
      return { ...state, games };
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

  // Action helpers
  selectGame: (gameId: string | null) => void;
  setViewMode: (mode: 'live' | 'replay') => void;
  seekToPosition: (position: number) => void;
  seekToSnapshot: (snapshotId: string) => void;
  stepForward: () => void;
  stepBackward: () => void;
  goToLive: () => void;
  setPressFilters: (filters: Partial<PressFilters>) => void;
  clearPressFilters: () => void;
  setGameViewTab: (tab: 'map' | 'orders' | 'press') => void;

  // Game management
  addGame: (game: GameHistory) => void;
  updateGame: (gameId: string, updates: Partial<GameHistory>) => void;
  removeGame: (gameId: string) => void;
  addSnapshot: (gameId: string, snapshot: GameSnapshot) => void;
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

  // Action helpers
  const selectGame = useCallback((gameId: string | null) => {
    dispatch({ type: 'SELECT_GAME', gameId });
  }, []);

  const setViewMode = useCallback((mode: 'live' | 'replay') => {
    dispatch({ type: 'SET_VIEW_MODE', mode });
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
    if (state.replayPosition === null) return;
    const prevPos = Math.max(state.replayPosition - 1, 0);
    dispatch({ type: 'SET_REPLAY_POSITION', position: prevPos });
  }, [state.replayPosition]);

  const goToLive = useCallback(() => {
    dispatch({ type: 'SET_VIEW_MODE', mode: 'live' });
  }, []);

  const setPressFilters = useCallback((filters: Partial<PressFilters>) => {
    dispatch({ type: 'SET_PRESS_FILTERS', filters });
  }, []);

  const clearPressFilters = useCallback(() => {
    dispatch({ type: 'CLEAR_PRESS_FILTERS' });
  }, []);

  const setGameViewTab = useCallback((tab: 'map' | 'orders' | 'press') => {
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

  const value: SpectatorContextValue = {
    state,
    dispatch,
    currentSnapshot,
    activeGame,
    isLive,
    selectGame,
    setViewMode,
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
    setViewMode,
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
      // Start from beginning when switching from live mode
      setViewMode('replay');
      seekToPosition(0);
    }
    setIsPlaying(true);
  }, [isLive, setViewMode, seekToPosition]);

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
