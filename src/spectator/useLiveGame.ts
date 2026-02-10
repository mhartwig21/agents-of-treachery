/**
 * React hook for connecting to the live game server.
 *
 * Provides real-time game updates via WebSocket connection.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useSpectator } from './SpectatorContext';
import type { GameHistory, GameSnapshot } from './types';
import { toUIPower, type UppercasePower } from './types';
import type { Message } from '../press/types';
import type { Order as UIOrder } from '../types/game';

/**
 * Server message types (must match server).
 */
type ServerMessage =
  | { type: 'GAME_LIST'; games: GameHistory[] }
  | { type: 'GAME_CREATED'; game: GameHistory }
  | { type: 'GAME_UPDATED'; gameId: string; updates: Partial<GameHistory>; latestMessages?: Message[]; latestOrders?: Record<string, UIOrder[]> }
  | { type: 'SNAPSHOT_ADDED'; gameId: string; snapshot: GameSnapshot }
  | { type: 'GAME_ENDED'; gameId: string; winner?: string; draw?: boolean }
  | { type: 'ERROR'; message: string };

/**
 * Client message types.
 */
type ClientMessage =
  | { type: 'START_GAME'; name?: string }
  | { type: 'SUBSCRIBE_GAME'; gameId: string }
  | { type: 'UNSUBSCRIBE_GAME'; gameId: string }
  | { type: 'GET_GAMES' };

/**
 * Connection state.
 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Game start event for tracking creation lifecycle.
 */
export type GameStartEvent =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'created'; gameId: string }
  | { status: 'error'; message: string };

/**
 * Hook return type.
 */
export interface UseLiveGameReturn {
  /** Current connection state */
  connectionState: ConnectionState;
  /** Error message if any */
  error: string | null;
  /** Start a new game. Returns false if the message could not be sent. */
  startGame: (name?: string) => boolean;
  /** Game creation lifecycle event */
  gameStartEvent: GameStartEvent;
  /** Reset gameStartEvent back to idle */
  clearGameStartEvent: () => void;
  /** Subscribe to a specific game's updates */
  subscribeToGame: (gameId: string) => void;
  /** Unsubscribe from a game */
  unsubscribeFromGame: (gameId: string) => void;
  /** Refresh game list */
  refreshGames: () => void;
  /** Reconnect to server */
  reconnect: () => void;
}

/**
 * Hook options.
 */
export interface UseLiveGameOptions {
  /** WebSocket server URL */
  serverUrl?: string;
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
}

const DEFAULT_OPTIONS: Required<UseLiveGameOptions> = {
  serverUrl: 'ws://localhost:3001',
  autoConnect: true,
  autoReconnect: true,
  reconnectDelay: 3000,
};

