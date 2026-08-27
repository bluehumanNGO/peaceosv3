import OpenTimestamps from 'opentimestamps';

const { DetachedTimestampFile, Ops, Notary } = OpenTimestamps;

function hexToDigestBytes(hex: string): number[] {
  return Array.from(Buffer.from(hex, 'hex'));
}

/**
 * Real OpenTimestamps stamping: submits contentHash to public calendar
 * servers over the network and returns the resulting proof. This is the
 * tool's actual "sello de tiempo" feature, not telemetry — it is an
 * explicit, user-initiated action core to `create`, distinct from the
 * "no phone home" constraint, which governs Verify (see
 * verifyTimestampProofOffline below, which never touches the network).
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

export interface TimestampCheckResult {
  status: 'ok' | 'fail';
  message: string;
  attestations: TimestampAttestationSummary[];
}

/**
 * Offline-only structural verification of an OpenTimestamps proof, per
 * AGENTS.md's "fully offline" mission constraint for Verify. Confirms the
 * proof deserializes, targets exactly this package's content_hash (catching
 * proof-swap / stale-proof-reuse across a tampered package), and carries at
 * least one recognized attestation.
 *
 * KNOWN LIMITATION, deliberate: this does NOT confirm the attestation
 * against the real Bitcoin blockchain or calendar server — that requires
 * network access, which Verify never performs. A proof claiming a forged
 * Bitcoin block height, or an unsubmitted/fabricated pending attestation,
 * passes this check as long as it is well-formed and targets the right
 * digest; only network-based confirmation could catch that. This is a
 * direct, surfaced consequence of the offline-verification requirement, not
 * an oversight — see the M1 report for the fuller tradeoff discussion.
 */
export function verifyTimestampProofOffline(contentHashHex: string, proofBytes: Uint8Array): TimestampCheckResult {
  let detached;
  try {
    detached = DetachedTimestampFile.deserialize(proofBytes);
  } catch (err) {
    return { status: 'fail', message: `Malformed OpenTimestamps proof: ${(err as Error).message}`, attestations: [] };
  }

  const embeddedDigestHex = Buffer.from(detached.fileDigest()).toString('hex');
  if (embeddedDigestHex !== contentHashHex) {
    return {
      status: 'fail',
      message:
        `Timestamp proof targets digest ${embeddedDigestHex}, not this package's ` +
        `content_hash (${contentHashHex}) — the proof does not belong to this package.`,
      attestations: [],
    };
  }

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

  if (attestations.length === 0) {
    return { status: 'fail', message: 'Timestamp proof contains no attestations.', attestations: [] };
  }

  return {
    status: 'ok',
    message:
      'Proof targets this package\'s content_hash and carries at least one attestation ' +
      '(structural, fully-offline check only — see known limitation in core/src/timestamp.ts).',
    attestations,
  };
}
