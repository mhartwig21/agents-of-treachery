#!/usr/bin/env npx tsx
/**
 * CLI tool to view game logs.
 *
 * Usage:
 *   npx tsx src/server/view-logs.ts                  # List all game logs
 *   npx tsx src/server/view-logs.ts <gameId>         # View logs for a specific game
 *   npx tsx src/server/view-logs.ts <gameId> --errors  # View only errors
 *   npx tsx src/server/view-logs.ts <gameId> --tail 20 # View last 20 entries
 *   npx tsx src/server/view-logs.ts <gameId> --type llm_response  # Filter by type
 */

import {
  listGameLogs,
  readGameLogs,
  readRecentGameLogs,
  getGameErrors,
  filterLogsByType,
  type GameLogEntry,
  type GameLogEvent,
} from './game-logger';

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleTimeString();
}

function formatEvent(entry: GameLogEntry): string {
  const time = formatTimestamp(entry.timestamp);
  const event = entry.event;

  switch (event.type) {
    case 'game_started':
      return `${time} [START] Game: ${event.name} (${event.powers?.length || 7} powers)`;
    case 'game_ended':
      return `${time} [END] Winner: ${event.winner || 'none'}, Draw: ${event.draw || false}, Reason: ${event.reason || ''}`;
    case 'phase_started':
      return `${time} [PHASE] ${event.season} ${event.year} - ${event.phase}`;
    case 'phase_resolved':
      return `${time} [RESOLVED] ${event.season} ${event.year} - ${event.phase}`;
    case 'agent_turn_started':
      return `${time} [TURN] ${event.power} started`;
    case 'agent_turn_completed':
      return `${time} [TURN] ${event.power} completed (${event.durationMs}ms)`;
    case 'llm_request':
      return `${time} [LLM->] ${event.power}: ${event.messageCount} messages, model=${event.model || 'default'}`;
    case 'llm_response':
      return `${time} [LLM<-] ${event.power}: ${event.durationMs}ms, tokens=${event.usage?.inputTokens || 0}/${event.usage?.outputTokens || 0}`;
    case 'llm_error':
      return `${time} [LLM!] ${event.power}: ${event.error}`;
    case 'orders_parsed':
      return `${time} [PARSE] ${event.power}: ${event.orders?.length || 0} orders`;
    case 'orders_submitted':
      return `${time} [ORDERS] ${event.power}: ${event.orders?.join(', ') || 'none'} (valid=${event.valid})`;
    case 'message_sent':
      return `${time} [MSG] ${event.from} -> ${Array.isArray(event.to) ? event.to.join(',') : event.to}: "${event.preview}"`;
    case 'error':
      return `${time} [ERROR] ${event.error} (${event.context || 'no context'})`;
    case 'warning':
      return `${time} [WARN] ${event.message}`;
    case 'debug':
      return `${time} [DEBUG] ${event.message}`;
    default:
      return `${time} [?] ${JSON.stringify(event)}`;
  }
}

function printLogs(logs: GameLogEntry[]): void {
  for (const entry of logs) {
    console.log(formatEvent(entry));
  }
}

function main() {
  const args = process.argv.slice(2);

  // No args - list all game logs
  if (args.length === 0) {
    const logs = listGameLogs();
    if (logs.length === 0) {
      console.log('No game logs found in logs/games/');
      console.log('Logs are created when games are started via the game server.');
      return;
    }
    console.log('Available game logs:');
    console.log('─'.repeat(60));
    for (const log of logs) {
      const sizeKB = (log.size / 1024).toFixed(1);
      console.log(`  ${log.gameId} (${sizeKB} KB)`);
    }
    console.log('─'.repeat(60));
    console.log(`\nUse: npx tsx src/server/view-logs.ts <gameId>`);
    return;
  }

  const gameId = args[0];
  const hasErrors = args.includes('--errors');
  const tailIdx = args.indexOf('--tail');
  const typeIdx = args.indexOf('--type');

  let logs: GameLogEntry[];

  if (hasErrors) {
    logs = getGameErrors(gameId);
    console.log(`Errors for game ${gameId}:`);
  } else if (tailIdx !== -1) {
    const count = parseInt(args[tailIdx + 1] || '20', 10);
    logs = readRecentGameLogs(gameId, count);
    console.log(`Last ${count} entries for game ${gameId}:`);
  } else {
    logs = readGameLogs(gameId);
    console.log(`All logs for game ${gameId}:`);
  }

  if (typeIdx !== -1) {
    const types = args[typeIdx + 1]?.split(',') as GameLogEvent['type'][];
    logs = filterLogsByType(logs, types);
    console.log(`Filtered by type: ${types.join(', ')}`);
  }

  if (logs.length === 0) {
    console.log('No log entries found.');
    return;
  }

  console.log('─'.repeat(60));
  printLogs(logs);
  console.log('─'.repeat(60));
  console.log(`Total: ${logs.length} entries`);
}

main();
