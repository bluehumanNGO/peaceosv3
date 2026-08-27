import { createRequire } from 'node:module';

import type * as Sodium from 'libsodium-wrappers';

// libsodium-wrappers' published ESM build (dist/modules-esm/*.mjs) is
// broken: it imports a sibling "libsodium.mjs" file that isn't actually
// included in the npm package, so a plain `import sodium from
// 'libsodium-wrappers'` fails at runtime under Node's real ESM resolver
// (confirmed while wiring examples/generate.ts — not just a test-only
// quirk). Its CJS build (dist/modules/libsodium-wrappers.js) works
// correctly, so it's loaded via createRequire, matching the same pattern
// used for ajv-formats in schema.ts.
const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers') as typeof Sodium;

export interface Ed25519Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

let readyPromise: Promise<typeof sodium> | null = null;

function loadSodium(): Promise<typeof sodium> {
  readyPromise ??= sodium.ready.then(() => sodium);
  return readyPromise;
}

export async function generateEd25519Keypair(): Promise<Ed25519Keypair> {
  const s = await loadSodium();
  const kp = s.crypto_sign_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export async function signDetached(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  const s = await loadSodium();
  return s.crypto_sign_detached(message, privateKey);
}

/**
 * Never throws: malformed signatures/keys/messages must fail closed as
 * `false`, not propagate an exception that a caller might mishandle as an
 * unrelated error and accidentally treat as "check skipped" rather than
 * "check failed".
 */
export async function verifyDetached(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  const s = await loadSodium();
  if (publicKey.length !== s.crypto_sign_PUBLICKEYBYTES || signature.length !== s.crypto_sign_BYTES) {
    return false;
  }
  try {
    return s.crypto_sign_verify_detached(signature, message, publicKey);
  } catch {
    return false;
  }
}
