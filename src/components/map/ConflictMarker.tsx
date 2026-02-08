/**
 * ConflictMarker - Visual indicator for contested territories.
 *
 * Displays a pulsing overlay on territories with conflicts, showing:
 * - Red pulsing circle indicating active conflict
 * - Strength badges for each contender arranged around the center
 * - Winner/loser highlighting after resolution
 */

import { useMemo } from 'react';
import { type LowercasePower, POWER_COLORS } from '../../spectator/types';

export interface Contender {
  power: LowercasePower;
  strength: number;
  isWinner?: boolean;
}

export interface ConflictMarkerProps {
  x: number;
  y: number;
  contenders: Contender[];
  resolved: boolean;
  /** Scale factor based on zoom level (1 = default, <1 = zoomed out) */
  scale?: number;
}

/**
 * Animated conflict marker with strength badges for contested territories.
 */
export function ConflictMarker({ x, y, contenders, resolved, scale = 1 }: ConflictMarkerProps) {
  // Calculate badge positions arranged in an arc around the center
  // Scale dimensions based on zoom level to prevent markers being too large when zoomed out
  const badgePositions = useMemo(() => {
    const radius = 35 * scale;
    const count = contenders.length;

    // Distribute badges evenly in an arc (top half of circle)
    const startAngle = -Math.PI + Math.PI / (count + 1);
    const angleStep = Math.PI / (count + 1);

    return contenders.map((contender, i) => {
      const angle = startAngle + angleStep * (i + 1);
      return {
        ...contender,
        cx: x + Math.cos(angle) * radius,
        cy: y + Math.sin(angle) * radius,
      };
    });
  }, [x, y, contenders, scale]);

  return (
    <g className="conflict-marker-group" role="graphics-symbol" aria-label={`Conflict: ${contenders.map(c => c.power).join(' vs ')}${resolved ? ' (resolved)' : ''}`}>
      {/* Glow filter definitions */}
      <defs>
        <filter id="conflict-winner-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor="#fbbf24" floodOpacity="0.8" result="gold" />
          <feComposite in="gold" in2="blur" operator="in" result="goldBlur" />
          <feMerge>
            <feMergeNode in="goldBlur" />
            <feMergeNode in="goldBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Pulsing red overlay circle - only shown during active conflict */}
      {!resolved && (
        <circle
          cx={x}
          cy={y}
          r={30 * scale}
          fill="rgba(220, 38, 38, 0.3)"
          stroke="rgba(220, 38, 38, 0.6)"
          strokeWidth={2}
          style={{ animation: 'battle-pulse 1.5s ease-in-out infinite' }}
        />
      )}

      {/* Strength badges for each contender */}
      {badgePositions.map(({ power, strength, isWinner, cx, cy }, index) => {
        const color = POWER_COLORS[power];
        const isLoser = resolved && !isWinner;

        return (
          <g
            key={`${power}-${index}`}
            opacity={isLoser ? 0.4 : 1}
            filter={isWinner ? 'url(#conflict-winner-glow)' : undefined}
          >
            {/* Badge circle background */}
            <circle
              cx={cx}
              cy={cy}
              r={14 * scale}
              fill={color}
              stroke={isWinner ? '#fbbf24' : 'white'}
              strokeWidth={(isWinner ? 2.5 : 1.5) * scale}
            />
            {/* Strength number */}
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fill="white"
              fontSize={12 * scale}
              fontWeight="bold"
              style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
            >
              {strength}
            </text>
          </g>
        );
      })}
    </g>
  );
}
