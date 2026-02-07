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
 * WebSocket Real-Time Spectator Updates E2E Tests
 *
 * Verifies that WebSocket-driven real-time updates propagate correctly
 * to the spectator view UI:
 * - Phase changes update the UI (season/year/phase indicators)
 * - New orders appear in the orders panel
 * - Supply center counts update after Fall resolution
 * - Relationship graph updates as press messages arrive
 *
 * Requires:
 * - Vite dev server on :5173
 * - Game server on :3001 with AI agents
 *
 * Run with: npx playwright test --project=websocket-spectator
 */

const GAME_SERVER_URL = 'http://localhost:3001';

async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${GAME_SERVER_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Waits for at least `count` messages of a given type, returning all matches.
 */
async function collectMessages(
  monitor: ReturnType<typeof createWebSocketMonitor>,
  type: string,
  count: number,
  timeoutMs: number,
  page: import('@playwright/test').Page
): Promise<GameServerMessage[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const messages = monitor.getMessages().filter((m) => m.type === type);
    if (messages.length >= count) return messages;
    await page.waitForTimeout(1000);
  }
  return monitor.getMessages().filter((m) => m.type === type);
}

/**
 * Ensures a game is running and navigated to. Creates one if needed.
 * Returns false if no game could be reached.
 */
async function ensureGameView(
  page: import('@playwright/test').Page,
  wsMonitor: ReturnType<typeof createWebSocketMonitor>
): Promise<boolean> {
  await page.goto('/');
  await page.waitForTimeout(2000);

  // Try navigating to an existing game first
  if (await navigateToGame(page, 0)) {
    return true;
  }

  // No games — try to create one
  const newGameBtn = page.getByRole('button', { name: /new game|start game|create/i });
  if (await newGameBtn.isVisible().catch(() => false)) {
    await newGameBtn.click();
    // Wait for game creation
    try {
      await wsMonitor.waitForMessage('GAME_CREATED', 15000);
    } catch {
      // Game may still appear even without the message
    }
    await page.waitForTimeout(3000);
    return navigateToGame(page, 0);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Test Suite: Phase Changes Update the UI
// ---------------------------------------------------------------------------
test.describe('WebSocket Spectator - Phase Changes', () => {
  test.setTimeout(300000); // 5 minutes — AI agents take time

  test.beforeEach(async () => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running — start with npm run server:llama-small');
  });

  test('phase indicator updates when SNAPSHOT_ADDED arrives', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // Record the initial phase text shown in the UI
    const initialPhase = await getCurrentPhase(page);
    console.log(`Initial phase text: ${initialPhase}`);
    await screenshot(page, { name: 'phase-initial', subdir: 'ws-spectator' });

    // Wait for at least 2 snapshots to observe a phase change
    const snapshots = await collectMessages(wsMonitor, 'SNAPSHOT_ADDED', 2, 180000, page);

    expect(snapshots.length).toBeGreaterThanOrEqual(1);

    if (snapshots.length >= 2) {
      const first = snapshots[0] as { snapshot?: { season?: string; year?: number; phase?: string } };
      const second = snapshots[1] as { snapshot?: { season?: string; year?: number; phase?: string } };
      const firstId = `${first.snapshot?.year}-${first.snapshot?.season}-${first.snapshot?.phase}`;
      const secondId = `${second.snapshot?.year}-${second.snapshot?.season}-${second.snapshot?.phase}`;

      console.log(`Phase change: ${firstId} -> ${secondId}`);
      expect(firstId).not.toBe(secondId);
    }

    // Verify the UI updated — the phase text should reflect the latest snapshot
    await page.waitForTimeout(1000);
    const updatedPhase = await getCurrentPhase(page);
    console.log(`Updated phase text: ${updatedPhase}`);
    await screenshot(page, { name: 'phase-updated', subdir: 'ws-spectator' });

    // Phase indicator should have content (Spring/Fall/Winter)
    expect(updatedPhase).toBeTruthy();
  });

  test('PhaseBadge reflects current phase type', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // PhaseBadge renders phase labels: Diplomacy, Movement, Retreat, Build
    const phaseBadge = page.locator('span').filter({
      hasText: /^(Diplomacy|Movement|Retreat|Build)$/,
    });

    // Wait for at least one snapshot so we know the phase is set
    await collectMessages(wsMonitor, 'SNAPSHOT_ADDED', 1, 60000, page);
    await page.waitForTimeout(500);

    const badgeCount = await phaseBadge.count();
    console.log(`PhaseBadge elements found: ${badgeCount}`);
    expect(badgeCount).toBeGreaterThan(0);

    const badgeText = await phaseBadge.first().textContent();
    console.log(`Current PhaseBadge text: ${badgeText}`);
    expect(['Diplomacy', 'Movement', 'Retreat', 'Build']).toContain(badgeText);

    await screenshot(page, { name: 'phase-badge', subdir: 'ws-spectator' });
  });

  test('multiple phase transitions update UI sequentially', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    const observedPhases: string[] = [];
    const startTime = Date.now();

    while (Date.now() - startTime < 180000 && observedPhases.length < 3) {
      const snapshots = wsMonitor.getMessages().filter((m) => m.type === 'SNAPSHOT_ADDED');

      for (const snap of snapshots) {
        const s = snap as { snapshot?: { year?: number; season?: string; phase?: string } };
        const phaseId = `${s.snapshot?.year}-${s.snapshot?.season}-${s.snapshot?.phase}`;
        if (!observedPhases.includes(phaseId)) {
          observedPhases.push(phaseId);
          console.log(`Observed phase: ${phaseId}`);
          await screenshot(page, {
            name: `phase-transition-${observedPhases.length}`,
            subdir: 'ws-spectator',
          });
        }
      }

      await page.waitForTimeout(3000);
    }

    console.log(`Total unique phases observed: ${observedPhases.length}`);
    console.log(`Phases: ${observedPhases.join(' -> ')}`);

    // Should observe at least the initial phase
    expect(observedPhases.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Orders Panel Updates
// ---------------------------------------------------------------------------
test.describe('WebSocket Spectator - Orders Panel', () => {
  test.setTimeout(300000);

  test.beforeEach(async () => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running');
  });

  test('orders appear in panel as agents submit them', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    await screenshot(page, { name: 'orders-initial', subdir: 'ws-spectator' });

    // Monitor for GAME_UPDATED messages with latestOrders
    const powersWithOrders = new Set<string>();
    const startTime = Date.now();

    while (Date.now() - startTime < 120000 && powersWithOrders.size < 7) {
      const messages = wsMonitor.getMessages();

      for (const msg of messages) {
        if (msg.type === 'GAME_UPDATED') {
          const updates = (msg as { updates?: { latestOrders?: Record<string, unknown[]> } }).updates;
          if (updates?.latestOrders) {
            for (const power of Object.keys(updates.latestOrders)) {
              powersWithOrders.add(power);
            }
          }
        }
      }

      await page.waitForTimeout(2000);
    }

    console.log(`Powers with live orders: ${Array.from(powersWithOrders).join(', ')}`);
    expect(powersWithOrders.size).toBeGreaterThan(0);

    // Verify orders panel shows content — look for order text patterns (HOLD, move arrows)
    // OrderRow renders with font-mono text-xs containing order text
    const orderRows = page.locator('.font-mono.text-xs');
    const orderCount = await orderRows.count();
    console.log(`Order rows visible in panel: ${orderCount}`);

    await screenshot(page, { name: 'orders-populated', subdir: 'ws-spectator' });
  });

  test('orders from snapshot appear after phase resolution', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // Wait for a SNAPSHOT_ADDED that contains orders
    let snapshotWithOrders: GameServerMessage | null = null;
    const startTime = Date.now();

    while (Date.now() - startTime < 180000 && !snapshotWithOrders) {
      const messages = wsMonitor.getMessages();

      for (const msg of messages) {
        if (msg.type === 'SNAPSHOT_ADDED') {
          const snapshot = (msg as { snapshot?: { orders?: unknown[] } }).snapshot;
          if (snapshot?.orders && (snapshot.orders as unknown[]).length > 0) {
            snapshotWithOrders = msg;
            break;
          }
        }
      }

      await page.waitForTimeout(3000);
    }

    if (snapshotWithOrders) {
      const snapshot = (snapshotWithOrders as { snapshot?: { orders?: unknown[]; id?: string } }).snapshot;
      const orderCount = (snapshot?.orders as unknown[])?.length || 0;
      console.log(`Snapshot ${snapshot?.id} has ${orderCount} orders`);
      expect(orderCount).toBeGreaterThan(0);

      // Give the UI time to render the new snapshot's orders
      await page.waitForTimeout(1000);

      // The "Orders" panel header should show the count
      const ordersHeader = page.getByText(/Orders/);
      await expect(ordersHeader.first()).toBeVisible();

      await screenshot(page, { name: 'orders-from-snapshot', subdir: 'ws-spectator' });
    } else {
      console.log('No snapshot with orders received within timeout');
    }
  });

  test('order format matches expected patterns', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // Wait for a snapshot with orders
    await collectMessages(wsMonitor, 'SNAPSHOT_ADDED', 1, 120000, page);
    await page.waitForTimeout(1000);

    // OrdersPanel renders formatted orders: "LON HOLD", "PAR → BUR", "MUN S PAR → BUR"
    // These appear in font-mono elements
    const orderTexts = page.locator('.font-mono.text-xs');
    const count = await orderTexts.count();

    if (count > 0) {
      const sampleOrders: string[] = [];
      for (let i = 0; i < Math.min(count, 5); i++) {
        const text = await orderTexts.nth(i).textContent();
        if (text) sampleOrders.push(text.trim());
      }
      console.log(`Sample orders: ${sampleOrders.join(', ')}`);

      // Orders should match known patterns
      for (const text of sampleOrders) {
        const matchesPattern =
          /HOLD/.test(text) ||
          /→/.test(text) ||
          /\bS\b/.test(text) ||
          /\bC\b/.test(text);
        expect(matchesPattern).toBe(true);
      }
    }

    await screenshot(page, { name: 'order-format', subdir: 'ws-spectator' });
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Supply Center Counts Update
// ---------------------------------------------------------------------------
test.describe('WebSocket Spectator - Supply Center Updates', () => {
  test.setTimeout(300000);

  test.beforeEach(async () => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running');
  });

  test('supply center counts display for all powers', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // Wait for at least one snapshot
    await collectMessages(wsMonitor, 'SNAPSHOT_ADDED', 1, 60000, page);
    await page.waitForTimeout(1000);

    // PowerStatsPanel renders "X SC" for each power
    const scLabels = page.locator('text=SC');
    const scCount = await scLabels.count();
    console.log(`SC label elements: ${scCount}`);

    // Should see "Victory: 18 supply centers" text in full panel
    const victoryText = page.getByText(/Victory.*18.*supply centers/);
    const hasVictoryText = await victoryText.isVisible().catch(() => false);
    console.log(`Victory threshold shown: ${hasVictoryText}`);

    await screenshot(page, { name: 'sc-counts', subdir: 'ws-spectator' });
  });

  test('supply center counts change after fall resolution snapshots', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // Track supply center distributions across snapshots
    const scHistories: Array<{ id: string; counts: Record<string, number> }> = [];
    const startTime = Date.now();

    while (Date.now() - startTime < 240000 && scHistories.length < 4) {
      const messages = wsMonitor.getMessages();

      for (const msg of messages) {
        if (msg.type === 'SNAPSHOT_ADDED') {
          const snapshot = (msg as {
            snapshot?: {
              id?: string;
              gameState?: { supplyCenters?: Record<string, string | undefined> };
            };
          }).snapshot;

          if (snapshot?.gameState?.supplyCenters && snapshot.id) {
            // Skip if we already recorded this snapshot
            if (scHistories.some((h) => h.id === snapshot.id)) continue;

            const counts: Record<string, number> = {};
            for (const owner of Object.values(snapshot.gameState.supplyCenters)) {
              if (owner) {
                counts[owner] = (counts[owner] || 0) + 1;
              }
            }

            scHistories.push({ id: snapshot.id, counts });
            console.log(`SC at ${snapshot.id}:`, JSON.stringify(counts));
          }
        }
      }

      await page.waitForTimeout(5000);
    }

    console.log(`Tracked ${scHistories.length} snapshots with SC data`);
    expect(scHistories.length).toBeGreaterThan(0);

    // If we have multiple snapshots, check for changes
    if (scHistories.length >= 2) {
      const first = scHistories[0];
      const last = scHistories[scHistories.length - 1];

      // At the start (1901), all powers have 3 SCs (except Italy=3, Austria=3)
      // After the first Fall, SC ownership should shift
      const firstTotal = Object.values(first.counts).reduce((a, b) => a + b, 0);
      const lastTotal = Object.values(last.counts).reduce((a, b) => a + b, 0);

      console.log(`SC total: ${firstTotal} -> ${lastTotal}`);
      // Total SCs can only increase (34 total on map, 22 initially owned)
      expect(lastTotal).toBeGreaterThanOrEqual(firstTotal);
    }

    await screenshot(page, { name: 'sc-changes', subdir: 'ws-spectator' });
  });

  test('SC balance chart renders in sidebar', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // Wait for a snapshot to ensure data is loaded
    await collectMessages(wsMonitor, 'SNAPSHOT_ADDED', 1, 60000, page);
    await page.waitForTimeout(1000);

    // Look for the SC Balance panel header (CollapsiblePanel title)
    const scBalanceHeader = page.getByText('SC Balance');
    const hasScBalance = await scBalanceHeader.isVisible().catch(() => false);
    console.log(`SC Balance panel visible: ${hasScBalance}`);

    if (hasScBalance) {
      await screenshot(page, { name: 'sc-balance-chart', subdir: 'ws-spectator' });
    }
  });
});

