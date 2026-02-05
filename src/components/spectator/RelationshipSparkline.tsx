/**
 * RelationshipSparkline - Mini chart showing relationship score over time.
 *
 * Renders a compact sparkline visualization of relationship history.
 * Used in edge tooltips and relationship summaries.
 */

import type { TimelinePoint, KeyEvent } from '../../hooks/useRelationshipHistory';

interface SparklineProps {
  /** Timeline data points to visualize */
  timeline: TimelinePoint[];
  /** Width of the sparkline in pixels */
  width?: number;
  /** Height of the sparkline in pixels */
  height?: number;
  /** Whether to show key event markers */
  showEvents?: boolean;
  /** Optional CSS class */
  className?: string;
}

/**
 * Get color for a key event marker.
 */
function getEventColor(event: KeyEvent): string {
  switch (event) {
    case 'betrayal':
      return '#ef4444'; // red-500
    case 'alliance':
      return '#22c55e'; // green-500
    case 'war':
      return '#f97316'; // orange-500
    case 'peace':
      return '#3b82f6'; // blue-500
    default:
      return '#6b7280'; // gray-500
  }
}

/**
 * Get color for a score value.
 */
function getScoreColor(score: number): string {
  if (score >= 10) return '#22c55e'; // green-500 (ally)
  if (score <= -10) return '#ef4444'; // red-500 (enemy)
  return '#6b7280'; // gray-500 (neutral)
}

/**
 * Sparkline component for relationship history visualization.
 */
export function RelationshipSparkline({
  timeline,
  width = 120,
  height = 40,
  showEvents = true,
  className = '',
}: SparklineProps) {
  if (timeline.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-gray-500 text-xs ${className}`}
        style={{ width, height }}
      >
        No history
      </div>
    );
  }

  const padding = 4;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Calculate x positions
  const xStep = chartWidth / Math.max(timeline.length - 1, 1);

  // Map score (-100 to +100) to y position
  const scoreToY = (score: number): number => {
    // Invert because SVG y increases downward
    const normalized = (score + 100) / 200; // 0 to 1
    return padding + chartHeight * (1 - normalized);
  };

  // Build the path
  const pathPoints = timeline.map((point, index) => {
    const x = padding + index * xStep;
    const y = scoreToY(point.score);
    return { x, y, point };
  });

  // Create the line path
  const linePath = pathPoints
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(' ');

  // Create gradient fill path (fill to baseline)
  const baselineY = scoreToY(0);
  const fillPath = `${linePath} L ${pathPoints[pathPoints.length - 1].x} ${baselineY} L ${pathPoints[0].x} ${baselineY} Z`;

  // Get current score color
  const currentScore = timeline[timeline.length - 1]?.score ?? 0;
  const lineColor = getScoreColor(currentScore);

  // Find key events
  const eventMarkers = showEvents
    ? pathPoints.filter((p) => p.point.keyEvent)
    : [];

  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox={`0 0 ${width} ${height}`}
    >
      {/* Zero line (baseline) */}
      <line
        x1={padding}
        y1={baselineY}
        x2={width - padding}
        y2={baselineY}
        stroke="#374151"
        strokeWidth="1"
        strokeDasharray="2,2"
      />

      {/* Gradient fill under the line */}
      <defs>
        <linearGradient id="sparkline-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <path
        d={fillPath}
        fill="url(#sparkline-gradient)"
      />

      {/* Main line */}
      <path
        d={linePath}
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Event markers */}
      {eventMarkers.map((marker, index) => (
        <circle
          key={`event-${index}`}
          cx={marker.x}
          cy={marker.y}
          r="4"
          fill={getEventColor(marker.point.keyEvent!)}
          stroke="white"
          strokeWidth="1"
        />
      ))}

      {/* Current value dot */}
      {pathPoints.length > 0 && (
        <circle
          cx={pathPoints[pathPoints.length - 1].x}
          cy={pathPoints[pathPoints.length - 1].y}
          r="3"
          fill="white"
          stroke={lineColor}
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

/**
 * Tooltip wrapper for sparkline with additional context.
 */
interface SparklineTooltipProps {
  /** Timeline data */
  timeline: TimelinePoint[];
  /** First power name */
  power1: string;
  /** Second power name */
  power2: string;
  /** Current relationship status */
  status: 'ally' | 'enemy' | 'neutral';
  /** Current score */
  score: number;
  /** Optional CSS class */
  className?: string;
}

/**
 * Status to display text.
 */
function statusToText(status: 'ally' | 'enemy' | 'neutral'): string {
  switch (status) {
    case 'ally':
      return 'Allied';
    case 'enemy':
      return 'Hostile';
    default:
      return 'Neutral';
  }
}

/**
 * Sparkline with tooltip context.
 */
export function SparklineTooltip({
  timeline,
  power1,
  power2,
  status,
  score,
  className = '',
}: SparklineTooltipProps) {
  const statusColor = status === 'ally' ? 'text-green-400' : status === 'enemy' ? 'text-red-400' : 'text-gray-400';

  return (
    <div className={`bg-gray-900 rounded-lg p-3 shadow-xl border border-gray-700 ${className}`}>
      <div className="text-sm font-medium text-white mb-2">
        {power1} &harr; {power2}
      </div>

      <RelationshipSparkline timeline={timeline} width={140} height={50} />

      <div className="flex justify-between items-center mt-2 text-xs">
        <span className={statusColor}>{statusToText(status)}</span>
        <span className="text-gray-400">
          Score: <span className={statusColor}>{score > 0 ? '+' : ''}{score}</span>
        </span>
      </div>

      {timeline.length > 0 && (
        <div className="text-xs text-gray-500 mt-1">
          {timeline.length} turns tracked
        </div>
      )}
    </div>
  );
}
