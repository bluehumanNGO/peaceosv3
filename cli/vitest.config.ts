import { createRequire } from 'node:module';

import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    // Same Vite-resolution workaround as core/vitest.config.ts — needed here
    // too because these tests exercise @peaceos/core, which pulls in both.
    alias: {
      opentimestamps: 'opentimestamps/index.js',
      'libsodium-wrappers': require.resolve('libsodium-wrappers'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