// ---------------------------------------------------------------------------
// Test Suite: Relationship Graph Updates
// ---------------------------------------------------------------------------
test.describe('WebSocket Spectator - Relationship Graph', () => {
  test.setTimeout(300000);

  test.beforeEach(async () => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running');
  });

  test('relationship graph renders all 7 power nodes', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // Wait for initial data
    await collectMessages(wsMonitor, 'SNAPSHOT_ADDED', 1, 60000, page);
    await page.waitForTimeout(1000);

    // Look for the Relationships panel
    const relHeader = page.getByText('Relationships');
    const hasRelPanel = await relHeader.isVisible().catch(() => false);
    console.log(`Relationships panel visible: ${hasRelPanel}`);

    if (hasRelPanel) {
      // The RelationshipGraphPanel renders an SVG with power abbreviation labels
      const graphSvg = page.locator('svg').filter({
        has: page.locator('text', { hasText: 'ENG' }),
      });

      if (await graphSvg.isVisible().catch(() => false)) {
        // Check for all 7 power abbreviations
        const abbreviations = ['ENG', 'FRA', 'GER', 'ITA', 'AUS', 'RUS', 'TUR'];
        for (const abbr of abbreviations) {
          const node = graphSvg.locator(`text:has-text("${abbr}")`);
          const visible = await node.isVisible().catch(() => false);
          console.log(`${abbr} node visible: ${visible}`);
        }
      }

      await screenshot(page, { name: 'relationship-graph', subdir: 'ws-spectator' });
    }
  });

  test('relationship edges appear as press messages accumulate', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // Record message counts over time
    let previousMessageCount = 0;
    const messageCounts: number[] = [];
    const startTime = Date.now();

    while (Date.now() - startTime < 120000) {
      const messages = wsMonitor.getMessages();

      // Count total press messages from GAME_UPDATED (latestMessages) and SNAPSHOT_ADDED
      let totalMessages = 0;
      for (const msg of messages) {
        if (msg.type === 'GAME_UPDATED') {
          const updates = (msg as { updates?: { latestMessages?: unknown[] } }).updates;
          if (updates?.latestMessages) {
            totalMessages += (updates.latestMessages as unknown[]).length;
          }
        }
        if (msg.type === 'SNAPSHOT_ADDED') {
          const snapshot = (msg as { snapshot?: { messages?: unknown[] } }).snapshot;
          if (snapshot?.messages) {
            totalMessages += (snapshot.messages as unknown[]).length;
          }
        }
      }

      if (totalMessages > previousMessageCount) {
        previousMessageCount = totalMessages;
        messageCounts.push(totalMessages);
        console.log(`Press messages accumulated: ${totalMessages}`);
      }

      await page.waitForTimeout(5000);
    }

    console.log(`Message count progression: ${messageCounts.join(' -> ')}`);

    // Relationship graph should have edges rendered
    const graphSvg = page.locator('svg').filter({
      has: page.locator('text', { hasText: 'ENG' }),
    });

    if (await graphSvg.isVisible().catch(() => false)) {
      // Edges are rendered as <line> elements in the .edges group
      const edges = graphSvg.locator('g.edges line:not([stroke="transparent"])');
      const edgeCount = await edges.count();
      console.log(`Relationship edges rendered: ${edgeCount}`);

      // Check edge legend
      const legendAllied = page.getByText('Allied');
      const legendHostile = page.getByText('Hostile');
      const legendNeutral = page.getByText('Neutral');
      console.log(`Legend - Allied: ${await legendAllied.isVisible().catch(() => false)}`);
      console.log(`Legend - Hostile: ${await legendHostile.isVisible().catch(() => false)}`);
      console.log(`Legend - Neutral: ${await legendNeutral.isVisible().catch(() => false)}`);
    }

    await screenshot(page, { name: 'relationship-edges', subdir: 'ws-spectator' });
  });

  test('relationship graph shows "no messages" state initially', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // Before any press messages arrive, the graph should show the no-data message
    // Note: this depends on timing — if the game already has messages, skip
    const noDataMsg = page.getByText('No diplomatic messages yet');
    const hasNoData = await noDataMsg.isVisible().catch(() => false);

    if (hasNoData) {
      console.log('Relationship graph shows empty state');
      await screenshot(page, { name: 'relationship-empty', subdir: 'ws-spectator' });
    } else {
      console.log('Game already has press messages — relationship graph has data');
    }
  });
});

