/**
 * Game Logger - Structured logging for game debugging.
 *
 * Writes JSONL logs to logs/games/{gameId}.jsonl for Gas Town agents to access.
 * Captures: LLM calls/responses, agent turns, orders, errors, and more.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';

/**
 * Log event types for game debugging.
 */
export type GameLogEvent =
  | { type: 'game_started'; gameId: string; name: string; powers: string[] }
  | { type: 'game_ended'; gameId: string; winner?: string; draw?: boolean; reason?: string }
  | { type: 'phase_started'; phase: string; year: number; season: string }
  | { type: 'phase_resolved'; phase: string; year: number; season: string }
  | { type: 'agent_turn_started'; power: string }
  | { type: 'agent_turn_completed'; power: string; durationMs: number }
  | { type: 'llm_request'; power: string; model?: string; messageCount: number; tokenEstimate?: number }
  | { type: 'llm_response'; power: string; model?: string; usage?: { inputTokens: number; outputTokens: number }; durationMs: number; stopReason?: string }
  | { type: 'llm_error'; power: string; error: string; model?: string }
  | { type: 'orders_parsed'; power: string; orders: string[]; rawOutput?: string }
  | { type: 'orders_submitted'; power: string; orders: string[]; valid: boolean; invalidReason?: string }
  | { type: 'invalid_order'; power: string; model?: string; orderText: string; error: string; year: number; season: string; phase: string }
  | { type: 'message_sent'; from: string; to: string | string[]; preview: string }
  | { type: 'error'; error: string; context?: string; stack?: string }
  | { type: 'warning'; message: string; context?: string }
  | { type: 'debug'; message: string; data?: unknown };

/**
 * Full log entry with metadata.
 */
export interface GameLogEntry {
  timestamp: string;
  gameId: string;
  event: GameLogEvent;
}

/**
 * Game logger for a single game instance.
 */
export class GameLogger {
  private gameId: string;
  private logPath: string;
  private enabled: boolean;

  constructor(gameId: string, logsDir?: string) {
    this.gameId = gameId;
    const baseDir = logsDir || join(process.cwd(), 'logs', 'games');
    this.logPath = join(baseDir, `${gameId}.jsonl`);
    this.enabled = true;

    // Ensure logs directory exists
    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Logs an event to the game log file.
   */
  log(event: GameLogEvent): void {
    if (!this.enabled) return;

    const entry: GameLogEntry = {
      timestamp: new Date().toISOString(),
      gameId: this.gameId,
      event,
    };

    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    } catch (error) {
      console.error(`[GameLogger] Failed to write log: ${error}`);
    }
  }

  /**
   * Convenience methods for common log types.
   */
  gameStarted(name: string, powers: string[]): void {
    this.log({ type: 'game_started', gameId: this.gameId, name, powers });
  }

  gameEnded(winner?: string, draw?: boolean, reason?: string): void {
    this.log({ type: 'game_ended', gameId: this.gameId, winner, draw, reason });
  }

  phaseStarted(phase: string, year: number, season: string): void {
    this.log({ type: 'phase_started', phase, year, season });
  }

  phaseResolved(phase: string, year: number, season: string): void {
    this.log({ type: 'phase_resolved', phase, year, season });
  }

  agentTurnStarted(power: string): void {
    this.log({ type: 'agent_turn_started', power });
  }

  agentTurnCompleted(power: string, durationMs: number): void {
    this.log({ type: 'agent_turn_completed', power, durationMs });
  }

  llmRequest(power: string, model?: string, messageCount?: number, tokenEstimate?: number): void {
    this.log({ type: 'llm_request', power, model, messageCount: messageCount || 0, tokenEstimate });
  }

  llmResponse(
    power: string,
    durationMs: number,
    model?: string,
    usage?: { inputTokens: number; outputTokens: number },
    stopReason?: string
  ): void {
    this.log({ type: 'llm_response', power, model, usage, durationMs, stopReason });
  }

