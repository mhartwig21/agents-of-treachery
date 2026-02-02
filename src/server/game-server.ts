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
import { GameLogger, getGameLogger, removeGameLogger, createLoggingLLMProvider } from './game-logger';

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
  logger: GameLogger;
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
    console.log('Received message:', message.type);
    switch (message.type) {
      case 'START_GAME':
        console.log('Starting new game:', message.name);
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
    console.log(`Creating game: ${gameId} (${gameName})`);

    const config: AgentRuntimeConfig = {
      gameId,
      agents: POWERS.map((power) => ({ power })),
      parallelExecution: true,
      turnTimeout: 60000,
      persistMemory: false,
      verbose: false,
    };

    const logger = getGameLogger(gameId);
    // Wrap LLM provider with logging
    const loggingProvider = createLoggingLLMProvider(this.llmProvider, logger);
    const runtime = new AgentRuntime(config, loggingProvider);
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
      logger,
    };

    this.games.set(gameId, activeGame);

    // Log game started
    logger.gameStarted(gameName, POWERS);

    // Subscribe to press messages
    spectator.onAnyMessage((message) => {
      activeGame.accumulatedMessages.push(message);
      const preview = message.content.length > 100 ? message.content.slice(0, 100) + '...' : message.content;
      // Get recipients from channel ID (format: bilateral:POWER1:POWER2 or multiparty:... or global)
      const channelParts = message.channelId.split(':');
      const recipients = channelParts.slice(1).filter(p => p !== message.sender);
      logger.messageSent(message.sender, recipients.length > 0 ? recipients : ['all'], preview);
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
      console.log(`[${gameId}] Initializing runtime...`);
      logger.debug('Initializing runtime');
      await runtime.initialize();
      console.log(`[${gameId}] Runtime initialized, starting game loop...`);
      logger.debug('Runtime initialized, starting game loop');
      const result = await runtime.runGame();
      console.log(`[${gameId}] Game finished:`, result);

      // Update history with final status
      activeGame.history.status = 'completed';
      if (result.winner) {
        activeGame.history.winner = result.winner.toLowerCase() as any;
      }

      // Log game ended
      logger.gameEnded(result.winner, result.draw, 'Game completed normally');

      this.broadcastToGame(activeGame, {
        type: 'GAME_ENDED',
        gameId,
        winner: result.winner,
        draw: result.draw,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error(`Game ${gameId} error:`, error);
      logger.error(errorMsg, 'Game execution failed', errorStack);
      logger.gameEnded(undefined, undefined, `Error: ${errorMsg}`);
      this.sendToClient(ws, {
        type: 'ERROR',
        message: `Game error: ${error}`,
      });
    } finally {
      // Clean up logger registry
      removeGameLogger(gameId);
    }
  }

  /**
   * Handles runtime events and creates snapshots.
   */
  private handleRuntimeEvent(game: ActiveGame, event: RuntimeEvent): void {
    const { runtime, logger } = game;
    console.log(`[${game.gameId}] Event: ${event.type}`, event.data.power || '');

    // Send real-time updates for agent activity
    if (event.type === 'agent_turn_started' && event.data.power) {
      logger.agentTurnStarted(event.data.power);
      this.broadcastToGame(game, {
        type: 'GAME_UPDATED',
        gameId: game.gameId,
        updates: {
          updatedAt: event.timestamp,
          currentAgent: event.data.power,
        },
      });
    }

    // Send real-time update when agent completes
    if (event.type === 'agent_turn_completed' && event.data.power) {
      console.log(`[${game.gameId}] ${event.data.power} completed turn`);
      logger.agentTurnCompleted(event.data.power, event.data.durationMs || 0);
      // Send any new messages immediately
      if (game.accumulatedMessages.length > 0) {
        const latestMessages = [...game.accumulatedMessages];
        this.broadcastToGame(game, {
          type: 'GAME_UPDATED',
          gameId: game.gameId,
          updates: {
            updatedAt: event.timestamp,
            latestMessages,
          },
        });
      }
    }

    // Track orders as they're submitted
    if (event.type === 'orders_submitted' && event.data.power && event.data.orders) {
      console.log(`[${game.gameId}] ${event.data.power} submitted ${event.data.orders.length} orders`);
      const orderStrings = event.data.orders.map((o): string => {
        switch (o.type) {
          case 'HOLD': return `${o.unit} HOLD`;
          case 'MOVE': return `${o.unit} - ${o.destination}`;
          case 'SUPPORT': return `${o.unit} S ${o.supportedUnit}${o.destination ? ' - ' + o.destination : ''}`;
          case 'CONVOY': return `${o.unit} C ${o.convoyedUnit} - ${o.destination}`;
        }
      });
      logger.ordersSubmitted(event.data.power, orderStrings, true);
      game.accumulatedOrders.set(event.data.power, event.data.orders);
      // Send order update immediately
      this.broadcastToGame(game, {
        type: 'GAME_UPDATED',
        gameId: game.gameId,
        updates: {
          updatedAt: event.timestamp,
          latestOrders: { [event.data.power]: event.data.orders.map(o => engineToUIOrder(o)) },
        },
      });
    }

    // Create full snapshot when phase resolves
    if (event.type === 'phase_resolved' || event.type === 'game_started') {
      const gameState = runtime.getGameState();
      logger.phaseResolved(gameState.phase, gameState.year, gameState.season);
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
      console.log(`[${game.gameId}] Broadcasting snapshot: ${snapshot.id} (${snapshot.messages.length} msgs, ${uiOrders.length} orders) to ${game.subscribers.size} subscribers`);
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
 * Creates a mock LLM provider for testing with random moves and diplomacy.
 */
export function createMockLLMProvider(): LLMProvider {
  const moveTypes = ['HOLD', 'MOVE', 'SUPPORT'];
  const territories = [
    'LON', 'EDI', 'LVP', 'YOR', 'WAL', 'NTH', 'NWG', 'ENG', 'IRI',
    'PAR', 'BRE', 'MAR', 'BUR', 'GAS', 'PIC', 'MAO',
    'BER', 'MUN', 'KIE', 'RUH', 'SIL', 'PRU', 'HEL', 'BAL',
    'ROM', 'NAP', 'VEN', 'TUS', 'PIE', 'APU', 'TYS', 'ION', 'ADR',
    'VIE', 'BUD', 'TRI', 'BOH', 'GAL', 'TYR',
    'MOS', 'WAR', 'STP', 'SEV', 'UKR', 'LVN', 'FIN', 'BOT',
    'CON', 'ANK', 'SMY', 'ARM', 'SYR', 'BLA', 'AEG', 'EAS'
  ];
  const diplomaticIntents = [
    'I propose we form an alliance against our mutual enemy.',
    'Your movements concern me. Can we discuss your intentions?',
    'I suggest we coordinate our attacks this turn.',
    'I will support your move if you support mine next turn.',
    'Let us agree to a DMZ in the disputed territories.',
    'I have no hostile intentions towards you... for now.',
    'Perhaps we can work together to eliminate the leader?',
    'I noticed your fleet movement. Care to explain?',
  ];
  const powers = ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'];

  return {
    async complete(params) {
      // Extract power from system message
      const systemMsg = params.messages.find(m => m.role === 'system')?.content || '';
      const powerMatch = systemMsg.match(/You are playing as (\w+)/i);
      const myPower = powerMatch ? powerMatch[1].toUpperCase() : 'ENGLAND';

      // Generate random orders
      const numUnits = Math.floor(Math.random() * 3) + 2;
      const orders: string[] = [];
      for (let i = 0; i < numUnits; i++) {
        const moveType = moveTypes[Math.floor(Math.random() * moveTypes.length)];
        const from = territories[Math.floor(Math.random() * territories.length)];
        if (moveType === 'HOLD') {
          orders.push(`${from} HOLD`);
        } else if (moveType === 'MOVE') {
          const to = territories[Math.floor(Math.random() * territories.length)];
          orders.push(`${from} - ${to}`);
        } else {
          const supportTarget = territories[Math.floor(Math.random() * territories.length)];
          orders.push(`${from} S ${supportTarget}`);
        }
      }

      // Generate random diplomatic messages (50% chance per other power)
      const diplomacy: string[] = [];
      for (const target of powers) {
        if (target !== myPower && Math.random() > 0.5) {
          const msg = diplomaticIntents[Math.floor(Math.random() * diplomaticIntents.length)];
          diplomacy.push(`SEND ${target}: "${msg}"`);
        }
      }

      const content = `
REASONING:
Analyzing the board position... I see opportunities for expansion.
My strategic priorities this turn are securing key supply centers.
I'll coordinate with potential allies while preparing for betrayal.

ORDERS:
${orders.join('\n')}

DIPLOMACY:
${diplomacy.join('\n')}
`;
      return {
        content,
        usage: { inputTokens: 100, outputTokens: 150 },
        stopReason: 'end_turn',
      };
    },
  };
}
