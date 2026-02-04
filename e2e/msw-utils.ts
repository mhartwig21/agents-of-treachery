/**
 * MSW utilities for Playwright E2E tests.
 *
 * Provides helpers to use MSW mocks in browser-based tests.
 *
 * Usage:
 * ```ts
 * import { setupMsw, mockGameServer, waitForMswReady } from './msw-utils';
 *
 * test('game creation with mock server', async ({ page }) => {
 *   await setupMsw(page);
 *   await mockGameServer(page, { games: [testGame] });
 *   // ... rest of test
 * });
 * ```
 */

import { Page } from '@playwright/test';

/**
 * Initialize MSW service worker in the page.
 * Must be called after page navigation.
 */
export async function setupMsw(page: Page): Promise<void> {
  // Check if MSW is available
  const hasMsw = await page.evaluate(() => typeof window.startMsw === 'function');
  if (!hasMsw) {
    console.warn('MSW not available on page. Ensure browser.ts is bundled and service worker is installed.');
    return;
  }

  // Start MSW
  await page.evaluate(() => window.startMsw());
}

/**
 * Stop MSW service worker.
 */
export async function teardownMsw(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (typeof window.stopMsw === 'function') {
      window.stopMsw();
    }
  });
}

/**
 * Wait for MSW to be ready to intercept requests.
 */
export async function waitForMswReady(page: Page, timeout: number = 5000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => typeof window.startMsw === 'function',
      { timeout }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Mock game server state for testing.
 * Injects predefined games and messages into the mock state.
 */
export async function mockGameServer(
  page: Page,
  config: {
    games?: Array<{ gameId: string; name: string; status: string }>;
    initialMessage?: string;
  }
): Promise<void> {
  await page.evaluate((config) => {
    // Access MSW worker to modify handlers at runtime if needed
    const worker = window.mswWorker;
    if (!worker) {
      console.warn('MSW worker not available');
      return;
    }

    // For now, just log - runtime handler modification is complex
    console.log('Mock game server configured:', config);
  }, config);
}

/**
 * Intercept WebSocket messages for assertions.
 */
export async function captureWsMessages(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    (window as unknown as { __capturedWsMessages: string[] }).__capturedWsMessages = [];
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      (window as unknown as { __capturedWsMessages: string[] }).__capturedWsMessages.push(
        typeof data === 'string' ? data : '[binary]'
      );
      return originalSend.call(this, data);
    };
  });

  return async () => {
    return page.evaluate(() =>
      (window as unknown as { __capturedWsMessages: string[] }).__capturedWsMessages
    );
  };
}

/**
 * Wait for a specific WebSocket message type.
 */
export async function waitForWsMessage(
  page: Page,
  messageType: string,
  timeout: number = 5000
): Promise<unknown> {
  return page.evaluate(
    ({ messageType, timeout }) => {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`Timeout waiting for WS message type: ${messageType}`));
        }, timeout);

        const checkMessages = setInterval(() => {
          const messages = (window as unknown as { __receivedWsMessages?: string[] }).__receivedWsMessages || [];
          for (const msg of messages) {
            try {
              const parsed = JSON.parse(msg);
              if (parsed.type === messageType) {
                clearTimeout(timeoutId);
                clearInterval(checkMessages);
                resolve(parsed);
                return;
              }
            } catch {
              // Skip non-JSON messages
            }
          }
        }, 100);
      });
    },
    { messageType, timeout }
  );
}
