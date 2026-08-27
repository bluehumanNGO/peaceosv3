import { canonicalizeJcs, sha256 } from './canonical.js';

export interface CustodyEventPayload {
  event: string;
  actor: string;
  at: string;
}

/** Per CRYPTO_CONTRACT.md §9: event_hash = SHA-256(JCS({ event, actor, at })), 32 raw bytes. */
export function computeCustodyEventHash(payload: CustodyEventPayload): Buffer {
  return sha256(canonicalizeJcs(payload));
}
