#!/usr/bin/env npx tsx
/**
 * Test LLM models for Diplomacy order generation.
 *
 * Compares different models on their ability to:
 * 1. Generate valid ORDERS sections
 * 2. Respond within reasonable time
 * 3. Follow the required format
 *
 * Usage:
 *   npx tsx scripts/test-ollama-models.ts
 *   npx tsx scripts/test-ollama-models.ts --model mistral:7b
 *   npx tsx scripts/test-ollama-models.ts --openai --model gpt-4o-mini
 *   npx tsx scripts/test-ollama-models.ts --trials 5
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

interface TestResult {
  model: string;
  trial: number;
  success: boolean;
  responseTime: number;
  ordersFound: boolean;
  orderCount: number;
  orders: string[];
  normalizedOrders: string[];
  validOrders: number;
  error?: string;
  rawResponse?: string;
}

interface ModelStats {
  model: string;
  trials: number;
  successes: number;
  avgResponseTime: number;
  avgOrderCount: number;
  parseRate: number;
  validOrderRate: number;
}

// Sample prompt simulating a France MOVEMENT phase
const TEST_PROMPT = `You are an AI playing as FRANCE in a game of Diplomacy.

## Current Game State
**Year**: 1901 **Season**: SPRING **Phase**: MOVEMENT

### Your Units (3)
- A Paris
- A Marseilles
- F Brest

### Your Supply Centers (3)
Paris, Marseilles, Brest

### Other Powers
**ENGLAND**: 3 units, 3 SCs
  Units: A Liverpool, F London, F Edinburgh
**GERMANY**: 3 units, 3 SCs
  Units: A Berlin, A Munich, F Kiel

## Your Task: Submit Orders

**CRITICAL: You MUST start your response with "ORDERS:" followed by your orders.**

Your units that need orders:
- Army in Paris
- Army in Marseilles
- Fleet in Brest

**Required format - start with ORDERS:**
ORDERS:
A Paris HOLD
A Marseilles HOLD
F Brest HOLD

Order types: HOLD, MOVE (->), SUPPORT
Example: A Paris -> Burgundy, F Brest HOLD, A Munich SUPPORT A Paris -> Burgundy

**Your response MUST begin with "ORDERS:" on the first line.**`;

// Normalize order to standard format
function normalizeOrder(order: string): string {
  let normalized = order.trim();

  // Replace various move syntaxes with standard ->
  normalized = normalized.replace(/\s+MOVE(?:\s+TO)?\s+/i, ' -> ');
  normalized = normalized.replace(/\s+MOVES?\s+TO\s+/i, ' -> ');
  normalized = normalized.replace(/\s+-\s+/g, ' -> '); // "A Paris - Burgundy"

  // Clean up double arrows
  normalized = normalized.replace(/->\s*->/g, '->');

  // Standardize spacing around arrows
  normalized = normalized.replace(/\s*->\s*/g, ' -> ');

  return normalized;
}

// Valid order patterns (applied after normalization)
// Province names can include hyphens (e.g., Mid-Atlantic Ocean)
const ORDER_PATTERNS = [
  /^[AF]\s+[\w-]+(?:\s+[\w-]+)?\s+HOLD$/i,
  /^[AF]\s+[\w-]+(?:\s+[\w-]+)?\s*->\s*[\w-]+(?:\s+[\w-]+)?(?:\s+[\w-]+)?$/i,
  /^[AF]\s+[\w-]+(?:\s+[\w-]+)?\s+SUPPORT\s+(?:[AF]\s+)?[\w-]+(?:\s+[\w-]+)?(?:\s*->\s*[\w-]+(?:\s+[\w-]+)?)?$/i,
  /^[AF]\s+[\w-]+(?:\s+[\w-]+)?\s+CONVOY\s+[AF]\s+[\w-]+(?:\s+[\w-]+)?\s*->\s*[\w-]+(?:\s+[\w-]+)?$/i,
];

function isValidOrder(order: string): boolean {
  const normalized = normalizeOrder(order);
  return ORDER_PATTERNS.some(pattern => pattern.test(normalized));
}

