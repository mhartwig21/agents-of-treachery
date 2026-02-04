/**
 * Auto-snapshot integration for GameSession.
 *
 * Provides automatic snapshotting at phase boundaries for crash recovery
 * and game replay.
 */

import { GameSession } from '../orchestration/session';
import { GameStore } from './game-store';
import { SnapshotManager, SnapshotMetadata, shouldAutoSnapshot } from './snapshot-manager';
import type { GameEvent } from '../orchestration/types';

/**
 * Configuration for auto-snapshotting.
 */
export interface AutoSnapshotConfig {
  /** Snapshot manager to use for persistence */
  manager: SnapshotManager;
  /** Whether to snapshot on every phase resolution (default: true) */
  snapshotOnPhaseResolution?: boolean;
  /** Whether to snapshot on game completion (default: true) */
  snapshotOnCompletion?: boolean;
  /** Callback when a snapshot is taken */
  onSnapshot?: (metadata: SnapshotMetadata) => void;
  /** Callback on snapshot error */
  onError?: (error: Error) => void;
}

/**
 * Tracks snapshot state for a session.
 */
interface SnapshotTracker {
  session: GameSession;
  store: GameStore;
  unsubscribe: () => void;
  lastSnapshotId?: string;
}

/**
 * Manages auto-snapshotting for a game session.
 * Call enableAutoSnapshot to start tracking, then cleanup when done.
 */
export function enableAutoSnapshot(
  session: GameSession,
  config: AutoSnapshotConfig
): AutoSnapshotHandle {
  const {
    manager,
    snapshotOnPhaseResolution = true,
    snapshotOnCompletion = true,
    onSnapshot,
    onError,
  } = config;

  // Create a GameStore to track events for snapshotting
  const store = new GameStore(session.getGameId());
  const gameState = session.getGameState();

  // Initialize store with current game state
  const supplyCenters = new Map(gameState.supplyCenters);
  store.initializeGame(gameState.units, supplyCenters);

  // Subscribe to session events to keep store in sync
  const unsubscribe = session.onEvent((event: GameEvent) => {
    // Update store based on event type
    syncStoreWithEvent(store, event, session);

    // Check if we should auto-snapshot
    if (shouldAutoSnapshot(event.type)) {
      if (
        (snapshotOnPhaseResolution && event.type !== 'GAME_COMPLETED') ||
        (snapshotOnCompletion && event.type === 'GAME_COMPLETED')
      ) {
        takeSnapshot(store, manager, event, onSnapshot, onError);
      }
    }
  });

  const tracker: SnapshotTracker = {
    session,
    store,
    unsubscribe,
  };

  return new AutoSnapshotHandle(tracker, manager, onSnapshot, onError);
}

/**
 * Syncs the GameStore with a session event.
 */
function syncStoreWithEvent(
  store: GameStore,
  event: GameEvent,
  session: GameSession
): void {
  const state = session.getGameState();

  switch (event.type) {
    case 'ORDERS_RESOLVED':
      // Phase was resolved - store is already updated via session
      // We just need to record the phase transition
      if ('year' in event && 'season' in event) {
        const e = event as { year: number; season: 'SPRING' | 'FALL'; phase?: string };
        // Note: The orchestrator emits ORDERS_RESOLVED after resolution
        // We'll capture state via snapshot rather than trying to replay
      }
      break;

    case 'PHASE_STARTED':
      // New phase started - update store to match session state
      if ('year' in event && 'season' in event && 'phase' in event) {
        const e = event as { year: number; season: 'SPRING' | 'FALL'; phase: string };
        const currentState = store.getState();
        if (
          currentState.year !== e.year ||
          currentState.season !== e.season ||
          currentState.phase !== e.phase
        ) {
          store.advancePhase(
            currentState.year,
            currentState.season,
            currentState.phase,
            e.year,
            e.season as 'SPRING' | 'FALL',
            e.phase as 'DIPLOMACY' | 'MOVEMENT' | 'RETREAT' | 'BUILD'
          );
        }
      }
      break;

    case 'GAME_COMPLETED':
      // Game ended
      store.endGame(state.winner, state.draw || false, state.year);
      break;

    default:
      // Other events don't require store updates
      break;
  }
}

/**
 * Takes a snapshot asynchronously.
 */
async function takeSnapshot(
  store: GameStore,
  manager: SnapshotManager,
  event: GameEvent,
  onSnapshot?: (metadata: SnapshotMetadata) => void,
  onError?: (error: Error) => void
): Promise<void> {
  try {
    const description = `Auto-snapshot after ${event.type}`;
    const metadata = await manager.saveSnapshot(store, description);

    if (onSnapshot) {
      onSnapshot(metadata);
    }
  } catch (error) {
    if (onError) {
      onError(error as Error);
    } else {
      console.error('Auto-snapshot failed:', error);
    }
  }
}

