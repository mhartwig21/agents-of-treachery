#!/usr/bin/env npx tsx
/**
 * Model comparison test script for Diplomacy AI agents.
 *
 * Tests different Ollama models for:
 * - Order parsing success rates
 * - Inference speed (with GPU acceleration)
 * - Response quality
 *
 * Usage:
 *   npx tsx scripts/test-models.ts
 *   npx tsx scripts/test-models.ts --model mistral:7b
 *   npx tsx scripts/test-models.ts --all
 */

import { parseAgentResponse, extractOrdersSection } from '../src/agent/order-parser';
import { buildSystemPrompt, buildTurnPrompt } from '../src/agent/prompts';
import { createInitialMemory } from '../src/agent/memory';
import { createAgentGameView } from '../src/agent/game-view';
import { POWERS, type Power, type GameState, type Unit } from '../src/engine/types';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

interface TestResult {
  model: string;
  power: Power;
  responseTime: number;
  hasOrdersSection: boolean;
  parsedOrders: number;
  parseErrors: string[];
  rawResponse: string;
  gpuUsed: boolean;
  vramMB: number;
}

interface ModelSummary {
  model: string;
  totalTests: number;
  ordersSuccessRate: number;
  avgResponseTime: number;
  avgParsedOrders: number;
  parseErrorRate: number;
}

/**
 * Creates a mock initial game state for testing.
 */
function createTestGameState(): GameState {
  const units: Unit[] = [
    // England
    { power: 'ENGLAND', type: 'FLEET', province: 'LON' },
    { power: 'ENGLAND', type: 'FLEET', province: 'EDI' },
    { power: 'ENGLAND', type: 'ARMY', province: 'LVP' },
    // France
    { power: 'FRANCE', type: 'ARMY', province: 'PAR' },
    { power: 'FRANCE', type: 'ARMY', province: 'MAR' },
    { power: 'FRANCE', type: 'FLEET', province: 'BRE' },
    // Germany
    { power: 'GERMANY', type: 'ARMY', province: 'BER' },
    { power: 'GERMANY', type: 'ARMY', province: 'MUN' },
    { power: 'GERMANY', type: 'FLEET', province: 'KIE' },
    // Italy
    { power: 'ITALY', type: 'ARMY', province: 'ROM' },
    { power: 'ITALY', type: 'ARMY', province: 'VEN' },
    { power: 'ITALY', type: 'FLEET', province: 'NAP' },
    // Austria
    { power: 'AUSTRIA', type: 'ARMY', province: 'VIE' },
    { power: 'AUSTRIA', type: 'ARMY', province: 'BUD' },
    { power: 'AUSTRIA', type: 'FLEET', province: 'TRI' },
    // Russia
    { power: 'RUSSIA', type: 'ARMY', province: 'MOS' },
    { power: 'RUSSIA', type: 'ARMY', province: 'WAR' },
    { power: 'RUSSIA', type: 'FLEET', province: 'SEV' },
    { power: 'RUSSIA', type: 'FLEET', province: 'STP', coast: 'SOUTH' },
    // Turkey
    { power: 'TURKEY', type: 'ARMY', province: 'CON' },
    { power: 'TURKEY', type: 'ARMY', province: 'SMY' },
    { power: 'TURKEY', type: 'FLEET', province: 'ANK' },
  ];

  const supplyCenters = new Map<string, Power | null>([
    ['LON', 'ENGLAND'], ['EDI', 'ENGLAND'], ['LVP', 'ENGLAND'],
    ['PAR', 'FRANCE'], ['MAR', 'FRANCE'], ['BRE', 'FRANCE'],
    ['BER', 'GERMANY'], ['MUN', 'GERMANY'], ['KIE', 'GERMANY'],
    ['ROM', 'ITALY'], ['VEN', 'ITALY'], ['NAP', 'ITALY'],
    ['VIE', 'AUSTRIA'], ['BUD', 'AUSTRIA'], ['TRI', 'AUSTRIA'],
    ['MOS', 'RUSSIA'], ['WAR', 'RUSSIA'], ['SEV', 'RUSSIA'], ['STP', 'RUSSIA'],
    ['CON', 'TURKEY'], ['SMY', 'TURKEY'], ['ANK', 'TURKEY'],
    // Neutral SCs
    ['NWY', null], ['SWE', null], ['DEN', null], ['HOL', null], ['BEL', null],
    ['SPA', null], ['POR', null], ['TUN', null], ['SER', null], ['GRE', null],
    ['RUM', null], ['BUL', null],
  ]);

  return {
    year: 1901,
    season: 'SPRING',
    phase: 'DIPLOMACY',
    units,
    supplyCenters,
    dislodgedUnits: [],
    retreatOptions: new Map(),
    buildCounts: new Map(),
    pendingRetreats: [],
  };
}

