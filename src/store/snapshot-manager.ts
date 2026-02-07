/**
 * SnapshotManager - File-based game state persistence.
 *
 * Handles saving and restoring game state snapshots to the filesystem.
 * Snapshots are stored as human-readable JSON files for debugging.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { StoreSnapshot, MessageRecord } from './game-store';
import { GameStore } from './game-store';
import type { GameState, Power, Season, Phase } from '../engine/types';
import type { GameEvent } from './events';

/**
 * Metadata stored with each snapshot file.
 */
export interface SnapshotMetadata {
  snapshotId: string;
  gameId: string;
  version: number;
  year: number;
  season: Season;
  phase: Phase;
  timestamp: Date;
  eventCount: number;
  messageCount: number;
  description?: string;
  parentSnapshotId?: string; // For what-if branching
}

/**
 * Full snapshot with metadata for file storage.
 * Extends StoreSnapshot with persistence metadata.
 */
export interface FileSnapshot extends StoreSnapshot {
  metadata: SnapshotMetadata;
}

/**
 * Serializable version of snapshot for JSON storage.
 * Maps and Dates need special handling.
 */
interface SerializedSnapshot {
  metadata: {
    snapshotId: string;
    gameId: string;
    version: number;
    year: number;
    season: Season;
    phase: Phase;
    timestamp: string;
    eventCount: number;
    messageCount: number;
    description?: string;
    parentSnapshotId?: string;
  };
  gameId: string;
  version: number;
  state: {
    year: number;
    season: Season;
    phase: Phase;
    units: GameState['units'];
    supplyCenters: Record<string, Power>;
    orders: Record<Power, GameState['orders'] extends Map<Power, infer V> ? V : never>;
    retreats: Record<string, string[]>;
    pendingRetreats: GameState['pendingRetreats'];
    pendingBuilds: Record<Power, number>;
    winner?: Power;
    draw?: boolean;
  };
  events: Array<GameEvent & { timestamp: string }>;
  messages: Array<Omit<MessageRecord, 'timestamp'> & { timestamp: string }>;
}

/**
 * Configuration for the snapshot manager.
 */
export interface SnapshotManagerConfig {
  /** Base directory for storing snapshots */
  snapshotDir: string;
  /** Maximum number of auto-snapshots to keep per game */
  maxAutoSnapshots?: number;
  /** Whether to compress old snapshots (future feature) */
  compressOldSnapshots?: boolean;
}

/**
 * Manages game state snapshots with file system persistence.
 */
export class SnapshotManager {
  private config: Required<SnapshotManagerConfig>;

  constructor(config: SnapshotManagerConfig) {
    this.config = {
      snapshotDir: config.snapshotDir,
      maxAutoSnapshots: config.maxAutoSnapshots ?? 100,
      compressOldSnapshots: config.compressOldSnapshots ?? false,
    };
  }

  /**
   * Generate a unique snapshot ID.
   */
  private generateSnapshotId(gameId: string, year: number, season: Season, phase: Phase): string {
    const timestamp = Date.now();
    return `${gameId}_${year}_${season}_${phase}_${timestamp}`;
  }

  /**
   * Get the directory path for a game's snapshots.
   */
  private getGameDir(gameId: string): string {
    return path.join(this.config.snapshotDir, gameId);
  }

  /**
   * Get the file path for a snapshot.
   */
  private getSnapshotPath(gameId: string, snapshotId: string): string {
    return path.join(this.getGameDir(gameId), `${snapshotId}.json`);
  }

