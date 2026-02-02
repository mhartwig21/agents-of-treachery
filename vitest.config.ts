import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [
      // Use jsdom for React component tests
      ['src/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./src/test/setup.ts'],
  },
});