/**
 * Call Ollama API for completion.
 */
async function callOllama(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; durationMs: number }> {
  const startTime = Date.now();

  const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const durationMs = Date.now() - startTime;

  return { content, durationMs };
}

/**
 * Check if GPU is being used by Ollama.
 */
async function checkGpuUsage(): Promise<{ used: boolean; vramBytes: number }> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/ps`);
    if (!response.ok) return { used: false, vramBytes: 0 };
    const data = await response.json();
    // Check if any model is loaded into VRAM
    for (const model of data.models || []) {
      if (model.size_vram && model.size_vram > 0) {
        return { used: true, vramBytes: model.size_vram };
      }
    }
    return { used: false, vramBytes: 0 };
  } catch {
    return { used: false, vramBytes: 0 };
  }
}

/**
 * Run a single test for a model and power.
 */
async function runTest(model: string, power: Power): Promise<TestResult> {
  const gameState = createTestGameState();
  const memory = createInitialMemory(power, 'test-game');
  const personality = {
    cooperativeness: 0.5,
    aggression: 0.5,
    patience: 0.5,
    trustworthiness: 0.7,
    paranoia: 0.3,
    deceptiveness: 0.3,
  };

  const systemPrompt = buildSystemPrompt(power, personality);
  const gameView = createAgentGameView(gameState, power);
  const turnPrompt = buildTurnPrompt(gameView, memory, []);

  const { content, durationMs } = await callOllama(model, systemPrompt, turnPrompt);
  const gpuInfo = await checkGpuUsage();

  // Parse the response
  const ordersSection = extractOrdersSection(content);
  const parseResult = parseAgentResponse(content);

  return {
    model,
    power,
    responseTime: durationMs,
    hasOrdersSection: ordersSection !== null,
    parsedOrders: parseResult.orders.length,
    parseErrors: parseResult.errors,
    rawResponse: content,
    gpuUsed: gpuInfo.used,
    vramMB: Math.round(gpuInfo.vramBytes / 1024 / 1024),
  };
}

/**
 * Run all tests for a model.
 */
async function runModelTests(model: string, powersToTest: Power[]): Promise<TestResult[]> {
  const results: TestResult[] = [];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing model: ${model}`);
  console.log(`${'='.repeat(60)}\n`);

  for (const power of powersToTest) {
    process.stdout.write(`  Testing ${power}... `);
    try {
      const result = await runTest(model, power);
      results.push(result);
      const status = result.hasOrdersSection ? '✓' : '✗';
      const gpu = result.gpuUsed ? `🖥️ GPU (${result.vramMB}MB)` : '💻 CPU';
      console.log(`${status} ${result.responseTime}ms, ${result.parsedOrders} orders parsed ${gpu}`);

      if (result.parseErrors.length > 0) {
        console.log(`    Errors: ${result.parseErrors.slice(0, 3).join(', ')}`);
      }
    } catch (error) {
      console.log(`✗ ERROR: ${error}`);
      results.push({
        model,
        power,
        responseTime: 0,
        hasOrdersSection: false,
        parsedOrders: 0,
        parseErrors: [String(error)],
        rawResponse: '',
        gpuUsed: false,
        vramMB: 0,
      });
    }
  }

  return results;
}

/**
 * Summarize results for a model.
 */