/**
 * Hook for connecting to the live game server.
 *
 * Usage:
 * ```tsx
 * function GameDashboard() {
 *   const { connectionState, startGame, error } = useLiveGame();
 *
 *   return (
 *     <div>
 *       <p>Status: {connectionState}</p>
 *       {error && <p>Error: {error}</p>}
 *       <button onClick={() => startGame('My Game')}>Start Game</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useLiveGame(options: UseLiveGameOptions = {}): UseLiveGameReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { addGame, updateGame, addSnapshot, dispatch, accumulateMessages, accumulateOrders } = useSpectator();

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [gameStartEvent, setGameStartEvent] = useState<GameStartEvent>({ status: 'idle' });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  // Track subscribed games to re-subscribe on reconnect
  const subscribedGamesRef = useRef<Set<string>>(new Set());

  // Use a ref for the message handler to avoid recreating connect() on context changes
  const handleMessageRef = useRef<(event: MessageEvent) => void>(() => {});

  /**
   * Handles incoming server messages.
   */
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;

        switch (message.type) {
          case 'GAME_LIST':
            // Replace all games with server's list
            dispatch({ type: 'SET_GAMES', games: message.games });
            break;

          case 'GAME_CREATED':
            addGame(message.game);
            // Server auto-subscribes the client that created the game
            subscribedGamesRef.current.add(message.game.gameId);
            setGameStartEvent({ status: 'created', gameId: message.game.gameId });
            break;

          case 'GAME_UPDATED':
            updateGame(message.gameId, message.updates);
            // Accumulate real-time messages and orders into live accumulator
            if (message.latestMessages && message.latestMessages.length > 0) {
              accumulateMessages(message.gameId, message.latestMessages);
            }
            if (message.latestOrders) {
              accumulateOrders(message.gameId, message.latestOrders);
            }
            break;

          case 'SNAPSHOT_ADDED':
            // Parse dates from JSON
            const snapshot = {
              ...message.snapshot,
              timestamp: new Date(message.snapshot.timestamp),
            };
            addSnapshot(message.gameId, snapshot);
            break;

          case 'GAME_ENDED':
            updateGame(message.gameId, {
              status: 'completed',
              winner: message.winner ? toUIPower(message.winner as UppercasePower) : undefined,
            });
            break;

          case 'ERROR':
            setError(message.message);
            setGameStartEvent((prev) =>
              prev.status === 'pending'
                ? { status: 'error', message: message.message }
                : prev
            );
            break;
        }
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    },
    [addGame, updateGame, addSnapshot, dispatch, accumulateMessages, accumulateOrders]
  );

  // Keep the ref updated with the latest handler
  handleMessageRef.current = handleMessage;

  /**
   * Connects to the WebSocket server.
   * Uses stable options ref to avoid dependency on changing callbacks.
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionState('connecting');
    setError(null);

    try {
      const ws = new WebSocket(opts.serverUrl);

      ws.onopen = () => {
        setConnectionState('connected');
        setError(null);
        // Re-subscribe to any games we were previously subscribed to
        for (const gameId of subscribedGamesRef.current) {
          ws.send(JSON.stringify({ type: 'SUBSCRIBE_GAME', gameId }));
        }
      };

      ws.onmessage = (event) => handleMessageRef.current(event);

      ws.onerror = () => {
        setConnectionState('error');
        setError('Connection error');
      };

      ws.onclose = () => {
        setConnectionState('disconnected');
        wsRef.current = null;

        // Auto-reconnect
        if (opts.autoReconnect) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, opts.reconnectDelay);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      setConnectionState('error');
      setError(`Failed to connect: ${err}`);
    }
  }, [opts.serverUrl, opts.autoReconnect, opts.reconnectDelay]);

  /**
   * Sends a message to the server.
   * Returns true if the message was sent, false if the connection is not open.
   */
  const send = useCallback((message: ClientMessage): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  /**
   * Starts a new game.
   * Returns true if the request was sent, false if the connection is not open.
   */
  const startGame = useCallback(
    (name?: string): boolean => {
      const sent = send({ type: 'START_GAME', name });
      if (sent) {
        setGameStartEvent({ status: 'pending' });
      }
      return sent;
    },
    [send]
  );

  /**
   * Resets the game start event back to idle.
   */
  const clearGameStartEvent = useCallback(() => {
    setGameStartEvent({ status: 'idle' });
  }, []);

  /**
   * Subscribes to a game's updates.
   */
  const subscribeToGame = useCallback(
    (gameId: string) => {
      subscribedGamesRef.current.add(gameId);
      send({ type: 'SUBSCRIBE_GAME', gameId });
    },
    [send]
  );

  /**
   * Unsubscribes from a game.
   */
  const unsubscribeFromGame = useCallback(
    (gameId: string) => {
      subscribedGamesRef.current.delete(gameId);
      send({ type: 'UNSUBSCRIBE_GAME', gameId });
    },
    [send]
  );

  /**
   * Refreshes the game list.
   */
  const refreshGames = useCallback(() => {
    send({ type: 'GET_GAMES' });
  }, [send]);

  /**
   * Manually reconnects.
   */
  const reconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    connect();
  }, [connect]);

  // Auto-connect on mount
  useEffect(() => {
    if (opts.autoConnect) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [opts.autoConnect, connect]);

  return {
    connectionState,
    error,
    startGame,
    gameStartEvent,
    clearGameStartEvent,
    subscribeToGame,
    unsubscribeFromGame,
    refreshGames,
    reconnect,
  };
}

/**
 * Hook for using live game without auto-connect.
 * Useful for components that want manual control.
 */
export function useLiveGameManual(serverUrl?: string): UseLiveGameReturn {
  return useLiveGame({
    serverUrl,
    autoConnect: false,
    autoReconnect: false,
  });
}
