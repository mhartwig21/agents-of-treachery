/**
 * MSW handlers for API and WebSocket mocking.
 *
 * Provides handlers for:
 * - HTTP health endpoint
 * - WebSocket game server messages
 */

import { http, HttpResponse, ws } from 'msw';
import type { ServerMessage, ClientMessage } from '../server/game-server';
import type { GameHistory } from '../spectator/types';
import { createTestGame, createTestSnapshot, ServerMessages } from './data';

/**
 * In-memory game state for mock server.
 */
interface MockServerState {
  games: Map<string, GameHistory>;
  gameCounter: number;
}

const state: MockServerState = {
  games: new Map(),
  gameCounter: 0,
};

/**
 * Reset mock server state (call between tests).
 */
export function resetMockState(): void {
  state.games.clear();
  state.gameCounter = 0;
}

/**
 * Add a game to mock state.
 */
export function addMockGame(game: GameHistory): void {
  state.games.set(game.gameId, game);
}

/**
 * Get a game from mock state.
 */
export function getMockGame(gameId: string): GameHistory | undefined {
  return state.games.get(gameId);
}

/**
 * HTTP handlers for REST endpoints.
 */
export const httpHandlers = [
  // Health check endpoint
  http.get('http://localhost:3001/health', () => {
    return HttpResponse.json({
      status: 'ok',
      games: state.games.size,
      clients: 1,
    });
  }),

  // Also handle relative path
  http.get('/health', () => {
    return HttpResponse.json({
      status: 'ok',
      games: state.games.size,
      clients: 1,
    });
  }),
];

/**
 * WebSocket handler for game server.
 */
const gameServerWs = ws.link('ws://localhost:3001');

/**
 * WebSocket event handlers map.
 * Maps client message types to handler functions.
 */
type WsClient = Parameters<Parameters<typeof gameServerWs.addEventListener>[1]>[0]['client'];

function handleClientMessage(client: WsClient, message: ClientMessage): void {
  switch (message.type) {
    case 'GET_GAMES': {
      const games = Array.from(state.games.values());
      const response: ServerMessage = ServerMessages.gameList(games);
      client.send(JSON.stringify(response));
      break;
    }

    case 'START_GAME': {
      state.gameCounter++;
      const gameId = `game-${state.gameCounter}-${Date.now()}`;
      const game = createTestGame({
        gameId,
        name: message.name || `AI Game ${state.gameCounter}`,
      });
      state.games.set(gameId, game);

      // Send game created message
      client.send(JSON.stringify(ServerMessages.gameCreated(game)));

      // Simulate game progression after a short delay
      simulateGameProgression(client, gameId);
      break;
    }

    case 'SUBSCRIBE_GAME': {
      // In mock, we just acknowledge - real subscriptions are handled via state
      const game = state.games.get(message.gameId);
      if (!game) {
        client.send(JSON.stringify(ServerMessages.error(`Game ${message.gameId} not found`)));
      }
      break;
    }

    case 'UNSUBSCRIBE_GAME': {
      // No-op in mock
      break;
    }
  }
}

/**
 * Simulates game progression by sending periodic updates.
 */
function simulateGameProgression(client: WsClient, gameId: string): void {
  const game = state.games.get(gameId);
  if (!game) return;

  let turn = 0;
  const seasons: Array<'SPRING' | 'FALL'> = ['SPRING', 'FALL'];
  let year = 1901;

  const sendUpdate = (): void => {
    if (!state.games.has(gameId)) return; // Game was removed

    const season = seasons[turn % 2];
    if (turn > 0 && turn % 2 === 0) year++;

    // Update current agent
    const powers = ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'];
    const currentAgent = powers[turn % 7];

    client.send(JSON.stringify(ServerMessages.gameUpdated(gameId, {
      updatedAt: new Date(),
      currentAgent,
    })));

    // Create and send snapshot
    const snapshot = createTestSnapshot({
      id: `${year}-${season}-DIPLOMACY`,
      year,
      season,
      phase: 'DIPLOMACY',
      timestamp: new Date(),
    });

    // Update local state
    game.snapshots.push(snapshot);
    game.updatedAt = new Date();

    client.send(JSON.stringify(ServerMessages.snapshotAdded(gameId, snapshot)));

    turn++;

    // End after 5 turns for testing
    if (turn >= 5) {
      game.status = 'completed';
      game.winner = 'france';
      client.send(JSON.stringify(ServerMessages.gameEnded(gameId, 'FRANCE', false)));
    }
  };

  // Send initial update immediately, then schedule more
  setTimeout(sendUpdate, 100);
}

/**
 * WebSocket handlers for game server.
 */
export const wsHandlers = [
  gameServerWs.addEventListener('connection', ({ client }) => {
    // Send initial game list on connection
    const games = Array.from(state.games.values());
    client.send(JSON.stringify(ServerMessages.gameList(games)));

    // Handle incoming messages
    client.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data as string) as ClientMessage;
        handleClientMessage(client, message);
      } catch {
        client.send(JSON.stringify(ServerMessages.error('Invalid message format')));
      }
    });
  }),
];

/**
 * All handlers combined.
 */
export const handlers = [...httpHandlers, ...wsHandlers];

/**
 * Error scenario handlers for testing error states.
 */
export const errorHandlers = {
  /**
   * Handler that returns server error for health check.
   */
  serverDown: http.get('http://localhost:3001/health', () => {
    return HttpResponse.json(
      { status: 'error', message: 'Server unavailable' },
      { status: 503 }
    );
  }),

  /**
   * Handler that times out (for testing timeout handling).
   */
  timeout: http.get('http://localhost:3001/health', async () => {
    await new Promise((resolve) => setTimeout(resolve, 30000));
    return HttpResponse.json({ status: 'ok' });
  }),
};

/**
 * Creates a WebSocket mock that sends predefined messages in sequence.
 */
export function createScriptedWsHandler(
  messages: ServerMessage[],
  delayMs: number = 100
) {
  return ws.link('ws://localhost:3001').addEventListener('connection', ({ client }) => {
    let index = 0;

    const sendNext = (): void => {
      if (index < messages.length) {
        client.send(JSON.stringify(messages[index]));
        index++;
        setTimeout(sendNext, delayMs);
      }
    };

    // Start sending after connection
    setTimeout(sendNext, delayMs);
  });
}
