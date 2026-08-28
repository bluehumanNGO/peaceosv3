import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireFromCore = createRequire(new URL('../core/package.json', import.meta.url));
const libsodiumWrapperPath = requireFromCore.resolve('libsodium-wrappers');
const requireFromSodiumWrapper = createRequire(libsodiumWrapperPath);
const libsodiumPath = requireFromSodiumWrapper.resolve('libsodium');
const sodiumVirtualModule = '\0peaceos-libsodium-wrapper';

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

function withoutQuery(id: string): string {
  return id.split('?')[0] ?? id;
}

function isSodiumWrapperId(id: string): boolean {
  return normalizePath(withoutQuery(id)) === normalizePath(libsodiumWrapperPath);
}

function asBrowserGlobal(source: string): string {
  const transformed = source.replace(/\}\)?\(this\);\s*$/, (suffix) => suffix.replace('(this)', '(__sodiumGlobal)'));
  if (transformed === source) {
    throw new Error('Could not wrap libsodium UMD source for browser ESM loading.');
  }
  return transformed;
}

function sodiumEsmWrapper(): string {
  return [
    'const __sodiumGlobal = {};',
    'const module = undefined;',
    'const exports = undefined;',
    'const define = undefined;',
    asBrowserGlobal(readFileSync(libsodiumPath, 'utf8')),
    asBrowserGlobal(readFileSync(libsodiumWrapperPath, 'utf8')),
    'const sodium = __sodiumGlobal.sodium;',
    "if (!sodium?.ready) throw new Error('libsodium failed to initialize.');",
    'export default sodium;',
  ].join('\n');
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'peaceos-libsodium-wrapper',
      resolveId(id) {
        if (isSodiumWrapperId(id)) {
          return sodiumVirtualModule;
        }
        return undefined;
      },
      load(id) {
        if (id !== sodiumVirtualModule) {
          return undefined;
        }

        return sodiumEsmWrapper();
      },
      transform(_code, id) {
        if (!isSodiumWrapperId(id)) {
          return undefined;
        }

        return { code: sodiumEsmWrapper(), map: null };
      },
    },
  ],
});