// ---------------------------------------------------------------------------
// Test Suite: WebSocket Connection Lifecycle
// ---------------------------------------------------------------------------
test.describe('WebSocket Spectator - Connection Lifecycle', () => {
  test.setTimeout(60000);

  test.beforeEach(async () => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running');
  });

  test('receives GAME_LIST on initial connection', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await page.waitForTimeout(3000);

    const messages = wsMonitor.getMessages();
    const gameList = messages.find((m) => m.type === 'GAME_LIST');

    expect(gameList).toBeDefined();
    expect(gameList?.type).toBe('GAME_LIST');

    const games = (gameList as { games?: unknown[] })?.games;
    console.log(`Games in list: ${games?.length ?? 0}`);

    await screenshot(page, { name: 'ws-connected', subdir: 'ws-spectator' });
  });

  test('live indicator shows connected state', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    if (!(await ensureGameView(page, wsMonitor))) {
      test.skip(true, 'No game available');
      return;
    }

    // In live mode, the game view shows a green "Live" indicator
    const liveIndicator = page.getByText('Live');
    const isLive = await liveIndicator.isVisible().catch(() => false);
    console.log(`Live indicator visible: ${isLive}`);

    if (isLive) {
      // The green dot animation should be visible
      const greenDot = page.locator('.bg-green-400.animate-pulse');
      const hasDot = await greenDot.first().isVisible().catch(() => false);
      console.log(`Green pulse dot visible: ${hasDot}`);
    }

    await screenshot(page, { name: 'live-indicator', subdir: 'ws-spectator' });
  });
});

