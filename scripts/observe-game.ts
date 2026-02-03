/**
 * Game Observer Script
 *
 * Connects to game server, starts a game, and observes AI agent behavior.
 * Outputs detailed logs for QA analysis.
 */

import WebSocket from 'ws';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3001';
const GAME_NAME = process.env.GAME_NAME || `Test Game ${Date.now()}`;
const MAX_PHASES = parseInt(process.env.MAX_PHASES || '20', 10);

interface GameSnapshot {
  phase: string;
  year: number;
  season: string;
  orders: Record<string, unknown[]>;
  messages: Array<{
    id: string;
    from: string;
    to: string | string[];
    content: string;
    timestamp: string;
    channel?: string;
  }>;
  territories: Record<string, { owner?: string; unit?: unknown }>;
}

interface GameHistory {
  gameId: string;
  name: string;
  status: string;
  currentPhase: string;
  snapshots: GameSnapshot[];
}

let ws: WebSocket;
let gameId: string | null = null;
let phaseCount = 0;
let lastPhase = '';
let allMessages: Array<{phase: string; from: string; to: string | string[]; content: string}> = [];
let allOrders: Array<{phase: string; power: string; orders: string[]}> = [];
let phaseSnapshots: Map<string, GameSnapshot> = new Map();

function log(category: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] [${category}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function analyzePress(messages: GameSnapshot['messages'], phase: string) {
  if (messages.length === 0) {
    log('PRESS', `Phase ${phase}: NO PRESS SENT`);
    return { count: 0, issues: ['No press messages this phase'] };
  }

  const issues: string[] = [];
  const byPower: Record<string, number> = {};

  for (const msg of messages) {
    byPower[msg.from] = (byPower[msg.from] || 0) + 1;

    // Check for empty or very short messages
    if (!msg.content || msg.content.trim().length < 10) {
      issues.push(`${msg.from}: Empty or too short message`);
    }

    // Check for generic/template messages
    if (msg.content.includes('[PLACEHOLDER]') || msg.content.includes('TODO')) {
      issues.push(`${msg.from}: Template/placeholder text found`);
    }

    // Store for cross-phase analysis
    allMessages.push({ phase, from: msg.from, to: msg.to, content: msg.content });
  }

  log('PRESS', `Phase ${phase}: ${messages.length} messages`, {
    byPower,
    sampleMessages: messages.slice(0, 3).map(m => ({
      from: m.from,
      to: m.to,
      preview: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : '')
    }))
  });

  // Check which powers didn't send any press
  const allPowers = ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'];
  const silentPowers = allPowers.filter(p => !byPower[p]);
  if (silentPowers.length > 0) {
    log('PRESS', `Silent powers (no messages): ${silentPowers.join(', ')}`);
  }

  return { count: messages.length, issues, byPower, silentPowers };
}

function analyzeOrders(snapshot: GameSnapshot, phase: string) {
  const orders = snapshot.orders || {};
  const issues: string[] = [];
  let totalOrders = 0;
  let holdCount = 0;

  for (const [power, powerOrders] of Object.entries(orders)) {
    const orderList = powerOrders as Array<{type: string; unit?: string; from?: string; to?: string}>;
    totalOrders += orderList.length;

    // Count HOLDs
    const holds = orderList.filter(o => o.type === 'HOLD' || o.type === 'hold');
    holdCount += holds.length;

    if (orderList.length === 0) {
      issues.push(`${power}: No orders submitted`);
    } else if (holds.length === orderList.length) {
      issues.push(`${power}: All units holding (${holds.length} holds)`);
    }

    // Store for analysis
    allOrders.push({
      phase,
      power,
      orders: orderList.map(o => `${o.unit || '?'} ${o.type} ${o.to || o.from || ''}`.trim())
    });
  }

  const holdRatio = totalOrders > 0 ? (holdCount / totalOrders * 100).toFixed(1) : 'N/A';
  log('ORDERS', `Phase ${phase}: ${totalOrders} orders (${holdCount} holds, ${holdRatio}% hold rate)`, {
    byPower: Object.fromEntries(
      Object.entries(orders).map(([p, o]) => [p, (o as unknown[]).length])
    )
  });

  if (holdCount === totalOrders && totalOrders > 0) {
    log('ORDERS', '⚠️  ALL ORDERS ARE HOLDS - Agents may not be generating real orders');
  }

  return { totalOrders, holdCount, issues };
}

function analyzeTerritoriesAndSupplyCenters(snapshot: GameSnapshot, phase: string) {
  const territories = snapshot.territories || {};
  const supplyCenters: Record<string, number> = {};
  const units: Record<string, number> = {};

  for (const [terrId, terr] of Object.entries(territories)) {
    if (terr.owner) {
      supplyCenters[terr.owner] = (supplyCenters[terr.owner] || 0) + 1;
    }
    if (terr.unit) {
      const unitPower = (terr.unit as {power?: string}).power || 'unknown';
      units[unitPower] = (units[unitPower] || 0) + 1;
    }
  }

  log('BOARD', `Phase ${phase} - Supply Centers:`, supplyCenters);
  log('BOARD', `Phase ${phase} - Unit counts:`, units);

  // Check for victory condition (18 supply centers)
  for (const [power, count] of Object.entries(supplyCenters)) {
    if (count >= 18) {
      log('VICTORY', `🏆 ${power} has won with ${count} supply centers!`);
      return { victory: true, winner: power };
    }
  }

  return { victory: false, supplyCenters, units };
}

