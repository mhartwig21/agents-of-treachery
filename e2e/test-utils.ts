/**
 * E2E Test Utilities
 *
 * Helper functions for Playwright tests including screenshot capture,
 * game monitoring, and WebSocket interaction.
 */

import { Page, BrowserContext } from '@playwright/test';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Screenshot options for consistent naming and organization.
 */
export interface ScreenshotOptions {
  /** Base name for the screenshot (without extension) */
  name: string;
  /** Optional subdirectory within test-results */
  subdir?: string;
  /** Whether to capture full page (default: true) */
  fullPage?: boolean;
}

/**
 * Ensures the screenshot directory exists.
 */
function ensureScreenshotDir(subdir?: string): string {
  const baseDir = 'test-results';
  const dir = subdir ? join(baseDir, subdir) : baseDir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Takes a screenshot with consistent naming.
 */
export async function screenshot(page: Page, options: ScreenshotOptions): Promise<string> {
  const dir = ensureScreenshotDir(options.subdir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${options.name}-${timestamp}.png`;
  const path = join(dir, filename);

  await page.screenshot({
    path,
    fullPage: options.fullPage ?? true,
  });

  return path;
}

/**
 * Takes a series of screenshots at intervals.
 */
export async function captureTimelapse(
  page: Page,
  options: {
    name: string;
    subdir?: string;
    count: number;
    intervalMs: number;
  }
): Promise<string[]> {
  const paths: string[] = [];
  const dir = ensureScreenshotDir(options.subdir);

  for (let i = 0; i < options.count; i++) {
    const filename = `${options.name}-${String(i + 1).padStart(3, '0')}.png`;
    const path = join(dir, filename);
    await page.screenshot({ path, fullPage: true });
    paths.push(path);

    if (i < options.count - 1) {
      await page.waitForTimeout(options.intervalMs);
    }
  }

  return paths;
}

/**
 * WebSocket message from game server.
 */
export interface GameServerMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Listens to WebSocket messages from the game server.
 * Returns a function to get collected messages.
 */
export function createWebSocketMonitor(page: Page): {
  getMessages: () => GameServerMessage[];
  waitForMessage: (type: string, timeoutMs?: number) => Promise<GameServerMessage>;
} {
  const messages: GameServerMessage[] = [];

  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      try {
        const msg = JSON.parse(frame.payload as string);
        messages.push(msg);
      } catch {
        // Ignore non-JSON frames
      }
    });
  });

  return {
    getMessages: () => [...messages],
    waitForMessage: async (type: string, timeoutMs = 30000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = messages.find((m) => m.type === type);
        if (found) return found;
        await page.waitForTimeout(100);
      }
      throw new Error(`Timeout waiting for message type: ${type}`);
    },
  };
}

/**
 * Waits for the game server to be connected.
 */
export async function waitForGameServerConnection(
  page: Page,
  timeoutMs = 10000
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    // Check if connected status indicator exists
    const connected = await page.locator('[data-testid="ws-connected"]').count();
    if (connected > 0) return true;

    // Also check for successful WebSocket message
    try {
      const ws = await page.waitForEvent('websocket', { timeout: 1000 });
      return true;
    } catch {
      // Continue waiting
    }

    await page.waitForTimeout(500);
  }

  return false;
}

/**
 * Starts a new game via WebSocket.
 */
export async function startNewGame(
  page: Page,
  gameName?: string
): Promise<string | null> {
  // Find and click the new game button
  const newGameBtn = page.getByRole('button', { name: /new game|start game|create game/i });

  if (await newGameBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await newGameBtn.click();

    // Wait for game to be created (look for GAME_CREATED message)
    await page.waitForTimeout(2000);
    return 'game-started';
  }

  return null;
}

/**
 * Navigates to a specific game in the UI.
 */
export async function navigateToGame(
  page: Page,
  gameIndex = 0
): Promise<boolean> {
  const gameCards = page.locator('[class*="cursor-pointer"]');
  const count = await gameCards.count();

  if (count > gameIndex) {
    await gameCards.nth(gameIndex).click();
    await page.waitForTimeout(500);
    return true;
  }

  return false;
}

/**
 * Checks if the game map is visible.
 */
export async function isMapVisible(page: Page): Promise<boolean> {
  const svg = page.locator('svg');
  return svg.first().isVisible().catch(() => false);
}

/**
 * Gets the current game phase text.
 */
export async function getCurrentPhase(page: Page): Promise<string | null> {
  const phaseLocator = page.getByText(/Spring|Fall|Winter|Autumn/);
  const isVisible = await phaseLocator.first().isVisible().catch(() => false);

  if (isVisible) {
    return phaseLocator.first().textContent();
  }

  return null;
}

/**
 * Monitors a game and captures screenshots on phase changes.
 */
export async function monitorGameWithScreenshots(
  page: Page,
  options: {
    maxDurationMs: number;
    screenshotDir: string;
  }
): Promise<{ screenshots: string[]; phases: string[] }> {
  const screenshots: string[] = [];
  const phases: string[] = [];
  let lastPhase: string | null = null;

  const start = Date.now();
  let iteration = 0;

  while (Date.now() - start < options.maxDurationMs) {
    const currentPhase = await getCurrentPhase(page);

    if (currentPhase && currentPhase !== lastPhase) {
      phases.push(currentPhase);
      lastPhase = currentPhase;

      // Take screenshot on phase change
      const path = await screenshot(page, {
        name: `phase-${currentPhase.replace(/\s+/g, '-')}`,
        subdir: options.screenshotDir,
      });
      screenshots.push(path);
    }

    iteration++;
    if (iteration % 10 === 0) {
      // Periodic screenshot every ~10 seconds
      const path = await screenshot(page, {
        name: `periodic-${iteration}`,
        subdir: options.screenshotDir,
      });
      screenshots.push(path);
    }

    await page.waitForTimeout(1000);
  }

  return { screenshots, phases };
}
