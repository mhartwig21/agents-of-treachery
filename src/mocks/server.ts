/**
 * MSW server setup for Node.js environment (Vitest).
 *
 * Usage in tests:
 * ```ts
 * import { server } from '../mocks/server';
 *
 * beforeAll(() => server.listen());
 * afterEach(() => server.resetHandlers());
 * afterAll(() => server.close());
 * ```
 */

import { setupServer } from 'msw/node';
import { handlers, resetMockState } from './handlers';

/**
 * MSW server instance for Node.js tests.
 */
export const server = setupServer(...handlers);

/**
 * Reset all mock state and handlers.
 * Call this in afterEach to ensure clean state between tests.
 */
export function resetServer(): void {
  resetMockState();
  server.resetHandlers();
}

// Re-export handlers and utilities for convenience
export { handlers, resetMockState, addMockGame, getMockGame } from './handlers';
export { errorHandlers, createScriptedWsHandler } from './handlers';
export * from './data';
