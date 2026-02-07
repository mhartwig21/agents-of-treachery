/**
 * RelationshipGraphPanel - Visualize power relationships as an interactive graph.
 *
 * Shows all 7 powers as nodes with edges representing their relationships.
 * Edge color indicates alliance status, thickness indicates strength.
 * Betrayals are highlighted with animated red dashed lines and badges.
 * Hovering edges shows sparkline history, clicking opens detailed history modal.
 */

import { useMemo, useState, useCallback, useRef } from 'react';
import { type LowercasePower, POWER_COLORS, UI_POWERS } from '../../spectator/types';
import type { Message } from '../../press/types';
import type { BetrayalInfo, PowerPairRelationship as EnginePairRelationship } from '../../analysis/relationships';
import {
  BetrayalEdge,
  BetrayerBadge,
  VictimBadge,
  BetrayalDetailsModal,
} from './BetrayalHighlight';
import { SparklineTooltip } from './RelationshipSparkline';
import { RelationshipHistoryModal } from './RelationshipHistoryModal';
import {
  useRelationshipHistory,
  type RelationshipHistory,
} from '../../hooks/useRelationshipHistory';

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
  /** Whether a betrayal has been detected */
  betrayalDetected?: boolean;
  /** Most recent betrayal info (if any) */
  betrayal?: BetrayalInfo;
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
  /** Betrayal data from the relationship engine */
  betrayals?: BetrayalInfo[];
  /** Whether to show betrayal visualization */
  showBetrayals?: boolean;
  /** Engine relationship data with action events for history */
  engineRelationships?: EnginePairRelationship[];
  /** Current game year for timeline */
  currentYear?: number;
  /** Current game season for timeline */
  currentSeason?: 'SPRING' | 'FALL';
  /** Whether to show relationship history on hover/click */
  showHistory?: boolean;
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

/** Edge identifier type */
type EdgeKey = `${LowercasePower}-${LowercasePower}`;

