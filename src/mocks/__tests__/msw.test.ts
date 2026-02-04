/**
 * Tests for MSW mock infrastructure.
 *
 * Verifies that mock handlers work correctly for both HTTP and WebSocket.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockState,
  addMockGame,
  getMockGame,
} from '../handlers';
import {
  createTestGame,
  createTestSnapshot,
  createTestMessage,
  createGameProgression,
  createCompletedGame,
  ServerMessages,
  INITIAL_GAME_STATE,
  SAMPLE_MESSAGES,
} from '../data';

describe('MSW Mock Data', () => {
  beforeEach(() => {
    resetMockState();
  });

  describe('createTestGame', () => {
    it('creates a game with default values', () => {
      const game = createTestGame();

      expect(game.gameId).toMatch(/^game-\d+$/);
      expect(game.name).toBe('Test Game');
      expect(game.status).toBe('active');
      expect(game.snapshots).toHaveLength(1);
    });

    it('allows overriding values', () => {
      const game = createTestGame({
        gameId: 'custom-game',
        name: 'Custom Name',
        status: 'completed',
      });

      expect(game.gameId).toBe('custom-game');
      expect(game.name).toBe('Custom Name');
      expect(game.status).toBe('completed');
    });
  });

  describe('createTestSnapshot', () => {
    it('creates a snapshot with default values', () => {
      const snapshot = createTestSnapshot();

      expect(snapshot.id).toBe('1901-SPRING-DIPLOMACY');
      expect(snapshot.year).toBe(1901);
      expect(snapshot.season).toBe('SPRING');
      expect(snapshot.phase).toBe('DIPLOMACY');
      expect(snapshot.gameState).toEqual(INITIAL_GAME_STATE);
    });

    it('allows overriding values', () => {
      const snapshot = createTestSnapshot({
        id: '1902-FALL-MOVEMENT',
        year: 1902,
        season: 'FALL',
        phase: 'MOVEMENT',
      });

      expect(snapshot.id).toBe('1902-FALL-MOVEMENT');
      expect(snapshot.year).toBe(1902);
      expect(snapshot.season).toBe('FALL');
    });
  });

  describe('createTestMessage', () => {
    it('creates a message with default values', () => {
      const msg = createTestMessage();

      expect(msg.id).toMatch(/^msg-/);
      expect(msg.channelId).toBe('bilateral:ENGLAND:FRANCE');
      expect(msg.sender).toBe('ENGLAND');
      expect(msg.content).toContain('alliance');
    });

    it('allows overriding values', () => {
      const msg = createTestMessage({
        channelId: 'bilateral:GERMANY:RUSSIA',
        content: 'Custom message',
      });

      expect(msg.channelId).toBe('bilateral:GERMANY:RUSSIA');
      expect(msg.content).toBe('Custom message');
    });
  });

  describe('createGameProgression', () => {
    it('creates multiple snapshots', () => {
      const snapshots = createGameProgression(4);

      expect(snapshots).toHaveLength(4);
      expect(snapshots[0].season).toBe('SPRING');
      expect(snapshots[1].season).toBe('FALL');
      expect(snapshots[2].season).toBe('SPRING');
      expect(snapshots[2].year).toBe(1902);
    });
  });

  describe('createCompletedGame', () => {
    it('creates a completed game with winner', () => {
      const game = createCompletedGame();

      expect(game.status).toBe('completed');
      expect(game.winner).toBe('france');
      expect(game.snapshots.length).toBeGreaterThan(1);
    });
  });

  describe('SAMPLE_MESSAGES', () => {
    it('has various message types', () => {
      expect(SAMPLE_MESSAGES.alliance.metadata?.intent).toBe('PROPOSAL');
      expect(SAMPLE_MESSAGES.acceptance.metadata?.intent).toBe('ACCEPTANCE');
      expect(SAMPLE_MESSAGES.threat.metadata?.intent).toBe('THREAT');
      expect(SAMPLE_MESSAGES.information.metadata?.intent).toBe('INFORMATION');
    });
  });
});

describe('MSW Mock State', () => {
  beforeEach(() => {
    resetMockState();
  });

  describe('addMockGame / getMockGame', () => {
    it('adds and retrieves games', () => {
      const game = createTestGame({ gameId: 'test-1' });
      addMockGame(game);

      const retrieved = getMockGame('test-1');
      expect(retrieved).toEqual(game);
    });

    it('returns undefined for non-existent games', () => {
      expect(getMockGame('non-existent')).toBeUndefined();
    });
  });

  describe('resetMockState', () => {
    it('clears all games', () => {
      addMockGame(createTestGame({ gameId: 'test-1' }));
      addMockGame(createTestGame({ gameId: 'test-2' }));

      resetMockState();

      expect(getMockGame('test-1')).toBeUndefined();
      expect(getMockGame('test-2')).toBeUndefined();
    });
  });
});

describe('ServerMessages factory', () => {
  it('creates GAME_LIST message', () => {
    const games = [createTestGame()];
    const msg = ServerMessages.gameList(games);

    expect(msg.type).toBe('GAME_LIST');
    expect(msg).toHaveProperty('games', games);
  });

  it('creates GAME_CREATED message', () => {
    const game = createTestGame();
    const msg = ServerMessages.gameCreated(game);

    expect(msg.type).toBe('GAME_CREATED');
    expect(msg).toHaveProperty('game', game);
  });

  it('creates GAME_UPDATED message', () => {
    const msg = ServerMessages.gameUpdated('game-1', { status: 'completed' });

    expect(msg.type).toBe('GAME_UPDATED');
    expect(msg).toHaveProperty('gameId', 'game-1');
    expect(msg).toHaveProperty('updates', { status: 'completed' });
  });

  it('creates SNAPSHOT_ADDED message', () => {
    const snapshot = createTestSnapshot();
    const msg = ServerMessages.snapshotAdded('game-1', snapshot);

    expect(msg.type).toBe('SNAPSHOT_ADDED');
    expect(msg).toHaveProperty('gameId', 'game-1');
    expect(msg).toHaveProperty('snapshot', snapshot);
  });

  it('creates GAME_ENDED message', () => {
    const msg = ServerMessages.gameEnded('game-1', 'FRANCE', false);

    expect(msg.type).toBe('GAME_ENDED');
    expect(msg).toHaveProperty('gameId', 'game-1');
    expect(msg).toHaveProperty('winner', 'FRANCE');
    expect(msg).toHaveProperty('draw', false);
  });

  it('creates ERROR message', () => {
    const msg = ServerMessages.error('Something went wrong');

    expect(msg.type).toBe('ERROR');
    expect(msg).toHaveProperty('message', 'Something went wrong');
  });
});

describe('HTTP handlers', () => {
  it('health endpoint returns status', async () => {
    const response = await fetch('http://localhost:3001/health');
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.status).toBe('ok');
    expect(typeof data.games).toBe('number');
    expect(typeof data.clients).toBe('number');
  });
});

describe('INITIAL_GAME_STATE', () => {
  it('has correct initial setup', () => {
    expect(INITIAL_GAME_STATE.year).toBe(1901);
    expect(INITIAL_GAME_STATE.phase).toBe('spring');
    expect(INITIAL_GAME_STATE.units).toHaveLength(22); // 22 starting units
  });

  it('has all powers represented', () => {
    const powers = new Set(INITIAL_GAME_STATE.units.map(u => u.power));
    expect(powers.size).toBe(7);
  });

  it('has supply centers assigned', () => {
    expect(INITIAL_GAME_STATE.supplyCenters.lon).toBe('england');
    expect(INITIAL_GAME_STATE.supplyCenters.par).toBe('france');
    expect(INITIAL_GAME_STATE.supplyCenters.ber).toBe('germany');
  });
});