function parseOrders(response: string): { orders: string[]; normalizedOrders: string[]; validCount: number } {
  const orders: string[] = [];
  const normalizedOrders: string[] = [];
  let validCount = 0;

  // Look for ORDERS: section - try multiple patterns
  let ordersSection = '';
  const ordersMatch = response.match(/ORDERS:\s*([\s\S]*?)(?:(?:\n\n)|(?:REASONING)|(?:DIPLOMACY)|(?:##)|$)/i);

  if (ordersMatch) {
    ordersSection = ordersMatch[1];
  } else {
    // Fallback: look for lines starting with A or F after any intro
    ordersSection = response;
  }

  const lines = ordersSection.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, comments, markdown, and non-order lines
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('-')) continue;

    // Check if it looks like an order (starts with A or F followed by space)
    if (/^[AF]\s+/i.test(trimmed)) {
      orders.push(trimmed);
      const normalized = normalizeOrder(trimmed);
      normalizedOrders.push(normalized);
      if (isValidOrder(trimmed)) {
        validCount++;
      }
    }
  }

  return { orders, normalizedOrders, validCount };
}

async function testOllamaModel(model: string, trial: number): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 512,
        },
      }),
    });

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      return {
        model,
        trial,
        success: false,
        responseTime,
        ordersFound: false,
        orderCount: 0,
        orders: [],
        normalizedOrders: [],
        validOrders: 0,
        error: `HTTP ${response.status}: ${error}`,
      };
    }

    const result = await response.json();
    const content = result.message?.content || '';

    const { orders, normalizedOrders, validCount } = parseOrders(content);
    const ordersFound = orders.length > 0;

    return {
      model,
      trial,
      success: ordersFound && validCount >= 3, // France has 3 units
      responseTime,
      ordersFound,
      orderCount: orders.length,
      orders,
      normalizedOrders,
      validOrders: validCount,
      rawResponse: content.substring(0, 500),
    };
  } catch (error) {
    return {
      model,
      trial,
      success: false,
      responseTime: Date.now() - startTime,
      ordersFound: false,
      orderCount: 0,
      orders: [],
      normalizedOrders: [],
      validOrders: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testOpenAIModel(model: string, trial: number): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        temperature: 0.7,
        max_tokens: 512,
      }),
    });

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      return {
        model,
        trial,
        success: false,
        responseTime,
        ordersFound: false,
        orderCount: 0,
        orders: [],
        normalizedOrders: [],
        validOrders: 0,
        error: `HTTP ${response.status}: ${error}`,
      };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';

    const { orders, normalizedOrders, validCount } = parseOrders(content);
    const ordersFound = orders.length > 0;

    return {
      model,
      trial,
      success: ordersFound && validCount >= 3, // France has 3 units
      responseTime,
      ordersFound,
      orderCount: orders.length,
      orders,
      normalizedOrders,
      validOrders: validCount,
      rawResponse: content.substring(0, 500),
    };
  } catch (error) {
    return {
      model,
      trial,
      success: false,
      responseTime: Date.now() - startTime,
      ordersFound: false,
      orderCount: 0,
      orders: [],
      normalizedOrders: [],
      validOrders: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testModel(model: string, trial: number, useOpenAI: boolean): Promise<TestResult> {
  return useOpenAI ? testOpenAIModel(model, trial) : testOllamaModel(model, trial);
}

function calculateStats(results: TestResult[]): ModelStats {
  const model = results[0].model;
  const successes = results.filter(r => r.success).length;
  const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
  const avgOrderCount = results.reduce((sum, r) => sum + r.orderCount, 0) / results.length;
  const parseRate = results.filter(r => r.ordersFound).length / results.length;
  const totalOrders = results.reduce((sum, r) => sum + r.orderCount, 0);
  const totalValidOrders = results.reduce((sum, r) => sum + r.validOrders, 0);
  const validOrderRate = totalOrders > 0 ? totalValidOrders / totalOrders : 0;

  return {
    model,
    trials: results.length,
    successes,
    avgResponseTime,
    avgOrderCount,
    parseRate,
    validOrderRate,
  };
}

function printResults(results: TestResult[], stats: ModelStats) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`MODEL: ${stats.model}`);
  console.log(`${'='.repeat(60)}`);

  console.log(`\nSummary:`);
  console.log(`  Trials: ${stats.trials}`);
  console.log(`  Success Rate: ${(stats.successes / stats.trials * 100).toFixed(1)}% (${stats.successes}/${stats.trials})`);
  console.log(`  Avg Response Time: ${(stats.avgResponseTime / 1000).toFixed(2)}s`);
  console.log(`  ORDERS Parse Rate: ${(stats.parseRate * 100).toFixed(1)}%`);
  console.log(`  Avg Order Count: ${stats.avgOrderCount.toFixed(1)}`);
  console.log(`  Valid Order Rate: ${(stats.validOrderRate * 100).toFixed(1)}%`);

  console.log(`\nTrial Details:`);
  for (const result of results) {
    const status = result.success ? '✓' : '✗';
    const time = (result.responseTime / 1000).toFixed(2);
    console.log(`  ${status} Trial ${result.trial}: ${time}s, ${result.validOrders}/${result.orderCount} valid orders`);

    if (result.orders.length > 0) {
      console.log(`    Raw: ${result.orders.join(' | ')}`);
      if (result.normalizedOrders.some((n, i) => n !== result.orders[i])) {
        console.log(`    Normalized: ${result.normalizedOrders.join(' | ')}`);
      }
    }
    if (result.error) {
      console.log(`    Error: ${result.error}`);
    }
  }
}

