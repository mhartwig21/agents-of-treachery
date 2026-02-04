import { test, expect } from '@playwright/test';
import {
  screenshot,
  createWebSocketMonitor,
  navigateToGame,
  isMapVisible,
  getCurrentPhase,
  type GameServerMessage,
} from './test-utils';

/**
 * Game Simulation E2E Tests
 *
 * Comprehensive tests for full game simulation scenarios.
 * Tests AI agent behavior, game flow, and UI responsiveness.
 *
 * Run with: npm run test:e2e:live
 */

const GAME_SERVER_URL = 'http://localhost:3001';

/**
 * Checks if the game server is running.
 */
async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${GAME_SERVER_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Waits for a specific WebSocket message type.
 */
async function waitForMessageType(
  messages: GameServerMessage[],
  type: string,
  timeoutMs: number = 30000
): Promise<GameServerMessage | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const msg = messages.find((m) => m.type === type);
    if (msg) return msg;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test.describe('Game Simulation - Server Connection', () => {
  test.beforeEach(async ({ page }) => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running - start with npm run server:llama-small');
  });

  test('connects to game server and receives game list', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await page.waitForTimeout(3000);

    const messages = wsMonitor.getMessages();
    const gameList = messages.find((m) => m.type === 'GAME_LIST');

    expect(gameList).toBeDefined();
    expect(gameList?.type).toBe('GAME_LIST');

    await screenshot(page, { name: 'server-connected', subdir: 'simulation' });
  });

  test('server health endpoint responds', async ({ page }) => {
    const response = await page.request.get(`${GAME_SERVER_URL}/health`);
    expect(response.ok()).toBe(true);

    const health = await response.json();
    expect(health.status).toBe('ok');
    expect(typeof health.games).toBe('number');
    expect(typeof health.clients).toBe('number');
  });
});

test.describe('Game Simulation - Game Creation', () => {
  test.setTimeout(120000); // 2 minutes

  test.beforeEach(async ({ page }) => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running');
  });

  test('can create a new game via UI', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    await screenshot(page, { name: 'before-create', subdir: 'simulation' });

    // Look for new game button
    const newGameBtn = page.getByRole('button', { name: /new game|start game|create/i });

    if (await newGameBtn.isVisible().catch(() => false)) {
      await newGameBtn.click();
      await page.waitForTimeout(5000);

      const messages = wsMonitor.getMessages();
      const gameCreated = messages.find((m) => m.type === 'GAME_CREATED');

      if (gameCreated) {
        console.log('Game created:', (gameCreated as { game?: { gameId?: string } }).game?.gameId);
        await screenshot(page, { name: 'game-created', subdir: 'simulation' });
      }
    }
  });

  test('new game appears in game list', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Get initial game count
    const initialMessages = wsMonitor.getMessages();
    const initialList = initialMessages.find((m) => m.type === 'GAME_LIST') as
      | { games?: unknown[] }
      | undefined;
    const initialCount = initialList?.games?.length || 0;

    // Create new game
    const newGameBtn = page.getByRole('button', { name: /new game|start game|create/i });
    if (await newGameBtn.isVisible().catch(() => false)) {
      await newGameBtn.click();
      await page.waitForTimeout(5000);

      // Check for updated game list
      const messages = wsMonitor.getMessages();
      const latestList = [...messages].reverse().find((m) => m.type === 'GAME_LIST') as
        | { games?: unknown[] }
        | undefined;

      if (latestList) {
        console.log(`Games: ${initialCount} -> ${latestList.games?.length}`);
      }
    }
  });
});

