/**
 * BetrayalHighlight - Visual components for betrayal visualization.
 *
 * Provides animated edges, badges, and markers for betrayal relationships
 * in the relationship graph and map components.
 */

import { useState } from 'react';
import type { BetrayalInfo, BetrayalType } from '../../analysis/relationships';
import type { LowercasePower } from '../../spectator/types';
import { POWER_COLORS } from '../../spectator/types';

/** Power display names */
const POWER_NAMES: Record<LowercasePower, string> = {
  england: 'England',
  france: 'France',
  germany: 'Germany',
  italy: 'Italy',
  austria: 'Austria',
  russia: 'Russia',
  turkey: 'Turkey',
};

/** Betrayal type descriptions */
const BETRAYAL_DESCRIPTIONS: Record<BetrayalType, string> = {
  CLASSIC_STAB: 'Supported last turn, attacked this turn',
  BROKEN_PROMISE: 'Broke diplomatic agreement',
  COORDINATED_STAB: 'Coordinated attack with other powers',
  CONVOY_BETRAYAL: 'Failed to provide promised convoy',
};

/** Betrayal type icons */
const BETRAYAL_ICONS: Record<BetrayalType, string> = {
  CLASSIC_STAB: '🗡️',
  BROKEN_PROMISE: '💔',
  COORDINATED_STAB: '⚔️',
  CONVOY_BETRAYAL: '🚢',
};

interface BetrayalEdgeProps {
  /** Start position */
  x1: number;
  y1: number;
  /** End position */
  x2: number;
  y2: number;
  /** Betrayal info */
  betrayal: BetrayalInfo;
  /** Whether this edge is highlighted/selected */
  highlighted?: boolean;
  /** Click handler */
  onClick?: () => void;
}

/**
 * Animated edge representing a betrayal relationship.
 * Features a red dashed line with flowing animation and dagger icon.
 */
