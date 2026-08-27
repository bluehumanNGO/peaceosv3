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
