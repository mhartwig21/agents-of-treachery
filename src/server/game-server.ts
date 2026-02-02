/**
 * Game Server - WebSocket-based server for live game integration.
 *
 * Runs Diplomacy games with AI agents and streams events to connected clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { AgentRuntime, type RuntimeEvent } from '../agent/runtime';
import type { LLMProvider, AgentRuntimeConfig } from '../agent/types';
import { SpectatorAPI } from '../press/spectator';
import { POWERS, type Power } from '../engine/types';
import {
  type GameSnapshot,
  type GameHistory,
  generateSnapshotId,
  engineToUIGameState,
  engineToUIOrder,
} from '../spectator/types';
import type { Message } from '../press/types';

/**
 * Message types sent to clients.
 */
export type ServerMessage =
  | { type: 'GAME_LIST'; games: GameHistory[] }
  | { type: 'GAME_CREATED'; game: GameHistory }
  | { type: 'GAME_UPDATED'; gameId: string; updates: Partial<GameHistory> }
  | { type: 'SNAPSHOT_ADDED'; gameId: string; snapshot: GameSnapshot }
  | { type: 'GAME_ENDED'; gameId: string; winner?: string; draw?: boolean }
  | { type: 'ERROR'; message: string };

/**
 * Message types received from clients.
 */
export type ClientMessage =
  | { type: 'START_GAME'; name?: string }
  | { type: 'SUBSCRIBE_GAME'; gameId: string }
  | { type: 'UNSUBSCRIBE_GAME'; gameId: string }
  | { type: 'GET_GAMES' };

/**
 * Active game state.
 */
interface ActiveGame {
  gameId: string;
  name: string;
  runtime: AgentRuntime;
  spectator: SpectatorAPI;
  history: GameHistory;
  subscribers: Set<WebSocket>;
  accumulatedMessages: Message[];
  accumulatedOrders: Map<Power, import('../engine/types').Order[]>;
}

/**
 * Game server configuration.
 */
export interface GameServerConfig {
  port: number;
  llmProvider: LLMProvider;
}

/**
 * Game server that manages live games and WebSocket connections.
 */
export class GameServer {
  private wss: WebSocketServer | null = null;
  private games: Map<string, ActiveGame> = new Map();
  private clients: Set<WebSocket> = new Set();
  private llmProvider: LLMProvider;
  private gameCounter: number = 0;

  constructor(config: GameServerConfig) {
    this.llmProvider = config.llmProvider;
  }

  /**
   * Starts the WebSocket server.
   */
  start(port: number): void {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`Client connected. Total: ${this.clients.size}`);