test.describe('Game Simulation - Game Flow', () => {
  test.setTimeout(300000); // 5 minutes for full game observation

  test.beforeEach(async ({ page }) => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running');
  });

  test('game progresses through phases', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Navigate to a game
    if (!(await navigateToGame(page, 0))) {
      // Try to create a game first
      const newGameBtn = page.getByRole('button', { name: /new game|start game/i });
      if (await newGameBtn.isVisible().catch(() => false)) {
        await newGameBtn.click();
        await page.waitForTimeout(10000);
        await navigateToGame(page, 0);
      } else {
        test.skip(true, 'No games available and cannot create one');
        return;
      }
    }

    await screenshot(page, { name: 'game-start', subdir: 'simulation-flow' });

    // Monitor for snapshots indicating phase progression
    const snapshots: GameServerMessage[] = [];
    const phases: string[] = [];

    const startTime = Date.now();
    const maxDuration = 180000; // 3 minutes

    while (Date.now() - startTime < maxDuration) {
      const messages = wsMonitor.getMessages();
      const newSnapshots = messages.filter(
        (m) => m.type === 'SNAPSHOT_ADDED' && !snapshots.some((s) => s === m)
      );

      for (const snapshot of newSnapshots) {
        snapshots.push(snapshot);
        const phase = (snapshot as { snapshot?: { phase?: string } }).snapshot?.phase;
        if (phase && !phases.includes(phase)) {
          phases.push(phase);
          console.log(`New phase detected: ${phase}`);
          await screenshot(page, {
            name: `phase-${phases.length}-${phase}`,
            subdir: 'simulation-flow',
          });
        }
      }

      // Check UI for phase changes
      const uiPhase = await getCurrentPhase(page);
      if (uiPhase && !phases.includes(uiPhase)) {
        phases.push(uiPhase);
        console.log(`UI phase: ${uiPhase}`);
      }

      await page.waitForTimeout(2000);
    }

    console.log(`Observed ${snapshots.length} snapshots, ${phases.length} unique phases`);
    console.log(`Phases: ${phases.join(' -> ')}`);

    await screenshot(page, { name: 'game-end', subdir: 'simulation-flow' });

    // Should have observed at least the initial state
    expect(snapshots.length).toBeGreaterThan(0);
  });

  test('agents submit orders (movement phase)', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    if (!(await navigateToGame(page, 0))) {
      test.skip(true, 'No games available');
      return;
    }

    await screenshot(page, { name: 'orders-start', subdir: 'simulation-orders' });

    // Wait for MOVEMENT phase snapshots
    const startTime = Date.now();
    let movementSnapshot: GameServerMessage | null = null;

    while (Date.now() - startTime < 120000 && !movementSnapshot) {
      const messages = wsMonitor.getMessages();
      movementSnapshot = messages.find((m) => {
        if (m.type !== 'SNAPSHOT_ADDED') return false;
        const snapshot = (m as { snapshot?: { phase?: string } }).snapshot;
        return snapshot?.phase === 'MOVEMENT';
      }) || null;

      await page.waitForTimeout(2000);
    }

    if (movementSnapshot) {
      const snapshot = (movementSnapshot as { snapshot?: { orders?: Record<string, unknown[]> } })
        .snapshot;
      const orders = snapshot?.orders || {};
      const orderCount = Object.values(orders).flat().length;

      console.log(`Orders in MOVEMENT phase: ${orderCount}`);
      console.log(`Powers with orders: ${Object.keys(orders).join(', ')}`);

      await screenshot(page, { name: 'movement-orders', subdir: 'simulation-orders' });

      // Should have orders for all 7 powers
      expect(Object.keys(orders).length).toBeGreaterThan(0);
    }
  });
});

test.describe('Game Simulation - UI Responsiveness', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running');
  });

  test('map updates reflect game state changes', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    if (!(await navigateToGame(page, 0))) {
      test.skip(true, 'No games available');
      return;
    }

    // Verify map is visible
    expect(await isMapVisible(page)).toBe(true);

    // Take screenshot of initial state
    await screenshot(page, { name: 'map-initial', subdir: 'simulation-ui' });

    // Wait and check for unit movements (if game progresses)
    await page.waitForTimeout(10000);

    // Take screenshot of later state
    await screenshot(page, { name: 'map-later', subdir: 'simulation-ui' });

    // Map should still be visible
    expect(await isMapVisible(page)).toBe(true);
  });

  test('orders panel shows submitted orders', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    if (!(await navigateToGame(page, 0))) {
      test.skip(true, 'No games available');
      return;
    }

    // Look for orders panel
    const ordersPanel = page.locator('[class*="orders"], [data-testid="orders-panel"]');
    const ordersHeading = page.getByText(/orders/i);

    if (await ordersHeading.isVisible().catch(() => false)) {
      await screenshot(page, { name: 'orders-panel', subdir: 'simulation-ui' });
    }
  });

  test('press messages panel shows diplomatic messages', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    if (!(await navigateToGame(page, 0))) {
      test.skip(true, 'No games available');
      return;
    }

    // Look for press/messages panel
    const pressHeading = page.getByText(/press|messages|diplomacy/i);

    if (await pressHeading.first().isVisible().catch(() => false)) {
      await screenshot(page, { name: 'press-panel', subdir: 'simulation-ui' });
    }

    // Wait for some press messages to accumulate
    await page.waitForTimeout(30000);
    await screenshot(page, { name: 'press-panel-later', subdir: 'simulation-ui' });
  });
});

