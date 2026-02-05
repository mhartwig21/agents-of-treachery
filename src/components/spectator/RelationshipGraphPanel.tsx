/**
 * RelationshipGraphPanel - Visualize power relationships as an interactive graph.
 *
 * Shows all 7 powers as nodes with edges representing their relationships.
 * Edge color indicates alliance status, thickness indicates strength.
 * Trust badges show "say vs do" reliability for each power.
 */

import { useMemo, useState } from 'react';
import { type LowercasePower, POWER_COLORS, UI_POWERS } from '../../spectator/types';
import type { Message } from '../../press/types';
import type { TrustMetrics, PairwiseTrust } from '../../analysis/trust';
import { TrustIndicatorBadgeSVG, TrustBadgeInline } from './TrustIndicatorBadge';

/**
 * Relationship data for a pair of powers.
 */
export interface PowerPairRelationship {
  power1: LowercasePower;
  power2: LowercasePower;
  /** Message count between the powers */
  messageCount: number;
  /** Estimated relationship: 'ally' | 'enemy' | 'neutral' */
  status: 'ally' | 'enemy' | 'neutral';
  /** Strength of relationship (0-1) */
  strength: number;
}

interface RelationshipGraphPanelProps {
  /** All messages to analyze for relationships */
  messages: Message[];
  /** Currently selected power to highlight */
  selectedPower?: LowercasePower;
  /** Callback when a power is clicked */
  onPowerClick?: (power: LowercasePower) => void;
  /** Optional CSS class */
  className?: string;
  /** Trust metrics for each power (from TrustTracker) */
  trustMetrics?: TrustMetrics[];
  /** Pairwise trust data for edge labels */
  pairwiseTrust?: PairwiseTrust[];
  /** Whether to show trust indicators */
  showTrustIndicators?: boolean;
}

/** Power abbreviations for display */
const POWER_ABBREV: Record<LowercasePower, string> = {
  england: 'ENG',
  france: 'FRA',
  germany: 'GER',
  italy: 'ITA',
  austria: 'AUS',
  russia: 'RUS',
  turkey: 'TUR',
};

/** Power full names */
const POWER_NAMES: Record<LowercasePower, string> = {
  england: 'England',
  france: 'France',
  germany: 'Germany',
  italy: 'Italy',
  austria: 'Austria',
  russia: 'Russia',
  turkey: 'Turkey',
};

/**
 * Compute relationships from messages.
 * Analyzes bilateral communication patterns and message intents.
 */
function computeRelationships(messages: Message[]): PowerPairRelationship[] {
  const relationships: PowerPairRelationship[] = [];
  const pairData = new Map<string, { count: number; positive: number; negative: number }>();

  // Initialize all pairs
  for (let i = 0; i < UI_POWERS.length; i++) {
    for (let j = i + 1; j < UI_POWERS.length; j++) {
      const key = `${UI_POWERS[i]}-${UI_POWERS[j]}`;
      pairData.set(key, { count: 0, positive: 0, negative: 0 });
    }
  }

  // Analyze messages
  for (const message of messages) {
    // Extract recipients from channel participants (bilateral channels)
    // Channel ID format is typically "POWER1-POWER2" for bilateral
    const channelParts = message.channelId.split('-');
    if (channelParts.length === 2) {
      const [p1, p2] = channelParts.map(p => p.toLowerCase()) as [LowercasePower, LowercasePower];

      // Normalize the key (alphabetical order)
      const key = p1 < p2 ? `${p1}-${p2}` : `${p2}-${p1}`;
      const data = pairData.get(key);

      if (data) {
        data.count++;

        // Analyze message intent for sentiment
        const intent = message.metadata?.intent;
        if (intent === 'PROPOSAL' || intent === 'ACCEPTANCE' || intent === 'INFORMATION') {
          data.positive++;
        } else if (intent === 'REJECTION' || intent === 'THREAT') {
          data.negative++;
        }
      }
    }
  }

  // Convert to relationships
  for (const [key, data] of pairData) {
    const [p1, p2] = key.split('-') as [LowercasePower, LowercasePower];

    // Determine status based on sentiment ratio
    let status: 'ally' | 'enemy' | 'neutral' = 'neutral';
    if (data.count > 0) {
      const positiveRatio = data.positive / data.count;
      const negativeRatio = data.negative / data.count;

      if (positiveRatio > 0.5 && data.count >= 3) {
        status = 'ally';
      } else if (negativeRatio > 0.3 && data.count >= 2) {
        status = 'enemy';
      }
    }

    // Strength based on message frequency (normalized)
    const maxMessages = Math.max(...Array.from(pairData.values()).map(d => d.count), 1);
    const strength = data.count / maxMessages;

    relationships.push({
      power1: p1,
      power2: p2,
      messageCount: data.count,
      status,
      strength,
    });
  }

  return relationships;
}

/**
 * Calculate node positions in a circle.
 */
