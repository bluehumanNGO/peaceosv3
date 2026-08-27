import { createRequire } from 'node:module';

import OpenTimestamps from 'opentimestamps';

const { DetachedTimestampFile, Ops, Notary } = OpenTimestamps;

// opentimestamps has no top-level export for its Esplora block-explorer
// client (Object.keys(OpenTimestamps) does not include it), and its .d.ts
// there declares a named export that doesn't match the CJS runtime shape
// (`module.exports = class Esplora {...}`, not `exports.Esplora = ...`) —
// the same class of NodeNext default-import mismatch worked around
// elsewhere in this codebase (see schema.ts, keys.ts). Loaded via
// createRequire with a small hand-written interface instead of trusting
// either the top-level export (absent) or the deep .d.ts (inaccurate).
// Runtime-verified while building A2.
interface EsploraLike {
  blockhash(height: string): Promise<string>;
  block(hash: string): Promise<{ merkleroot: string; time: number }>;
}
interface EsploraConstructor {
  new (options: { url?: string; timeout?: number }): EsploraLike;
}
const require = createRequire(import.meta.url);
const Esplora = require('opentimestamps/src/esplora.js') as EsploraConstructor;

/**
 * Real OpenTimestamps stamping: submits contentHash to public calendar
 * servers over the network and returns the resulting proof. This is the
 * tool's actual "sello de tiempo" feature, not telemetry — it is an
 * explicit, user-initiated action core to `create`, distinct from the
 * "no phone home" constraint, which governs Verify (see
 * verifyTimestampProofOffline / confirmBitcoinAnchor below: the former never
 * touches the network; the latter only does when the caller opts in and
 * supplies the endpoint themselves).
 */
export async function createTimestampProof(contentHash: Buffer): Promise<Uint8Array> {
  const fileHashOp = new Ops.OpSHA256();
  const detached = DetachedTimestampFile.fromHash(fileHashOp, Array.from(contentHash));
  await OpenTimestamps.stamp(detached);
  return detached.serializeToBytes();
}

/**
 * Builds a structurally real OpenTimestamps proof — correctly serialized,
 * correctly targets contentHash — with a single "pending" calendar
 * attestation, entirely offline (no network call, nothing ever submitted
 * anywhere). Used by build() when the caller opts out of live calendar
 * submission (tests, examples generation, `--no-network`): it produces the
 * exact byte format Verify's offline check expects, without requiring
 * network access during build either.
 */
export function createLocalPendingProof(
  contentHash: Buffer,
  calendarUri = 'https://alice.btc.calendar.opentimestamps.org',
): Uint8Array {
  const fileHashOp = new Ops.OpSHA256();
  const detached = DetachedTimestampFile.fromHash(fileHashOp, Array.from(contentHash));
  detached.timestamp.attestations.push(new Notary.PendingAttestation(calendarUri));
  return detached.serializeToBytes();
}

export interface TimestampAttestationSummary {
  type: 'pending' | 'bitcoin' | 'litecoin' | 'unknown';
  detail: string;
}

/**
 * `bound` — the proof is well-formed and cryptographically binds exactly
 * this package's content_hash. Established fully offline; this is what the
 * default (no `--check-bitcoin`) check reports on success.
 *
 * `anchored` — additionally chain-confirmed: a Bitcoin block explorer the
 * caller trusts was actually queried and its merkle root matches the
 * attestation. Only ever reported after `confirmBitcoinAnchor` succeeds —
 * never shown without a real network confirmation having happened.
 */
export type TimestampLevel = 'bound' | 'anchored';

export interface TimestampCheckResult {
  status: 'ok' | 'fail' | 'not_determined';
  level: TimestampLevel;
  message: string;
  attestations: TimestampAttestationSummary[];
}

function summarizeAttestations(detached: InstanceType<typeof DetachedTimestampFile>): TimestampAttestationSummary[] {
  const attestations: TimestampAttestationSummary[] = [];
  for (const [, attestation] of detached.timestamp.allAttestations()) {
    if (attestation instanceof Notary.PendingAttestation) {
      attestations.push({ type: 'pending', detail: attestation.uri });
    } else if (attestation instanceof Notary.BitcoinBlockHeaderAttestation) {
      attestations.push({ type: 'bitcoin', detail: `block height ${attestation.height}` });
    } else if (attestation instanceof Notary.LitecoinBlockHeaderAttestation) {
      attestations.push({ type: 'litecoin', detail: `block height ${attestation.height}` });
    } else {
      attestations.push({ type: 'unknown', detail: String(attestation) });
    }
  }
  return attestations;
}