function parseArgs(): { models: string[]; trials: number; useOpenAI: boolean } {
  const args = process.argv.slice(2);
  let models: string[] = [];
  let trials = 3;
  let useOpenAI = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      models.push(args[i + 1]);
      i++;
    } else if (args[i] === '--trials' && args[i + 1]) {
      trials = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--openai') {
      useOpenAI = true;
    }
  }

  // Default models if none specified
  if (models.length === 0) {
    models = useOpenAI ? ['gpt-4o-mini', 'gpt-4o'] : ['llama3.2:1b', 'mistral:7b'];
  }

  return { models, trials, useOpenAI };
}

async function checkOllama(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

async function listAvailableModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.models?.map((m: { name: string }) => m.name) || [];
  } catch {
    return [];
  }
}

async function main() {
  const { models, trials, useOpenAI } = parseArgs();

  if (useOpenAI) {
    console.log('🧪 OpenAI Model Testing for Diplomacy Order Generation');
    console.log('======================================================\n');

    if (!OPENAI_API_KEY) {
      console.error('Error: OPENAI_API_KEY environment variable not set');
      console.error('Set it with: export OPENAI_API_KEY=sk-...');
      process.exit(1);
    }

    console.log(`Testing OpenAI models: ${models.join(', ')}`);
    console.log(`Trials per model: ${trials}\n`);
  } else {
    console.log('🧪 Ollama Model Testing for Diplomacy Order Generation');
    console.log('======================================================\n');

    // Check Ollama is running
    const ollamaRunning = await checkOllama();
    if (!ollamaRunning) {
      console.error('Error: Cannot connect to Ollama at', OLLAMA_BASE_URL);
      console.error('Make sure Ollama is running: ollama serve');
      process.exit(1);
    }

    const available = await listAvailableModels();
    console.log(`Available models: ${available.join(', ')}\n`);

    // Verify requested models are available
    for (const model of models) {
      if (!available.includes(model)) {
        console.warn(`Warning: Model "${model}" not found. Pull it with: ollama pull ${model}`);
      }
    }

    console.log(`Testing models: ${models.join(', ')}`);
    console.log(`Trials per model: ${trials}\n`);
  }

  const allStats: ModelStats[] = [];

  for (const model of models) {
    if (!useOpenAI) {
      const available = await listAvailableModels();
      if (!available.includes(model)) {
        console.log(`\nSkipping ${model} (not available)`);
        continue;
      }
    }

    console.log(`\nTesting ${model}...`);
    const results: TestResult[] = [];

    for (let i = 1; i <= trials; i++) {
      process.stdout.write(`  Trial ${i}/${trials}...`);
      const result = await testModel(model, i, useOpenAI);
      results.push(result);
      console.log(` ${result.success ? '✓' : '✗'} (${(result.responseTime / 1000).toFixed(2)}s)`);
    }

    const stats = calculateStats(results);
    allStats.push(stats);
    printResults(results, stats);
  }

  // Print comparison
  if (allStats.length > 1) {
    console.log('\n' + '='.repeat(60));
    console.log('MODEL COMPARISON');
    console.log('='.repeat(60));
    console.log('\n| Model | Success | Avg Time | Parse Rate | Valid Orders |');
    console.log('|-------|---------|----------|------------|--------------|');

    for (const stats of allStats) {
      const successPct = (stats.successes / stats.trials * 100).toFixed(0);
      const time = (stats.avgResponseTime / 1000).toFixed(1);
      const parsePct = (stats.parseRate * 100).toFixed(0);
      const validPct = (stats.validOrderRate * 100).toFixed(0);
      console.log(`| ${stats.model.padEnd(13)} | ${successPct.padStart(5)}% | ${time.padStart(6)}s | ${parsePct.padStart(8)}% | ${validPct.padStart(10)}% |`);
    }

    // Recommendation
    console.log('\n📊 Recommendation:');
    const best = allStats.reduce((a, b) =>
      (a.successes / a.trials > b.successes / b.trials) ? a : b
    );
    console.log(`  Best model for order generation: ${best.model}`);
    console.log(`  Success rate: ${(best.successes / best.trials * 100).toFixed(0)}%`);
    console.log(`  Avg response time: ${(best.avgResponseTime / 1000).toFixed(2)}s`);
  }
}

main().catch(console.error);
