/**
 * Core types for the Diplomacy agent runtime.
 *
 * This module defines the structures for AI agent sessions, memory,
 * and runtime configuration.
 */

import type { Power, Order, RetreatOrder, BuildOrder, Season, Phase } from '../engine/types';

/**
 * Unique identifier for an agent session.
 */
export type AgentSessionId = string;

/**
 * Trust level between powers, ranging from -1 (enemy) to 1 (ally).
 */
export type TrustLevel = number;

/**
 * Record of a significant event in agent memory.
 */
export interface MemoryEvent {
  year: number;
  season: Season;
  type: 'ALLIANCE_FORMED' | 'ALLIANCE_BROKEN' | 'BETRAYAL' | 'COOPERATION' | 'ATTACK' | 'SUPPORT_GIVEN' | 'SUPPORT_RECEIVED' | 'PROMISE_MADE' | 'PROMISE_KEPT' | 'PROMISE_BROKEN';
  powers: Power[];
  description: string;
  impactOnTrust: number;
}

/**
 * A commitment or promise made between powers.
 */
export interface Commitment {
  id: string;
  year: number;
  season: Season;
  fromPower: Power;
  toPower: Power;
  description: string;
  expiresYear?: number;
  expiresSeason?: Season;
  fulfilled?: boolean;
  broken?: boolean;
}

/**
 * Strategic note about a power or territory.
 */
export interface StrategicNote {
  id: string;
  year: number;
  season: Season;
  subject: string;
  content: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/**
 * Agent's memory of relationship with another power.
 */
export interface PowerRelationship {
  power: Power;
  trustLevel: TrustLevel;
  isAlly: boolean;
  isEnemy: boolean;
  lastInteraction: { year: number; season: Season } | null;
  commitments: Commitment[];
  notes: string[];
}

/**
 * Persistent memory for an agent across game turns.
 */
export interface AgentMemory {
  /** The power this agent represents */
  power: Power;

  /** Current game identifier */
  gameId: string;

  /** When this memory was last updated */
  lastUpdated: { year: number; season: Season; phase: Phase };

  /** Trust levels for each other power (-1 to 1) */
  trustLevels: Map<Power, TrustLevel>;

  /** Detailed relationship tracking per power */
  relationships: Map<Power, PowerRelationship>;

  /** Historical events the agent remembers */
  events: MemoryEvent[];

  /** Active commitments the agent has made or received */
  activeCommitments: Commitment[];

  /** Strategic notes and observations */
  strategicNotes: StrategicNote[];

  /** Long-term strategic goals */
  strategicGoals: string[];

  /** Territory priorities for expansion */
  territoryPriorities: string[];

  /** Powers the agent is currently allied with */
  currentAllies: Power[];

  /** Powers the agent considers enemies */
  currentEnemies: Power[];

  /** Summary of previous turns for context */
  turnSummaries: TurnSummary[];

  /**
   * Full private diary - permanent, unabridged record of all entries.
   * Never truncated, used for historical analysis.
   */
  fullPrivateDiary: DiaryEntry[];

  /**
   * Consolidated yearly summaries - used for LLM context.
   * Contains condensed versions of past years.
   */
  yearSummaries: YearSummary[];

  /**
   * Current year diary entries - not yet consolidated.
   * At year end, these are summarized and moved to yearSummaries.
   */
  currentYearDiary: DiaryEntry[];
}

/**
 * Summary of a completed turn for memory.
 */
export interface TurnSummary {
  year: number;
  season: Season;
  ordersSubmitted: string[];
  ordersSucceeded: string[];
  ordersFailed: string[];
  supplyCentersGained: string[];
  supplyCentersLost: string[];
  unitsBuilt: number;
  unitsLost: number;
  diplomaticHighlights: string[];
}

/**
 * Type of diary entry.
 */
export type DiaryEntryType = 'negotiation' | 'orders' | 'reflection' | 'consolidation';

/**
 * A single diary entry recording agent thoughts and actions.
 */
export interface DiaryEntry {
  /** Game phase identifier, e.g., "[S1901M]" */
  phase: string;
  /** Type of diary entry */
  type: DiaryEntryType;
  /** The diary content */
  content: string;
  /** When the entry was created */
  timestamp: Date;
}

/**
 * Yearly summary created by consolidation.
 */
export interface YearSummary {
  /** The year this summary covers */
  year: number;
  /** Consolidated summary of the year's events (2-3 key points) */
  summary: string;
  /** Key territorial changes */
  territorialChanges: string[];
  /** Key diplomatic developments */
  diplomaticChanges: string[];
  /** When the consolidation was performed */
  consolidatedAt: Date;
}

/**
 * Configuration for an individual agent.
 */
export interface AgentConfig {
  /** The power this agent plays */
  power: Power;

  /** Agent personality traits affecting play style */
  personality?: AgentPersonality;

  /** Model to use for this agent (e.g., 'claude-3-opus', 'claude-3-sonnet') */
  model?: string;

  /** Temperature for LLM calls (0-1) */
  temperature?: number;

