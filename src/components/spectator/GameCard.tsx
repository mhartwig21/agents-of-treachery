/**
 * GameCard - Summary card for a game in the spectator dashboard.
 *
 * Shows game name, current turn, progress bar, and power statistics.
 */

import { type GameSummary, UI_POWERS, POWER_COLORS } from '../../spectator/types';
import { PhaseIndicator } from '../shared/PhaseIndicator';
import { PowerBadge } from '../shared/PowerBadge';

interface GameCardProps {
  game: GameSummary;
  onClick: () => void;
  isSelected?: boolean;
  /** Which agent is currently thinking (for live indicator) */
  currentAgent?: string;
}

export function GameCard({ game, onClick, isSelected = false, currentAgent }: GameCardProps) {
  // Status badge styling
  const statusStyles = {
    active: 'bg-green-900/50 text-green-400',
    completed: 'bg-gray-700 text-gray-400',
    paused: 'bg-yellow-900/50 text-yellow-400',
  };

  const isAgentActive = game.status === 'active' && currentAgent;

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      role="button"
      tabIndex={0}
      className={`
        bg-gray-800 rounded-lg p-4 cursor-pointer transition-all
        hover:bg-gray-750 hover:ring-1 hover:ring-gray-600
        focus:outline-none focus:ring-2 focus:ring-blue-500
        ${isSelected ? 'ring-2 ring-blue-500' : ''}
        ${isAgentActive ? 'ring-1 ring-green-500/50' : ''}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white truncate">{game.name}</h3>
          <PhaseIndicator
            year={game.currentYear}
            season={game.currentSeason}
            phase={game.currentPhase}
            size="sm"
            className="mt-1"
          />
        </div>
        <div className="flex items-center gap-2">
          {isAgentActive && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="capitalize">{currentAgent}</span>
            </span>
          )}
          <span className={`text-xs px-2 py-1 rounded ${statusStyles[game.status]}`}>
            {game.status}
          </span>
        </div>
      </div>

      {/* Progress bar showing SC distribution */}
      <div className="h-3 bg-gray-700 rounded-full overflow-hidden flex mb-3">
        {UI_POWERS.map((power) => {
          const count = game.supplyCenterCounts[power];
          if (count === 0) return null;
          const width = (count / 34) * 100; // 34 total supply centers
          return (
            <div
              key={power}
              className="h-full transition-all duration-300"
              style={{
                width: `${width}%`,
                backgroundColor: POWER_COLORS[power],
              }}
              title={`${power}: ${count} SCs`}
            />
          );
        })}
      </div>

      {/* Power stats grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-xs mb-3">
        {UI_POWERS.filter(p => game.supplyCenterCounts[p] > 0 || game.unitCounts[p] > 0).map((power) => (
          <div key={power} className="flex items-center gap-1">
            <PowerBadge power={power} size="sm" />
            <span className="text-gray-400">{game.supplyCenterCounts[power]}</span>
          </div>
        ))}
      </div>

      {/* Footer with messages and last activity */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{game.messageCount} messages</span>
        <span>{formatTimeAgo(game.lastActivity)}</span>
      </div>

      {/* Winner display if completed */}
      {game.status === 'completed' && game.winner && (
        <div className="mt-3 pt-3 border-t border-gray-700 flex items-center gap-2">
          <span className="text-yellow-500 text-sm">Winner:</span>
          <PowerBadge power={game.winner} showLabel size="sm" />
        </div>
      )}
    </div>
  );
}

/**
 * Formats a date as a relative time string.
 */
function formatTimeAgo(date: Date | string): string {
  const now = new Date();
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - dateObj.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return dateObj.toLocaleDateString();
}

/**
 * Compact game card for lists.
 */
interface GameCardCompactProps {
  game: GameSummary;
  onClick: () => void;
  isSelected?: boolean;
}

export function GameCardCompact({ game, onClick, isSelected = false }: GameCardCompactProps) {
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      role="button"
      tabIndex={0}
      className={`
        flex items-center justify-between p-3 rounded cursor-pointer transition-colors
        hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500
        ${isSelected ? 'bg-gray-700 ring-1 ring-blue-500' : 'bg-gray-800'}
      `}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            game.status === 'active' ? 'bg-green-500' : 'bg-gray-500'
          }`}
        />
        <span className="truncate font-medium">{game.name}</span>
      </div>
      <PhaseIndicator
        year={game.currentYear}
        season={game.currentSeason}
        phase={game.currentPhase}
        compact
        size="sm"
      />
    </div>
  );
}
