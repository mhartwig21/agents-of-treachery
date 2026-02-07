/**
 * Agent Runtime - Public API
 *
 * This module provides the framework for AI agents to play Diplomacy.
 * It includes session management, memory persistence, order parsing,
 * and the main runtime coordinator.
 */

// Core types
export type {
  AgentSessionId,
  TrustLevel,
  MemoryEvent,
  Commitment,
  StrategicNote,
  PowerRelationship,
  AgentMemory,
  StrategicPlan,
  TurnSummary,
  ConsolidatedBlock,
  TrustAffectingEvent,
  DiaryEntry,
  DiaryEntryType,
  YearSummary,
  AgentConfig,
  AgentPersonality,
  AgentSession,
  ConversationMessage,
  AgentTurnResult,
  DiplomaticAction,
  AgentRuntimeConfig,
  RuntimeStatus,
  LLMProvider,
  LLMCompletionParams,
  LLMCompletionResult,
  AgentGameView,
  UnitView,
  RetreatView,
  OrderResultView,
  StructuredOrder,
  StructuredRetreatOrder,
  StructuredBuildOrder,
  // Message analysis types
  SenderIntent,
  StrategicValue,
  RecommendedResponse,
  MessageAnalysis,
} from './types';

export { DEFAULT_PERSONALITY, DEFAULT_RUNTIME_CONFIG } from './types';

// Memory system
export {
  createInitialMemory,
  updateTrust,
  recordEvent,
  addCommitment,
  fulfillCommitment,
  breakCommitment,
  addStrategicNote,
  cleanupExpiredCommitments,
  addTurnSummary,
  updateMemoryTimestamp,
  getRelationshipSummary,
  getRecentEvents,
  getHighPriorityNotes,
  serializeMemory,
  deserializeMemory,
  InMemoryStore,
  FileMemoryStore,
  MemoryManager,
} from './memory';

export type { MemoryStore } from './memory';

// Diary system
export {
  formatPhaseId,
  createDiaryEntry,
  addDiaryEntry,
  addNegotiationEntry,
  addOrdersEntry,
  addReflectionEntry,
  shouldConsolidate,
  consolidateYear,
  performYearEndConsolidation,
  getContextDiary,
  getDiaryStats,
  initializeDiary,
  buildConsolidationPrompt,
  parseConsolidationResponse,
  // Enhanced yearly summary generation
  extractYearlyGameContext,
  buildEnhancedConsolidationPrompt,
  parseEnhancedConsolidationResponse,
  generateYearlySummary,
  // Alias exports for backward compatibility
  shouldConsolidateDiary,
  consolidateDiary,
  recordOrders,
  recordReflection,
  recordNegotiation,
  estimateDiaryTokens,
} from './diary';

export type { YearlyGameContext } from './diary';

// Memory consolidation
export {
  shouldConsolidateTurns,
  extractTrustEvents,
  buildTurnConsolidationPrompt,
  parseConsolidationResponse as parseTurnConsolidationResponse,
  createFallbackConsolidation,
  consolidateTurnSummaries,
  mergeOldestBlocks,
  mergeStrategicNotes,
  getAllTrustEvents,
  formatConsolidatedMemory,
  consolidateMemory,
  RECENT_TURNS_TO_KEEP,
  CONSOLIDATION_THRESHOLD,
  MAX_CONSOLIDATED_BLOCKS,
} from './consolidation';

// Session management
export {
  AgentSessionManager,
  createTestSessionManager,
  MockLLMProvider,
} from './session';

export type { SessionStats } from './session';

// Prompt system
export {
  buildSystemPrompt,
  buildTurnPrompt,
  buildDiplomacyPrompt,
  buildMemoryUpdatePrompt,
  buildStrategicContext,
  formatStrategicContext,
  getPromptContextStats,
} from './prompts';

// Context compression
export {
  estimateTokens,
  getCompressionLevel,
  getBudgetCompressionLevel,
  getEffectiveCompressionLevel,
  compressRules,
  compressStrategy,
  compressPowerStrategy,
  compressOrderFormat,
  compressGuidelines,
  compressGameState,
  compressDiaryContext,
  getRelevantPowers,
  getMaxRecentEvents,
  getMaxDiaryEntries,
  getMaxYearSummaries,
  getMaxRecentMessages,
} from './context-compression';

