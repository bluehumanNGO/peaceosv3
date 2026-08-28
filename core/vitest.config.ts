import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // opentimestamps has an invalid "main" for Vite; point at its real entry.
    alias: {
      opentimestamps: 'opentimestamps/index.js',
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