export function BetrayalEdge({
  x1, y1, x2, y2,
  betrayal,
  highlighted = true,
  onClick,
}: BetrayalEdgeProps) {
  // Calculate midpoint for icon placement
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  // Animation ID for unique filter reference
  const animId = `betrayal-${betrayal.id}`;

  return (
    <g
      className="betrayal-edge cursor-pointer"
      onClick={onClick}
      style={{ opacity: highlighted ? 1 : 0.3 }}
    >
      {/* Glow filter */}
      <defs>
        <filter id={`${animId}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Base line with glow */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="#dc2626"
        strokeWidth="3"
        strokeDasharray="8,4"
        strokeLinecap="round"
        filter={`url(#${animId}-glow)`}
        style={{
          animation: 'betrayal-flow 1s linear infinite',
        }}
      />

      {/* Animated pulsing overlay */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="#f87171"
        strokeWidth="5"
        strokeOpacity="0.3"
        strokeDasharray="8,4"
        strokeLinecap="round"
        style={{
          animation: 'betrayal-pulse 1.5s ease-in-out infinite',
        }}
      />

      {/* Icon at midpoint */}
      <g transform={`translate(${midX - 10}, ${midY - 10})`}>
        <circle
          cx="10"
          cy="10"
          r="12"
          fill="#1f2937"
          stroke="#dc2626"
          strokeWidth="2"
        />
        <text
          x="10"
          y="10"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="12"
          className="select-none pointer-events-none"
        >
          {BETRAYAL_ICONS[betrayal.type]}
        </text>
      </g>
    </g>
  );
}

interface BetrayerBadgeProps {
  /** Position */
  x: number;
  y: number;
  /** Number of betrayals committed */
  count: number;
  /** Offset from node center */
  offset?: number;
}

/**
 * Badge indicating a power has committed betrayals.
 */
export function BetrayerBadge({ x, y, count, offset = 20 }: BetrayerBadgeProps) {
  return (
    <g transform={`translate(${x + offset}, ${y - offset})`}>
      <circle
        cx="0"
        cy="0"
        r="10"
        fill="#dc2626"
        stroke="#fff"
        strokeWidth="1.5"
        style={{ animation: 'badge-pulse 2s ease-in-out infinite' }}
      />
      <text
        x="0"
        y="0"
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize="10"
        fontWeight="bold"
        className="select-none pointer-events-none"
      >
        🗡️
      </text>
      {count > 1 && (
        <g transform="translate(8, 8)">
          <circle cx="0" cy="0" r="6" fill="#fff" stroke="#dc2626" strokeWidth="1" />
          <text
            x="0"
            y="0"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#dc2626"
            fontSize="8"
            fontWeight="bold"
          >
            {count}
          </text>
        </g>
      )}
    </g>
  );
}

interface VictimBadgeProps {
  /** Position */
  x: number;
  y: number;
  /** Number of times betrayed */
  count: number;
  /** Offset from node center */
  offset?: number;
}

/**
 * Badge indicating a power has been betrayed.
 */
export function VictimBadge({ x, y, count, offset = 20 }: VictimBadgeProps) {
  return (
    <g transform={`translate(${x - offset}, ${y - offset})`}>
      <circle
        cx="0"
        cy="0"
        r="10"
        fill="#7c3aed"
        stroke="#fff"
        strokeWidth="1.5"
      />
      <text
        x="0"
        y="0"
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize="10"
        fontWeight="bold"
        className="select-none pointer-events-none"
      >
        💀
      </text>
      {count > 1 && (
        <g transform="translate(-8, 8)">
          <circle cx="0" cy="0" r="6" fill="#fff" stroke="#7c3aed" strokeWidth="1" />
          <text
            x="0"
            y="0"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#7c3aed"
            fontSize="8"
            fontWeight="bold"
          >
            {count}
          </text>
        </g>
      )}
    </g>
  );
}

interface BetrayalDetailsModalProps {
  /** Betrayal info to display */
  betrayal: BetrayalInfo;
  /** Whether modal is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
}

/**
 * Modal showing detailed information about a betrayal.
 */
export function BetrayalDetailsModal({
  betrayal,
  isOpen,
  onClose,
}: BetrayalDetailsModalProps) {
  if (!isOpen) return null;

  const betrayerName = POWER_NAMES[betrayal.betrayer.toLowerCase() as LowercasePower];
  const victimName = POWER_NAMES[betrayal.victim.toLowerCase() as LowercasePower];
  const betrayerColor = POWER_COLORS[betrayal.betrayer.toLowerCase() as LowercasePower];
  const victimColor = POWER_COLORS[betrayal.victim.toLowerCase() as LowercasePower];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border-2 border-red-500 rounded-lg shadow-2xl max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{
          animation: 'modal-appear 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div className="bg-red-900/50 px-6 py-4 border-b border-red-700">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{BETRAYAL_ICONS[betrayal.type]}</span>
            <div>
              <h2 className="text-xl font-bold text-red-300">
                BETRAYAL DETECTED!
              </h2>
              <p className="text-sm text-red-400">
                {betrayal.turn.season} {betrayal.turn.year}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Powers involved */}
          <div className="flex items-center justify-center gap-4">
            <div className="text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold border-2 border-red-500"
                style={{ backgroundColor: betrayerColor }}
              >
                🗡️
              </div>
              <p className="mt-1 text-sm text-gray-300">{betrayerName}</p>
              <p className="text-xs text-red-400">Betrayer</p>
            </div>
            <div className="text-2xl text-red-500">→</div>
            <div className="text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold border-2 border-purple-500"
                style={{ backgroundColor: victimColor }}
              >
                💀
              </div>
              <p className="mt-1 text-sm text-gray-300">{victimName}</p>
              <p className="text-xs text-purple-400">Victim</p>
            </div>
          </div>

          {/* Type description */}
          <div className="bg-gray-800 rounded-lg px-4 py-3">
            <p className="text-sm font-medium text-gray-400">Type</p>
            <p className="text-white">{BETRAYAL_DESCRIPTIONS[betrayal.type]}</p>
          </div>

          {/* Evidence */}
          <div className="bg-gray-800 rounded-lg px-4 py-3">
            <p className="text-sm font-medium text-gray-400 mb-2">Evidence</p>
            <ul className="space-y-2">
              {betrayal.evidence.map((ev, i) => (
                <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                  <span className="text-gray-500">•</span>
                  <span>{ev.description}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Coordinated participants */}
          {betrayal.participants && betrayal.participants.length > 1 && (
            <div className="bg-gray-800 rounded-lg px-4 py-3">
              <p className="text-sm font-medium text-gray-400 mb-2">Coordinating Powers</p>
              <div className="flex gap-2">
                {betrayal.participants.map((p) => (
                  <div
                    key={p}
                    className="px-2 py-1 rounded text-xs text-white"
                    style={{ backgroundColor: POWER_COLORS[p.toLowerCase() as LowercasePower] }}
                  >
                    {POWER_NAMES[p.toLowerCase() as LowercasePower]}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Severity */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Severity:</span>
            <div className="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-yellow-500 via-orange-500 to-red-500"
                style={{ width: `${Math.min(100, betrayal.severity * 8)}%` }}
              />
            </div>
            <span className="text-sm text-red-400 font-medium">{betrayal.severity}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-800/50 border-t border-gray-700">
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface BetrayalFlashProps {
  /** Betrayal that just occurred */
  betrayal: BetrayalInfo;
  /** Duration of flash in ms */
  duration?: number;
  /** Callback when flash completes */
  onComplete?: () => void;
}

/**
 * Full-screen flash effect when a betrayal is detected.
 */
export function BetrayalFlash({
  betrayal: _betrayal,
  duration = 500,
  onComplete,
}: BetrayalFlashProps) {
  // Note: _betrayal is available for future use (e.g., customizing flash color by betrayal type)
  const [visible, setVisible] = useState(true);

  // Auto-hide after duration
  setTimeout(() => {
    setVisible(false);
    onComplete?.();
  }, duration);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-40"
      style={{
        background: 'radial-gradient(circle, rgba(220,38,38,0.3) 0%, transparent 70%)',
        animation: 'flash-fade 0.5s ease-out forwards',
      }}
    />
  );
}

// Inject CSS animations
const styleId = 'betrayal-highlight-styles';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes betrayal-flow {
      from { stroke-dashoffset: 0; }
      to { stroke-dashoffset: -24; }
    }

    @keyframes betrayal-pulse {
      0%, 100% { stroke-opacity: 0.3; stroke-width: 5; }
      50% { stroke-opacity: 0.6; stroke-width: 8; }
    }

    @keyframes badge-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }

    @keyframes flash-fade {
      from { opacity: 1; }
      to { opacity: 0; }
    }

    @keyframes modal-appear {
      from {
        opacity: 0;
        transform: scale(0.9) translateY(-20px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
  `;
  document.head.appendChild(style);
}