  llmError(power: string, error: string, model?: string): void {
    this.log({ type: 'llm_error', power, error, model });
  }

  ordersParsed(power: string, orders: string[], rawOutput?: string): void {
    this.log({ type: 'orders_parsed', power, orders, rawOutput });
  }

  ordersSubmitted(power: string, orders: string[], valid: boolean, invalidReason?: string): void {
    this.log({ type: 'orders_submitted', power, orders, valid, invalidReason });
  }

  invalidOrder(power: string, model: string | undefined, orderText: string, error: string, year: number, season: string, phase: string): void {
    this.log({ type: 'invalid_order', power, model, orderText, error, year, season, phase });
  }

  messageSent(from: string, to: string | string[], preview: string): void {
    this.log({ type: 'message_sent', from, to, preview });
  }

  error(error: string, context?: string, stack?: string): void {
    this.log({ type: 'error', error, context, stack });
  }

  warning(message: string, context?: string): void {
    this.log({ type: 'warning', message, context });
  }

  debug(message: string, data?: unknown): void {
    this.log({ type: 'debug', message, data });
  }

  /**
   * Gets the path to the log file.
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Disables logging (for tests or production).
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Enables logging.
   */
  enable(): void {
    this.enabled = true;
  }
}

/**
 * Registry of active game loggers.
 */
const loggers = new Map<string, GameLogger>();

/**
 * Gets or creates a logger for a game.
 */
export function getGameLogger(gameId: string, logsDir?: string): GameLogger {
  let logger = loggers.get(gameId);
  if (!logger) {
    logger = new GameLogger(gameId, logsDir);
    loggers.set(gameId, logger);
  }
  return logger;
}

/**
 * Removes a logger from the registry.
 */
export function removeGameLogger(gameId: string): void {
  loggers.delete(gameId);
}

/**
 * Gets all active logger game IDs.
 */
export function getActiveGameIds(): string[] {
  return Array.from(loggers.keys());
}

/**
 * Reads all log entries from a game log file.
 */
export function readGameLogs(gameId: string, logsDir?: string): GameLogEntry[] {
  const baseDir = logsDir || join(process.cwd(), 'logs', 'games');
  const logPath = join(baseDir, `${gameId}.jsonl`);

  if (!existsSync(logPath)) {
    return [];
  }

  const content = readFileSync(logPath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.length > 0);

  return lines.map(line => {
    try {
      return JSON.parse(line) as GameLogEntry;
    } catch {
      return null;
    }
  }).filter((entry): entry is GameLogEntry => entry !== null);
}

/**
 * Reads the last N log entries from a game log file.
 */
export function readRecentGameLogs(gameId: string, count: number = 50, logsDir?: string): GameLogEntry[] {
  const allLogs = readGameLogs(gameId, logsDir);
  return allLogs.slice(-count);
}

/**
 * Lists all available game log files.
 */
export function listGameLogs(logsDir?: string): { gameId: string; path: string; size: number }[] {
  const baseDir = logsDir || join(process.cwd(), 'logs', 'games');

  if (!existsSync(baseDir)) {
    return [];
  }

  const files = readdirSync(baseDir).filter(f => f.endsWith('.jsonl'));

  return files.map(f => {
    const fullPath = join(baseDir, f);
    const stat = statSync(fullPath);
    return {
      gameId: basename(f, '.jsonl'),
      path: fullPath,
      size: stat.size,
    };
  });
}

/**
 * Filters log entries by type.
 */
export function filterLogsByType(logs: GameLogEntry[], types: GameLogEvent['type'][]): GameLogEntry[] {
  return logs.filter(entry => types.includes(entry.event.type));
}

/**
 * Gets errors from game logs.
 */
export function getGameErrors(gameId: string, logsDir?: string): GameLogEntry[] {
  const logs = readGameLogs(gameId, logsDir);
  return filterLogsByType(logs, ['error', 'llm_error']);
}

