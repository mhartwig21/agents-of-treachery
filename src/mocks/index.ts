/**
 * MSW Mock Infrastructure
 *
 * Exports for use in tests:
 * - server: Node.js MSW server for Vitest
 * - handlers: All mock handlers
 * - data: Test fixtures and factories
 *
 * @example
 * ```ts
 * // In Vitest tests
 * import { server, addMockGame, createTestGame } from '../mocks';
 *
 * // Add a game to mock state
 * addMockGame(createTestGame({ gameId: 'test-1' }));
 *
 * // Fetch will now return this game
 * const response = await fetch('http://localhost:3001/health');
 * ```
 *
 * @example
 * ```ts
 * // For Playwright browser tests, import browser.ts separately
 * // and use the msw-utils.ts helpers
 * ```
 */

// Server setup (Node.js)
export { server, resetServer } from './server';

// Handlers
export {
  handlers,
  httpHandlers,
  wsHandlers,
  resetMockState,
  addMockGame,
  getMockGame,
  errorHandlers,
  createScriptedWsHandler,
} from './handlers';

// Test data factories
export {
  INITIAL_GAME_STATE,
  createTestGame,
  createTestSnapshot,
  createTestMessage,
  createGameProgression,
  createCompletedGame,
  ServerMessages,
  SAMPLE_MESSAGES,
} from './data';