export type {
  CompressionLevel,
  TokenBudget,
  ContextStats,
} from './context-compression';

// Prompt loader for external prompt files
export {
  PromptLoader,
  getPromptLoader,
  setPromptLoader,
  loadPrompt,
} from './prompt-loader';

export type {
  ModelFamily,
  PromptVariables,
  PromptLoaderConfig,
} from './prompt-loader';

// Power-specific personalities
export {
  POWER_PERSONALITIES,
  POWER_PERSONALITY_PROMPTS,
  getPowerPersonality,
  getPowerPersonalityPrompt,
} from './personalities';

// Power-specific strategic guides
export {
  POWER_GUIDES,
  getPowerGuide,
  formatPowerGuideMarkdown,
  getOpeningAdvice,
} from './power-guides';

export type {
  PowerGuide,
  OpeningVariation,
} from './power-guides';

// Game view
export {
  createAgentGameView,
  createFullGameSummary,
  formatSupplyCentersForPower,
  getUncontrolledSupplyCenters,
  getNeutralSupplyCenters,
  estimateDistance,
  getNeighboringPowers,
  createStrategicSummary,
  getProvinceName,
  formatProvinceList,
} from './game-view';

// Pathfinding and strategic analysis
export {
  findShortestPath,
  calculateDistances,
  findNearestThreats,
  findNearestOpportunities,
  findConvoyRoutes,
  getAdjacentStatus,
  generateUnitStrategicContext,
  calculateThreatLevel,
  findImmediateThreatPowers,
  findReachableTargets,
  generatePowerStrategicContext,
  formatStrategicContextXML,
  formatStrategicContextMarkdown,
} from './pathfinding';

export type {
  PathResult,
  UnitStrategicContext,
  ThreatInfo,
  OpportunityInfo,
  ConvoyRoute,
  AdjacentProvince,
  PowerStrategicContext,
} from './pathfinding';

// Order parsing
export {
  normalizeProvince,
  parseCoast,
  extractOrdersSection,
  extractRetreatsSection,
  extractBuildsSection,
  parseOrderLine,
  parseRetreatLine,
  parseBuildLine,
  parseAgentResponse,
  validateOrders,
  fillDefaultOrders,
} from './order-parser';

export type { ParseResult } from './order-parser';

// Strategic planning
export {
  buildPlanningPrompt,
  parsePlanResponse,
  generateStrategicPlan,
  recordPlanInDiary,
  formatPlanForPrompt,
} from './planning';

// Negotiation analysis
export {
  analyzeIncomingMessage,
  analyzeIncomingMessages,
  buildAnalysisPrompt,
  parseAnalysisResponse,
  formatAnalysisForDiary,
  recordAnalysisInDiary,
  generateAnalysisSummary,
} from './negotiation';

// Negotiation quality metrics
export {
  NegotiationMetricsTracker,
  createNegotiationMetricsTracker,
  calculatePromiseCorrelationFromReconciliations,
} from './negotiation-metrics';

export type {
  PromiseCorrelation,
  AlliancePattern,
  DeceptionMetrics,
  PowerNegotiationScore,
  NegotiationMetricsReport,
} from './negotiation-metrics';

// Model registry
export {
  ModelRegistry,
  createOpenAIFreeTierRegistry,
  createDiverseOpenAIRegistry,
  createUniformOpenAIRegistry,
  BUILTIN_MODELS,
  OPENAI_FREE_TIER_BUDGETS,
} from './model-registry';

export type {
  ModelDefinition,
  ModelTier,
  TierBudgetConfig,
  TierBudget,
  PowerModelConfig,
} from './model-registry';

// Runtime
export {
  AgentRuntime,
  createTestRuntime,
  runAutonomousGame,
} from './runtime';

export type {
  RuntimeEventType,
  RuntimeEvent,
  RuntimeEventCallback,
} from './runtime';
