/**
 * Tests for SnapshotManager file-based persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SnapshotManager, shouldAutoSnapshot, AUTO_SNAPSHOT_EVENTS } from '../snapshot-manager';
import { GameStore } from '../game-store';
import type { Unit, Power } from '../../engine/types';

describe('SnapshotManager', () => {
  let manager: SnapshotManager;
  let store: GameStore;
  let tempDir: string;

  const initialUnits: Unit[] = [
    { type: 'FLEET', power: 'ENGLAND', province: 'LON' },
    { type: 'FLEET', power: 'ENGLAND', province: 'EDI' },
    { type: 'ARMY', power: 'ENGLAND', province: 'LVP' },
    { type: 'ARMY', power: 'FRANCE', province: 'PAR' },
    { type: 'ARMY', power: 'FRANCE', province: 'MAR' },
  ];

  const initialSupplyCenters = new Map<string, Power>([
    ['LON', 'ENGLAND'],
    ['EDI', 'ENGLAND'],
    ['LVP', 'ENGLAND'],
    ['PAR', 'FRANCE'],
    ['MAR', 'FRANCE'],
  ]);

  beforeEach(async () => {
    // Create a temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-snapshots-'));
    manager = new SnapshotManager({ snapshotDir: tempDir });

    store = new GameStore('test-game-001');
    store.initializeGame(initialUnits, initialSupplyCenters);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('saveSnapshot', () => {
    it('should save a snapshot to the filesystem', async () => {
      const metadata = await manager.saveSnapshot(store);

      expect(metadata.gameId).toBe('test-game-001');
      expect(metadata.version).toBe(1);
      expect(metadata.year).toBe(1901);
      expect(metadata.season).toBe('SPRING');
      expect(metadata.phase).toBe('DIPLOMACY');
      expect(metadata.eventCount).toBe(1);
      expect(metadata.messageCount).toBe(0);
    });

    it('should create a readable JSON file', async () => {
      const metadata = await manager.saveSnapshot(store);

      const filePath = path.join(tempDir, 'test-game-001', `${metadata.snapshotId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.metadata.snapshotId).toBe(metadata.snapshotId);
      expect(parsed.state.year).toBe(1901);
      expect(parsed.state.units).toHaveLength(5);
    });

    it('should include description when provided', async () => {
      const metadata = await manager.saveSnapshot(store, 'Test snapshot');

      expect(metadata.description).toBe('Test snapshot');
    });

    it('should include parent snapshot ID for branches', async () => {
      const parentMeta = await manager.saveSnapshot(store, 'Parent snapshot');
      const childMeta = await manager.saveSnapshot(store, 'Child snapshot', parentMeta.snapshotId);

      expect(childMeta.parentSnapshotId).toBe(parentMeta.snapshotId);
    });
  });

  describe('loadSnapshot', () => {
    it('should load a previously saved snapshot', async () => {
      const metadata = await manager.saveSnapshot(store);
      const loaded = await manager.loadSnapshot('test-game-001', metadata.snapshotId);

      expect(loaded.gameId).toBe('test-game-001');
      expect(loaded.version).toBe(1);
      expect(loaded.state.units).toHaveLength(5);
      expect(loaded.state.supplyCenters.size).toBe(5);
    });

    it('should preserve all game state', async () => {
      // Add some game state changes
      store.submitOrders('ENGLAND', [{ type: 'HOLD', unit: 'LON' }], 1901, 'SPRING');
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');
      store.recordMessage('msg-1', 'ch-1', 'ENGLAND', 'Hello France!');

      const metadata = await manager.saveSnapshot(store);
      const loaded = await manager.loadSnapshot('test-game-001', metadata.snapshotId);

      expect(loaded.state.season).toBe('FALL');
      expect(loaded.events.length).toBe(4); // GAME_CREATED, ORDERS_SUBMITTED, PHASE_ADVANCED, MESSAGE_SENT
      expect(loaded.messages.length).toBe(1);
      expect(loaded.messages[0].content).toBe('Hello France!');
    });

    it('should throw for non-existent snapshot', async () => {
      await expect(
        manager.loadSnapshot('test-game-001', 'non-existent')
      ).rejects.toThrow();
    });
  });

  describe('restoreFromSnapshot', () => {
    it('should create a new store from a snapshot', async () => {
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');
      const metadata = await manager.saveSnapshot(store);

      const restored = await manager.restoreFromSnapshot('test-game-001', metadata.snapshotId);
      const state = restored.getState();

      expect(state.year).toBe(1901);
      expect(state.season).toBe('FALL');
      expect(state.units).toHaveLength(5);
    });

    it('should restore full event history', async () => {
      store.submitOrders('ENGLAND', [{ type: 'HOLD', unit: 'LON' }], 1901, 'SPRING');
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');

      const metadata = await manager.saveSnapshot(store);
      const restored = await manager.restoreFromSnapshot('test-game-001', metadata.snapshotId);

      expect(restored.getEvents()).toHaveLength(3);
    });
  });

  describe('createBranch', () => {
    it('should create a new store with the original game state', async () => {
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');
      const metadata = await manager.saveSnapshot(store);

      const { store: branchStore, branchGameId, parentSnapshotId } =
        await manager.createBranch('test-game-001', metadata.snapshotId);

      expect(branchGameId).toContain('test-game-001_branch_');
      expect(parentSnapshotId).toBe(metadata.snapshotId);
      expect(branchStore.getState().season).toBe('FALL');
    });

    it('should allow custom branch game ID', async () => {
      const metadata = await manager.saveSnapshot(store);

      const { branchGameId } = await manager.createBranch(
        'test-game-001',
        metadata.snapshotId,
        'custom-branch-id'
      );

      expect(branchGameId).toBe('custom-branch-id');
    });

    it('should allow branch to diverge independently', async () => {
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');
      const metadata = await manager.saveSnapshot(store);

      // Create branch
      const { store: branchStore } = await manager.createBranch(
        'test-game-001',
        metadata.snapshotId
      );

      // Advance original
      store.advancePhase(1901, 'FALL', 'DIPLOMACY', 1902, 'SPRING', 'DIPLOMACY');

      // Advance branch differently (still at FALL, different actions)
      branchStore.captureSupplyCenters(1901, 'FALL', [
        { territory: 'BEL', from: null, to: 'ENGLAND' },
      ]);

      // Verify they diverged
      expect(store.getState().year).toBe(1902);
      expect(branchStore.getState().year).toBe(1901);
      expect(branchStore.getState().supplyCenters.get('BEL')).toBe('ENGLAND');
      expect(store.getState().supplyCenters.has('BEL')).toBe(false);
    });
  });

  describe('listSnapshots', () => {
    it('should return empty array for no snapshots', async () => {
      const snapshots = await manager.listSnapshots('non-existent-game');
      expect(snapshots).toEqual([]);
    });

    it('should list all snapshots for a game', async () => {
      await manager.saveSnapshot(store);
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');
      await manager.saveSnapshot(store);

      const snapshots = await manager.listSnapshots('test-game-001');
      expect(snapshots).toHaveLength(2);
    });

    it('should sort snapshots by timestamp, newest first', async () => {
      const first = await manager.saveSnapshot(store, 'First');
      await new Promise(resolve => setTimeout(resolve, 10));
      const second = await manager.saveSnapshot(store, 'Second');

      const snapshots = await manager.listSnapshots('test-game-001');
      expect(snapshots[0].snapshotId).toBe(second.snapshotId);
      expect(snapshots[1].snapshotId).toBe(first.snapshotId);
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return null for no snapshots', async () => {
      const latest = await manager.getLatestSnapshot('non-existent-game');
      expect(latest).toBeNull();
    });

    it('should return the most recent snapshot', async () => {
      await manager.saveSnapshot(store, 'First');
      await new Promise(resolve => setTimeout(resolve, 10));
      const second = await manager.saveSnapshot(store, 'Second');

      const latest = await manager.getLatestSnapshot('test-game-001');
      expect(latest?.snapshotId).toBe(second.snapshotId);
    });
  });

  describe('deleteSnapshot', () => {
    it('should delete a specific snapshot', async () => {
      const meta1 = await manager.saveSnapshot(store, 'First');
      const meta2 = await manager.saveSnapshot(store, 'Second');

      await manager.deleteSnapshot('test-game-001', meta1.snapshotId);

      const snapshots = await manager.listSnapshots('test-game-001');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].snapshotId).toBe(meta2.snapshotId);
    });
  });

  describe('findSnapshotsAtPhase', () => {
    it('should find snapshots matching year and season', async () => {
      await manager.saveSnapshot(store);
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'FALL', 'DIPLOMACY');
      await manager.saveSnapshot(store);

      const spring = await manager.findSnapshotsAtPhase('test-game-001', 1901, 'SPRING');
      const fall = await manager.findSnapshotsAtPhase('test-game-001', 1901, 'FALL');

      expect(spring).toHaveLength(1);
      expect(fall).toHaveLength(1);
    });

    it('should filter by phase when specified', async () => {
      await manager.saveSnapshot(store);
      store.advancePhase(1901, 'SPRING', 'DIPLOMACY', 1901, 'SPRING', 'MOVEMENT');
      await manager.saveSnapshot(store);

      const diplomacy = await manager.findSnapshotsAtPhase(
        'test-game-001', 1901, 'SPRING', 'DIPLOMACY'
      );
      const movement = await manager.findSnapshotsAtPhase(
        'test-game-001', 1901, 'SPRING', 'MOVEMENT'
      );

      expect(diplomacy).toHaveLength(1);
      expect(movement).toHaveLength(1);
    });
  });

  describe('snapshotExists', () => {
    it('should return true for existing snapshot', async () => {
      const meta = await manager.saveSnapshot(store);
      const exists = await manager.snapshotExists('test-game-001', meta.snapshotId);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent snapshot', async () => {
      const exists = await manager.snapshotExists('test-game-001', 'fake-id');
      expect(exists).toBe(false);
    });
  });

  describe('deleteAllSnapshots', () => {
    it('should delete all snapshots for a game', async () => {
      await manager.saveSnapshot(store);
      await manager.saveSnapshot(store);
      await manager.saveSnapshot(store);

      await manager.deleteAllSnapshots('test-game-001');

      const snapshots = await manager.listSnapshots('test-game-001');
      expect(snapshots).toHaveLength(0);
    });

    it('should not throw for non-existent game', async () => {
      await expect(
        manager.deleteAllSnapshots('non-existent')
      ).resolves.not.toThrow();
    });
  });

  describe('pruning', () => {
    it('should prune old snapshots beyond maxAutoSnapshots', async () => {
      const limitedManager = new SnapshotManager({
        snapshotDir: tempDir,
        maxAutoSnapshots: 3,
      });

      // Create 5 snapshots
      for (let i = 0; i < 5; i++) {
        await limitedManager.saveSnapshot(store);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const snapshots = await limitedManager.listSnapshots('test-game-001');
      expect(snapshots).toHaveLength(3);
    });
  });
});

describe('shouldAutoSnapshot', () => {
  it('should return true for phase resolution events', () => {
    expect(shouldAutoSnapshot('MOVEMENT_RESOLVED')).toBe(true);
    expect(shouldAutoSnapshot('RETREATS_RESOLVED')).toBe(true);
    expect(shouldAutoSnapshot('BUILDS_RESOLVED')).toBe(true);
    expect(shouldAutoSnapshot('GAME_ENDED')).toBe(true);
  });

  it('should return false for other events', () => {
    expect(shouldAutoSnapshot('GAME_CREATED')).toBe(false);
    expect(shouldAutoSnapshot('ORDERS_SUBMITTED')).toBe(false);
    expect(shouldAutoSnapshot('PHASE_ADVANCED')).toBe(false);
    expect(shouldAutoSnapshot('MESSAGE_SENT')).toBe(false);
  });
});

describe('AUTO_SNAPSHOT_EVENTS', () => {
  it('should include all phase resolution events', () => {
    expect(AUTO_SNAPSHOT_EVENTS).toContain('MOVEMENT_RESOLVED');
    expect(AUTO_SNAPSHOT_EVENTS).toContain('RETREATS_RESOLVED');
    expect(AUTO_SNAPSHOT_EVENTS).toContain('BUILDS_RESOLVED');
    expect(AUTO_SNAPSHOT_EVENTS).toContain('GAME_ENDED');
  });
});
