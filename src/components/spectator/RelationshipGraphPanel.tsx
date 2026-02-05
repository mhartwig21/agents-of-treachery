/**
 * RelationshipGraphPanel - Visualize power relationships as an interactive graph.
 *
 * Shows all 7 powers as nodes with edges representing their relationships.
 * Edge color indicates alliance status, thickness indicates strength.
 * Supports three analysis modes: messages-only, actions-only, and combined.
 */

import { useMemo, useState, useCallback } from 'react';
import { type LowercasePower, POWER_COLORS, UI_POWERS, toEnginePower, toUIPower } from '../../spectator/types';
import type { Message } from '../../press/types';
import type { GameEvent, MovementResolvedEvent, SupplyCentersCapturedEvent } from '../../store/events';
import type { GameState } from '../../types/game';
import {
  ActionRelationshipEngine,
  type PowerPairRelationship as ActionPairRelationship,
} from '../../analysis/relationships';
import type { Power as EnginePower, Unit as EngineUnit } from '../../engine/types';

/**
 * Analysis mode for relationship inference.
 */
export type AnalysisMode = 'messages' | 'actions' | 'combined';

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
  /** Whether a betrayal has been detected (from action analysis) */
  betrayalDetected?: boolean;
  /** Numeric score for combined mode (-100 to 100) */
  score?: number;
  /** Message-based score (0-1 normalized) */
  messageScore?: number;
  /** Action-based score (-100 to 100) */
  actionScore?: number;
}

interface RelationshipGraphPanelProps {
  /** All messages to analyze for relationships */
  messages: Message[];
  /** Game events for action analysis */
  gameEvents?: GameEvent[];
  /** Current game state for context */
  gameState?: GameState;
  /** Toggle between message-only, action-only, and combined analysis */
  analysisMode?: AnalysisMode;
  /** Callback when analysis mode changes */
  onAnalysisModeChange?: (mode: AnalysisMode) => void;
  /** Currently selected power to highlight */
  selectedPower?: LowercasePower;
  /** Callback when a power is clicked */
  onPowerClick?: (power: LowercasePower) => void;
  /** Optional CSS class */
  className?: string;
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

    // Compute message score (0-1 based on sentiment)
    let messageScore = 0.5; // neutral
    if (data.count > 0) {
      const positiveRatio = data.positive / data.count;
      const negativeRatio = data.negative / data.count;
      messageScore = 0.5 + (positiveRatio - negativeRatio) * 0.5;
    }

    relationships.push({
      power1: p1,
      power2: p2,
      messageCount: data.count,
      status,
      strength,
      messageScore,
    });
  }

  return relationships;
}

/**
 * Process game events to extract action-based relationships.
 */
function computeActionRelationships(
  gameEvents: GameEvent[],
  gameState?: GameState
): Map<string, ActionPairRelationship> {
  const engine = new ActionRelationshipEngine();

  // Update unit owners from game state if available
  if (gameState?.units) {
    const engineUnits: EngineUnit[] = gameState.units.map(u => ({
      type: u.type.toUpperCase() as 'ARMY' | 'FLEET',
      power: toEnginePower(u.power),
      province: u.territory.toUpperCase(),
    }));
    engine.updateUnitOwners(engineUnits);
  }

  // Build unit ownership map from game state
  const unitsByProvince = new Map<string, EnginePower>();
  if (gameState?.units) {
    for (const unit of gameState.units) {
      unitsByProvince.set(unit.territory.toUpperCase(), toEnginePower(unit.power));
    }
  }

  // Process relevant events
  for (const event of gameEvents) {
    if (event.type === 'MOVEMENT_RESOLVED') {
      const movementEvent = event as MovementResolvedEvent;

      // Find corresponding capture event (if any)
      const captureEvent = gameEvents.find(
        e =>
          e.type === 'SUPPLY_CENTERS_CAPTURED' &&
          (e as SupplyCentersCapturedEvent).payload.year === movementEvent.payload.year &&
          (e as SupplyCentersCapturedEvent).payload.season === movementEvent.payload.season
      ) as SupplyCentersCapturedEvent | undefined;

      // Build unit ownership from the movement results
      const turnUnitsByProvince = new Map<string, EnginePower>();
      for (const { order } of movementEvent.payload.results) {
        // Get the power that owns this unit from the event context
        // This is an approximation - in production would need proper unit tracking
        const existingOwner = unitsByProvince.get(order.unit);
        if (existingOwner) {
          turnUnitsByProvince.set(order.unit, existingOwner);
        }
      }

      engine.processTurn(
        movementEvent.payload.results.map(r => r.order),
        movementEvent,
        captureEvent || null,
        turnUnitsByProvince.size > 0 ? turnUnitsByProvince : unitsByProvince
      );
    }
  }

  // Convert to map keyed by power pair
  const actionRelationships = new Map<string, ActionPairRelationship>();
  for (const rel of engine.getAllRelationships()) {
    const key = `${toUIPower(rel.power1)}-${toUIPower(rel.power2)}`;
    actionRelationships.set(key, rel);
  }

  return actionRelationships;
}

