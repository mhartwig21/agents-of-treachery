/**
 * PowerStatsPanel - Display supply center and unit counts for each power.
 *
 * Shows at-a-glance game statistics with visual progress bars.
 */

import { type LowercasePower, UI_POWERS, POWER_COLORS } from '../../spectator/types';
import { PowerBadge } from '../shared/PowerBadge';

interface PowerStatsPanelProps {
  /** Supply center counts by power */
  supplyCenterCounts: Record<LowercasePower, number>;
  /** Unit counts by power */
  unitCounts: Record<LowercasePower, number>;
  /** Currently selected/highlighted power */
  selectedPower?: LowercasePower;
  /** Callback when a power is clicked */
  onPowerClick?: (power: LowercasePower) => void;
  /** Whether the panel is in compact mode */
  compact?: boolean;
  className?: string;
}

const WINNING_SC_COUNT = 18;
const TOTAL_SC_COUNT = 34;

export function PowerStatsPanel({
  supplyCenterCounts,
  unitCounts,
  selectedPower,
  onPowerClick,
  compact = false,
  className = '',
}: PowerStatsPanelProps) {
  // Build stats array and sort by SC count
  const powerStats = UI_POWERS.map((power) => ({
    power,
    supplyCenters: supplyCenterCounts[power] || 0,
    units: unitCounts[power] || 0,
    isEliminated: (supplyCenterCounts[power] || 0) === 0 && (unitCounts[power] || 0) === 0,
  })).sort((a, b) => b.supplyCenters - a.supplyCenters);

  if (compact) {
    return (
      <div className={`bg-gray-800 rounded-lg p-3 ${className}`}>
        <div className="flex flex-wrap gap-3">
          {powerStats.map(({ power, supplyCenters, isEliminated }) => (
            <button
              key={power}
              onClick={() => onPowerClick?.(power)}
              disabled={isEliminated}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded transition-colors
                ${selectedPower === power ? 'bg-gray-600' : 'hover:bg-gray-700'}
                ${isEliminated ? 'opacity-40' : ''}
              `}
            >
              <PowerBadge power={power} size="sm" />
              <span className="text-sm font-mono">{supplyCenters}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800 ${className}`}>
      <div className="p-4 space-y-3">
        {powerStats.map(({ power, supplyCenters, units, isEliminated }) => (
          <PowerStatRow
            key={power}
            power={power}
            supplyCenters={supplyCenters}
            units={units}
            isEliminated={isEliminated}
            isSelected={selectedPower === power}
            onClick={() => onPowerClick?.(power)}
          />
        ))}
      </div>
      {/* Victory threshold marker */}
      <div className="px-4 pb-3 text-xs text-gray-500">
        Victory: {WINNING_SC_COUNT} supply centers
      </div>
    </div>
  );
}

interface PowerStatRowProps {
  power: LowercasePower;
  supplyCenters: number;
  units: number;
  isEliminated: boolean;
  isSelected: boolean;
  onClick: () => void;
}

function PowerStatRow({
  power,
  supplyCenters,
  units,
  isEliminated,
  isSelected,
  onClick,
}: PowerStatRowProps) {
  const scPercent = (supplyCenters / TOTAL_SC_COUNT) * 100;
  const winPercent = (WINNING_SC_COUNT / TOTAL_SC_COUNT) * 100;

  return (
    <button
      onClick={onClick}
      disabled={isEliminated}
      className={`
        w-full text-left p-2 rounded transition-colors
        ${isSelected ? 'bg-gray-700' : 'hover:bg-gray-700/50'}
        ${isEliminated ? 'opacity-40 cursor-default' : 'cursor-pointer'}
      `}
    >
      <div className="flex items-center justify-between mb-2">
        <PowerBadge power={power} showLabel size="sm" />
        <div className="flex items-center gap-3 text-sm">
          <span className="font-mono">
            <span className="text-white">{supplyCenters}</span>
            <span className="text-gray-500"> SC</span>
          </span>
          <span className="font-mono text-gray-400">
            {units} <span className="text-gray-600">units</span>
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden relative">
        {/* Victory threshold marker */}
        <div
          className="absolute top-0 bottom-0 w-px bg-yellow-500/50"
          style={{ left: `${winPercent}%` }}
        />
        {/* Progress fill */}
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${scPercent}%`,
            backgroundColor: POWER_COLORS[power],
          }}
        />
      </div>

      {/* Near victory indicator */}
      {supplyCenters >= WINNING_SC_COUNT - 2 && supplyCenters < WINNING_SC_COUNT && (
        <div className="mt-1 text-xs text-yellow-500">
          {WINNING_SC_COUNT - supplyCenters} SC from victory
        </div>
      )}
      {supplyCenters >= WINNING_SC_COUNT && (
        <div className="mt-1 text-xs text-green-500">
          Victory threshold reached!
        </div>
      )}
    </button>
  );
}

/**
 * Mini version for mobile header.
 */
interface PowerStatsMiniProps {
  supplyCenterCounts: Record<LowercasePower, number>;
  className?: string;
}

export function PowerStatsMini({ supplyCenterCounts, className = '' }: PowerStatsMiniProps) {
  const sorted = UI_POWERS
    .map((power) => ({ power, count: supplyCenterCounts[power] || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {sorted.map(({ power, count }) => (
        <span key={power} className="flex items-center gap-1 text-xs">
          <span
            className="w-2 h-2 rounded"
            style={{ backgroundColor: POWER_COLORS[power] }}
          />
          <span className="font-mono">{count}</span>
        </span>
      ))}
    </div>
  );
}