function summarizeModel(results: TestResult[]): ModelSummary {
  const model = results[0]?.model || 'unknown';
  const totalTests = results.length;
  const successfulTests = results.filter(r => r.hasOrdersSection);
  const ordersSuccessRate = (successfulTests.length / totalTests) * 100;
  const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / totalTests;
  const avgParsedOrders = results.reduce((sum, r) => sum + r.parsedOrders, 0) / totalTests;
  const totalErrors = results.reduce((sum, r) => sum + r.parseErrors.length, 0);
  const totalPossibleOrders = results.reduce((sum, r) => sum + r.parsedOrders + r.parseErrors.length, 0);
  const parseErrorRate = totalPossibleOrders > 0 ? (totalErrors / totalPossibleOrders) * 100 : 0;

  return {
    model,
    totalTests,
    ordersSuccessRate,
    avgResponseTime,
    avgParsedOrders,
    parseErrorRate,
  };
}

/**
 * Print detailed sample response.
 */
function printSampleResponse(result: TestResult): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Sample response from ${result.model} (${result.power}):`);
  console.log(`${'─'.repeat(60)}`);
  console.log(result.rawResponse.slice(0, 1500));
  if (result.rawResponse.length > 1500) {
    console.log('... [truncated]');
  }
  console.log(`${'─'.repeat(60)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  let modelsToTest: string[] = [];
  let testAllPowers = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      modelsToTest.push(args[i + 1]);
      i++;
    } else if (args[i] === '--all') {
      testAllPowers = true;
    }
  }

  // Default models if none specified
  if (modelsToTest.length === 0) {
    modelsToTest = ['llama3.2:1b', 'mistral:7b'];
  }

  // Test 3 powers by default, all 7 if --all
  const powersToTest: Power[] = testAllPowers
    ? [...POWERS]
    : ['ENGLAND', 'FRANCE', 'GERMANY'];

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Diplomacy AI Model Comparison Test                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nModels: ${modelsToTest.join(', ')}`);
  console.log(`Powers: ${powersToTest.join(', ')}`);
  console.log(`Ollama URL: ${OLLAMA_BASE_URL}`);

  // Check GPU status
  console.log('\nChecking GPU status...');
  try {
    const { execSync } = await import('child_process');
    const gpuInfo = execSync('nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader', {
      encoding: 'utf-8',
    }).trim();
    console.log(`GPU: ${gpuInfo}`);
  } catch {
    console.log('GPU: Not available or nvidia-smi not found');
  }

  const allResults: Map<string, TestResult[]> = new Map();

  for (const model of modelsToTest) {
    const results = await runModelTests(model, powersToTest);
    allResults.set(model, results);

    // Print a sample response
    const successfulResult = results.find(r => r.hasOrdersSection);
    if (successfulResult) {
      printSampleResponse(successfulResult);
    }
  }

  // Print summary table
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('Model             | Orders OK | Avg Time | Avg Orders | Parse Err');
  console.log('─'.repeat(70));

  for (const [model, results] of allResults) {
    const summary = summarizeModel(results);
    console.log(
      `${summary.model.padEnd(17)} | ` +
      `${summary.ordersSuccessRate.toFixed(0).padStart(6)}%   | ` +
      `${summary.avgResponseTime.toFixed(0).padStart(6)}ms | ` +
      `${summary.avgParsedOrders.toFixed(1).padStart(10)} | ` +
      `${summary.parseErrorRate.toFixed(0).padStart(6)}%`
    );
  }

  // Recommendations
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                 RECOMMENDATIONS                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const summaries = Array.from(allResults.entries()).map(([, results]) => summarizeModel(results));
  const bestByOrders = summaries.reduce((a, b) => a.ordersSuccessRate > b.ordersSuccessRate ? a : b);
  const bestBySpeed = summaries.reduce((a, b) => a.avgResponseTime < b.avgResponseTime ? a : b);

  console.log(`Best for order parsing: ${bestByOrders.model} (${bestByOrders.ordersSuccessRate.toFixed(0)}% success)`);
  console.log(`Fastest inference: ${bestBySpeed.model} (${bestBySpeed.avgResponseTime.toFixed(0)}ms avg)`);

  // GPU usage summary
  const anyGpuUsed = Array.from(allResults.values()).flat().some(r => r.gpuUsed);
  console.log(`\nGPU acceleration: ${anyGpuUsed ? '✓ Active' : '✗ Not detected'}`);
}

main().catch(console.error);
