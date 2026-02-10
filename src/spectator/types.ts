/**
 * Types for the Spectator UI system.
 *
 * Provides interfaces for viewing game state, history, and omniscient press access.
 */

import type { GameState as UIGameState, Power as UIPower, Order as UIOrder } from '../types/game';
import type {
  Power as EnginePower,
  Season,
  Phase,
  Order as EngineOrder,
  GameState as EngineGameState,
} from '../engine/types';
import type { Message, ChannelId } from '../press/types';
import type { DeceptionRecord } from '../analysis/deception';
import type { PromiseMemoryUpdate } from '../analysis/promise-tracker';
import type { NarrativeEvent } from '../analysis/narrative';

// Re-export press Power type
export type { EnginePower, Season, Phase };

/**
 * Power type aliases for clarity.
 */
export type LowercasePower = UIPower;
export type UppercasePower = EnginePower;

/**
 * Convert UI power (lowercase) to engine power (uppercase).
 */
export const toEnginePower = (p: LowercasePower): UppercasePower =>
  p.toUpperCase() as UppercasePower;

/**
 * Convert engine power (uppercase) to UI power (lowercase).
 */
export const toUIPower = (p: UppercasePower): LowercasePower =>
  p.toLowerCase() as LowercasePower;

/**
 * All powers in lowercase format.
 */
export const UI_POWERS: LowercasePower[] = [
  'england', 'france', 'germany', 'italy', 'austria', 'russia', 'turkey'
];

/**
 * Power colors for consistent styling across components.
 */
export const POWER_COLORS: Record<LowercasePower, string> = {
  england: '#1e3a5f',
  france: '#5c8dc9',
  germany: '#4a4a4a',
  italy: '#2e7d32',
  austria: '#c62828',
  russia: '#7b1fa2',
  turkey: '#f9a825',
};

/**
 * Analysis data attached to a snapshot.
 */
export interface SnapshotAnalysis {
  deceptions?: DeceptionRecord[];
  promiseUpdates?: PromiseMemoryUpdate[];
  narrativeEvents?: NarrativeEvent[];
}

/**
 * Represents a snapshot of game state at a specific point.
 */
export interface GameSnapshot {
  /** Unique identifier: "YEAR-SEASON-PHASE" */
  id: string;
  year: number;
  season: Season;
  phase: Phase;
  /** Clone of game state at this point */
  gameState: UIGameState;
  /** Orders submitted this turn */
  orders: UIOrder[];
  /** Press messages sent this turn */
  messages: Message[];
  /** Timestamp when snapshot was captured */
  timestamp: Date;
  /** Analysis results for this phase */
  analysis?: SnapshotAnalysis;
}

/**
 * Generates a snapshot ID from game state components.
 */
export function generateSnapshotId(year: number, season: Season, phase: Phase): string {
  return `${year}-${season}-${phase}`;
}

/**
 * Complete history of a game.
 */
export interface GameHistory {
  gameId: string;
  name: string;
  status: 'active' | 'completed' | 'paused';
  /** All recorded snapshots in chronological order */
  snapshots: GameSnapshot[];
  /** Winner if game is completed */
  winner?: LowercasePower;
  /** Players/agents for each power */
  players?: Record<LowercasePower, string>;
  /** Game creation time */
  createdAt: Date;
  /** Last activity time */
  updatedAt: Date;
  /** Live: which agent is currently thinking */
  currentAgent?: string;
}

/**
 * Accumulator for live data during a phase (before snapshot is created).
 * Holds messages and orders as they arrive in real-time.
 */
export interface LiveAccumulator {
  /** Messages received during current phase */
  messages: Message[];
  /** Orders submitted by power during current phase */
  orders: Record<string, UIOrder[]>;
}

/**
 * Current state of the spectator interface.
 */
export interface SpectatorState {
  /** All games indexed by ID */
  games: Map<string, GameHistory>;
  /** Currently selected game */
  activeGameId: string | null;
  /** Viewing mode */
  viewMode: 'live' | 'replay';
  /** Index into snapshots array when in replay mode (null = live) */
  replayPosition: number | null;
  /** Press filtering options */
  pressFilters: PressFilters;
  /** Current view within a game */
  gameViewTab: 'map' | 'orders' | 'press' | 'relationships';
  /** Whether mobile layout is active */
  isMobile: boolean;
  /** Live accumulator for real-time data (keyed by gameId) */
  liveAccumulators: Map<string, LiveAccumulator>;
}

/**
 * Filters for the press timeline/panel.
 */
export interface PressFilters {
  /** Filter to specific channels */
  channels: ChannelId[];
  /** Filter to messages from specific powers */
  powers: LowercasePower[];
  /** Text search query */
  searchQuery: string;
  /** Filter by message intent */
  intents: string[];
}

/**
 * Actions for the spectator reducer.
 */
export type SpectatorAction =
  | { type: 'SET_GAMES'; games: GameHistory[] }
  | { type: 'ADD_GAME'; game: GameHistory }
  | { type: 'UPDATE_GAME'; gameId: string; updates: Partial<GameHistory> }
  | { type: 'REMOVE_GAME'; gameId: string }
  | { type: 'SELECT_GAME'; gameId: string | null }
  | { type: 'SET_VIEW_MODE'; mode: 'live' | 'replay' }
  | { type: 'SET_REPLAY_POSITION'; position: number | null }
  | { type: 'SEEK_TO_SNAPSHOT'; snapshotId: string }
  | { type: 'ADD_SNAPSHOT'; gameId: string; snapshot: GameSnapshot }
  | { type: 'SET_PRESS_FILTERS'; filters: Partial<PressFilters> }
  | { type: 'CLEAR_PRESS_FILTERS' }
  | { type: 'SET_GAME_VIEW_TAB'; tab: 'map' | 'orders' | 'press' | 'relationships' }
  | { type: 'SET_MOBILE'; isMobile: boolean }
  | { type: 'ACCUMULATE_MESSAGES'; gameId: string; messages: Message[] }
  | { type: 'ACCUMULATE_ORDERS'; gameId: string; orders: Record<string, UIOrder[]> }
  | { type: 'CLEAR_LIVE_ACCUMULATOR'; gameId: string };