/**
 * Offline-only structural verification of an OpenTimestamps proof, per
 * AGENTS.md's "fully offline" mission constraint for Verify, and the
 * default (no `--check-bitcoin`) behavior of `check`. Confirms the proof
 * deserializes, targets exactly this package's content_hash (catching
 * proof-swap / reuse-of-another-package's-proof), and carries at least one
 * recognized attestation. On success this is reported as "bound (offline)",
 * never as fully "anchored" — see TimestampLevel.
 *
 * KNOWN LIMITATION, deliberate: this does NOT confirm the attestation
 * against the real Bitcoin blockchain or calendar server — that requires
 * network access, which this function never performs. A proof claiming a
 * forged-but-well-formed Bitcoin block height passes this check; only
 * confirmBitcoinAnchor (opt-in, caller-supplied endpoint) can catch that.
 */
export function verifyTimestampProofOffline(contentHashHex: string, proofBytes: Uint8Array): TimestampCheckResult {
  let detached;
  try {
    detached = DetachedTimestampFile.deserialize(proofBytes);
  } catch (err) {
    return {
      status: 'fail',
      level: 'bound',
      message: `Malformed OpenTimestamps proof: ${(err as Error).message}`,
      attestations: [],
    };
  }

  const embeddedDigestHex = Buffer.from(detached.fileDigest()).toString('hex');
  if (embeddedDigestHex !== contentHashHex) {
    return {
      status: 'fail',
      level: 'bound',
      message:
        `Timestamp proof targets digest ${embeddedDigestHex}, not this package's content_hash ` +
        `(${contentHashHex}) — this looks like a proof reused from a different package, not a proof ` +
        'for this one.',
      attestations: [],
    };
  }

  const attestations = summarizeAttestations(detached);
  if (attestations.length === 0) {
    return { status: 'fail', level: 'bound', message: 'Timestamp proof contains no attestations.', attestations: [] };
  }

  return {
    status: 'ok',
    level: 'bound',
    message:
      "Proof is well-formed and binds exactly this package's content_hash (offline check). " +
      'Timestamp not chain-confirmed; run with --check-bitcoin <esplora-url> to confirm.',
    attestations,
  };
}

/**
 * Opt-in chain confirmation (A2): queries ONLY the Esplora-compatible
 * endpoint the caller supplies (their own node/explorer — never a
 * project-chosen default, never called unless the caller explicitly asks).
 * Upgrades a `bound` result to `anchored` on success. On any failure to
 * confirm — network error, unreachable endpoint, attestation still pending,
 * anything — reports `not_determined`, never `fail`: an unreachable
 * confirmation source says nothing about whether the package itself is
 * genuine, so it must never be scored as a package defect, and it must
 * never be silently treated as a pass either.
 */
export async function confirmBitcoinAnchor(
  contentHashHex: string,
  proofBytes: Uint8Array,
  esploraSource: string,
): Promise<TimestampCheckResult> {
  const offline = verifyTimestampProofOffline(contentHashHex, proofBytes);
  if (offline.status !== 'ok') {
    return offline;
  }

  const detached = DetachedTimestampFile.deserialize(proofBytes);
  let bitcoinMsg: number[] | undefined;
  let bitcoinAttestation: InstanceType<typeof Notary.BitcoinBlockHeaderAttestation> | undefined;
  for (const [msg, attestation] of detached.timestamp.allAttestations()) {
    if (attestation instanceof Notary.BitcoinBlockHeaderAttestation) {
      bitcoinMsg = msg;
      bitcoinAttestation = attestation;
      break;
    }
  }

  if (!bitcoinAttestation || !bitcoinMsg) {
    return {
      status: 'not_determined',
      level: 'bound',
      message:
        "Proof is well-formed and binds exactly this package's content_hash (offline check), but no " +
        'Bitcoin block attestation is present yet (likely still pending in the calendar) — nothing to ' +
        `confirm against ${esploraSource} yet.`,
      attestations: offline.attestations,
    };
  }

  const esplora = new Esplora({ url: esploraSource, timeout: 10_000 });
  try {
    const blockHash = await esplora.blockhash(String(bitcoinAttestation.height));
    const block = await esplora.block(blockHash);
    const attestedTime = bitcoinAttestation.verifyAgainstBlockheader(
      bitcoinMsg.slice().reverse(),
      block as unknown as Parameters<typeof bitcoinAttestation.verifyAgainstBlockheader>[1],
    );
    return {
      status: 'ok',
      level: 'anchored',
      message:
        `Chain-confirmed against ${esploraSource}: content_hash is anchored in Bitcoin block ` +
        `${bitcoinAttestation.height}, attested at ${new Date(attestedTime * 1000).toISOString()}.`,
      attestations: offline.attestations,
    };
  } catch (err) {
    return {
      status: 'not_determined',
      level: 'bound',
      message:
        `Could not chain-confirm against ${esploraSource}: ${(err as Error).message}. This does not mean ` +
        'the package is invalid — only that chain confirmation could not complete.',
      attestations: offline.attestations,
    };
  }
}