  /**
   * Ensure the snapshot directory exists.
   */
  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * Convert a StoreSnapshot to a serializable format.
   */
  private serializeSnapshot(snapshot: FileSnapshot): SerializedSnapshot {
    const { state, events, messages, metadata } = snapshot;

    // Convert Maps to Records
    const supplyCenters: Record<string, Power> = {};
    state.supplyCenters.forEach((power, territory) => {
      supplyCenters[territory] = power;
    });

    const orders: Record<string, unknown[]> = {};
    state.orders.forEach((orderList, power) => {
      orders[power] = orderList;
    });

    const retreats: Record<string, string[]> = {};
    state.retreats.forEach((options, province) => {
      retreats[province] = options;
    });

    const pendingBuilds: Record<string, number> = {};
    state.pendingBuilds.forEach((count, power) => {
      pendingBuilds[power] = count;
    });

    return {
      metadata: {
        ...metadata,
        timestamp: metadata.timestamp.toISOString(),
      },
      gameId: snapshot.gameId,
      version: snapshot.version,
      state: {
        year: state.year,
        season: state.season,
        phase: state.phase,
        units: state.units,
        supplyCenters,
        orders: orders as SerializedSnapshot['state']['orders'],
        retreats,
        pendingRetreats: state.pendingRetreats,
        pendingBuilds: pendingBuilds as SerializedSnapshot['state']['pendingBuilds'],
        winner: state.winner,
        draw: state.draw,
      },
      events: events.map(e => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
      })) as Array<GameEvent & { timestamp: string }>,
      messages: messages.map(m => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
      })),
    };
  }

  /**
   * Convert a serialized snapshot back to the full format.
   */
  private deserializeSnapshot(serialized: SerializedSnapshot): FileSnapshot {
    const { metadata, state, events, messages } = serialized;

    // Convert Records back to Maps
    const supplyCenters = new Map<string, Power>();
    for (const [territory, power] of Object.entries(state.supplyCenters)) {
      supplyCenters.set(territory, power);
    }

    const orders = new Map<Power, unknown[]>();
    for (const [power, orderList] of Object.entries(state.orders)) {
      orders.set(power as Power, orderList);
    }

    const retreats = new Map<string, string[]>();
    for (const [province, options] of Object.entries(state.retreats)) {
      retreats.set(province, options);
    }

    const pendingBuilds = new Map<Power, number>();
    for (const [power, count] of Object.entries(state.pendingBuilds)) {
      pendingBuilds.set(power as Power, count);
    }

    return {
      metadata: {
        ...metadata,
        timestamp: new Date(metadata.timestamp),
      },
      gameId: serialized.gameId,
      version: serialized.version,
      state: {
        year: state.year,
        season: state.season,
        phase: state.phase,
        units: state.units,
        supplyCenters,
        orders: orders as GameState['orders'],
        retreats,
        pendingRetreats: state.pendingRetreats,
        pendingBuilds: pendingBuilds as GameState['pendingBuilds'],
        winner: state.winner,
        draw: state.draw,
      },
      events: events.map(e => ({
        ...e,
        timestamp: new Date(e.timestamp),
      })),
      messages: messages.map(m => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
    };
  }

  /**
   * Save a snapshot to the filesystem.
   *
   * @param store - The game store to snapshot
   * @param description - Optional description of why this snapshot was taken
   * @param parentSnapshotId - Optional parent snapshot ID for what-if branching
   * @returns The snapshot metadata
   */
  async saveSnapshot(
    store: GameStore,
    description?: string,
    parentSnapshotId?: string
  ): Promise<SnapshotMetadata> {
    const snapshot = store.getSnapshot();
    const state = snapshot.state;

    const snapshotId = this.generateSnapshotId(
      snapshot.gameId,
      state.year,
      state.season,
      state.phase
    );

    const metadata: SnapshotMetadata = {
      snapshotId,
      gameId: snapshot.gameId,
      version: snapshot.version,
      year: state.year,
      season: state.season,
      phase: state.phase,
      timestamp: new Date(),
      eventCount: snapshot.events.length,
      messageCount: snapshot.messages.length,
      description,
      parentSnapshotId,
    };

    const fileSnapshot: FileSnapshot = {
      ...snapshot,
      metadata,
    };

    const gameDir = this.getGameDir(snapshot.gameId);
    await this.ensureDir(gameDir);

    const filePath = this.getSnapshotPath(snapshot.gameId, snapshotId);
    const serialized = this.serializeSnapshot(fileSnapshot);
    await fs.writeFile(filePath, JSON.stringify(serialized, null, 2), 'utf-8');

    // Prune old auto-snapshots if needed
    await this.pruneOldSnapshots(snapshot.gameId);

    return metadata;
  }

  /**
   * Load a snapshot from the filesystem.
   *
   * @param gameId - The game ID
   * @param snapshotId - The snapshot ID to load
   * @returns The loaded snapshot
   */
  async loadSnapshot(gameId: string, snapshotId: string): Promise<FileSnapshot> {
    const filePath = this.getSnapshotPath(gameId, snapshotId);
    const content = await fs.readFile(filePath, 'utf-8');
    const serialized: SerializedSnapshot = JSON.parse(content);
    return this.deserializeSnapshot(serialized);
  }

  /**
   * Restore a game store from a snapshot.
   *
   * @param gameId - The game ID
   * @param snapshotId - The snapshot ID to restore
   * @returns A new GameStore initialized from the snapshot
   */
  async restoreFromSnapshot(gameId: string, snapshotId: string): Promise<GameStore> {
    const snapshot = await this.loadSnapshot(gameId, snapshotId);
    const store = new GameStore(snapshot.gameId);
    store.replayEvents(snapshot.events);
    return store;
  }

  /**
   * Create a "what-if" branch from a snapshot.
   * Returns a new GameStore that can diverge from the snapshot point.
   *
   * @param gameId - The game ID
   * @param snapshotId - The snapshot ID to branch from
   * @param branchGameId - Optional new game ID for the branch (defaults to original with suffix)
   * @returns A new GameStore initialized at the snapshot point
   */
  async createBranch(
    gameId: string,
    snapshotId: string,
    branchGameId?: string
  ): Promise<{ store: GameStore; branchGameId: string; parentSnapshotId: string }> {
    const snapshot = await this.loadSnapshot(gameId, snapshotId);

    // Generate branch ID if not provided
    const newGameId = branchGameId ?? `${gameId}_branch_${Date.now()}`;

    // Create a new store for the branch
    const store = new GameStore(newGameId);
    store.replayEvents(snapshot.events);

    return {
      store,
      branchGameId: newGameId,
      parentSnapshotId: snapshotId,
    };
  }

  /**
   * List all snapshots for a game.
   *
   * @param gameId - The game ID
   * @returns Array of snapshot metadata, sorted by timestamp (newest first)
   */
  async listSnapshots(gameId: string): Promise<SnapshotMetadata[]> {
    const gameDir = this.getGameDir(gameId);

    try {
      const files = await fs.readdir(gameDir);
      const snapshots: SnapshotMetadata[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(gameDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const serialized: SerializedSnapshot = JSON.parse(content);
        snapshots.push({
          ...serialized.metadata,
          timestamp: new Date(serialized.metadata.timestamp),
        });
      }

      // Sort by timestamp, newest first
      snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      return snapshots;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get the latest snapshot for a game.
   *
   * @param gameId - The game ID
   * @returns The latest snapshot metadata, or null if none exists
   */
  async getLatestSnapshot(gameId: string): Promise<SnapshotMetadata | null> {
    const snapshots = await this.listSnapshots(gameId);
    return snapshots.length > 0 ? snapshots[0] : null;
  }

  /**
   * Delete a specific snapshot.
   *
   * @param gameId - The game ID
   * @param snapshotId - The snapshot ID to delete
   */
  async deleteSnapshot(gameId: string, snapshotId: string): Promise<void> {
    const filePath = this.getSnapshotPath(gameId, snapshotId);
    await fs.unlink(filePath);
  }

  /**
   * Prune old auto-snapshots to stay within the configured limit.
   */
  private async pruneOldSnapshots(gameId: string): Promise<void> {
    const snapshots = await this.listSnapshots(gameId);

    if (snapshots.length > this.config.maxAutoSnapshots) {
      // Delete oldest snapshots beyond the limit
      const toDelete = snapshots.slice(this.config.maxAutoSnapshots);
      for (const snapshot of toDelete) {
        await this.deleteSnapshot(gameId, snapshot.snapshotId);
      }
    }
  }

  /**
   * Find snapshots at a specific game phase.
   *
   * @param gameId - The game ID
   * @param year - The year to filter by
   * @param season - The season to filter by
   * @param phase - Optional phase to filter by
   * @returns Array of matching snapshot metadata
   */
  async findSnapshotsAtPhase(
    gameId: string,
    year: number,
    season: Season,
    phase?: Phase
  ): Promise<SnapshotMetadata[]> {
    const snapshots = await this.listSnapshots(gameId);
    return snapshots.filter(s =>
      s.year === year &&
      s.season === season &&
      (phase === undefined || s.phase === phase)
    );
  }

  /**
   * Check if a snapshot exists.
   *
   * @param gameId - The game ID
   * @param snapshotId - The snapshot ID
   * @returns True if the snapshot exists
   */
  async snapshotExists(gameId: string, snapshotId: string): Promise<boolean> {
    const filePath = this.getSnapshotPath(gameId, snapshotId);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete all snapshots for a game.
   *
   * @param gameId - The game ID
   */
  async deleteAllSnapshots(gameId: string): Promise<void> {
    const gameDir = this.getGameDir(gameId);
    try {
      await fs.rm(gameDir, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

/**
 * Event types that should trigger auto-snapshots.
 */
export const AUTO_SNAPSHOT_EVENTS = [
  'MOVEMENT_RESOLVED',
  'RETREATS_RESOLVED',
  'BUILDS_RESOLVED',
  'GAME_ENDED',
] as const;

export type AutoSnapshotEvent = (typeof AUTO_SNAPSHOT_EVENTS)[number];

/**
 * Check if an event type should trigger an auto-snapshot.
 */
export function shouldAutoSnapshot(eventType: string): boolean {
  return AUTO_SNAPSHOT_EVENTS.includes(eventType as AutoSnapshotEvent);
}
