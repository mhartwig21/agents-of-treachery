/**
 * Game Server - WebSocket-based server for live game integration.
 *
 * Runs Diplomacy games with AI agents and streams events to connected clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
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
  toUIPower,
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
  private httpServer: ReturnType<typeof createServer> | null = null;
  private games: Map<string, ActiveGame> = new Map();
  private clients: Set<WebSocket> = new Set();
  private llmProvider: LLMProvider;
  private gameCounter: number = 0;

  constructor(config: GameServerConfig) {
    this.llmProvider = config.llmProvider;
  }

  /**
   * Handles HTTP requests (health check endpoint).
   */
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        games: this.games.size,
        clients: this.clients.size,
      }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }

  /**
   * Starts the WebSocket server with HTTP health endpoint.
   */
  start(port: number): void {
    // Create HTTP server for health checks
    this.httpServer = createServer((req, res) => this.handleHttpRequest(req, res));

    // Attach WebSocket server to HTTP server
    this.wss = new WebSocketServer({ server: this.httpServer });

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

    // Start HTTP server (WebSocket is attached)
    this.httpServer!.listen(port, () => {
      console.log(`Game server listening on port ${port}`);
      console.log(`Health check: http://localhost:${port}/health`);
    });
  }

  /**
   * Stops the server.
   */
  stop(): void {
    for (const game of this.games.values()) {
      game.runtime.stop();
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
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
        console.log(`Subscribing to game: ${message.gameId} (available: ${Array.from(this.games.keys()).join(', ')})`);
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
        activeGame.history.winner = toUIPower(result.winner);
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
      // Use the phase/year/season from the event (the completed phase), not the current game state
      // because the runtime has already transitioned to the next phase by now
      const snapshotYear = event.data.year ?? gameState.year;
      const snapshotSeason = event.data.season ?? gameState.season;
      const snapshotPhase = event.data.phase ?? gameState.phase;
      logger.phaseResolved(snapshotPhase, snapshotYear, snapshotSeason);
      const uiGameState = engineToUIGameState(gameState);

      // Convert accumulated orders to UI format
      const uiOrders = [];
      for (const [, orders] of game.accumulatedOrders) {
        for (const order of orders) {
          uiOrders.push(engineToUIOrder(order));
        }
      }

      const snapshot: GameSnapshot = {
        id: generateSnapshotId(snapshotYear, snapshotSeason, snapshotPhase),
        year: snapshotYear,
        season: snapshotSeason,
        phase: snapshotPhase,
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
      console.log(`[${gameId}] Client subscribed. Total subscribers: ${game.subscribers.size}`);
    } else {
      console.log(`[${gameId}] Game not found for subscription`);
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
 * Adjacency map for Diplomacy territories.
 * Maps each territory to its adjacent territories.
 */
const ADJACENCIES: Record<string, string[]> = {
  // England
  LON: ['WAL', 'YOR', 'ENG', 'NTH'],
  EDI: ['YOR', 'LVP', 'CLY', 'NTH', 'NWG'],
  LVP: ['EDI', 'YOR', 'WAL', 'CLY', 'IRI', 'NAO'],
  YOR: ['LON', 'EDI', 'LVP', 'WAL', 'NTH'],
  WAL: ['LON', 'LVP', 'YOR', 'ENG', 'IRI'],
  CLY: ['EDI', 'LVP', 'NAO', 'NWG'],
  // France
  PAR: ['BRE', 'PIC', 'BUR', 'GAS'],
  BRE: ['PAR', 'PIC', 'GAS', 'MAO', 'ENG'],
  MAR: ['SPA', 'GAS', 'BUR', 'PIE', 'LYO'],
  BUR: ['PAR', 'PIC', 'BEL', 'RUH', 'MUN', 'MAR', 'GAS'],
  GAS: ['PAR', 'BRE', 'BUR', 'MAR', 'SPA', 'MAO'],
  PIC: ['PAR', 'BRE', 'BEL', 'BUR', 'ENG'],
  // Germany
  BER: ['KIE', 'MUN', 'SIL', 'PRU', 'BAL'],
  MUN: ['BER', 'KIE', 'RUH', 'BUR', 'TYR', 'BOH', 'SIL'],
  KIE: ['BER', 'MUN', 'RUH', 'HOL', 'HEL', 'DEN', 'BAL'],
  RUH: ['KIE', 'MUN', 'BUR', 'BEL', 'HOL'],
  SIL: ['BER', 'MUN', 'BOH', 'GAL', 'WAR', 'PRU'],
  PRU: ['BER', 'SIL', 'WAR', 'LVN', 'BAL'],
  // Italy
  ROM: ['NAP', 'TUS', 'VEN', 'APU', 'TYS'],
  NAP: ['ROM', 'APU', 'TYS', 'ION'],
  VEN: ['ROM', 'TUS', 'PIE', 'TYR', 'TRI', 'APU', 'ADR'],
  TUS: ['ROM', 'VEN', 'PIE', 'LYO', 'TYS'],
  PIE: ['TUS', 'VEN', 'TYR', 'MAR', 'LYO'],
  APU: ['ROM', 'NAP', 'VEN', 'ION', 'ADR'],
  // Austria
  VIE: ['BUD', 'TRI', 'BOH', 'GAL', 'TYR'],
  BUD: ['VIE', 'TRI', 'GAL', 'RUM', 'SER'],
  TRI: ['VIE', 'BUD', 'VEN', 'TYR', 'SER', 'ALB', 'ADR'],
  BOH: ['VIE', 'MUN', 'SIL', 'GAL', 'TYR'],
  GAL: ['VIE', 'BUD', 'BOH', 'SIL', 'WAR', 'UKR', 'RUM'],
  TYR: ['VIE', 'TRI', 'VEN', 'PIE', 'MUN', 'BOH'],
  // Russia
  MOS: ['STP', 'SEV', 'UKR', 'WAR', 'LVN'],
  WAR: ['MOS', 'LVN', 'PRU', 'SIL', 'GAL', 'UKR'],
  STP: ['MOS', 'LVN', 'FIN', 'NWY', 'BAR', 'BOT'],
  SEV: ['MOS', 'UKR', 'RUM', 'ARM', 'BLA'],
  UKR: ['MOS', 'WAR', 'GAL', 'RUM', 'SEV'],
  LVN: ['MOS', 'WAR', 'PRU', 'STP', 'BOT', 'BAL'],
  FIN: ['STP', 'NWY', 'SWE', 'BOT'],
  // Turkey
  CON: ['ANK', 'SMY', 'BUL', 'AEG', 'BLA'],
  ANK: ['CON', 'SMY', 'ARM', 'BLA'],
  SMY: ['CON', 'ANK', 'ARM', 'SYR', 'AEG', 'EAS'],
  ARM: ['ANK', 'SMY', 'SEV', 'SYR', 'BLA'],
  SYR: ['SMY', 'ARM', 'EAS'],
  // Neutrals
  NWY: ['STP', 'FIN', 'SWE', 'SKA', 'NTH', 'NWG', 'BAR'],
  SWE: ['NWY', 'FIN', 'DEN', 'SKA', 'BOT', 'BAL'],
  DEN: ['SWE', 'KIE', 'SKA', 'HEL', 'BAL', 'NTH'],
  HOL: ['KIE', 'RUH', 'BEL', 'HEL', 'NTH'],
  BEL: ['HOL', 'RUH', 'BUR', 'PIC', 'ENG', 'NTH'],
  SPA: ['MAR', 'GAS', 'POR', 'MAO', 'LYO', 'WES'],
  POR: ['SPA', 'MAO'],
  TUN: ['NAF', 'WES', 'TYS', 'ION'],
  NAF: ['TUN', 'MAO', 'WES'],
  SER: ['BUD', 'TRI', 'ALB', 'GRE', 'BUL', 'RUM'],
  ALB: ['TRI', 'SER', 'GRE', 'ADR', 'ION'],
  GRE: ['SER', 'ALB', 'BUL', 'AEG', 'ION'],
  BUL: ['CON', 'SER', 'GRE', 'RUM', 'AEG', 'BLA'],
  RUM: ['BUD', 'GAL', 'UKR', 'SEV', 'SER', 'BUL', 'BLA'],
  // Sea zones
  NTH: ['LON', 'EDI', 'YOR', 'NWY', 'DEN', 'HOL', 'BEL', 'ENG', 'SKA', 'HEL', 'NWG'],
  NWG: ['EDI', 'CLY', 'NWY', 'NTH', 'NAO', 'BAR'],
  ENG: ['LON', 'WAL', 'BRE', 'PIC', 'BEL', 'NTH', 'IRI', 'MAO'],
  IRI: ['WAL', 'LVP', 'ENG', 'NAO', 'MAO'],
  NAO: ['LVP', 'CLY', 'NWG', 'IRI', 'MAO'],
  MAO: ['BRE', 'GAS', 'SPA', 'POR', 'NAF', 'ENG', 'IRI', 'NAO', 'WES'],
  HEL: ['KIE', 'DEN', 'HOL', 'NTH'],
  BAL: ['BER', 'KIE', 'PRU', 'LVN', 'SWE', 'DEN', 'BOT'],
  BOT: ['STP', 'LVN', 'FIN', 'SWE', 'BAL'],
  SKA: ['NWY', 'SWE', 'DEN', 'NTH'],
  TYS: ['ROM', 'NAP', 'TUS', 'TUN', 'LYO', 'WES', 'ION'],
  ION: ['NAP', 'APU', 'TUN', 'ALB', 'GRE', 'TYS', 'ADR', 'AEG', 'EAS'],
  ADR: ['VEN', 'TRI', 'APU', 'ALB', 'ION'],
  LYO: ['MAR', 'PIE', 'TUS', 'SPA', 'TYS', 'WES'],
  WES: ['SPA', 'NAF', 'TUN', 'MAO', 'LYO', 'TYS'],
  AEG: ['CON', 'SMY', 'GRE', 'BUL', 'ION', 'EAS'],
  EAS: ['SMY', 'SYR', 'ION', 'AEG'],
  BLA: ['CON', 'ANK', 'ARM', 'SEV', 'RUM', 'BUL'],
  BAR: ['STP', 'NWY', 'NWG'],
};

/**
 * Parse unit positions from the turn prompt.
 * Returns array of { type: 'A' | 'F', province: string }
 */
function parseUnitsFromPrompt(prompt: string): Array<{ type: 'A' | 'F'; province: string }> {
  const units: Array<{ type: 'A' | 'F'; province: string }> = [];

  // Look for "### Your Units" section
  const unitsMatch = prompt.match(/### Your Units[^\n]*\n([\s\S]*?)(?=\n###|\n##|$)/);
  if (!unitsMatch) {
    return units;
  }

  const unitsSection = unitsMatch[1];
  // Match lines like "- A Paris" or "- F London" or "- A St Petersburg (north coast)"
  const unitPattern = /^- ([AF]) ([A-Za-z ]+?)(?:\s*\([^)]*\))?$/gm;
  let match;

  while ((match = unitPattern.exec(unitsSection)) !== null) {
    const type = match[1] as 'A' | 'F';
    // Normalize province name to abbreviation
    const province = normalizeProvince(match[2].trim());
    if (province) {
      units.push({ type, province });
    }
  }

  return units;
}

/**
 * Normalize province name to standard 3-letter abbreviation.
 */
function normalizeProvince(name: string): string {
  const normalized = name.toUpperCase().trim();

  // Common full names to abbreviations
  const nameMap: Record<string, string> = {
    'LONDON': 'LON', 'EDINBURGH': 'EDI', 'LIVERPOOL': 'LVP', 'YORK': 'YOR',
    'WALES': 'WAL', 'CLYDE': 'CLY',
    'PARIS': 'PAR', 'BREST': 'BRE', 'MARSEILLES': 'MAR', 'BURGUNDY': 'BUR',
    'GASCONY': 'GAS', 'PICARDY': 'PIC',
    'BERLIN': 'BER', 'MUNICH': 'MUN', 'KIEL': 'KIE', 'RUHR': 'RUH',
    'SILESIA': 'SIL', 'PRUSSIA': 'PRU',
    'ROME': 'ROM', 'NAPLES': 'NAP', 'VENICE': 'VEN', 'TUSCANY': 'TUS',
    'PIEDMONT': 'PIE', 'APULIA': 'APU',
    'VIENNA': 'VIE', 'BUDAPEST': 'BUD', 'TRIESTE': 'TRI', 'BOHEMIA': 'BOH',
    'GALICIA': 'GAL', 'TYROLIA': 'TYR',
    'MOSCOW': 'MOS', 'WARSAW': 'WAR', 'ST PETERSBURG': 'STP', 'SEVASTOPOL': 'SEV',
    'UKRAINE': 'UKR', 'LIVONIA': 'LVN', 'FINLAND': 'FIN',
    'CONSTANTINOPLE': 'CON', 'ANKARA': 'ANK', 'SMYRNA': 'SMY', 'ARMENIA': 'ARM',
    'SYRIA': 'SYR',
    'NORWAY': 'NWY', 'SWEDEN': 'SWE', 'DENMARK': 'DEN', 'HOLLAND': 'HOL',
    'BELGIUM': 'BEL', 'SPAIN': 'SPA', 'PORTUGAL': 'POR', 'TUNIS': 'TUN',
    'NORTH AFRICA': 'NAF', 'SERBIA': 'SER', 'ALBANIA': 'ALB', 'GREECE': 'GRE',
    'BULGARIA': 'BUL', 'RUMANIA': 'RUM',
    'NORTH SEA': 'NTH', 'NORWEGIAN SEA': 'NWG', 'ENGLISH CHANNEL': 'ENG',
    'IRISH SEA': 'IRI', 'MID-ATLANTIC OCEAN': 'MAO', 'NORTH ATLANTIC OCEAN': 'NAO',
    'HELGOLAND BIGHT': 'HEL', 'BALTIC SEA': 'BAL', 'GULF OF BOTHNIA': 'BOT',
    'SKAGERRAK': 'SKA', 'TYRRHENIAN SEA': 'TYS', 'IONIAN SEA': 'ION',
    'ADRIATIC SEA': 'ADR', 'GULF OF LYON': 'LYO', 'WESTERN MEDITERRANEAN': 'WES',
    'AEGEAN SEA': 'AEG', 'EASTERN MEDITERRANEAN': 'EAS', 'BLACK SEA': 'BLA',
    'BARENTS SEA': 'BAR',
  };

  // Check if it's a full name
  if (nameMap[normalized]) {
    return nameMap[normalized];
  }

  // Already an abbreviation (3 letters)
  if (normalized.length <= 3 && ADJACENCIES[normalized]) {
    return normalized;
  }

  // Try to find partial match
  for (const [fullName, abbrev] of Object.entries(nameMap)) {
    if (fullName.startsWith(normalized) || normalized.startsWith(fullName)) {
      return abbrev;
    }
  }

  // Return as-is if we can't normalize (might still be valid)
  return normalized.substring(0, 3);
}

/**
 * Get a random adjacent territory for a unit.
 */
function getRandomAdjacent(province: string): string | null {
  const adjacent = ADJACENCIES[province];
  if (!adjacent || adjacent.length === 0) {
    return null;
  }
  return adjacent[Math.floor(Math.random() * adjacent.length)];
}

/**
 * Creates a mock LLM provider for testing with random moves and diplomacy.
 */
export function createMockLLMProvider(): LLMProvider {
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

      // Get the user message (turn prompt) which contains actual unit positions
      const userMsg = params.messages.find(m => m.role === 'user')?.content || '';

      // Parse actual units from the prompt
      const myUnits = parseUnitsFromPrompt(userMsg);

      // Generate orders for actual units
      const orders: string[] = [];
      for (const unit of myUnits) {
        const moveType = Math.random();
        const unitPrefix = unit.type;

        if (moveType < 0.3) {
          // HOLD (30% chance)
          orders.push(`${unitPrefix} ${unit.province} HOLD`);
        } else if (moveType < 0.8) {
          // MOVE (50% chance)
          const destination = getRandomAdjacent(unit.province);
          if (destination) {
            orders.push(`${unitPrefix} ${unit.province} -> ${destination}`);
          } else {
            orders.push(`${unitPrefix} ${unit.province} HOLD`);
          }
        } else {
          // SUPPORT another unit (20% chance)
          const otherUnits = myUnits.filter(u => u.province !== unit.province);
          if (otherUnits.length > 0) {
            const supportTarget = otherUnits[Math.floor(Math.random() * otherUnits.length)];
            orders.push(`${unitPrefix} ${unit.province} SUPPORT ${supportTarget.type} ${supportTarget.province}`);
          } else {
            orders.push(`${unitPrefix} ${unit.province} HOLD`);
          }
        }
      }

      // If no units were parsed, generate a fallback HOLD
      if (orders.length === 0) {
        orders.push('No units available');
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