/**
 * Handle for managing auto-snapshot lifecycle.
 */
export class AutoSnapshotHandle {
  private tracker: SnapshotTracker;
  private manager: SnapshotManager;
  private onSnapshot?: (metadata: SnapshotMetadata) => void;
  private onError?: (error: Error) => void;
  private disposed = false;

  constructor(
    tracker: SnapshotTracker,
    manager: SnapshotManager,
    onSnapshot?: (metadata: SnapshotMetadata) => void,
    onError?: (error: Error) => void
  ) {
    this.tracker = tracker;
    this.manager = manager;
    this.onSnapshot = onSnapshot;
    this.onError = onError;
  }

  /**
   * Gets the underlying game store.
   */
  getStore(): GameStore {
    return this.tracker.store;
  }

  /**
   * Takes a manual snapshot.
   */
  async snapshot(description?: string): Promise<SnapshotMetadata> {
    if (this.disposed) {
      throw new Error('AutoSnapshotHandle has been disposed');
    }

    try {
      const metadata = await this.manager.saveSnapshot(
        this.tracker.store,
        description
      );

      if (this.onSnapshot) {
        this.onSnapshot(metadata);
      }

      this.tracker.lastSnapshotId = metadata.snapshotId;
      return metadata;
    } catch (error) {
      if (this.onError) {
        this.onError(error as Error);
      }
      throw error;
    }
  }

  /**
   * Gets the ID of the last snapshot taken.
   */
  getLastSnapshotId(): string | undefined {
    return this.tracker.lastSnapshotId;
  }

  /**
   * Stops auto-snapshotting and cleans up.
   */
  dispose(): void {
    if (!this.disposed) {
      this.tracker.unsubscribe();
      this.disposed = true;
    }
  }
}

/**
 * Restore a GameSession from a snapshot.
 *
 * @param manager - The snapshot manager
 * @param gameId - The game ID
 * @param snapshotId - The snapshot ID to restore from
 * @returns A new GameSession restored to the snapshot state
 */
export async function restoreSession(
  manager: SnapshotManager,
  gameId: string,
  snapshotId: string
): Promise<{ session: GameSession; store: GameStore }> {
  const snapshot = await manager.loadSnapshot(gameId, snapshotId);
  const store = await manager.restoreFromSnapshot(gameId, snapshotId);

  // Create a new session with the restored state
  const { GameSessionSnapshot } = await import('../orchestration/types');
  const { GameSession } = await import('../orchestration/session');

  // Build session snapshot from store snapshot
  const sessionSnapshot = {
    gameId: snapshot.gameId,
    status: snapshot.state.winner || snapshot.state.draw ? 'COMPLETED' : 'ACTIVE',
    gameState: snapshot.state,
    phaseStatus: null,
    agents: [],
    eventHistory: [],
    createdAt: snapshot.metadata.timestamp,
    startedAt: snapshot.metadata.timestamp,
    completedAt: snapshot.state.winner || snapshot.state.draw
      ? snapshot.metadata.timestamp
      : undefined,
  };

  const session = GameSession.fromSnapshot(sessionSnapshot as any);

  return { session, store };
}

/**
 * Create a "what-if" branch from a snapshot.
 *
 * @param manager - The snapshot manager
 * @param gameId - The original game ID
 * @param snapshotId - The snapshot ID to branch from
 * @param branchGameId - Optional custom game ID for the branch
 * @returns A new GameSession at the branch point
 */
export async function createBranchSession(
  manager: SnapshotManager,
  gameId: string,
  snapshotId: string,
  branchGameId?: string
): Promise<{
  session: GameSession;
  store: GameStore;
  branchGameId: string;
  parentSnapshotId: string;
}> {
  const { store, branchGameId: newGameId, parentSnapshotId } =
    await manager.createBranch(gameId, snapshotId, branchGameId);

  const snapshot = await manager.loadSnapshot(gameId, snapshotId);

  // Create a new session for the branch
  const { GameSession } = await import('../orchestration/session');

  const sessionSnapshot = {
    gameId: newGameId,
    status: 'ACTIVE' as const,
    gameState: snapshot.state,
    phaseStatus: null,
    agents: [],
    eventHistory: [],
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: undefined,
  };

  const session = GameSession.fromSnapshot(sessionSnapshot as any);

  return {
    session,
    store,
    branchGameId: newGameId,
    parentSnapshotId,
  };
}
