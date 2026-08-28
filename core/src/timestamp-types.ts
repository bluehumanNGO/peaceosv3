export interface TimestampAttestationSummary {
  type: 'pending' | 'bitcoin' | 'litecoin' | 'unknown';
  detail: string;
}

/**
 * `bound` - the proof is well-formed and cryptographically binds exactly
 * this package's content_hash. Established fully offline; this is what the
 * default (no `--check-bitcoin`) check reports on success.
 *
 * `anchored` - additionally chain-confirmed: a Bitcoin block explorer the
 * caller trusts was actually queried and its merkle root matches the
 * attestation. Only ever reported after a Node-only confirmer succeeds.
 */
export type TimestampLevel = 'bound' | 'anchored';

export interface TimestampCheckResult {
  status: 'ok' | 'fail' | 'not_determined';
  level: TimestampLevel;
  message: string;
  attestations: TimestampAttestationSummary[];
}

export type ConfirmBitcoinAnchor = (
  contentHashHex: string,
  proofBytes: Uint8Array,
  esploraSource: string,
) => Promise<TimestampCheckResult>;
