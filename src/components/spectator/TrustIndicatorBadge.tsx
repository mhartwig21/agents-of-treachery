/**
 * TrustIndicatorBadge - Shows a visual trust indicator for a power.
 *
 * Displays a badge showing whether a power is trustworthy based on
 * their history of keeping diplomatic promises.
 */

import { useMemo } from 'react';

type TrustLevel = 'high' | 'medium' | 'low' | 'unknown';

interface TrustIndicatorBadgeProps {
  /** Trust level to display */
  level: TrustLevel;
  /** Trust score (0-100) for detailed display */
  score?: number;
  /** Number of promises kept */
  kept?: number;
  /** Number of promises made */
  total?: number;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show detailed info on hover */
  showDetails?: boolean;
  /** Custom className */
  className?: string;
}

/**
 * Returns the display properties for each trust level.
 */
function getTrustDisplay(level: TrustLevel): {
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
} {
  switch (level) {
    case 'high':
      return {
        icon: '\u2713', // checkmark
        color: '#22c55e',
        bgColor: '#22c55e20',
        borderColor: '#22c55e',
        label: 'Trustworthy',
      };
    case 'medium':
      return {
        icon: '!',
        color: '#eab308',
        bgColor: '#eab30820',
        borderColor: '#eab308',
        label: 'Caution',
      };
    case 'low':
      return {
        icon: '\u2717', // X mark
        color: '#ef4444',
        bgColor: '#ef444420',
        borderColor: '#ef4444',
        label: 'Unreliable',
      };
    case 'unknown':
    default:
      return {
        icon: '?',
        color: '#6b7280',
        bgColor: '#6b728020',
        borderColor: '#6b7280',
        label: 'Unknown',
      };
  }
}

/**
 * Size configurations.
 */
const SIZES = {
  sm: { width: 16, height: 16, fontSize: 10 },
  md: { width: 20, height: 20, fontSize: 12 },
  lg: { width: 24, height: 24, fontSize: 14 },
};

export function TrustIndicatorBadge({
  level,
  score,
  kept,
  total,
  size = 'md',
  showDetails = true,
  className = '',
}: TrustIndicatorBadgeProps) {
  const display = useMemo(() => getTrustDisplay(level), [level]);
  const dimensions = SIZES[size];

  const tooltip = useMemo(() => {
    if (level === 'unknown') {
      return 'No promise data yet';
    }
    if (score !== undefined && kept !== undefined && total !== undefined) {
      return `${score}% reliable (${kept}/${total} promises kept)`;
    }
    return display.label;
  }, [level, score, kept, total, display.label]);

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full ${className}`}
      style={{
        width: dimensions.width,
        height: dimensions.height,
        backgroundColor: display.bgColor,
        border: `1.5px solid ${display.borderColor}`,
        color: display.color,
        fontSize: dimensions.fontSize,
        fontWeight: 'bold',
      }}
      title={showDetails ? tooltip : undefined}
    >
      {display.icon}
    </div>
  );
}

/**
 * SVG version for use within SVG elements (like the relationship graph).
 */
export function TrustIndicatorBadgeSVG({
  level,
  x,
  y,
  size = 10,
  tooltip,
}: {
  level: TrustLevel;
  x: number;
  y: number;
  size?: number;
  tooltip?: string;
}) {
  const display = getTrustDisplay(level);

  return (
    <g className="trust-indicator" transform={`translate(${x}, ${y})`}>
      <title>{tooltip || display.label}</title>
      <circle
        r={size}
        fill={display.bgColor}
        stroke={display.borderColor}
        strokeWidth="1.5"
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill={display.color}
        fontSize={size * 1.2}
        fontWeight="bold"
      >
        {display.icon}
      </text>
    </g>
  );
}

/**
 * Compact inline badge for use in text or lists.
 */
export function TrustBadgeInline({
  level,
  score,
  showScore = false,
}: {
  level: TrustLevel;
  score?: number;
  showScore?: boolean;
}) {
  const display = getTrustDisplay(level);

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
      style={{
        backgroundColor: display.bgColor,
        color: display.color,
        border: `1px solid ${display.borderColor}`,
      }}
    >
      <span>{display.icon}</span>
      {showScore && score !== undefined && (
        <span>{score}%</span>
      )}
    </span>
  );
}
