/**
 * Types for game orchestration.
 *
 * The orchestration layer manages game lifecycle, turn progression,
 * deadlines, and agent coordination.
 */

import { Power, Phase, Season, GameState, Order, RetreatOrder, BuildOrder } from '../engine/types';

/**
 * Unique identifier for a game session.
 */
export type GameId = string;

/**
 * Game lifecycle status.
 */
export type GameStatus =
  | 'PENDING'     // Created but not started
  | 'ACTIVE'      // Game in progress
  | 'PAUSED'      // Temporarily paused
  | 'COMPLETED'   // Game ended (winner or draw)
  | 'ABANDONED';  // Game terminated early

/**
 * Agent registration for a power.
 */
export interface AgentHandle {
  power: Power;
  agentId: string;
  /** Webhook URL for async notifications */
  webhookUrl?: string;
  /** Whether this agent is currently responsive */
  isResponsive: boolean;
  /** Last time we heard from this agent */
  lastActivity: Date;
  /** Number of consecutive missed deadlines */
  missedDeadlines: number;
}

/**
 * Configuration for the game orchestrator.
 */
export interface OrchestratorConfig {
  /** Duration for diplomacy phase in milliseconds */
  diplomacyPhaseDuration: number;
  /** Duration for movement submission after diplomacy in milliseconds */
  movementPhaseDuration: number;
  /** Duration for retreat phase in milliseconds */
  retreatPhaseDuration: number;
  /** Duration for build phase in milliseconds */
  buildPhaseDuration: number;
  /** Time before deadline to send reminder (nudge) in milliseconds */
  nudgeBeforeDeadline: number;
  /** Maximum consecutive missed deadlines before agent is considered inactive */
  maxMissedDeadlines: number;
  /** Whether to auto-submit HOLD orders for agents that miss deadline */
  autoHoldOnTimeout: boolean;
  /** Whether to auto-resolve when all orders are submitted (before deadline) */
  autoResolveOnComplete: boolean;
  /** Minimum time between phase changes in milliseconds (prevents rapid-fire) */
  minPhaseDuration: number;
}

/**
 * Default orchestrator configuration.
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  diplomacyPhaseDuration: 5 * 60 * 1000,   // 5 minutes
  movementPhaseDuration: 2 * 60 * 1000,    // 2 minutes
  retreatPhaseDuration: 1 * 60 * 1000,     // 1 minute
  buildPhaseDuration: 1 * 60 * 1000,       // 1 minute
  nudgeBeforeDeadline: 30 * 1000,          // 30 seconds
  maxMissedDeadlines: 3,
  autoHoldOnTimeout: true,
  autoResolveOnComplete: true,
  minPhaseDuration: 1000,                  // 1 second minimum
};

/**
 * Types of events emitted by the orchestrator.
 */
export type GameEventType =
  | 'GAME_CREATED'
  | 'GAME_STARTED'
  | 'GAME_PAUSED'
  | 'GAME_RESUMED'
  | 'GAME_COMPLETED'
  | 'GAME_ABANDONED'
  | 'PHASE_STARTED'
  | 'PHASE_ENDING_SOON'
  | 'PHASE_ENDED'
  | 'ORDERS_SUBMITTED'
  | 'ALL_ORDERS_RECEIVED'
  | 'ORDERS_RESOLVED'
  | 'AGENT_NUDGED'
  | 'AGENT_TIMEOUT'
  | 'AGENT_INACTIVE';

/**
 * Base structure for game events.
 */
export interface GameEventBase {
  type: GameEventType;
  gameId: GameId;
  timestamp: Date;
}

/**
 * Event when a game is created.
 */
export interface GameCreatedEvent extends GameEventBase {
  type: 'GAME_CREATED';
}

/**
 * Event when a game starts.
 */
export interface GameStartedEvent extends GameEventBase {
  type: 'GAME_STARTED';
  year: number;
  season: Season;
  phase: Phase;
}

/**
 * Event when a game is paused.
 */
export interface GamePausedEvent extends GameEventBase {
  type: 'GAME_PAUSED';
  reason?: string;
}

/**
 * Event when a game is resumed.
 */
export interface GameResumedEvent extends GameEventBase {
  type: 'GAME_RESUMED';
}

/**
 * Event when a game completes.
 */
export interface GameCompletedEvent extends GameEventBase {
  type: 'GAME_COMPLETED';
  winner?: Power;
  isDraw: boolean;
  finalYear: number;
}

/**
 * Event when a game is abandoned.
 */
export interface GameAbandonedEvent extends GameEventBase {
  type: 'GAME_ABANDONED';
  reason: string;
}

