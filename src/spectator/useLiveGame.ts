/**
 * React hook for connecting to the live game server.
 *
 * Provides real-time game updates via WebSocket connection.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useSpectator } from './SpectatorContext';
import type { GameHistory, GameSnapshot } from './types';

/**
 * Server message types (must match server).
 */
type ServerMessage =
  | { type: 'GAME_LIST'; games: GameHistory[] }
  | { type: 'GAME_CREATED'; game: GameHistory }
  | { type: 'GAME_UPDATED'; gameId: string; updates: Partial<GameHistory> }
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
 * Hook return type.
 */
export interface UseLiveGameReturn {
  /** Current connection state */
  connectionState: ConnectionState;
  /** Error message if any */
  error: string | null;
  /** Start a new game */
  startGame: (name?: string) => void;
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
  const { addGame, updateGame, addSnapshot, dispatch } = useSpectator();

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);

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
            break;

          case 'GAME_UPDATED':
            updateGame(message.gameId, message.updates);
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
              winner: message.winner?.toLowerCase() as any,
            });
            break;

          case 'ERROR':
            setError(message.message);
            break;
        }
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    },
    [addGame, updateGame, addSnapshot, dispatch]
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
   */
  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  /**
   * Starts a new game.
   */
  const startGame = useCallback(
    (name?: string) => {
      send({ type: 'START_GAME', name });
    },
    [send]
  );

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