/**
 * Combine message-based and action-based relationships.
 * Actions speak louder than words: 70% action, 30% message weight.
 */
function combineRelationships(
  messageRelationships: PowerPairRelationship[],
  actionRelationships: Map<string, ActionPairRelationship>,
  mode: AnalysisMode
): PowerPairRelationship[] {
  if (mode === 'messages') {
    return messageRelationships;
  }

  return messageRelationships.map(msgRel => {
    const key = `${msgRel.power1}-${msgRel.power2}`;
    const actionRel = actionRelationships.get(key);

    if (mode === 'actions') {
      if (!actionRel) {
        return {
          ...msgRel,
          status: 'neutral' as const,
          strength: 0,
          score: 0,
          actionScore: 0,
          betrayalDetected: false,
        };
      }

      return {
        ...msgRel,
        status: actionRel.status,
        strength: Math.abs(actionRel.score) / 100,
        score: actionRel.score,
        actionScore: actionRel.score,
        betrayalDetected: actionRel.betrayalDetected,
      };
    }

    // Combined mode
    const messageScore = msgRel.messageScore ?? 0.5;
    // Convert message score (0-1) to -100 to 100 scale
    const normalizedMessageScore = (messageScore - 0.5) * 200;
    const actionScore = actionRel?.score ?? 0;

    // Combined: 30% message, 70% action (actions speak louder than words)
    const combinedScore = normalizedMessageScore * 0.3 + actionScore * 0.7;
    const clampedScore = Math.max(-100, Math.min(100, combinedScore));

    // Determine status from combined score
    let status: 'ally' | 'enemy' | 'neutral' = 'neutral';
    if (clampedScore >= 10) status = 'ally';
    else if (clampedScore <= -10) status = 'enemy';

    // Strength is the absolute magnitude
    const strength = Math.abs(clampedScore) / 100;

    return {
      ...msgRel,
      status,
      strength,
      score: Math.round(clampedScore),
      messageScore,
      actionScore,
      betrayalDetected: actionRel?.betrayalDetected ?? false,
    };
  });
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

export function RelationshipGraphPanel({
  messages,
  gameEvents,
  gameState,
  analysisMode = 'messages',
  onAnalysisModeChange,
  selectedPower,
  onPowerClick,
  className = '',
}: RelationshipGraphPanelProps) {
  const [hoveredPower, setHoveredPower] = useState<LowercasePower | null>(null);
  const [internalMode, setInternalMode] = useState<AnalysisMode>(analysisMode);

  // Use controlled or uncontrolled mode
  const currentMode = onAnalysisModeChange ? analysisMode : internalMode;
  const handleModeChange = useCallback(
    (mode: AnalysisMode) => {
      if (onAnalysisModeChange) {
        onAnalysisModeChange(mode);
      } else {
        setInternalMode(mode);
      }
    },
    [onAnalysisModeChange]
  );

  // Compute message-based relationships
  const messageRelationships = useMemo(() => computeRelationships(messages), [messages]);

  // Compute action-based relationships (only when needed)
  const actionRelationships = useMemo(() => {
    if (currentMode === 'messages' || !gameEvents?.length) {
      return new Map<string, ActionPairRelationship>();
    }
    return computeActionRelationships(gameEvents, gameState);
  }, [currentMode, gameEvents, gameState]);

  // Combine relationships based on mode
  const relationships = useMemo(
    () => combineRelationships(messageRelationships, actionRelationships, currentMode),
    [messageRelationships, actionRelationships, currentMode]
  );

  // Check if we have game events to enable action modes
  const hasGameEvents = (gameEvents?.length ?? 0) > 0;

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
    const betrayals: LowercasePower[] = [];
    let totalMessages = 0;
    let averageScore: number | undefined;
    let scoreSum = 0;
    let scoreCount = 0;

    for (const rel of relationships) {
      if (rel.power1 === activePower || rel.power2 === activePower) {
        const other = rel.power1 === activePower ? rel.power2 : rel.power1;
        totalMessages += rel.messageCount;
        if (rel.status === 'ally') allies.push(other);
        if (rel.status === 'enemy') enemies.push(other);
        if (rel.betrayalDetected) betrayals.push(other);
        if (rel.score !== undefined) {
          scoreSum += rel.score;
          scoreCount++;
        }
      }
    }

    if (scoreCount > 0) {
      averageScore = Math.round(scoreSum / scoreCount);
    }

    return { allies, enemies, betrayals, totalMessages, averageScore };
  }, [activePower, relationships]);

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Mode Toggle */}
      <div className="flex justify-center gap-1 mb-3">
        <button
          onClick={() => handleModeChange('messages')}
          className={`px-3 py-1 text-xs rounded-l-md transition-colors ${
            currentMode === 'messages'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Messages
        </button>
        <button
          onClick={() => handleModeChange('actions')}
          disabled={!hasGameEvents}
          className={`px-3 py-1 text-xs transition-colors ${
            currentMode === 'actions'
              ? 'bg-blue-600 text-white'
              : hasGameEvents
                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
          }`}
          title={!hasGameEvents ? 'No game events available' : undefined}
        >
          Actions
        </button>
        <button
          onClick={() => handleModeChange('combined')}
          disabled={!hasGameEvents}
          className={`px-3 py-1 text-xs rounded-r-md transition-colors ${
            currentMode === 'combined'
              ? 'bg-blue-600 text-white'
              : hasGameEvents
                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
          }`}
          title={!hasGameEvents ? 'No game events available' : undefined}
        >
          Combined
        </button>
      </div>

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
                    strokeDasharray={rel.betrayalDetected ? '4,4' : undefined}
                    className="transition-opacity duration-200"
                  />
                  {/* Betrayal indicator */}
                  {rel.betrayalDetected && highlighted && (
                    <g transform={`translate(${midX}, ${midY})`}>
                      <circle r="8" fill="#991b1b" stroke="#fca5a5" strokeWidth="1" />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#fca5a5"
                        fontSize="10"
                        fontWeight="bold"
                      >
                        !
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
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="flex justify-center flex-wrap gap-4 mt-2 text-xs text-gray-400">
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
        {currentMode !== 'messages' && (
          <div className="flex items-center gap-1">
            <div className="w-4 h-0.5 bg-red-800 rounded" style={{ borderStyle: 'dashed', borderWidth: '1px', borderColor: '#fca5a5' }} />
            <span>Betrayal</span>
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
            {activeStats.averageScore !== undefined && (
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  activeStats.averageScore > 0
                    ? 'bg-green-900 text-green-300'
                    : activeStats.averageScore < 0
                      ? 'bg-red-900 text-red-300'
                      : 'bg-gray-700 text-gray-300'
                }`}
              >
                {activeStats.averageScore > 0 ? '+' : ''}
                {activeStats.averageScore}
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
            {activeStats.betrayals.length > 0 && (
              <div>
                Betrayals:{' '}
                <span className="text-orange-400">
                  {activeStats.betrayals.map((p) => POWER_ABBREV[p]).join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* No data message */}
      {messages.length === 0 && !hasGameEvents && (
        <div className="text-center text-gray-500 py-8">
          No diplomatic messages yet.
          <br />
          <span className="text-sm">Relationships will appear as powers communicate.</span>
        </div>
      )}
      {currentMode !== 'messages' && !hasGameEvents && (
        <div className="text-center text-gray-500 py-4">
          <span className="text-sm">No game events available for action analysis.</span>
        </div>
      )}
    </div>
  );
}