/**
 * Event when a phase starts.
 */
export interface PhaseStartedEvent extends GameEventBase {
  type: 'PHASE_STARTED';
  year: number;
  season: Season;
  phase: Phase;
  deadline: Date;
  /** Powers that need to submit orders this phase */
  activePowers: Power[];
}

/**
 * Event when phase deadline is approaching (nudge).
 */
export interface PhaseEndingSoonEvent extends GameEventBase {
  type: 'PHASE_ENDING_SOON';
  year: number;
  season: Season;
  phase: Phase;
  deadline: Date;
  timeRemaining: number;
  /** Powers that haven't submitted yet */
  pendingPowers: Power[];
}

/**
 * Event when a phase ends.
 */
export interface PhaseEndedEvent extends GameEventBase {
  type: 'PHASE_ENDED';
  year: number;
  season: Season;
  phase: Phase;
  /** Powers that missed the deadline */
  timeoutPowers: Power[];
}

/**
 * Event when a power submits orders.
 */
export interface OrdersSubmittedEvent extends GameEventBase {
  type: 'ORDERS_SUBMITTED';
  power: Power;
  orderCount: number;
}

/**
 * Event when all orders have been received.
 */
export interface AllOrdersReceivedEvent extends GameEventBase {
  type: 'ALL_ORDERS_RECEIVED';
  year: number;
  season: Season;
  phase: Phase;
}

/**
 * Event when orders are resolved (movement, retreat, or build).
 */
export interface OrdersResolvedEvent extends GameEventBase {
  type: 'ORDERS_RESOLVED';
  year: number;
  season: Season;
  phase: Phase;
  /** Summary of resolution results */
  summary: ResolutionSummary;
}

/**
 * Summary of order resolution.
 */
export interface ResolutionSummary {
  /** Number of successful moves */
  successfulMoves: number;
  /** Number of failed moves */
  failedMoves: number;
  /** Number of dislodged units */
  dislodgedUnits: number;
  /** Number of units built */
  unitsBuilt: number;
  /** Number of units disbanded */
  unitsDisbanded: number;
  /** Supply center changes (power gained/lost) */
  supplyChanges: Array<{ territory: string; from?: Power; to: Power }>;
}

/**
 * Event when an agent is nudged (deadline approaching).
 */
export interface AgentNudgedEvent extends GameEventBase {
  type: 'AGENT_NUDGED';
  power: Power;
  deadline: Date;
  timeRemaining: number;
}

/**
 * Event when an agent times out (missed deadline).
 */
export interface AgentTimeoutEvent extends GameEventBase {
  type: 'AGENT_TIMEOUT';
  power: Power;
  phase: Phase;
  /** What action was taken (e.g., auto-hold) */
  action: string;
}

/**
 * Event when an agent is marked inactive.
 */
export interface AgentInactiveEvent extends GameEventBase {
  type: 'AGENT_INACTIVE';
  power: Power;
  missedDeadlines: number;
}

/**
 * Union of all game events.
 */
export type GameEvent =
  | GameCreatedEvent
  | GameStartedEvent
  | GamePausedEvent
  | GameResumedEvent
  | GameCompletedEvent
  | GameAbandonedEvent
  | PhaseStartedEvent
  | PhaseEndingSoonEvent
  | PhaseEndedEvent
  | OrdersSubmittedEvent
  | AllOrdersReceivedEvent
  | OrdersResolvedEvent
  | AgentNudgedEvent
  | AgentTimeoutEvent
  | AgentInactiveEvent;

/**
 * Callback type for game event listeners.
 */
export type GameEventCallback = (event: GameEvent) => void;

/**
 * Orders that can be submitted during different phases.
 */
export type PhaseOrders =
  | { phase: 'DIPLOMACY' | 'MOVEMENT'; orders: Order[] }
  | { phase: 'RETREAT'; orders: RetreatOrder[] }
  | { phase: 'BUILD'; orders: BuildOrder[] };

/**
 * Submission status for a power.
 */
export interface SubmissionStatus {
  power: Power;
  submitted: boolean;
  submittedAt?: Date;
  orderCount: number;
}

/**
 * Current phase status.
 */
export interface PhaseStatus {
  year: number;
  season: Season;
  phase: Phase;
  deadline: Date;
  startedAt: Date;
  submissions: SubmissionStatus[];
  nudgeSent: boolean;
}

/**
 * Snapshot of game session state (for persistence).
 */
export interface GameSessionSnapshot {
  gameId: GameId;
  status: GameStatus;
  gameState: GameState;
  phaseStatus: PhaseStatus | null;
  agents: AgentHandle[];
  eventHistory: GameEvent[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}