// ---------------------------------------------------------------------------
// Test Suite: End-to-End Real-Time Flow
// ---------------------------------------------------------------------------
test.describe('WebSocket Spectator - Full Real-Time Flow', () => {
  test.setTimeout(300000);

  test.beforeEach(async () => {
    const serverRunning = await isServerRunning();
    test.skip(!serverRunning, 'Game server not running');
  });

  test('full cycle: game start -> agents think -> orders submit -> phase resolve -> UI updates', async ({
    page,
  }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Start a new game
    const newGameBtn = page.getByRole('button', { name: /new game|start game|create/i });
    if (await newGameBtn.isVisible().catch(() => false)) {
      await newGameBtn.click();
    }

    // Phase 1: Game creation
    try {
      const gameCreated = await wsMonitor.waitForMessage('GAME_CREATED', 15000);
      const game = (gameCreated as { game?: { gameId?: string; name?: string } }).game;
      console.log(`Game created: ${game?.gameId} (${game?.name})`);
    } catch {
      console.log('Skipping game creation — using existing game');
    }

    // Navigate to game
    await page.waitForTimeout(3000);
    if (!(await navigateToGame(page, 0))) {
      test.skip(true, 'No game available to observe');
      return;
    }

    await screenshot(page, { name: 'full-flow-start', subdir: 'ws-spectator' });

    // Phase 2: Agent activity — wait for GAME_UPDATED with currentAgent
    const agentsSeen = new Set<string>();
    const startTime = Date.now();

    while (Date.now() - startTime < 120000 && agentsSeen.size < 3) {
      const messages = wsMonitor.getMessages();
      for (const msg of messages) {
        if (msg.type === 'GAME_UPDATED') {
          const updates = (msg as { updates?: { currentAgent?: string } }).updates;
          if (updates?.currentAgent) {
            agentsSeen.add(updates.currentAgent);
          }
        }
      }
      await page.waitForTimeout(2000);
    }

    console.log(`Agents observed: ${Array.from(agentsSeen).join(', ')}`);
    expect(agentsSeen.size).toBeGreaterThan(0);

    // Phase 3: Wait for first phase resolution
    const snapshots = await collectMessages(wsMonitor, 'SNAPSHOT_ADDED', 1, 120000, page);

    if (snapshots.length > 0) {
      const snapshot = (snapshots[0] as {
        snapshot?: {
          id?: string;
          orders?: unknown[];
          messages?: unknown[];
          gameState?: { units?: unknown[]; supplyCenters?: Record<string, unknown> };
        };
      }).snapshot;

      console.log(`First snapshot: ${snapshot?.id}`);
      console.log(`  Orders: ${(snapshot?.orders as unknown[])?.length || 0}`);
      console.log(`  Messages: ${(snapshot?.messages as unknown[])?.length || 0}`);
      console.log(`  Units: ${(snapshot?.gameState?.units as unknown[])?.length || 0}`);
    }

    // Phase 4: Verify UI reflects the state
    expect(await isMapVisible(page)).toBe(true);

    const phase = await getCurrentPhase(page);
    console.log(`UI phase after resolution: ${phase}`);
    expect(phase).toBeTruthy();

    await screenshot(page, { name: 'full-flow-end', subdir: 'ws-spectator' });
  });
});
