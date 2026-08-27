import { createRequire } from 'node:module';

import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    // Both packages resolve and run fine under plain Node (verified directly
    // while building M1) but trip Vite's stricter resolution: opentimestamps
    // has an invalid "main" with no "exports" map (fixed by pointing at its
    // real entry file); libsodium-wrappers HAS an "exports" map that only
    // declares its ESM build, which itself references a sibling .mjs file
    // that doesn't resolve under Vite (fixed by pointing at the working CJS
    // entry via Node's own resolution, which respects the "require"
    // condition libsodium-wrappers' exports map does declare).
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