/**
 * LLM provider type matching the agent runtime interface.
 */
interface LLMProviderLike {
  complete(params: {
    messages: { role: string; content: string }[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
  }): Promise<{
    content: string;
    usage?: { inputTokens: number; outputTokens: number };
    stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence';
  }>;
}

/**
 * Creates a logging wrapper around an LLM provider.
 * Logs all LLM requests and responses to the specified game logger.
 */
export function createLoggingLLMProvider<T extends LLMProviderLike>(
  provider: T,
  logger: GameLogger,
  defaultPower: string = 'unknown'
): T {
  return {
    async complete(params: Parameters<T['complete']>[0]) {
      // Try to extract power from system message
      let power = defaultPower;
      const systemMsg = params.messages.find(m => m.role === 'system')?.content || '';
      const powerMatch = systemMsg.match(/You are playing as (\w+)/i);
      if (powerMatch) {
        power = powerMatch[1].toUpperCase();
      }

      const startTime = Date.now();
      logger.llmRequest(power, params.model, params.messages.length);

      try {
        const response = await provider.complete(params);
        const durationMs = Date.now() - startTime;
        logger.llmResponse(power, durationMs, params.model, response.usage, response.stopReason);
        return response;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.llmError(power, errorMsg, params.model);
        throw error;
      }
    },
  } as T;
}

/**
 * Statistics for invalid orders aggregated by model.
 */
export interface InvalidOrderStats {
  /** Model identifier */
  model: string;
  /** Total orders submitted by this model */
  totalOrders: number;
  /** Number of invalid orders */
  invalidOrders: number;
  /** Invalid order rate (0-1) */
  invalidRate: number;
  /** Breakdown of error types */
  errorTypes: Record<string, number>;
  /** Sample invalid orders for review */
  samples: Array<{
    power: string;
    orderText: string;
    error: string;
    phase: string;
  }>;
}

/**
 * Aggregated statistics for all models in a game.
 */
export interface ModelStatsReport {
  gameId: string;
  totalInvalidOrders: number;
  totalOrders: number;
  overallInvalidRate: number;
  byModel: InvalidOrderStats[];
}

/**
 * Extracts invalid order statistics from game logs, aggregated by model.
 */
export function getInvalidOrderStats(gameId: string, logsDir?: string): ModelStatsReport {
  const logs = readGameLogs(gameId, logsDir);

  // Track orders and invalids per model
  const modelData = new Map<string, {
    totalOrders: number;
    invalidOrders: number;
    errorTypes: Record<string, number>;
    samples: Array<{ power: string; orderText: string; error: string; phase: string }>;
  }>();

  // Count total orders from llm_response events (one per agent turn)
  const ordersByPowerPhase = new Map<string, string>(); // power+phase -> model

  for (const entry of logs) {
    const event = entry.event;

    // Track model used per power from llm_response events
    if (event.type === 'llm_response' && event.model) {
      const key = `${event.power}`;
      ordersByPowerPhase.set(key, event.model);
    }

    // Track submitted orders (count total valid orders)
    if (event.type === 'orders_submitted') {
      const model = ordersByPowerPhase.get(event.power) || 'unknown';
      if (!modelData.has(model)) {
        modelData.set(model, {
          totalOrders: 0,
          invalidOrders: 0,
          errorTypes: {},
          samples: [],
        });
      }
      const data = modelData.get(model)!;
      data.totalOrders += event.orders.length;
    }

    // Track invalid orders
    if (event.type === 'invalid_order') {
      const model = event.model || 'unknown';
      if (!modelData.has(model)) {
        modelData.set(model, {
          totalOrders: 0,
          invalidOrders: 0,
          errorTypes: {},
          samples: [],
        });
      }
      const data = modelData.get(model)!;
      data.invalidOrders++;
      data.totalOrders++; // Invalid orders still count toward total attempts

      // Categorize error type
      const errorType = categorizeError(event.error);
      data.errorTypes[errorType] = (data.errorTypes[errorType] || 0) + 1;

      // Keep sample (max 10 per model)
      if (data.samples.length < 10) {
        data.samples.push({
          power: event.power,
          orderText: event.orderText,
          error: event.error,
          phase: `${event.season} ${event.year} ${event.phase}`,
        });
      }
    }
  }

  // Build report
  const byModel: InvalidOrderStats[] = [];
  let totalInvalid = 0;
  let totalAll = 0;

  for (const [model, data] of modelData) {
    totalInvalid += data.invalidOrders;
    totalAll += data.totalOrders;

    byModel.push({
      model,
      totalOrders: data.totalOrders,
      invalidOrders: data.invalidOrders,
      invalidRate: data.totalOrders > 0 ? data.invalidOrders / data.totalOrders : 0,
      errorTypes: data.errorTypes,
      samples: data.samples,
    });
  }

  // Sort by invalid rate descending
  byModel.sort((a, b) => b.invalidRate - a.invalidRate);

  return {
    gameId,
    totalInvalidOrders: totalInvalid,
    totalOrders: totalAll,
    overallInvalidRate: totalAll > 0 ? totalInvalid / totalAll : 0,
    byModel,
  };
}

/**
 * Categorizes an order validation error into a general type.
 */
function categorizeError(error: string): string {
  const lower = error.toLowerCase();

  if (lower.includes('no unit') || lower.includes('unit at')) {
    return 'NO_UNIT_AT_LOCATION';
  }
  if (lower.includes('cannot reach') || lower.includes('adjacent')) {
    return 'INVALID_MOVE_TARGET';
  }
  if (lower.includes('support')) {
    return 'INVALID_SUPPORT';
  }
  if (lower.includes('convoy') || lower.includes('fleet')) {
    return 'INVALID_CONVOY';
  }
  if (lower.includes('province') || lower.includes('unknown')) {
    return 'UNKNOWN_PROVINCE';
  }
  if (lower.includes('parse') || lower.includes('could not')) {
    return 'PARSE_ERROR';
  }

  return 'OTHER';
}

/**
 * Formats the model stats report for console output.
 */
export function formatModelStatsReport(report: ModelStatsReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═'.repeat(60));
  lines.push('INVALID ORDER STATISTICS BY MODEL');
  lines.push('═'.repeat(60));
  lines.push('');
  lines.push(`Game: ${report.gameId}`);
  lines.push(`Total Orders: ${report.totalOrders}`);
  lines.push(`Invalid Orders: ${report.totalInvalidOrders}`);
  lines.push(`Overall Invalid Rate: ${(report.overallInvalidRate * 100).toFixed(2)}%`);
  lines.push('');

  if (report.byModel.length === 0) {
    lines.push('No model data available.');
  } else {
    for (const stats of report.byModel) {
      lines.push('─'.repeat(60));
      lines.push(`Model: ${stats.model}`);
      lines.push(`  Total Orders: ${stats.totalOrders}`);
      lines.push(`  Invalid Orders: ${stats.invalidOrders}`);
      lines.push(`  Invalid Rate: ${(stats.invalidRate * 100).toFixed(2)}%`);

      if (Object.keys(stats.errorTypes).length > 0) {
        lines.push('  Error Types:');
        for (const [type, count] of Object.entries(stats.errorTypes)) {
          lines.push(`    ${type}: ${count}`);
        }
      }

      if (stats.samples.length > 0) {
        lines.push('  Sample Invalid Orders:');
        for (const sample of stats.samples.slice(0, 3)) {
          lines.push(`    [${sample.power}] "${sample.orderText}" - ${sample.error}`);
        }
      }
    }
  }

  lines.push('');
  lines.push('═'.repeat(60));

  return lines.join('\n');
}
