/**
 * SpectatorDashboard - Grid view of all games with filtering.
 *
 * Main entry point for the spectator interface showing available games.
 */

import { useState, useMemo } from 'react';
import { useSpectator } from '../../spectator/SpectatorContext';
import { useLiveGame, type ConnectionState } from '../../spectator/useLiveGame';
import { createGameSummary, type GameSummary } from '../../spectator/types';
import { GameCard, GameCardCompact } from './GameCard';
import { PowerBadgeRow } from '../shared/PowerBadge';

type StatusFilter = 'all' | 'active' | 'completed' | 'paused';
type ViewMode = 'grid' | 'list';

interface SpectatorDashboardProps {
  /** Callback when a game is selected */
  onSelectGame?: (gameId: string) => void;
  /** Whether to enable live game connection */
  enableLiveConnection?: boolean;
  /** WebSocket server URL */
  serverUrl?: string;
}

export function SpectatorDashboard({
  onSelectGame,
  enableLiveConnection = false,
  serverUrl,
}: SpectatorDashboardProps) {
  const { state, selectGame } = useSpectator();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [isStartingGame, setIsStartingGame] = useState(false);

  // Live game connection (only active when enabled)
  const {
    connectionState,
    error: connectionError,
    startGame: startLiveGame,
    reconnect,
  } = useLiveGame({
    serverUrl,
    autoConnect: enableLiveConnection,
    autoReconnect: enableLiveConnection,
  });

  // Convert games to summaries and filter
  const gameSummaries = useMemo(() => {
    const summaries: GameSummary[] = [];
    state.games.forEach((game) => {
      summaries.push(createGameSummary(game));
    });
    return summaries;
  }, [state.games]);

  const filteredGames = useMemo(() => {
    return gameSummaries
      .filter((game) => {
        // Status filter
        if (statusFilter !== 'all' && game.status !== statusFilter) {
          return false;
        }
        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          if (!game.name.toLowerCase().includes(query) && !game.gameId.toLowerCase().includes(query)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        // Active games first, then by last activity
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (b.status === 'active' && a.status !== 'active') return 1;
        const aTime = typeof a.lastActivity === 'string' ? new Date(a.lastActivity).getTime() : a.lastActivity.getTime();
        const bTime = typeof b.lastActivity === 'string' ? new Date(b.lastActivity).getTime() : b.lastActivity.getTime();
        return bTime - aTime;
      });
  }, [gameSummaries, statusFilter, searchQuery]);

  const handleSelectGame = (gameId: string) => {
    selectGame(gameId);
    onSelectGame?.(gameId);
  };

  const handleStartNewGame = () => {
    if (connectionState !== 'connected') {
      return;
    }
    setIsStartingGame(true);
    startLiveGame(`AI Game ${Date.now()}`);
    // Reset after a brief moment (game creation is async)
    setTimeout(() => setIsStartingGame(false), 1000);
  };

  // Stats counts
  const activeCount = gameSummaries.filter((g) => g.status === 'active').length;
  const completedCount = gameSummaries.filter((g) => g.status === 'completed').length;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Spectator Dashboard</h1>
              <p className="text-gray-400 text-sm mt-1">
                Watch AI agents play Diplomacy in real-time
              </p>
            </div>
            <div className="flex items-center gap-4">
              {enableLiveConnection && (
                <div className="flex items-center gap-3">
                  <ConnectionIndicator
                    state={connectionState}
                    error={connectionError}
                    onReconnect={reconnect}
                  />
                  <button
                    onClick={handleStartNewGame}
                    disabled={connectionState !== 'connected' || isStartingGame}
                    className={`
                      px-4 py-2 rounded-lg font-medium transition-colors
                      ${connectionState === 'connected' && !isStartingGame
                        ? 'bg-green-600 hover:bg-green-500 text-white'
                        : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      }
                    `}
                  >
                    {isStartingGame ? 'Starting...' : 'Start New Game'}
                  </button>
                </div>
              )}
              <PowerBadgeRow size="md" />
            </div>
          </div>

          {/* Filters and search */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Status filter tabs */}
            <div className="flex bg-gray-700 rounded-lg p-1">
              {[
                { key: 'all', label: 'All', count: gameSummaries.length },
                { key: 'active', label: 'Active', count: activeCount },
                { key: 'completed', label: 'Completed', count: completedCount },
              ].map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key as StatusFilter)}
                  className={`
                    px-3 py-1.5 text-sm rounded-md transition-colors
                    ${statusFilter === key
                      ? 'bg-gray-600 text-white'
                      : 'text-gray-400 hover:text-white'
                    }
                  `}
                >
                  {label} ({count})
                </button>
              ))}
            </div>

            {/* Search input */}
            <div className="flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search games..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-sm
                  placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* View mode toggle */}
            <div className="flex bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`
                  px-3 py-1.5 text-sm rounded-md transition-colors
                  ${viewMode === 'grid' ? 'bg-gray-600 text-white' : 'text-gray-400'}
                `}
                title="Grid view"
              >
                <GridIcon />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`
                  px-3 py-1.5 text-sm rounded-md transition-colors
                  ${viewMode === 'list' ? 'bg-gray-600 text-white' : 'text-gray-400'}
                `}
                title="List view"
              >
                <ListIcon />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {filteredGames.length === 0 ? (
          <EmptyState
            hasGames={gameSummaries.length > 0}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
          />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredGames.map((game) => {
              const fullGame = state.games.get(game.gameId);
              return (
                <GameCard
                  key={game.gameId}
                  game={game}
                  onClick={() => handleSelectGame(game.gameId)}
                  isSelected={state.activeGameId === game.gameId}
                  currentAgent={fullGame?.currentAgent}
                />
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredGames.map((game) => (
              <GameCardCompact
                key={game.gameId}
                game={game}
                onClick={() => handleSelectGame(game.gameId)}
                isSelected={state.activeGameId === game.gameId}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState({
  hasGames,
  searchQuery,
  statusFilter,
}: {
  hasGames: boolean;
  searchQuery: string;
  statusFilter: StatusFilter;
}) {
  if (!hasGames) {
    return (
      <div className="text-center py-16">
        <div className="text-gray-500 text-6xl mb-4">🎯</div>
        <h2 className="text-xl font-semibold mb-2">No games yet</h2>
        <p className="text-gray-400">
          Games will appear here once AI agents start playing.
        </p>
      </div>
    );
  }

  return (
    <div className="text-center py-16">
      <div className="text-gray-500 text-4xl mb-4">🔍</div>
      <h2 className="text-xl font-semibold mb-2">No matching games</h2>
      <p className="text-gray-400">
        {searchQuery
          ? `No games matching "${searchQuery}"`
          : `No ${statusFilter} games found`}
      </p>
    </div>
  );
}

function GridIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
    </svg>
  );
}

interface ConnectionIndicatorProps {
  state: ConnectionState;
  error: string | null;
  onReconnect: () => void;
}

function ConnectionIndicator({ state, error, onReconnect }: ConnectionIndicatorProps) {
  const stateConfig: Record<ConnectionState, { color: string; label: string }> = {
    connected: { color: 'bg-green-500', label: 'Connected' },
    connecting: { color: 'bg-yellow-500', label: 'Connecting...' },
    disconnected: { color: 'bg-gray-500', label: 'Disconnected' },
    error: { color: 'bg-red-500', label: 'Error' },
  };

  const config = stateConfig[state];

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${config.color}`} />
      <span className="text-sm text-gray-400">{config.label}</span>
      {(state === 'disconnected' || state === 'error') && (
        <button
          onClick={onReconnect}
          className="text-xs text-blue-400 hover:text-blue-300 underline"
        >
          Reconnect
        </button>
      )}
      {error && (
        <span className="text-xs text-red-400" title={error}>
          (!)
        </span>
      )}
    </div>
  );
}
