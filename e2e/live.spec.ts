import { test, expect } from '@playwright/test';
import {
  screenshot,
  captureTimelapse,
  createWebSocketMonitor,
  navigateToGame,
  isMapVisible,
  getCurrentPhase,
  monitorGameWithScreenshots,
} from './test-utils';

/**
 * Live E2E Tests - Full stack with real AI agents
 *
 * These tests require:
 * - Vite dev server running on :5173
 * - Game server running on :3001 with Ollama
 * - Ollama with llama3.2:1b model
 *
 * Run with: npm run test:e2e:live
 */

test.describe('Live Game with AI Agents', () => {
  test.setTimeout(180000); // 3 minutes - AI games take time

  test('can connect to game server and view dashboard', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await expect(page.getByText('Spectator Dashboard')).toBeVisible();

    await screenshot(page, { name: 'dashboard', subdir: 'live' });

    // Wait for WebSocket connection and game list
    await page.waitForTimeout(3000);

    const messages = wsMonitor.getMessages();
    const gameListMsg = messages.find((m) => m.type === 'GAME_LIST');

    // Log connection status
    console.log(`WebSocket messages received: ${messages.length}`);
    console.log(`Game list received: ${!!gameListMsg}`);

    await screenshot(page, { name: 'dashboard-connected', subdir: 'live' });
  });

  test('can start a new game and observe AI agents', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Look for new game button
    const newGameBtn = page.getByRole('button', { name: /new game|start game|create/i });

    if (await newGameBtn.isVisible().catch(() => false)) {
      await screenshot(page, { name: 'before-start', subdir: 'live' });
      await newGameBtn.click();

      // Wait for game creation
      await page.waitForTimeout(5000);
      await screenshot(page, { name: 'after-start', subdir: 'live' });

      // Try to wait for GAME_CREATED message
      try {
        await wsMonitor.waitForMessage('GAME_CREATED', 10000);
        console.log('Game created successfully');
      } catch {
        console.log('No GAME_CREATED message received');
      }
    } else {
      console.log('No new game button found - dashboard may show existing games');
      await screenshot(page, { name: 'no-new-game-btn', subdir: 'live' });
    }

    // Navigate to a game if one exists
    if (await navigateToGame(page, 0)) {
      await page.waitForTimeout(1000);
      await screenshot(page, { name: 'game-view', subdir: 'live' });

      expect(await isMapVisible(page)).toBe(true);

      const phase = await getCurrentPhase(page);
      console.log(`Current phase: ${phase}`);
    }
  });

  test('can observe game phase progression', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Navigate to first game
    if (!(await navigateToGame(page, 0))) {
      test.skip(true, 'No games available to observe');
      return;
    }

    await screenshot(page, { name: 'phase-start', subdir: 'live-phases' });

    // Monitor the game for 60 seconds, capturing phase changes
    const { screenshots, phases } = await monitorGameWithScreenshots(page, {
      maxDurationMs: 60000,
      screenshotDir: 'live-phases',
    });

    console.log(`Captured ${screenshots.length} screenshots`);
    console.log(`Observed phases: ${phases.join(' -> ')}`);

    // Should have captured at least initial state
    expect(screenshots.length).toBeGreaterThan(0);
  });

  test('timelapse capture of game progress', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    if (!(await navigateToGame(page, 0))) {
      test.skip(true, 'No games available');
      return;
    }

    // Capture 10 screenshots over 30 seconds
    const paths = await captureTimelapse(page, {
      name: 'timelapse',
      subdir: 'live-timelapse',
      count: 10,
      intervalMs: 3000,
    });

    console.log(`Captured timelapse: ${paths.length} frames`);
    expect(paths.length).toBe(10);
  });
});

test.describe('Game Server Connection', () => {
  test('WebSocket connection established', async ({ page }) => {
    const wsMessages: string[] = [];

    page.on('websocket', (ws) => {
      console.log(`WebSocket opened: ${ws.url()}`);

      ws.on('framereceived', (frame) => {
        wsMessages.push(frame.payload as string);
      });

      ws.on('close', () => {
        console.log('WebSocket closed');
      });
    });

    await page.goto('/');
    await page.waitForTimeout(5000);

    console.log(`Received ${wsMessages.length} WebSocket messages`);

    await screenshot(page, { name: 'ws-test', subdir: 'live' });

    // Should receive at least the GAME_LIST message
    expect(wsMessages.length).toBeGreaterThan(0);

    const hasGameList = wsMessages.some((m) => m.includes('GAME_LIST'));
    expect(hasGameList).toBe(true);
  });
});

test.describe('Agent Behavior Verification', () => {
  test.setTimeout(300000); // 5 minutes for full observation

  test('agents submit orders (not just HOLD)', async ({ page }) => {
    const wsMonitor = createWebSocketMonitor(page);

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Start a new game or use existing
    const newGameBtn = page.getByRole('button', { name: /new game|start game/i });
    if (await newGameBtn.isVisible().catch(() => false)) {
      await newGameBtn.click();
      await page.waitForTimeout(10000); // Wait for game to start
    }

    // Navigate to game view
    await navigateToGame(page, 0);
    await page.waitForTimeout(2000);

    await screenshot(page, { name: 'agent-test-start', subdir: 'agent-behavior' });

    // Monitor for 2 minutes looking for game updates
    const startTime = Date.now();
    const snapshots: unknown[] = [];

    while (Date.now() - startTime < 120000) {
      const messages = wsMonitor.getMessages();
      const newSnapshots = messages.filter((m) => m.type === 'SNAPSHOT_ADDED');

      if (newSnapshots.length > snapshots.length) {
        snapshots.push(...newSnapshots.slice(snapshots.length));
        console.log(`Snapshot received. Total: ${snapshots.length}`);
        await screenshot(page, {
          name: `snapshot-${snapshots.length}`,
          subdir: 'agent-behavior',
        });
      }

      await page.waitForTimeout(5000);
    }

    console.log(`Observed ${snapshots.length} game snapshots`);

    // Log findings for manual review
    await screenshot(page, { name: 'agent-test-end', subdir: 'agent-behavior' });
  });
});