  /** Maximum tokens for LLM responses */
  maxTokens?: number;

  /** Whether to enable verbose logging */
  verbose?: boolean;
}

/**
 * Personality traits that influence agent behavior.
 */
export interface AgentPersonality {
  /** How likely to form alliances (0-1) */
  cooperativeness: number;

  /** How likely to take risks (0-1) */
  aggression: number;

  /** How much to value long-term vs short-term gains (0-1, higher = long-term) */
  patience: number;

  /** How likely to honor commitments (0-1) */
  trustworthiness: number;

  /** How suspicious of other powers (0-1) */
  paranoia: number;

  /** How likely to use deception (0-1) */
  deceptiveness: number;
}

/**
 * Default personality traits for a balanced player.
 */
export const DEFAULT_PERSONALITY: AgentPersonality = {
  cooperativeness: 0.5,
  aggression: 0.5,
  patience: 0.5,
  trustworthiness: 0.7,
  paranoia: 0.3,
  deceptiveness: 0.3,
};

/**
 * Active session for an agent.
 */
export interface AgentSession {
  id: AgentSessionId;
  power: Power;
  config: AgentConfig;
  memory: AgentMemory;
  createdAt: Date;
  lastActiveAt: Date;
  conversationHistory: ConversationMessage[];
  isActive: boolean;
}

/**
 * A message in the agent's conversation history.
 */
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/**
 * Result of an agent's turn, including orders and diplomatic actions.
 */
export interface AgentTurnResult {
  power: Power;
  orders: Order[];
  retreatOrders?: RetreatOrder[];
  buildOrders?: BuildOrder[];
  reasoning: string;
  diplomaticMessages?: DiplomaticAction[];
  memoryUpdates?: Partial<AgentMemory>;
}

/**
 * Negotiation stage for tracking deal progression.
 */
export type NegotiationStage = 'OPENING' | 'COUNTER' | 'FINAL' | 'ACCEPT' | 'REJECT';

/**
 * Conditional clause parsed from "IF X THEN Y" format.
 */
export interface ConditionalClause {
  condition: string;
  commitment: string;
}

/**
 * A diplomatic action taken by an agent.
 */
export interface DiplomaticAction {
  type: 'SEND_MESSAGE' | 'PROPOSE_ALLIANCE' | 'BREAK_ALLIANCE' | 'MAKE_COMMITMENT';
  targetPowers: Power[];
  content: string;
  channelId?: string;
  /** Negotiation stage indicator (e.g., [COUNTER], [FINAL]) */
  negotiationStage?: NegotiationStage;
  /** Parsed conditional clause from "IF X THEN Y" in message */
  conditional?: ConditionalClause;
}

/**
 * Configuration for the agent runtime.
 */
export interface AgentRuntimeConfig {
  /** Unique identifier for this game */
  gameId: string;

  /** Configuration for each agent */
  agents: AgentConfig[];

  /** Whether to run agents in parallel */
  parallelExecution: boolean;

  /** Timeout for agent turns in milliseconds */
  turnTimeout: number;

  /** Whether to save memory to disk */
  persistMemory: boolean;

  /** Directory for memory persistence */
  memoryDir?: string;

  /** Whether to log all agent interactions */
  verbose: boolean;

  /** API key for LLM provider */
  apiKey?: string;

  /** Base URL for LLM API */
  apiBaseUrl?: string;

  /** Maximum conversation history messages per agent (sliding window). Default: 50 */
  maxConversationHistory?: number;

  /** Maximum press messages to retain per channel (sliding window). Default: 100 */
  maxPressMessagesPerChannel?: number;

  /** Duration of press period in minutes. Agents can have back-and-forth conversations during this window. Default: 1 */
  pressPeriodMinutes?: number;

  /** Polling interval during press period in seconds. How often to check for agents with unread messages. Default: 5 */
  pressPollIntervalSeconds?: number;
}

/**
 * Default runtime configuration.
 */
export const DEFAULT_RUNTIME_CONFIG: Partial<AgentRuntimeConfig> = {
  parallelExecution: true,
  turnTimeout: 120000, // 2 minutes
  persistMemory: true,
  verbose: false,
  maxConversationHistory: 20, // Reduced from 50 to avoid context overflow on long games
  maxPressMessagesPerChannel: 100,
  pressPeriodMinutes: 1, // 1 minute default for faster testing, increase for real games
  pressPollIntervalSeconds: 5,
};

/**
 * Status of the agent runtime.
 */
export interface RuntimeStatus {
  gameId: string;
  isRunning: boolean;
  currentPhase: Phase;
  currentSeason: Season;
  currentYear: number;
  activeSessions: AgentSessionId[];
  lastUpdate: Date;
}

/**
 * Interface for the LLM provider used by agents.
 */
export interface LLMProvider {
  /**
   * Send a completion request to the LLM.
   */
  complete(params: LLMCompletionParams): Promise<LLMCompletionResult>;
}

/**
 * Parameters for an LLM completion request.
 */
export interface LLMCompletionParams {
  messages: ConversationMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

/**
 * Result from an LLM completion request.
 */
export interface LLMCompletionResult {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence';
}

/**
 * Game state formatted for agent consumption.
 */
export interface AgentGameView {
  /** The power receiving this view */
  viewingPower: Power;