function calculateNodePositions(
  centerX: number,
  centerY: number,
  radius: number
): Map<LowercasePower, { x: number; y: number }> {
  const positions = new Map<LowercasePower, { x: number; y: number }>();
  const angleStep = (2 * Math.PI) / UI_POWERS.length;

  // Start from top (-PI/2) and go clockwise
  UI_POWERS.forEach((power, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    positions.set(power, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  return positions;
}

/** Convert Power to LowercasePower */
function toLowerPower(power: string): LowercasePower {
  return power.toLowerCase() as LowercasePower;
}

/** Get trust level from score */
function getTrustLevel(score: number, promiseCount: number): 'high' | 'medium' | 'low' | 'unknown' {
  if (promiseCount === 0) return 'unknown';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function RelationshipGraphPanel({
  messages,
  selectedPower,
  onPowerClick,
  className = '',
  trustMetrics = [],
  pairwiseTrust = [],
  showTrustIndicators = true,
}: RelationshipGraphPanelProps) {
  const [hoveredPower, setHoveredPower] = useState<LowercasePower | null>(null);

  // Compute relationships from messages
  const relationships = useMemo(() => computeRelationships(messages), [messages]);

  // Create trust lookup maps
  const trustByPower = useMemo(() => {
    const map = new Map<LowercasePower, TrustMetrics>();
    for (const metrics of trustMetrics) {
      map.set(toLowerPower(metrics.power), metrics);
    }
    return map;
  }, [trustMetrics]);

  const trustByPair = useMemo(() => {
    const map = new Map<string, PairwiseTrust>();
    for (const trust of pairwiseTrust) {
      const key = [trust.power1, trust.power2].sort().join('-').toLowerCase();
      map.set(key, trust);
    }
    return map;
  }, [pairwiseTrust]);

  // Graph dimensions
  const width = 400;
  const height = 400;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 140;
  const nodeRadius = 28;

  // Calculate node positions
  const nodePositions = useMemo(
    () => calculateNodePositions(centerX, centerY, radius),
    [centerX, centerY, radius]
  );

  // Get edge color based on relationship status
  const getEdgeColor = (status: 'ally' | 'enemy' | 'neutral') => {
    switch (status) {
      case 'ally':
        return '#22c55e'; // green-500
      case 'enemy':
        return '#ef4444'; // red-500
      default:
        return '#6b7280'; // gray-500
    }
  };

  // Get edge width based on strength
  const getEdgeWidth = (strength: number) => {
    return 1 + strength * 4; // 1-5px
  };

  // Check if an edge should be highlighted
  const isEdgeHighlighted = (power1: LowercasePower, power2: LowercasePower) => {
    const activePower = hoveredPower || selectedPower;
    if (!activePower) return true;
    return power1 === activePower || power2 === activePower;
  };

  // Get broken promise count for an edge
  const getBrokenPromiseCount = (power1: LowercasePower, power2: LowercasePower): number => {
    const key = [power1, power2].sort().join('-');
    const trust = trustByPair.get(key);
    return trust?.brokenPromises.length ?? 0;
  };

  // Statistics for the selected/hovered power
  const activePower = hoveredPower || selectedPower;
  const activeStats = useMemo(() => {
    if (!activePower) return null;

    const allies: LowercasePower[] = [];
    const enemies: LowercasePower[] = [];
    let totalMessages = 0;

    for (const rel of relationships) {
      if (rel.power1 === activePower || rel.power2 === activePower) {
        const other = rel.power1 === activePower ? rel.power2 : rel.power1;
        totalMessages += rel.messageCount;
        if (rel.status === 'ally') allies.push(other);
        if (rel.status === 'enemy') enemies.push(other);
      }
    }

    return { allies, enemies, totalMessages };
  }, [activePower, relationships]);

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Graph */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full max-w-[400px] mx-auto"
        >
          {/* Edges */}
          <g className="edges">
            {relationships.map((rel) => {
              const pos1 = nodePositions.get(rel.power1)!;
              const pos2 = nodePositions.get(rel.power2)!;
              const highlighted = isEdgeHighlighted(rel.power1, rel.power2);
              const brokenCount = showTrustIndicators ? getBrokenPromiseCount(rel.power1, rel.power2) : 0;
              const midX = (pos1.x + pos2.x) / 2;
              const midY = (pos1.y + pos2.y) / 2;

              return (
                <g key={`${rel.power1}-${rel.power2}`}>
                  <line
                    x1={pos1.x}
                    y1={pos1.y}
                    x2={pos2.x}
                    y2={pos2.y}
                    stroke={getEdgeColor(rel.status)}
                    strokeWidth={getEdgeWidth(rel.strength)}
                    strokeOpacity={highlighted ? 0.8 : 0.15}
                    className="transition-opacity duration-200"
                  />
                  {/* Broken promise indicator on edge */}
                  {brokenCount > 0 && highlighted && (
                    <g transform={`translate(${midX}, ${midY})`}>
                      <title>{`${brokenCount} broken promise${brokenCount > 1 ? 's' : ''}`}</title>
                      <circle r={8} fill="#ef444440" stroke="#ef4444" strokeWidth="1" />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#ef4444"
                        fontSize="8"
                        fontWeight="bold"
                      >
                        {brokenCount}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {/* Nodes */}
          <g className="nodes">
            {UI_POWERS.map((power) => {
              const pos = nodePositions.get(power)!;
              const isActive = power === activePower;
              const isSelected = power === selectedPower;
              const trust = trustByPower.get(power);
              const trustLevel = trust
                ? getTrustLevel(trust.trustScore, trust.promisesMade)
                : 'unknown';
              const trustTooltip = trust
                ? `${trust.trustScore}% reliable (${trust.promisesKept}/${trust.promisesKept + trust.promisesBroken} kept)`
                : 'No promise data';

              return (
                <g
                  key={power}
                  className="cursor-pointer"
                  onClick={() => onPowerClick?.(power)}
                  onMouseEnter={() => setHoveredPower(power)}
                  onMouseLeave={() => setHoveredPower(null)}
                >
                  {/* Selection ring */}
                  {isSelected && (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={nodeRadius + 4}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2"
                      className="animate-pulse"
                    />
                  )}

                  {/* Node background */}
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={nodeRadius}
                    fill={POWER_COLORS[power]}
                    stroke={isActive ? '#fff' : 'rgba(255,255,255,0.3)'}
                    strokeWidth={isActive ? 3 : 1}
                    className="transition-all duration-200"
                  />

                  {/* Power abbreviation */}
                  <text
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="white"
                    fontSize="12"
                    fontWeight="bold"
                    className="pointer-events-none select-none"
                  >
                    {POWER_ABBREV[power]}
                  </text>

                  {/* Trust indicator badge */}
                  {showTrustIndicators && (
                    <TrustIndicatorBadgeSVG
                      level={trustLevel}
                      x={pos.x + nodeRadius - 4}
                      y={pos.y - nodeRadius + 4}
                      size={8}
                      tooltip={trustTooltip}
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-col items-center gap-2 mt-2">
        {/* Relationship legend */}
        <div className="flex justify-center gap-4 text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <div className="w-4 h-1 bg-green-500 rounded" />
            <span>Allied</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-1 bg-red-500 rounded" />
            <span>Hostile</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-1 bg-gray-500 rounded" />
            <span>Neutral</span>
          </div>
        </div>

        {/* Trust legend */}
        {showTrustIndicators && (
          <div className="flex justify-center gap-3 text-xs text-gray-400">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500 flex items-center justify-center text-green-500 text-[8px] font-bold">{'\u2713'}</span>
              <span>Reliable</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500 flex items-center justify-center text-yellow-500 text-[8px] font-bold">!</span>
              <span>Caution</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500 flex items-center justify-center text-red-500 text-[8px] font-bold">{'\u2717'}</span>
              <span>Unreliable</span>
            </div>
          </div>
        )}
      </div>

      {/* Active power info */}
      {activePower && activeStats && (
        <div className="mt-4 p-3 bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: POWER_COLORS[activePower] }}
            />
            <span className="font-medium text-white">{POWER_NAMES[activePower]}</span>
            {/* Trust badge inline */}
            {showTrustIndicators && (() => {
              const trust = trustByPower.get(activePower);
              if (!trust) return null;
              const level = getTrustLevel(trust.trustScore, trust.promisesMade);
              return <TrustBadgeInline level={level} score={trust.trustScore} showScore />;
            })()}
          </div>
          <div className="text-sm text-gray-400 space-y-1">
            <div>
              Messages: <span className="text-white">{activeStats.totalMessages}</span>
            </div>
            {activeStats.allies.length > 0 && (
              <div>
                Allies:{' '}
                <span className="text-green-400">
                  {activeStats.allies.map((p) => POWER_ABBREV[p]).join(', ')}
                </span>
              </div>
            )}
            {activeStats.enemies.length > 0 && (
              <div>
                Enemies:{' '}
                <span className="text-red-400">
                  {activeStats.enemies.map((p) => POWER_ABBREV[p]).join(', ')}
                </span>
              </div>
            )}
            {/* Trust metrics */}
            {showTrustIndicators && (() => {
              const trust = trustByPower.get(activePower);
              if (!trust || trust.promisesMade === 0) return null;
              return (
                <div className="mt-2 pt-2 border-t border-gray-700">
                  <div className="text-xs text-gray-500 mb-1">Promise Reliability</div>
                  <div>
                    Promises made: <span className="text-white">{trust.promisesMade}</span>
                  </div>
                  <div>
                    Kept:{' '}
                    <span className="text-green-400">{trust.promisesKept}</span>
                    {trust.promisesBroken > 0 && (
                      <span className="text-red-400 ml-2">
                        Broken: {trust.promisesBroken}
                      </span>
                    )}
                  </div>
                  {trust.trend !== 'stable' && (
                    <div className="text-xs mt-1">
                      Trend:{' '}
                      <span className={trust.trend === 'improving' ? 'text-green-400' : 'text-red-400'}>
                        {trust.trend === 'improving' ? '\u2191 Improving' : '\u2193 Declining'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* No data message */}
      {messages.length === 0 && (
        <div className="text-center text-gray-500 py-8">
          No diplomatic messages yet.
          <br />
          <span className="text-sm">Relationships will appear as powers communicate.</span>
        </div>
      )}
    </div>
  );
}