function analyzeContinuity() {
  log('CONTINUITY', 'Analyzing cross-phase continuity...');

  // Check if powers reference past events
  const referencesToPast: string[] = [];
  const keywords = ['last turn', 'previous', 'betrayed', 'backstab', 'promised', 'agreed', 'alliance', 'trust'];

  for (const msg of allMessages) {
    const lower = msg.content.toLowerCase();
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        referencesToPast.push(`${msg.phase} - ${msg.from}: "${msg.content.substring(0, 80)}..."`);
        break;
      }
    }
  }

  if (referencesToPast.length > 0) {
    log('CONTINUITY', `Found ${referencesToPast.length} messages referencing past events:`,
      referencesToPast.slice(0, 5));
  } else {
    log('CONTINUITY', '⚠️  No messages found referencing past events - agents may lack memory');
  }
}

function handleMessage(data: string) {
  try {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'GAME_LIST':
        log('SERVER', `Received game list: ${msg.games.length} games`);
        break;

      case 'GAME_CREATED':
        gameId = msg.game.gameId;
        log('GAME', `Game created: ${gameId}`);
        log('GAME', `Name: ${msg.game.name}`);
        break;

      case 'GAME_UPDATED':
        log('GAME', `Game updated: ${msg.gameId}`, msg.updates);
        break;

      case 'SNAPSHOT_ADDED':
        const snapshot = msg.snapshot as GameSnapshot;
        const phaseKey = `${snapshot.season} ${snapshot.year}`;

        if (phaseKey !== lastPhase) {
          phaseCount++;
          lastPhase = phaseKey;
          log('PHASE', `\n${'='.repeat(60)}`);
          log('PHASE', `NEW PHASE: ${phaseKey} (Phase #${phaseCount})`);
          log('PHASE', `${'='.repeat(60)}`);

          // Analyze this phase
          analyzePress(snapshot.messages || [], phaseKey);
          analyzeOrders(snapshot, phaseKey);
          const boardState = analyzeTerritoriesAndSupplyCenters(snapshot, phaseKey);

          phaseSnapshots.set(phaseKey, snapshot);

          if (boardState.victory) {
            log('GAME', 'Game ended with victory!');
            setTimeout(() => {
              analyzeContinuity();
              printSummary();
              process.exit(0);
            }, 1000);
          }

          if (phaseCount >= MAX_PHASES) {
            log('GAME', `Reached max phases (${MAX_PHASES}), stopping observation`);
            setTimeout(() => {
              analyzeContinuity();
              printSummary();
              process.exit(0);
            }, 1000);
          }
        }
        break;

      case 'GAME_ENDED':
        log('GAME', `Game ended: ${msg.gameId}`, { winner: msg.winner, draw: msg.draw });
        analyzeContinuity();
        printSummary();
        setTimeout(() => process.exit(0), 1000);
        break;

      case 'ERROR':
        log('ERROR', msg.message);
        break;
    }
  } catch (e) {
    log('ERROR', `Failed to parse message: ${e}`);
  }
}

function printSummary() {
  log('SUMMARY', '\n' + '='.repeat(60));
  log('SUMMARY', 'GAME OBSERVATION SUMMARY');
  log('SUMMARY', '='.repeat(60));
  log('SUMMARY', `Total phases observed: ${phaseCount}`);
  log('SUMMARY', `Total press messages: ${allMessages.length}`);
  log('SUMMARY', `Total order sets: ${allOrders.length}`);

  // Calculate hold rate
  let totalOrders = 0;
  let totalHolds = 0;
  for (const orderSet of allOrders) {
    for (const order of orderSet.orders) {
      totalOrders++;
      if (order.toLowerCase().includes('hold')) {
        totalHolds++;
      }
    }
  }

  log('SUMMARY', `Overall hold rate: ${(totalHolds / totalOrders * 100).toFixed(1)}%`);

  // Press per power
  const pressByPower: Record<string, number> = {};
  for (const msg of allMessages) {
    pressByPower[msg.from] = (pressByPower[msg.from] || 0) + 1;
  }
  log('SUMMARY', 'Press messages by power:', pressByPower);
}

async function main() {
  log('START', `Connecting to ${SERVER_URL}...`);

  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    log('CONNECT', 'Connected to game server');

    // Start a new game
    log('GAME', `Starting new game: ${GAME_NAME}`);
    ws.send(JSON.stringify({ type: 'START_GAME', name: GAME_NAME }));
  });

  ws.on('message', (data) => {
    handleMessage(data.toString());
  });

  ws.on('close', () => {
    log('CONNECT', 'Disconnected from server');
    printSummary();
    process.exit(0);
  });

  ws.on('error', (err) => {
    log('ERROR', `WebSocket error: ${err.message}`);
    process.exit(1);
  });
}

main().catch(console.error);
