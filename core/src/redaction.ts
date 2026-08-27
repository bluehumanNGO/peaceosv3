import { randomBytes } from 'node:crypto';

import { canonicalizeJcs, sha256Hex } from './canonical.js';

export interface RedactionCommitmentInput {
  saltBase64: string;
  field: string;
  value: string;
}

/** Per CRYPTO_CONTRACT.md §6: SHA-256(JCS({ salt, field, value })), hex-encoded. */
export function computeRedactionCommitment({ saltBase64, field, value }: RedactionCommitmentInput): string {
  const jcs = canonicalizeJcs({ salt: saltBase64, field, value });
  return sha256Hex(jcs);
}

export function generateRedactionSalt(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Reveal mode (B2): given salt + value the organization custodies OUTSIDE
 * the package, recompute the commitment and confirm it matches what's in
 * the manifest. Never attempts anything, never partially matches — the
 * salt/value pair either reproduces the exact committed digest or it
 * doesn't. Callers are responsible for never invoking this without a real,
 * caller-supplied salt (there is no "try without salt" mode by design).
 */
export function verifyRedactionReveal(manifestCommitment: string, input: RedactionCommitmentInput): boolean {
  return computeRedactionCommitment(input) === manifestCommitment;
}