export function RelationshipGraphPanel({
  messages,
  selectedPower,
  onPowerClick,
  className = '',
  betrayals = [],
  showBetrayals = true,
  engineRelationships = [],
  currentYear = 1901,
  currentSeason = 'SPRING',
  showHistory = true,
}: RelationshipGraphPanelProps) {
  const [hoveredPower, setHoveredPower] = useState<LowercasePower | null>(null);
  const [selectedBetrayal, setSelectedBetrayal] = useState<BetrayalInfo | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<EdgeKey | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<EdgeKey | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build relationship history from engine data
  const relationshipHistory = useRelationshipHistory({
    relationships: engineRelationships.map(r => ({
      ...r,
      power1: r.power1.toLowerCase() as LowercasePower,
      power2: r.power2.toLowerCase() as LowercasePower,
    })) as unknown as EnginePairRelationship[],
    currentYear,
    currentSeason,
  });

  // Compute relationships from messages
  const relationships = useMemo(() => computeRelationships(messages), [messages]);

  // Compute betrayal counts per power
  const betrayalCounts = useMemo(() => {
    const asBetrayer: Record<LowercasePower, number> = {
      england: 0, france: 0, germany: 0, italy: 0, austria: 0, russia: 0, turkey: 0,
    };
    const asVictim: Record<LowercasePower, number> = {
      england: 0, france: 0, germany: 0, italy: 0, austria: 0, russia: 0, turkey: 0,
    };

    for (const b of betrayals) {
      const betrayerKey = b.betrayer.toLowerCase() as LowercasePower;
      const victimKey = b.victim.toLowerCase() as LowercasePower;
      asBetrayer[betrayerKey] = (asBetrayer[betrayerKey] || 0) + 1;
      asVictim[victimKey] = (asVictim[victimKey] || 0) + 1;
    }

    return { asBetrayer, asVictim };
  }, [betrayals]);

  // Map betrayals to power pairs
  const betrayalsByPair = useMemo(() => {
    const map = new Map<string, BetrayalInfo>();
    for (const b of betrayals) {
      const p1 = b.betrayer.toLowerCase() as LowercasePower;
      const p2 = b.victim.toLowerCase() as LowercasePower;
      const key = p1 < p2 ? `${p1}-${p2}` : `${p2}-${p1}`;
      // Keep the most recent betrayal for each pair
      if (!map.has(key)) {
        map.set(key, b);
      }
    }
    return map;
  }, [betrayals]);

  const handleBetrayalClick = useCallback((betrayal: BetrayalInfo) => {
    setSelectedBetrayal(betrayal);
  }, []);

  // Handle edge hover with tooltip positioning (debounced to prevent rapid flicker)
  const handleEdgeMouseEnter = useCallback(
    (edge: EdgeKey, event: React.MouseEvent) => {
      if (!showHistory) return;

      // Clear any pending hover timer
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }

      // Capture position synchronously from the event
      const clientX = event.clientX;
      const clientY = event.clientY;

      hoverTimerRef.current = setTimeout(() => {
        setHoveredEdge(edge);

        // Calculate tooltip position relative to the container div (positioning context)
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const x = clientX - containerRect.left;
          const y = clientY - containerRect.top;
          setTooltipPosition({ x, y });
        }
      }, 50);
    },
    [showHistory]
  );

  const handleEdgeMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoveredEdge(null);
    setTooltipPosition(null);
  }, []);

  const handleEdgeClick = useCallback(
    (edge: EdgeKey) => {
      if (!showHistory) return;
      setSelectedEdge(edge);
    },
    [showHistory]
  );

  // Get history for a specific edge
  const getEdgeHistory = useCallback(
    (p1: LowercasePower, p2: LowercasePower): RelationshipHistory | undefined => {
      const key = p1 < p2 ? `${p1.toUpperCase()}-${p2.toUpperCase()}` : `${p2.toUpperCase()}-${p1.toUpperCase()}`;
      return relationshipHistory.get(key);
    },
    [relationshipHistory]
  );

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
      <div ref={containerRef} className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full max-w-[400px] mx-auto"
        >
          {/* Regular Edges (non-betrayal) */}
          <g className="edges">
            {relationships.map((rel) => {
              const pos1 = nodePositions.get(rel.power1)!;
              const pos2 = nodePositions.get(rel.power2)!;
              const highlighted = isEdgeHighlighted(rel.power1, rel.power2);
              const pairKey = (rel.power1 < rel.power2
                ? `${rel.power1}-${rel.power2}`
                : `${rel.power2}-${rel.power1}`) as EdgeKey;
              const hasBetrayal = showBetrayals && betrayalsByPair.has(pairKey);
              const isHovered = hoveredEdge === pairKey;

              // Skip if this pair has a betrayal (rendered separately)
              if (hasBetrayal) return null;

              return (
                <g key={`${rel.power1}-${rel.power2}`}>
                  {/* Invisible wider line for easier hover/click */}
                  <line
                    x1={pos1.x}
                    y1={pos1.y}
                    x2={pos2.x}
                    y2={pos2.y}
                    stroke="transparent"
                    strokeWidth={Math.max(getEdgeWidth(rel.strength) + 8, 12)}
                    className="cursor-pointer"
                    onMouseEnter={(e) => handleEdgeMouseEnter(pairKey, e)}
                    onMouseLeave={handleEdgeMouseLeave}
                    onClick={() => handleEdgeClick(pairKey)}
                  />
                  {/* Visible edge line */}
                  <line
                    x1={pos1.x}
                    y1={pos1.y}
                    x2={pos2.x}
                    y2={pos2.y}
                    stroke={getEdgeColor(rel.status)}
                    strokeWidth={isHovered ? getEdgeWidth(rel.strength) + 2 : getEdgeWidth(rel.strength)}
                    strokeOpacity={highlighted ? (isHovered ? 0.9 : 0.7) : 0.35}
                    className="transition-opacity duration-300 pointer-events-none"
                  />
                </g>
              );
            })}
          </g>

          {/* Betrayal Edges */}
          {showBetrayals && (
            <g className="betrayal-edges">
              {Array.from(betrayalsByPair.entries()).map(([key, betrayal]) => {
                const [p1, p2] = key.split('-') as [LowercasePower, LowercasePower];
                const pos1 = nodePositions.get(p1)!;
                const pos2 = nodePositions.get(p2)!;
                const highlighted = isEdgeHighlighted(p1, p2);

                return (
                  <BetrayalEdge
                    key={key}
                    x1={pos1.x}
                    y1={pos1.y}
                    x2={pos2.x}
                    y2={pos2.y}
                    betrayal={betrayal}
                    highlighted={highlighted}
                    onClick={() => handleBetrayalClick(betrayal)}
                  />
                );
              })}
            </g>
          )}

          {/* Nodes */}
          <g className="nodes">
            {UI_POWERS.map((power) => {
              const pos = nodePositions.get(power)!;
              const isActive = power === activePower;
              const isSelected = power === selectedPower;
              const betrayerCount = betrayalCounts.asBetrayer[power] || 0;
              const victimCount = betrayalCounts.asVictim[power] || 0;

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

                  {/* Betrayer badge */}
                  {showBetrayals && betrayerCount > 0 && (
                    <BetrayerBadge
                      x={pos.x}
                      y={pos.y}
                      count={betrayerCount}
                      offset={nodeRadius - 5}
                    />
                  )}

                  {/* Victim badge */}
                  {showBetrayals && victimCount > 0 && (
                    <VictimBadge
                      x={pos.x}
                      y={pos.y}
                      count={victimCount}
                      offset={nodeRadius - 5}
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4 mt-2 text-xs text-gray-400">
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
        {showBetrayals && betrayals.length > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-4 h-1 bg-red-600 rounded border border-red-400 border-dashed" />
            <span className="text-red-400">Betrayal</span>
          </div>
        )}
      </div>

      {/* Betrayal Details Modal */}
      {selectedBetrayal && (
        <BetrayalDetailsModal
          betrayal={selectedBetrayal}
          isOpen={true}
          onClose={() => setSelectedBetrayal(null)}
        />
      )}

      {/* Active power info */}
      {activePower && activeStats && (
        <div className="mt-4 p-3 bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: POWER_COLORS[activePower] }}
            />
            <span className="font-medium text-white">{POWER_NAMES[activePower]}</span>
            {/* Betrayal badges */}
            {showBetrayals && betrayalCounts.asBetrayer[activePower] > 0 && (
              <span className="text-xs px-2 py-0.5 bg-red-900 text-red-300 rounded-full">
                🗡️ {betrayalCounts.asBetrayer[activePower]} betrayed
              </span>
            )}
            {showBetrayals && betrayalCounts.asVictim[activePower] > 0 && (
              <span className="text-xs px-2 py-0.5 bg-purple-900 text-purple-300 rounded-full">
                💀 {betrayalCounts.asVictim[activePower]} stabbed
              </span>
            )}
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

      {/* Edge hover tooltip with sparkline */}
      {showHistory && hoveredEdge && tooltipPosition && (() => {
        const [p1, p2] = hoveredEdge.split('-') as [LowercasePower, LowercasePower];
        const history = getEdgeHistory(p1, p2);
        const rel = relationships.find(
          r => (r.power1 === p1 && r.power2 === p2) || (r.power1 === p2 && r.power2 === p1)
        );

        if (!rel) return null;

        return (
          <div
            className="absolute z-10 pointer-events-none"
            style={{
              left: tooltipPosition.x,
              top: tooltipPosition.y - 10,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <SparklineTooltip
              timeline={history?.timeline || []}
              power1={POWER_NAMES[p1]}
              power2={POWER_NAMES[p2]}
              status={rel.status}
              score={history?.currentScore || 0}
            />
          </div>
        );
      })()}

      {/* Relationship History Modal */}
      {showHistory && selectedEdge && (() => {
        const [p1, p2] = selectedEdge.split('-') as [LowercasePower, LowercasePower];
        const history = getEdgeHistory(p1, p2);

        if (!history) return null;

        return (
          <RelationshipHistoryModal
            history={history}
            isOpen={true}
            onClose={() => setSelectedEdge(null)}
            powerColors={POWER_COLORS}
          />
        );
      })()}
    </div>
  );
}
