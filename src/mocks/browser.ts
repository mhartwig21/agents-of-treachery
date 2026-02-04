/**
 * MSW browser setup for E2E tests (Playwright).
 *
 * This file is used by the browser to initialize MSW with service worker.
 *
 * Usage in Playwright:
 * 1. Generate service worker: npx msw init public/ --save
 * 2. In test: await page.evaluate(() => window.startMsw())
 *
 * Or use the test utilities in e2e/msw-utils.ts
 */

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * MSW worker instance for browser.
 */
export const worker = setupWorker(...handlers);

/**
 * Start the mock service worker.
 * Call this before running tests that need mocking.
 */
export async function startMsw(): Promise<void> {
  await worker.start({
    onUnhandledRequest: 'bypass', // Don't warn about unhandled requests
    quiet: true, // Reduce console noise
  });
}

/**
 * Stop the mock service worker.
 */
export function stopMsw(): void {
  worker.stop();
}

// Expose functions on window for Playwright access
declare global {
  interface Window {
    startMsw: typeof startMsw;
    stopMsw: typeof stopMsw;
    mswWorker: typeof worker;
  }
}

if (typeof window !== 'undefined') {
  window.startMsw = startMsw;
  window.stopMsw = stopMsw;
  window.mswWorker = worker;
}