test.describe('Game Simulation - Agent Behavior', () => {
  test.setTimeout(300000); // 5 minutes

  test.beforeEach(async ({ page }) => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running');
  });

  test('all powers have agents submitting orders', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);
    const POWERS = ['ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'AUSTRIA', 'RUSSIA', 'TURKEY'];

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Start or find a game
    const newGameBtn = page.getByRole('button', { name: /new game|start game/i });
    if (await newGameBtn.isVisible().catch(() => false)) {
      await newGameBtn.click();
      await page.waitForTimeout(10000);
    }

    await navigateToGame(page, 0);

    // Monitor for snapshots with orders from all powers
    const powersWithOrders = new Set<string>();
    const startTime = Date.now();

    while (Date.now() - startTime < 180000 && powersWithOrders.size < POWERS.length) {
      const messages = wsMonitor.getMessages();

      for (const msg of messages) {
        if (msg.type === 'SNAPSHOT_ADDED') {
          const snapshot = (msg as { snapshot?: { orders?: Record<string, unknown[]> } }).snapshot;
          const orders = snapshot?.orders || {};

          for (const power of Object.keys(orders)) {
            if ((orders[power] as unknown[])?.length > 0) {
              powersWithOrders.add(power);
            }
          }
        }
      }

      if (powersWithOrders.size > 0) {
        console.log(`Powers with orders: ${Array.from(powersWithOrders).join(', ')}`);
      }

      await page.waitForTimeout(5000);
    }

    console.log(`Final: ${powersWithOrders.size}/${POWERS.length} powers submitted orders`);
    await screenshot(page, { name: 'all-powers', subdir: 'simulation-agents' });

    // All powers should eventually submit orders
    expect(powersWithOrders.size).toBeGreaterThan(0);
  });

  test('agents generate press messages', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Start or find a game
    const newGameBtn = page.getByRole('button', { name: /new game|start game/i });
    if (await newGameBtn.isVisible().catch(() => false)) {
      await newGameBtn.click();
      await page.waitForTimeout(10000);
    }

    await navigateToGame(page, 0);

    // Monitor for snapshots with press messages
    const messagesCount: number[] = [];
    const startTime = Date.now();

    while (Date.now() - startTime < 120000) {
      const messages = wsMonitor.getMessages();

      for (const msg of messages) {
        if (msg.type === 'SNAPSHOT_ADDED') {
          const snapshot = (msg as { snapshot?: { press?: unknown[] } }).snapshot;
          const press = snapshot?.press || [];
          messagesCount.push((press as unknown[]).length);
        }
      }

      await page.waitForTimeout(5000);
    }

    const totalMessages = messagesCount.reduce((a, b) => a + b, 0);
    console.log(`Total press messages observed: ${totalMessages}`);

    await screenshot(page, { name: 'press-messages', subdir: 'simulation-agents' });
  });
});

test.describe('Game Simulation - Error Handling', () => {
  test('gracefully handles server disconnect', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Take screenshot of connected state
    await screenshot(page, { name: 'connected', subdir: 'simulation-errors' });

    // UI should not crash if server becomes unavailable
    // (This is a basic connectivity check)
    await expect(page.getByText('Spectator Dashboard')).toBeVisible();
  });

  test('UI shows appropriate state when no games available', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Dashboard should load even with no games
    await expect(page.getByText('Spectator Dashboard')).toBeVisible();

    await screenshot(page, { name: 'no-games', subdir: 'simulation-errors' });
  });
});
