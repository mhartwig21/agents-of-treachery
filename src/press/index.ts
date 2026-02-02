/**
 * Press System - Diplomatic Messaging for AI Diplomacy
 *
 * The press system enables communication between AI agents playing Diplomacy.
 * It supports:
 * - Bilateral press (private power-to-power messages)
 * - Multi-party press (alliance group chats)
 * - Global press (public announcements)
 * - Full spectator visibility for human observers
 *
 * @example
 * ```typescript
 * import {
 *   PressSystem,
 *   AgentPressAPI,
 *   SpectatorAPI,
 *   createAgentAPIs
 * } from './press';
 *
 * // Initialize the press system
 * const press = new PressSystem({
 *   gameId: 'game-001',
 *   year: 1901,
 *   season: 'SPRING',
 *   phase: 'DIPLOMACY'
 * });
 *
 * // Create APIs for all agents
 * const agentAPIs = createAgentAPIs(press);
 * const englandAPI = agentAPIs.get('ENGLAND')!;
 *
 * // Agent sends a message
 * englandAPI.sendTo('FRANCE', 'Shall we discuss the Channel?', {
 *   intent: 'PROPOSAL'
 * });
 *
 * // Spectator watches everything
 * const spectator = new SpectatorAPI(press);
 * spectator.onAnyMessage((msg, channel) => {
 *   console.log(`[${channel.type}] ${msg.sender}: ${msg.content}`);
 * });
 * ```
 *
 * @module press
 */

// Core types - type exports
export type {
  Power,
  ChannelType,
  ChannelId,
  Channel,
  MessageId,
  Message,
  MessageMetadata,
  MessageIntent,
  PressNotification,
  SendMessageRequest,
  CreateChannelRequest,
  MessageQuery,
  MessageQueryResult,
  SpectatorView,
  PressContext,
  PressConfig,
} from './types';

// Core types - value exports
export { POWERS, DEFAULT_PRESS_CONFIG } from './types';

// Channel management - class and function exports
export {
  ChannelManager,
  getBilateralChannelId,
  getMultipartyChannelId,
  parseChannelId,
  isParticipant,
  GLOBAL_CHANNEL_ID,
} from './channel';

// Main press system
export { PressSystem } from './press-system';
export type { NotificationCallback } from './press-system';

// Agent API - class and function exports
export { AgentPressAPI, createAgentAPIs } from './agent-api';

// Agent API - type exports
export type {
  AgentResponse,
  InboxSummary,
  ChannelSummary,
  AgentSendOptions,
} from './agent-api';

// Spectator API - class export
export { SpectatorAPI } from './spectator';

// Spectator API - type exports
export type {
  PressStatistics,
  DiplomaticExchange,
  ActivityPeriod,
} from './spectator';
