import type * as Sodium from 'libsodium-wrappers';

// The package's ESM export points at a missing sibling file in 0.7.16. This
// published wrapper entry works in Node and browsers and still exposes
// sodium.ready; keep this import free of Node-only module loading.
// @ts-expect-error The package does not publish declarations for this subpath.
import * as sodiumModule from '../node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js';

const sodium = ('default' in sodiumModule ? sodiumModule.default : sodiumModule) as typeof Sodium;

export interface Ed25519Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

let readyPromise: Promise<typeof sodium> | null = null;

function loadSodium(): Promise<typeof sodium> {
  if (!readyPromise) {
    readyPromise = sodium.ready.then(() => sodium);
  }
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