  /** Current game phase information */
  year: number;
  season: Season;
  phase: Phase;

  /** This power's units */
  myUnits: UnitView[];

  /** Other powers' units (visible) */
  otherUnits: Map<Power, UnitView[]>;

  /** Supply center ownership */
  supplyCenters: Map<Power, string[]>;

  /** Number of supply centers per power */
  supplyCenterCounts: Map<Power, number>;

  /** Number of units per power */
  unitCounts: Map<Power, number>;

  /** Pending retreats for this power (if in retreat phase) */
  pendingRetreats?: RetreatView[];

  /** Build/disband count (positive = builds, negative = disbands) */
  buildCount?: number;

  /** Available build locations (if builds pending) */
  availableBuildLocations?: string[];

  /** Recent orders results (if available) */
  lastOrderResults?: OrderResultView[];
}

/**
 * A unit from the agent's perspective.
 */
export interface UnitView {
  type: 'ARMY' | 'FLEET';
  province: string;
  coast?: string;
  /** Adjacent provinces this unit can move to */
  adjacentProvinces?: string[];
}

/**
 * A pending retreat from the agent's perspective.
 */
export interface RetreatView {
  unit: UnitView;
  retreatOptions: string[];
  dislodgedFrom: string;
}

/**
 * Order result from the agent's perspective.
 */
export interface OrderResultView {
  order: string;
  success: boolean;
  reason?: string;
}

/**
 * Structured order format that agents produce.
 */
export interface StructuredOrder {
  unit: string;
  action: 'HOLD' | 'MOVE' | 'SUPPORT' | 'CONVOY';
  destination?: string;
  destinationCoast?: string;
  supportedUnit?: string;
  supportDestination?: string;
  convoyedUnit?: string;
  viaConvoy?: boolean;
}

/**
 * Structured retreat order format.
 */
export interface StructuredRetreatOrder {
  unit: string;
  destination?: string; // null = disband
}

/**
 * Structured build order format.
 */
export interface StructuredBuildOrder {
  action: 'BUILD' | 'DISBAND';
  province?: string;
  unitType?: 'ARMY' | 'FLEET';
  coast?: string;
}

/**
 * Sender's likely intent when sending a message.
 */
export type SenderIntent =
  | 'alliance_proposal'
  | 'threat'
  | 'information'
  | 'deception'
  | 'request'
  | 'commitment'
  | 'neutral';

/**
 * Strategic value assessment of a message.
 */
export type StrategicValue = 'high' | 'medium' | 'low';

/**
 * Recommended response strategy.
 */
export type RecommendedResponse = 'accept' | 'counter' | 'reject' | 'stall' | 'investigate';

/**
 * Analysis of an incoming diplomatic message.
 * Generated by the LLM to help agents make informed diplomatic decisions.
 */
export interface MessageAnalysis {
  /** ID of the message being analyzed */
  messageId: string;
  /** Power that sent the message */
  sender: Power;
  /** Power receiving/analyzing the message */
  receiver: Power;
  /** Classified intent of the sender */
  senderIntent: SenderIntent;
  /** Credibility score based on sender's history (0-1) */
  credibilityScore: number;
  /** Strategic value of the proposal/information */
  strategicValue: StrategicValue;
  /** Recommended response strategy */
  recommendedResponse: RecommendedResponse;
  /** LLM's reasoning for the analysis */
  reasoning: string;
  /** Potential deception indicators found */
  redFlags: string[];
  /** Specific commitments or proposals extracted from the message */
  extractedCommitments: string[];
  /** When this analysis was created */
  timestamp: Date;
}

/**
 * Trust update generated from phase reflection.
 */
export interface TrustUpdate {
  /** Power whose trust level changed */
  power: Power;
  /** Change in trust level (-1.0 to +1.0) */
  delta: number;
  /** Reason for the trust change */
  reason: string;
  /** Whether this was a betrayal */
  isBetrayal: boolean;
}

/**
 * Observation about what happened during a phase.
 */
export interface PhaseObservation {
  /** Power this observation is about */
  power: Power;
  /** What was promised (if applicable) */
  promised?: string;
  /** What actually happened */
  actual: string;
  /** Classification of the action */
  classification: 'cooperation' | 'betrayal' | 'neutral' | 'surprise_attack' | 'lie_of_omission';
}

/**
 * Result of phase reflection analysis.
 * Generated after order resolution to detect betrayals and update relationships.
 */
export interface PhaseReflection {
  /** Power that performed this reflection */
  power: Power;
  /** Game year */
  year: number;
  /** Game season */
  season: Season;
  /** Trust updates to apply */
  trustUpdates: TrustUpdate[];
  /** Observations about each power's actions */
  observations: PhaseObservation[];
  /** Overall strategic summary */
  strategicSummary: string;
  /** When this reflection was generated */
  timestamp: Date;
}
