import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, afterAll, beforeAll } from 'vitest';
import { server, resetServer } from '../mocks/server';

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});

// Reset handlers and mock state after each test
afterEach(() => {
  cleanup();
  resetServer();
});

// Close server after all tests
afterAll(() => {
  server.close();
});
