/**
 * Core types for the Diplomacy press (messaging) system.
 *
 * Press is the traditional Diplomacy term for diplomatic communication.
 * This system supports bilateral, multi-party, and global messaging.
 */

// Import canonical Power type from engine
import { type Power, POWERS } from '../engine/types';

// Re-export for consumers of press types
export type { Power };
export { POWERS };

/**
 * Types of press channels available in the game.
 */
export type ChannelType =
  | 'BILATERAL'    // Private between exactly 2 powers
  | 'MULTIPARTY'   // Private group of 3+ powers
  | 'GLOBAL';      // Public to all powers (broadcast)

/**
 * Unique identifier for a press channel.
 * Format: `bilateral:POWER1:POWER2` or `multiparty:POWER1:POWER2:...` or `global`
 */
export type ChannelId = string;

/**
 * Represents a press channel for communication.
 */
export interface Channel {
  id: ChannelId;
  type: ChannelType;
  participants: Power[];
  createdAt: Date;
  name?: string; // Optional name for multiparty channels (e.g., "Triple Alliance")
}

/**
 * Unique identifier for a message.
 */
export type MessageId = string;

/**
 * A press message sent through the system.
 */
export interface Message {
  id: MessageId;
  channelId: ChannelId;
  sender: Power;
  content: string;
  timestamp: Date;
  replyTo?: MessageId; // For threading
  metadata?: MessageMetadata;
}

/**
 * Optional metadata for agent consumption.
 */
export interface MessageMetadata {
  /** Agent-assigned intent classification */
  intent?: MessageIntent;
  /** Referenced territories or units */
  references?: string[];
  /** Sentiment analysis score (-1 to 1) */
  sentiment?: number;
  /** Negotiation stage for deal tracking */
  negotiationStage?: NegotiationStage;
  /** Conditional clause for "If X then Y" diplomacy */
  conditional?: ConditionalClause;
  /** ID of the proposal this message responds to (for threading negotiations) */
  inResponseTo?: MessageId;
  /** Press round number within a diplomacy phase (1-based) */
  pressRound?: number;
  /** Phase identifier: "YEAR-SEASON-PHASE" (e.g., "1901-SPRING-DIPLOMACY") */
  phaseId?: string;
  /** Custom key-value pairs for agent use */
  custom?: Record<string, unknown>;
}

/**
 * Common diplomatic intents for agent message classification.
 */
export type MessageIntent =
  | 'PROPOSAL'        // Proposing an alliance or coordinated action
  | 'COUNTER_PROPOSAL' // Counter-proposing with modified terms
  | 'ACCEPTANCE'      // Accepting a proposal
  | 'REJECTION'       // Rejecting a proposal
  | 'CONDITIONAL'     // Conditional commitment: "If you do X, I'll do Y"
  | 'THREAT'          // Warning or threatening action
  | 'INFORMATION'     // Sharing information about other powers
  | 'REQUEST'         // Asking for information or action
  | 'SMALL_TALK'      // General diplomacy, relationship building
  | 'DECEPTION';      // (For spectator analysis - agents don't self-report this)

/**
 * Negotiation stages for tracking deal progression.
 * Enables multi-round back-and-forth negotiation.
 */
export type NegotiationStage =
  | 'OPENING'         // Initial proposal
  | 'COUNTER'         // Counter-proposal in response
  | 'FINAL_TERMS'     // Final offer, take it or leave it
  | 'ACCEPTED'        // Deal confirmed by both parties
  | 'REJECTED';       // Deal explicitly rejected

/**
 * Conditional clause for "If you do X, I'll do Y" diplomacy.
 */
export interface ConditionalClause {
  /** The condition that must be met */
  condition: string;
  /** The commitment if condition is met */
  commitment: string;
  /** Whether the condition has been evaluated */
  evaluated?: boolean;
  /** Whether the condition was met (after evaluation) */
  conditionMet?: boolean;
}

/**
 * Notification sent to agents when they receive press.
 */
export interface PressNotification {
  type: 'NEW_MESSAGE' | 'CHANNEL_CREATED' | 'CHANNEL_INVITED';
  message?: Message;
  channel: Channel;
  timestamp: Date;
}

/**
 * Structured format for agents to send messages.
 */
export interface SendMessageRequest {
  channelId: ChannelId;
  content: string;
  replyTo?: MessageId;
  metadata?: MessageMetadata;
}

/**
 * Request to create a new multiparty channel.
 */
export interface CreateChannelRequest {
  participants: Power[];
  name?: string;
}

/**
 * Query parameters for retrieving message history.
 */
export interface MessageQuery {
  channelId?: ChannelId;
  sender?: Power;
  since?: Date;
  limit?: number;
  threadId?: MessageId; // Get all messages in a thread
}

/**
 * Result from a message query.
 */
export interface MessageQueryResult {
  messages: Message[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Spectator view of all press activity.
 * Provides omniscient access to all channels and messages.
 */
export interface SpectatorView {
  channels: Channel[];
  recentMessages: Message[];
  /** Messages grouped by channel for easy browsing */
  messagesByChannel: Map<ChannelId, Message[]>;
}

/**
 * Game context for press - ties messages to game state.
 */
export interface PressContext {
  gameId: string;
  year: number;
  season: 'SPRING' | 'FALL' | 'WINTER';
  phase: 'DIPLOMACY' | 'MOVEMENT' | 'RETREAT' | 'BUILD';
}

/**
 * Configuration for the press system.
 */
export interface PressConfig {
  /** Whether press is enabled during movement phase */
  allowDuringMovement: boolean;
  /** Whether to include message metadata for agents */
  includeMetadata: boolean;
  /** Maximum message length */
  maxMessageLength: number;
  /** Rate limiting: max messages per phase per power */
  maxMessagesPerPhase: number;
  /** Maximum messages to retain per channel (sliding window for memory bounds) */
  maxMessagesPerChannel: number;
}

export const DEFAULT_PRESS_CONFIG: PressConfig = {
  allowDuringMovement: true,
  includeMetadata: true,
  maxMessageLength: 2000,
  maxMessagesPerPhase: 100,
  maxMessagesPerChannel: 100,
};
