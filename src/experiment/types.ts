/**
 * Experiment Runner Types.
 *
 * Types for batch game simulations with different model configurations.
 */

import type { Power, Season, Phase } from '../engine/types';
import type { AgentPersonality } from '../agent/types';
import type { SnapshotMetadata } from '../store/snapshot-manager';
import type { ModelStatsReport, LieStatsReport } from '../server/game-logger';

/**
 * Configuration for a single model in an experiment.
 */
export interface ModelConfig {
  /** Unique identifier for this model config */
  id: string;
  /** LLM provider (anthropic, openrouter, openai, ollama, mock) */
  provider: 'anthropic' | 'openrouter' | 'openai' | 'ollama' | 'mock' | 'custom';
  /** Model name/identifier */
  model: string;
  /** Temperature for inference (0-1) */
  temperature?: number;
  /** Max tokens for responses */
  maxTokens?: number;
  /** Optional base URL for custom providers */
  baseUrl?: string;
  /** Optional API key (if not using env vars) */
  apiKey?: string;
}

/**
 * Configuration for power-specific model assignments.
 * Allows testing different models playing different powers.
 */
export interface PowerModelAssignment {
  /** The power to assign */
  power: Power;
  /** Model config ID to use for this power (references ModelConfig.id) */
  modelConfigId: string;
  /**
   * Inline model spec string (alternative to modelConfigId).
   * Format: [provider:]model[@base_url][#api_key]
   * Examples: "openai:gpt-4o", "ollama:llama3.2@http://gpu:11434"
   * When set, overrides modelConfigId.
   */
  modelSpec?: string;
  /** Optional personality overrides */
  personality?: Partial<AgentPersonality>;
}

/**
 * Configuration for a single game in the experiment.
 */
export interface GameConfig {
  /** Unique game identifier */
  gameId: string;
  /** Model assignments per power (if not specified, uses default model) */
  powerAssignments?: PowerModelAssignment[];
  /** Default model config ID for unassigned powers */
  defaultModelConfigId: string;
  /** Random seed for reproducibility (optional) */
  seed?: number;
}

/**
 * Full experiment configuration.
 */
export interface ExperimentConfig {
  /** Unique experiment identifier */
  experimentId: string;
  /** Human-readable experiment name */
  name: string;
  /** Description of the experiment */
  description?: string;
  /** Available model configurations */
  models: ModelConfig[];
  /** Number of games to run */
  gameCount: number;
  /** Maximum concurrent games */
  maxConcurrent: number;
  /** Maximum turns per game (0 = unlimited) */
  maxTurnsPerGame: number;
  /** Default model config ID for all powers */
  defaultModelConfigId: string;
  /**
   * Default model spec string (alternative to defaultModelConfigId).
   * Format: [provider:]model[@base_url][#api_key]
   * When set, auto-generates a ModelConfig and uses it as default.
   */
  defaultModelSpec?: string;
  /** Per-game configurations (optional, auto-generated if not provided) */
  games?: GameConfig[];
  /** Whether to run analysis after each game */
  runAnalysis: boolean;
  /** Whether to save snapshots for each game */
  saveSnapshots: boolean;
  /** Base directory for experiment artifacts */
  outputDir: string;
  /** Phase delay in ms (throttle game loop) */
  phaseDelayMs?: number;
  /** Press period duration in minutes (0 for instant, 1 for testing, 10+ for real games) */
  pressPeriodMinutes?: number;
  /** Whether to enable verbose logging */
  verbose: boolean;
}

/**
 * Result of a single game.
 */
export interface GameResult {
  /** Game identifier */
  gameId: string;
  /** Experiment identifier */
  experimentId: string;
  /** Start time */
  startedAt: Date;
  /** End time */
  completedAt: Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Winner power (if any) */
  winner?: Power;
  /** Whether game ended in draw */
  draw?: boolean;
  /** Final year */
  finalYear: number;
  /** Final season */
  finalSeason: Season;
  /** Final supply center counts per power */
  finalSupplyCenters: Record<Power, number>;
  /** Total turns played */
  turnCount: number;
  /** Model used per power */
  modelsByPower: Record<Power, string>;
  /** Path to game log file */
  logPath: string;
  /** Path to snapshots directory */
  snapshotsPath?: string;
  /** Invalid order statistics */
  invalidOrderStats?: ModelStatsReport;
  /** Lie/deception statistics */
  lieStats?: LieStatsReport;
  /** Error if game failed */
  error?: string;
  /** Status */
  status: 'completed' | 'failed' | 'timeout';
}

/**
 * Aggregated statistics across all games.
 */
export interface ExperimentStats {
  /** Total games run */
  totalGames: number;
  /** Games completed successfully */
  completedGames: number;
  /** Games that failed */
  failedGames: number;
  /** Games that timed out */
  timedOutGames: number;
  /** Win counts by power */
  winsByPower: Record<Power, number>;
  /** Win counts by model */
  winsByModel: Record<string, number>;
  /** Draw count */
  drawCount: number;
  /** Average game duration in ms */
  averageDurationMs: number;
  /** Average turns per game */
  averageTurns: number;
  /** Invalid order rate by model */
  invalidOrderRateByModel: Record<string, number>;
  /** Deception rate by model */
  deceptionRateByModel: Record<string, number>;
  /** Average final supply centers by power */
  averageSupplyCentersByPower: Record<Power, number>;
}

/**
 * Full experiment results.
 */
export interface ExperimentResults {
  /** Experiment configuration */
  config: ExperimentConfig;
  /** Start time */
  startedAt: Date;
  /** End time */
  completedAt?: Date;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Individual game results */
  games: GameResult[];
  /** Aggregated statistics */
  stats: ExperimentStats;
  /** Status */
  status: 'running' | 'completed' | 'aborted';
}

/**
 * Progress update during experiment execution.
 */
export interface ExperimentProgress {
  /** Experiment identifier */
  experimentId: string;
  /** Total games */
  totalGames: number;
  /** Games completed */
  completedGames: number;
  /** Games in progress */
  inProgressGames: number;
  /** Games pending */
  pendingGames: number;
  /** Estimated time remaining in ms */
  estimatedRemainingMs?: number;
  /** Current active game IDs */
  activeGameIds: string[];
}

/**
 * Event types for experiment progress tracking.
 */
export type ExperimentEventType =
  | 'experiment_started'
  | 'game_started'
  | 'game_completed'
  | 'game_failed'
  | 'experiment_completed'
  | 'experiment_aborted';

/**
 * Event emitted during experiment execution.
 */
export interface ExperimentEvent {
  type: ExperimentEventType;
  timestamp: Date;
  experimentId: string;
  gameId?: string;
  data?: {
    progress?: ExperimentProgress;
    result?: GameResult;
    error?: string;
    stats?: ExperimentStats;
  };
}

/**
 * Callback for experiment events.
 */
export type ExperimentEventCallback = (event: ExperimentEvent) => void;

/**
 * Critical state for resumption.
 */
export interface CriticalState {
  /** Experiment ID */
  experimentId: string;
  /** Game ID */
  gameId: string;
  /** Snapshot metadata */
  snapshot: SnapshotMetadata;
  /** Phase to resume from */
  resumePhase: {
    year: number;
    season: Season;
    phase: Phase;
  };
}

/**
 * Options for resuming an experiment from critical state.
 */
export interface ResumeOptions {
  /** Critical states to resume from */
  criticalStates: CriticalState[];
  /** Whether to continue remaining games */
  continueRemaining: boolean;
}
