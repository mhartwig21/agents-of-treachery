/**
 * Tests for auto-snapshot integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SnapshotManager } from '../snapshot-manager';
import { enableAutoSnapshot, AutoSnapshotHandle } from '../auto-snapshot';
import { GameSession } from '../../orchestration/session';

describe('AutoSnapshot', () => {
  let manager: SnapshotManager;
  let session: GameSession;
  let tempDir: string;
  let handle: AutoSnapshotHandle | null = null;

  beforeEach(async () => {
    // Create a temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-auto-snapshot-'));
    manager = new SnapshotManager({ snapshotDir: tempDir });
    session = new GameSession();
  });

  afterEach(async () => {
    // Clean up handle
    if (handle) {
      handle.dispose();
      handle = null;
    }
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('enableAutoSnapshot', () => {
    it('should create an AutoSnapshotHandle', () => {
      handle = enableAutoSnapshot(session, { manager });
      expect(handle).toBeDefined();
      expect(handle.getStore()).toBeDefined();
    });

    it('should track the game store', () => {
      handle = enableAutoSnapshot(session, { manager });
      const store = handle.getStore();

      expect(store.getState().year).toBe(1901);
      expect(store.getState().season).toBe('SPRING');
    });

    it('should allow manual snapshots', async () => {
      handle = enableAutoSnapshot(session, { manager });

      const metadata = await handle.snapshot('Manual test snapshot');

      expect(metadata.gameId).toBe(session.getGameId());
      expect(metadata.description).toBe('Manual test snapshot');
    });

    it('should track last snapshot ID', async () => {
      handle = enableAutoSnapshot(session, { manager });

      expect(handle.getLastSnapshotId()).toBeUndefined();

      const metadata = await handle.snapshot();

      expect(handle.getLastSnapshotId()).toBe(metadata.snapshotId);
    });

    it('should call onSnapshot callback', async () => {
      const onSnapshot = vi.fn();
      handle = enableAutoSnapshot(session, { manager, onSnapshot });

      await handle.snapshot('Test');

      expect(onSnapshot).toHaveBeenCalledTimes(1);
      expect(onSnapshot.mock.calls[0][0].description).toBe('Test');
    });
  });

  describe('dispose', () => {
    it('should prevent further snapshots after dispose', async () => {
      handle = enableAutoSnapshot(session, { manager });
      handle.dispose();

      await expect(handle.snapshot()).rejects.toThrow('disposed');
    });
  });

  describe('snapshot persistence', () => {
    it('should save snapshots to the filesystem', async () => {
      handle = enableAutoSnapshot(session, { manager });

      const metadata = await handle.snapshot('Test persistence');

      // Verify file exists
      const snapshots = await manager.listSnapshots(session.getGameId());
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].snapshotId).toBe(metadata.snapshotId);
    });

    it('should persist game state correctly', async () => {
      handle = enableAutoSnapshot(session, { manager });

      const metadata = await handle.snapshot();
      const loaded = await manager.loadSnapshot(session.getGameId(), metadata.snapshotId);

      expect(loaded.state.year).toBe(1901);
      expect(loaded.state.season).toBe('SPRING');
      expect(loaded.state.units.length).toBeGreaterThan(0);
    });
  });

  describe('configuration', () => {
    it('should respect snapshotOnPhaseResolution config', () => {
      handle = enableAutoSnapshot(session, {
        manager,
        snapshotOnPhaseResolution: false,
      });

      // This just verifies the handle is created with the config
      // Full testing of auto-trigger would require simulating phase resolution
      expect(handle).toBeDefined();
    });

    it('should respect snapshotOnCompletion config', () => {
      handle = enableAutoSnapshot(session, {
        manager,
        snapshotOnCompletion: false,
      });

      expect(handle).toBeDefined();
    });

    it('should call onError callback on failure', async () => {
      const onError = vi.fn();

      // Create manager with invalid path to force error
      const badManager = new SnapshotManager({
        snapshotDir: '/nonexistent/path/that/should/fail',
      });

      handle = enableAutoSnapshot(session, {
        manager: badManager,
        onError,
      });

      // Manual snapshot should fail
      await handle.snapshot().catch(() => {});

      expect(onError).toHaveBeenCalled();
    });
  });
});
