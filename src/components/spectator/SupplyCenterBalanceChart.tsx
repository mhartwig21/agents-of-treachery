/**
 * SupplyCenterBalanceChart - Line/area chart showing SC ownership per power across phases.
 *
 * Visualizes momentum shifts, collapses, and comebacks throughout the game.
 * Key metric for understanding game flow at a glance.
 */

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useSpectator } from '../../spectator/SpectatorContext';
import { UI_POWERS, POWER_COLORS, type LowercasePower, type GameSnapshot } from '../../spectator/types';

const WINNING_SC_COUNT = 18;

interface ChartDataPoint {
  /** Label for x-axis: "1901 S" */
  label: string;
  /** Full label: "Spring 1901" */
  fullLabel: string;
  /** Index into snapshots array */
  position: number;
  /** SC count per power */
  england: number;
  france: number;
  germany: number;
  italy: number;
  austria: number;
  russia: number;
  turkey: number;
}

/**
 * Extract SC counts from a game snapshot.
 */
function getSupplyCenterCountsFromSnapshot(
  snapshot: GameSnapshot
): Record<LowercasePower, number> {
  const counts: Record<LowercasePower, number> = {
    england: 0,
    france: 0,
    germany: 0,
    italy: 0,
    austria: 0,
    russia: 0,
    turkey: 0,
  };

  for (const owner of Object.values(snapshot.gameState.supplyCenters)) {
    if (owner) {
      counts[owner]++;
    }
  }

  return counts;
}

/**
 * Format season abbreviation.
 */
function seasonAbbrev(season: string): string {
  switch (season) {
    case 'SPRING':
      return 'S';
    case 'FALL':
      return 'F';
    case 'WINTER':
      return 'W';
    default:
      return season.charAt(0);
  }
}

/**
 * Format full season name.
 */
function seasonFull(season: string): string {
  switch (season) {
    case 'SPRING':
      return 'Spring';
    case 'FALL':
      return 'Fall';
    case 'WINTER':
      return 'Winter';
    default:
      return season;
  }
}

interface SupplyCenterBalanceChartProps {
  /** Additional CSS classes */
  className?: string;
  /** Chart height in pixels */
  height?: number;
}

export function SupplyCenterBalanceChart({
  className = '',
  height = 200,
}: SupplyCenterBalanceChartProps) {
  const { activeGame, state, seekToPosition } = useSpectator();

  // Build chart data from all snapshots
  const chartData = useMemo(() => {
    if (!activeGame?.snapshots?.length) return [];

    const data: ChartDataPoint[] = [];
    let lastYear = 0;
    let lastSeason = '';

    for (let i = 0; i < activeGame.snapshots.length; i++) {
      const snapshot = activeGame.snapshots[i];
      const counts = getSupplyCenterCountsFromSnapshot(snapshot);

      // Only include unique year/season combinations to avoid cluttering
      // (multiple phases in same season have same SC counts)
      if (snapshot.year === lastYear && snapshot.season === lastSeason) {
        // Update existing data point with latest position
        const last = data[data.length - 1];
        if (last) {
          last.position = i;
        }
        continue;
      }

      lastYear = snapshot.year;
      lastSeason = snapshot.season;

      data.push({
        label: `${snapshot.year % 100}${seasonAbbrev(snapshot.season)}`,
        fullLabel: `${seasonFull(snapshot.season)} ${snapshot.year}`,
        position: i,
        ...counts,
      });
    }

    return data;
  }, [activeGame?.snapshots]);

  // Current position for highlighting
  const currentPosition = useMemo(() => {
    if (state.replayPosition === null) {
      return activeGame?.snapshots?.length ? activeGame.snapshots.length - 1 : 0;
    }
    return state.replayPosition;
  }, [state.replayPosition, activeGame?.snapshots?.length]);

  // Find which data point corresponds to current position
  const currentDataIndex = useMemo(() => {
    if (!chartData.length) return 0;
    // Find the data point whose position is <= currentPosition
    let idx = 0;
    for (let i = 0; i < chartData.length; i++) {
      if (chartData[i].position <= currentPosition) {
        idx = i;
      }
    }
    return idx;
  }, [chartData, currentPosition]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChartClick = (data: any) => {
    if (data?.activePayload?.[0]?.payload) {
      const point = data.activePayload[0].payload as ChartDataPoint;
      seekToPosition(point.position);
    }
  };

  if (!chartData.length) {
    return (
      <div className={`p-4 text-center text-gray-500 text-sm ${className}`}>
        No game history available
      </div>
    );
  }

  return (
    <div className={`p-2 ${className}`}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          onClick={handleChartClick}
        >
          <XAxis
            dataKey="label"
            tick={{ fill: '#9ca3af', fontSize: 10 }}
            tickLine={{ stroke: '#4b5563' }}
            axisLine={{ stroke: '#4b5563' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: '#9ca3af', fontSize: 10 }}
            tickLine={{ stroke: '#4b5563' }}
            axisLine={{ stroke: '#4b5563' }}
            domain={[0, 'dataMax']}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: '#6b7280', strokeWidth: 1 }}
          />
          {/* Victory threshold line */}
          <ReferenceLine
            y={WINNING_SC_COUNT}
            stroke="#eab308"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />
          {/* Current position indicator */}
          {chartData[currentDataIndex] && (
            <ReferenceLine
              x={chartData[currentDataIndex].label}
              stroke="#60a5fa"
              strokeWidth={2}
              strokeOpacity={0.8}
            />
          )}
          {/* Area for each power (stacked: false for line chart effect) */}
          {UI_POWERS.map((power) => (
            <Area
              key={power}
              type="monotone"
              dataKey={power}
              stroke={POWER_COLORS[power]}
              fill={POWER_COLORS[power]}
              fillOpacity={0.1}
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 4,
                stroke: POWER_COLORS[power],
                strokeWidth: 2,
                fill: '#1f2937',
              }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 px-2">
        {UI_POWERS.map((power) => (
          <div key={power} className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-sm"
              style={{ backgroundColor: POWER_COLORS[power] }}
            />
            <span className="text-xs text-gray-400 capitalize">{power.slice(0, 3)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Custom tooltip component for the chart.
 */
interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
  }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;

  // Find the full label from payload
  const firstPayload = payload[0] as unknown as { payload?: ChartDataPoint };
  const fullLabel = firstPayload?.payload?.fullLabel || label;

  // Sort by SC count descending
  const sorted = [...payload].sort((a, b) => b.value - a.value);

  return (
    <div className="bg-gray-800 border border-gray-600 rounded px-3 py-2 shadow-lg">
      <div className="text-sm font-medium text-white mb-1">{fullLabel}</div>
      <div className="space-y-0.5">
        {sorted.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-gray-300 capitalize">{entry.dataKey}</span>
            </div>
            <span className="font-mono text-white">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