      // Send current game list
      this.sendToClient(ws, {
        type: 'GAME_LIST',
        games: Array.from(this.games.values()).map((g) => g.history),
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as ClientMessage;
          this.handleClientMessage(ws, message);
        } catch (error) {
          this.sendToClient(ws, {
            type: 'ERROR',
            message: 'Invalid message format',
          });
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        // Remove from all game subscriptions
        for (const game of this.games.values()) {
          game.subscribers.delete(ws);
        }
        console.log(`Client disconnected. Total: ${this.clients.size}`);
      });
    });

    console.log(`Game server listening on port ${port}`);
  }

  /**
   * Stops the server.
   */
  stop(): void {
    if (this.wss) {
      for (const game of this.games.values()) {
        game.runtime.stop();
      }
      this.wss.close();
      this.wss = null;
    }
  }

  /**
   * Handles messages from clients.
   */
  private handleClientMessage(ws: WebSocket, message: ClientMessage): void {
    switch (message.type) {
      case 'START_GAME':
        this.startNewGame(ws, message.name);
        break;

      case 'SUBSCRIBE_GAME':
        this.subscribeToGame(ws, message.gameId);
        break;

      case 'UNSUBSCRIBE_GAME':
        this.unsubscribeFromGame(ws, message.gameId);
        break;

      case 'GET_GAMES':
        this.sendToClient(ws, {
          type: 'GAME_LIST',
          games: Array.from(this.games.values()).map((g) => g.history),
        });
        break;
    }
  }

  /**
   * Starts a new game with AI agents.
   */
  private async startNewGame(ws: WebSocket, name?: string): Promise<void> {
    const gameId = `game-${++this.gameCounter}-${Date.now()}`;
    const gameName = name || `AI Game ${this.gameCounter}`;

    const config: AgentRuntimeConfig = {
      gameId,
      agents: POWERS.map((power) => ({ power })),
      parallelExecution: true,
      turnTimeout: 60000,
      persistMemory: false,
      verbose: false,
    };

    const runtime = new AgentRuntime(config, this.llmProvider);
    const spectator = new SpectatorAPI(runtime.getPressSystem());

    const now = new Date();
    const history: GameHistory = {
      gameId,
      name: gameName,
      status: 'active',
      snapshots: [],
      createdAt: now,
      updatedAt: now,
    };

    const activeGame: ActiveGame = {
      gameId,
      name: gameName,
      runtime,
      spectator,
      history,
      subscribers: new Set([ws]),
      accumulatedMessages: [],
      accumulatedOrders: new Map(),
    };

    this.games.set(gameId, activeGame);

    // Subscribe to press messages
    spectator.onAnyMessage((message) => {
      activeGame.accumulatedMessages.push(message);
    });

    // Subscribe to runtime events
    runtime.onEvent((event) => {
      this.handleRuntimeEvent(activeGame, event);
    });

    // Notify all clients about new game
    this.broadcast({
      type: 'GAME_CREATED',
      game: history,
    });

    // Initialize and run game
    try {
      await runtime.initialize();
      const result = await runtime.runGame();

      // Update history with final status
      activeGame.history.status = 'completed';
      if (result.winner) {
        activeGame.history.winner = result.winner.toLowerCase() as any;
      }

      this.broadcastToGame(activeGame, {
        type: 'GAME_ENDED',
        gameId,
        winner: result.winner,
        draw: result.draw,
      });
    } catch (error) {
      console.error(`Game ${gameId} error:`, error);
      this.sendToClient(ws, {
        type: 'ERROR',
        message: `Game error: ${error}`,
      });
    }
  }

  /**
   * Handles runtime events and creates snapshots.
   */
  private handleRuntimeEvent(game: ActiveGame, event: RuntimeEvent): void {
    const { runtime } = game;

    // Track orders as they're submitted
    if (event.type === 'orders_submitted' && event.data.power && event.data.orders) {
      game.accumulatedOrders.set(event.data.power, event.data.orders);
    }

    // Create snapshot when phase resolves
    if (event.type === 'phase_resolved' || event.type === 'game_started') {
      const gameState = runtime.getGameState();
      const uiGameState = engineToUIGameState(gameState);

      // Convert accumulated orders to UI format
      const uiOrders = [];
      for (const [, orders] of game.accumulatedOrders) {
        for (const order of orders) {
          uiOrders.push(engineToUIOrder(order));
        }
      }

      const snapshot: GameSnapshot = {
        id: generateSnapshotId(gameState.year, gameState.season, gameState.phase),
        year: gameState.year,
        season: gameState.season,
        phase: gameState.phase,
        gameState: uiGameState,
        orders: uiOrders,
        messages: [...game.accumulatedMessages],
        timestamp: event.timestamp,
      };

      // Add snapshot to history
      game.history.snapshots.push(snapshot);
      game.history.updatedAt = event.timestamp;

      // Clear accumulated data for next phase
      game.accumulatedMessages = [];
      game.accumulatedOrders.clear();

      // Broadcast snapshot to subscribers
      this.broadcastToGame(game, {
        type: 'SNAPSHOT_ADDED',
        gameId: game.gameId,
        snapshot,
      });
    }
  }

  /**
   * Subscribes a client to a game's updates.
   */
  private subscribeToGame(ws: WebSocket, gameId: string): void {
    const game = this.games.get(gameId);
    if (game) {
      game.subscribers.add(ws);
    }
  }

  /**
   * Unsubscribes a client from a game's updates.
   */
  private unsubscribeFromGame(ws: WebSocket, gameId: string): void {
    const game = this.games.get(gameId);
    if (game) {
      game.subscribers.delete(ws);
    }
  }

  /**
   * Sends a message to a specific client.
   */
  private sendToClient(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcasts a message to all connected clients.
   */
  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Broadcasts a message to all subscribers of a game.
   */
  private broadcastToGame(game: ActiveGame, message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of game.subscribers) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Gets the number of connected clients.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Gets the number of active games.
   */
  getGameCount(): number {
    return this.games.size;
  }
}

/**
 * Creates a mock LLM provider for testing.
 */
export function createMockLLMProvider(): LLMProvider {
  return {
    async complete(_params) {
      // Simple mock that returns hold orders for all units
      const content = `
<thinking>
I'll order all my units to hold for now.
</thinking>

<orders>
All units HOLD
</orders>

<diplomatic_actions>
</diplomatic_actions>
`;
      return {
        content,
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      };
    },
  };
}
