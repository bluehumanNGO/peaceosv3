import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      opentimestamps: 'opentimestamps/index.js',
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
