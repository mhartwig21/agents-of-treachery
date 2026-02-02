/**
 * Game Orchestration Module
 *
 * Provides automated game management for Diplomacy games:
 * - Turn phase progression with deadlines
 * - Agent coordination and prodding
 * - Auto-adjudication when all orders received
 * - Game lifecycle management
 */

// Types
export {
  GameId,
  GameStatus,
  AgentHandle,
  OrchestratorConfig,
  DEFAULT_ORCHESTRATOR_CONFIG,
  GameEventType,
  GameEvent,
  GameEventBase,
  GameCreatedEvent,
  GameStartedEvent,
  GamePausedEvent,
  GameResumedEvent,
  GameCompletedEvent,
  GameAbandonedEvent,
  PhaseStartedEvent,
  PhaseEndingSoonEvent,
  PhaseEndedEvent,
  OrdersSubmittedEvent,
  AllOrdersReceivedEvent,
  OrdersResolvedEvent,
  AgentNudgedEvent,
  AgentTimeoutEvent,
  AgentInactiveEvent,
  GameEventCallback,
  PhaseOrders,
  SubmissionStatus,
  PhaseStatus,
  ResolutionSummary,
  GameSessionSnapshot,
} from './types';

// Orchestrator
export { GameOrchestrator } from './orchestrator';

// Session
export { GameSession, GameSessionConfig } from './session';