/**
 * Initial state for the spectator.
 */
export const initialSpectatorState: SpectatorState = {
  games: new Map(),
  activeGameId: null,
  viewMode: 'live',
  replayPosition: null,
  pressFilters: {
    channels: [],
    powers: [],
    searchQuery: '',
    intents: [],
  },
  gameViewTab: 'map',
  isMobile: false,
  liveAccumulators: new Map(),
};

/**
 * Creates an empty live accumulator.
 */
export function createEmptyAccumulator(): LiveAccumulator {
  return { messages: [], orders: {} };
}

/**
 * Gets the live accumulator for the active game.
 */
export function getLiveAccumulator(state: SpectatorState): LiveAccumulator | null {
  if (!state.activeGameId) return null;
  return state.liveAccumulators.get(state.activeGameId) ?? null;
}

/**
 * Gets the current snapshot being viewed.
 */
export function getCurrentSnapshot(state: SpectatorState): GameSnapshot | null {
  if (!state.activeGameId) return null;

  const game = state.games.get(state.activeGameId);
  if (!game || game.snapshots.length === 0) return null;

  if (state.viewMode === 'live' || state.replayPosition === null) {
    return game.snapshots[game.snapshots.length - 1];
  }

  return game.snapshots[state.replayPosition] ?? null;
}

/**
 * Gets the active game.
 */
export function getActiveGame(state: SpectatorState): GameHistory | null {
  if (!state.activeGameId) return null;
  return state.games.get(state.activeGameId) ?? null;
}

/**
 * Checks if currently viewing a live game.
 */
export function isViewingLive(state: SpectatorState): boolean {
  return state.viewMode === 'live' || state.replayPosition === null;
}

/**
 * Summary information for a game card.
 */
export interface GameSummary {
  gameId: string;
  name: string;
  status: 'active' | 'completed' | 'paused';
  currentYear: number;
  currentSeason: Season;
  currentPhase: Phase;
  supplyCenterCounts: Record<LowercasePower, number>;
  unitCounts: Record<LowercasePower, number>;
  winner?: LowercasePower;
  messageCount: number;
  lastActivity: Date;
}

/**
 * Creates a summary from a game history.
 */
export function createGameSummary(game: GameHistory): GameSummary {
  const latestSnapshot = game.snapshots[game.snapshots.length - 1];

  const supplyCenterCounts = {} as Record<LowercasePower, number>;
  const unitCounts = {} as Record<LowercasePower, number>;

  // Initialize counts
  for (const power of UI_POWERS) {
    supplyCenterCounts[power] = 0;
    unitCounts[power] = 0;
  }

  if (latestSnapshot) {
    // Count supply centers
    for (const owner of Object.values(latestSnapshot.gameState.supplyCenters)) {
      if (owner) {
        supplyCenterCounts[owner]++;
      }
    }

    // Count units
    for (const unit of latestSnapshot.gameState.units) {
      unitCounts[unit.power]++;
    }
  }

  // Count total messages
  const messageCount = game.snapshots.reduce(
    (sum, s) => sum + s.messages.length,
    0
  );

  return {
    gameId: game.gameId,
    name: game.name,
    status: game.status,
    currentYear: latestSnapshot?.year ?? 1901,
    currentSeason: latestSnapshot?.season ?? 'SPRING',
    currentPhase: latestSnapshot?.phase ?? 'DIPLOMACY',
    supplyCenterCounts,
    unitCounts,
    winner: game.winner,
    messageCount,
    lastActivity: game.updatedAt,
  };
}

/**
 * Converts engine GameState to UI GameState for display.
 */
export function engineToUIGameState(engineState: EngineGameState): UIGameState {
  const supplyCenters: Record<string, UIPower | undefined> = {};
  engineState.supplyCenters.forEach((power, territory) => {
    supplyCenters[territory.toLowerCase()] = toUIPower(power);
  });

  return {
    phase: engineState.phase.toLowerCase() as UIGameState['phase'],
    year: engineState.year,
    units: engineState.units.map(u => ({
      type: u.type.toLowerCase() as 'army' | 'fleet',
      power: toUIPower(u.power),
      territory: u.province.toLowerCase(),
    })),
    orders: [], // Orders need separate conversion
    supplyCenters,
  };
}

/**
 * Converts engine Order to UI Order format.
 * Province IDs are converted to lowercase to match territory data.
 */
export function engineToUIOrder(order: EngineOrder): UIOrder {
  switch (order.type) {
    case 'HOLD':
      return { type: 'hold', unit: order.unit.toLowerCase() };
    case 'MOVE':
      return { type: 'move', unit: order.unit.toLowerCase(), target: order.destination.toLowerCase() };
    case 'SUPPORT':
      return {
        type: 'support',
        unit: order.unit.toLowerCase(),
        target: order.supportedUnit.toLowerCase(),
        supportTarget: order.destination?.toLowerCase(),
      };
    case 'CONVOY':
      return {
        type: 'convoy',
        unit: order.unit.toLowerCase(),
        target: order.convoyedUnit.toLowerCase(),
        supportTarget: order.destination.toLowerCase(),
      };
  }
}
