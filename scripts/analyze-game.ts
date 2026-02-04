/**
 * Game Analysis Script
 *
 * Analyzes completed game logs and generates statistics,
 * including invalid order tracking by model.
 *
 * Usage:
 *   npx tsx scripts/analyze-game.ts <gameId>
 *   npx tsx scripts/analyze-game.ts logs/games/game-123.jsonl
 */

import { basename } from 'path';
import {
  readGameLogs,
  listGameLogs,
  getInvalidOrderStats,
  formatModelStatsReport,
  getLieStats,
  formatLieStatsReport,
  filterLogsByType,
  type GameLogEntry,
} from '../src/server/game-logger';

function log(category: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] [${category}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function analyzeGame(gameId: string) {
  const logs = readGameLogs(gameId);

  if (logs.length === 0) {
    console.error(`No logs found for game: ${gameId}`);
    console.log('\nAvailable games:');
    for (const game of listGameLogs()) {
      console.log(`  ${game.gameId} (${(game.size / 1024).toFixed(1)} KB)`);
    }
    process.exit(1);
  }

  log('ANALYSIS', `Analyzing game: ${gameId}`);
  log('ANALYSIS', `Total log entries: ${logs.length}`);

  // Game overview
  const gameStarted = logs.find(e => e.event.type === 'game_started');
  const gameEnded = logs.find(e => e.event.type === 'game_ended');

  if (gameStarted?.event.type === 'game_started') {
    log('GAME', `Name: ${gameStarted.event.name}`);
    log('GAME', `Powers: ${gameStarted.event.powers.join(', ')}`);
  }

  if (gameEnded?.event.type === 'game_ended') {
    if (gameEnded.event.winner) {
      log('GAME', `Winner: ${gameEnded.event.winner}`);
    } else if (gameEnded.event.draw) {
      log('GAME', 'Game ended in a draw');
    }
  }

  // Phase statistics
  const phaseEvents = filterLogsByType(logs, ['phase_started', 'phase_resolved']);
  const uniquePhases = new Set(
    phaseEvents
      .filter(e => e.event.type === 'phase_started')
      .map(e => {
        const event = e.event as { year: number; season: string };
        return `${event.season} ${event.year}`;
      })
  );
  log('PHASES', `Total phases: ${uniquePhases.size}`);

  // LLM statistics
  const llmResponses = filterLogsByType(logs, ['llm_response']);
  const llmErrors = filterLogsByType(logs, ['llm_error']);

  const modelStats = new Map<string, { calls: number; inputTokens: number; outputTokens: number }>();
  for (const entry of llmResponses) {
    if (entry.event.type === 'llm_response') {
      const model = entry.event.model || 'unknown';
      const existing = modelStats.get(model) || { calls: 0, inputTokens: 0, outputTokens: 0 };
      existing.calls++;
      if (entry.event.usage) {
        existing.inputTokens += entry.event.usage.inputTokens;
        existing.outputTokens += entry.event.usage.outputTokens;
      }
      modelStats.set(model, existing);
    }
  }

  log('LLM', `Total LLM calls: ${llmResponses.length}`);
  log('LLM', `LLM errors: ${llmErrors.length}`);

  if (modelStats.size > 0) {
    log('LLM', 'Usage by model:');
    for (const [model, stats] of modelStats) {
      console.log(`  ${model}:`);
      console.log(`    Calls: ${stats.calls}`);
      console.log(`    Input tokens: ${stats.inputTokens.toLocaleString()}`);
      console.log(`    Output tokens: ${stats.outputTokens.toLocaleString()}`);
    }
  }

  // Order statistics
  const ordersSubmitted = filterLogsByType(logs, ['orders_submitted']);
  const validOrders = ordersSubmitted.filter(
    e => e.event.type === 'orders_submitted' && e.event.valid
  );
  const invalidOrders = ordersSubmitted.filter(
    e => e.event.type === 'orders_submitted' && !e.event.valid
  );

  log('ORDERS', `Order submissions: ${ordersSubmitted.length}`);
  log('ORDERS', `Valid: ${validOrders.length}, Invalid: ${invalidOrders.length}`);

  // Invalid order analysis by model
  const invalidStats = getInvalidOrderStats(gameId);
  console.log(formatModelStatsReport(invalidStats));

  // Lie detection analysis by model and power
  const lieStats = getLieStats(gameId);
  console.log(formatLieStatsReport(lieStats));

  // Error summary
  const errors = filterLogsByType(logs, ['error']);
  if (errors.length > 0) {
    log('ERRORS', `Total errors: ${errors.length}`);
    for (const entry of errors.slice(0, 5)) {
      if (entry.event.type === 'error') {
        console.log(`  - ${entry.event.error}`);
        if (entry.event.context) {
          console.log(`    Context: ${entry.event.context}`);
        }
      }
    }
    if (errors.length > 5) {
      console.log(`  ... and ${errors.length - 5} more errors`);
    }
  }

  // Press statistics
  const messagesSent = filterLogsByType(logs, ['message_sent']);
  const pressByPower = new Map<string, number>();
  for (const entry of messagesSent) {
    if (entry.event.type === 'message_sent') {
      const from = entry.event.from;
      pressByPower.set(from, (pressByPower.get(from) || 0) + 1);
    }
  }

  log('PRESS', `Total diplomatic messages: ${messagesSent.length}`);
  if (pressByPower.size > 0) {
    log('PRESS', 'Messages by power:');
    for (const [power, count] of pressByPower) {
      console.log(`  ${power}: ${count}`);
    }
  }
}

function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.log('Usage: npx tsx scripts/analyze-game.ts <gameId>');
    console.log('\nAvailable games:');
    for (const game of listGameLogs()) {
      console.log(`  ${game.gameId} (${(game.size / 1024).toFixed(1)} KB)`);
    }
    process.exit(0);
  }

  // Handle full path input
  let gameId = arg;
  if (arg.includes('/') || arg.includes('\\')) {
    gameId = basename(arg, '.jsonl');
  }

  analyzeGame(gameId);
}

main();
