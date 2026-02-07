import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 *
 * Two test modes:
 * - smoke: Frontend-only tests (fast, no AI)
 * - live: Full stack with game server + Ollama AI agents
 *
 * Run specific project:
 *   npx playwright test --project=smoke
 *   npx playwright test --project=live
 */

const USE_LIVE_SERVER = process.env.E2E_LIVE === 'true';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'live',
      testMatch: /live\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'simulation',
      testMatch: /game-simulation\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'websocket-spectator',
      testMatch: /websocket-spectator\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: /(live|game-simulation|websocket-spectator)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: USE_LIVE_SERVER
    ? [
        {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
        },
        {
          command: 'npm run server:llama-small',
          url: 'http://localhost:3001/health',
          reuseExistingServer: !process.env.CI,
          timeout: 60000,
        },
      ]
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
      },
});
