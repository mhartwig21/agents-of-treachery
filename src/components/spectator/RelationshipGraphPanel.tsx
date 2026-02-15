/**
 * RelationshipGraphPanel - Visualize power relationships as an interactive graph.
 *
 * Shows all 7 powers as nodes with edges representing their relationships.
 * Edge color indicates alliance status, thickness indicates strength.
 * Betrayals are highlighted with animated red dashed lines and badges.
 * Hovering edges shows sparkline history, clicking opens detailed history modal.
 * Trust badges show "say vs do" reliability for each power.
 * Supports three analysis modes: messages-only, actions-only, and combined.
 */

import { useMemo, useState, useCallback, useRef } from 'react';
import { type LowercasePower, POWER_COLORS, UI_POWERS, toEnginePower, toUIPower } from '../../spectator/types';
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
import type { TrustMetrics, PairwiseTrust } from '../../analysis/trust';
import { TrustIndicatorBadgeSVG, TrustBadgeInline } from './TrustIndicatorBadge';
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
  /** Whether a betrayal has been detected */
  betrayalDetected?: boolean;
  /** Most recent betrayal info (if any) */
  betrayal?: BetrayalInfo;
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
    // Extract bilateral pair from channel ID.
    // Primary format: "bilateral:POWER1:POWER2" (from getBilateralChannelId)
    // Legacy fallback: "POWER1-POWER2"
    // Skip multiparty: and global channels (not bilateral pairs)
    let p1: LowercasePower | undefined;
    let p2: LowercasePower | undefined;

    const channelId = message.channelId;
    if (channelId.startsWith('bilateral:')) {
      const parts = channelId.slice('bilateral:'.length).split(':');
      if (parts.length === 2) {
        p1 = parts[0].toLowerCase() as LowercasePower;
        p2 = parts[1].toLowerCase() as LowercasePower;
      }
    } else if (!channelId.startsWith('multiparty:') && !channelId.startsWith('global')) {
      // Legacy "POWER1-POWER2" format
      const parts = channelId.split('-');
      if (parts.length === 2) {
        p1 = parts[0].toLowerCase() as LowercasePower;
        p2 = parts[1].toLowerCase() as LowercasePower;
      }
    }

    if (p1 && p2) {
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

/** Edge identifier type */
type EdgeKey = `${LowercasePower}-${LowercasePower}`;

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
  gameEvents,
  gameState,
  analysisMode = 'messages',
  onAnalysisModeChange,
  selectedPower,
  onPowerClick,
  className = '',
  betrayals = [],
  showBetrayals = true,
  engineRelationships = [],
  currentYear = 1901,
  currentSeason = 'SPRING',
  showHistory = true,
  trustMetrics = [],
  pairwiseTrust = [],
  showTrustIndicators = true,
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
      <div ref={containerRef} className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full max-w-[400px] mx-auto"
          role="img"
          aria-label="Relationship graph showing diplomatic connections between powers"
        >
          {/* Regular Edges (non-betrayal) */}
          <g className="edges" role="group" aria-label="Relationship edges">
            {relationships.map((rel) => {
              const pos1 = nodePositions.get(rel.power1)!;
              const pos2 = nodePositions.get(rel.power2)!;
              const highlighted = isEdgeHighlighted(rel.power1, rel.power2);
              const pairKey = (rel.power1 < rel.power2
                ? `${rel.power1}-${rel.power2}`
                : `${rel.power2}-${rel.power1}`) as EdgeKey;
              const hasBetrayal = showBetrayals && betrayalsByPair.has(pairKey);
              const isHovered = hoveredEdge === pairKey;
              const brokenCount = showTrustIndicators ? getBrokenPromiseCount(rel.power1, rel.power2) : 0;
              const midX = (pos1.x + pos2.x) / 2;
              const midY = (pos1.y + pos2.y) / 2;

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
                    strokeDasharray={rel.betrayalDetected ? '4,4' : undefined}
                    className="transition-opacity duration-300 pointer-events-none"
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

          {/* Betrayal Edges */}
          {showBetrayals && (
            <g className="betrayal-edges" role="group" aria-label="Betrayal edges">
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
          <g className="nodes" role="group" aria-label="Power nodes">
            {UI_POWERS.map((power) => {
              const pos = nodePositions.get(power)!;
              const isActive = power === activePower;
              const isSelected = power === selectedPower;
              const betrayerCount = betrayalCounts.asBetrayer[power] || 0;
              const victimCount = betrayalCounts.asVictim[power] || 0;
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
                  role="button"
                  aria-label={`${POWER_NAMES[power]}: ${relationships.find(r => r.power1 === power || r.power2 === power)?.status || 'neutral'}`}
                  tabIndex={0}
                  onClick={() => onPowerClick?.(power)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPowerClick?.(power); } }}
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
        <div className="flex flex-wrap justify-center gap-4 text-xs text-gray-400">
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
          {currentMode !== 'messages' && (
            <div className="flex items-center gap-1">
              <div className="w-4 h-0.5 bg-red-800 rounded" style={{ borderStyle: 'dashed', borderWidth: '1px', borderColor: '#fca5a5' }} />
              <span>Betrayal</span>
            </div>
          )}
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
                {betrayalCounts.asBetrayer[activePower]} betrayed
              </span>
            )}
            {showBetrayals && betrayalCounts.asVictim[activePower] > 0 && (
              <span className="text-xs px-2 py-0.5 bg-purple-900 text-purple-300 rounded-full">
                {betrayalCounts.asVictim[activePower]} stabbed
              </span>
            )}
            {/* Trust badge inline */}
            {showTrustIndicators && (() => {
              const trust = trustByPower.get(activePower);
              if (!trust) return null;
              const level = getTrustLevel(trust.trustScore, trust.promisesMade);
              return <TrustBadgeInline level={level} score={trust.trustScore} showScore />;
            })()}
            {/* Average score badge (from action engine) */}
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
      {messages.length === 0 && !hasGameEvents && (
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

        // Clamp tooltip position to stay within container bounds
        const TOOLTIP_W = 180;
        const TOOLTIP_H = 140;
        const containerW = containerRef.current?.clientWidth || width;
        const containerH = containerRef.current?.clientHeight || height;

        // Default: centered above cursor
        let left = tooltipPosition.x - TOOLTIP_W / 2;
        let top = tooltipPosition.y - 10 - TOOLTIP_H;

        // Clamp horizontal
        left = Math.max(0, Math.min(left, containerW - TOOLTIP_W));

        // If clipping top, flip to below cursor
        if (top < 0) {
          top = tooltipPosition.y + 15;
        }

        // Clamp bottom
        if (top + TOOLTIP_H > containerH) {
          top = containerH - TOOLTIP_H;
        }

        return (
          <div
            className="absolute z-10 pointer-events-none"
            style={{ left, top }}
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

      {currentMode !== 'messages' && !hasGameEvents && (
        <div className="text-center text-gray-500 py-4">
          <span className="text-sm">No game events available for action analysis.</span>
        </div>
      )}
    </div>
  );
}
