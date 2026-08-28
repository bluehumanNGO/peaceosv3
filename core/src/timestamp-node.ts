import OpenTimestamps from 'opentimestamps';

import { verifyTimestampProofOffline } from './timestamp-offline.js';
import type { TimestampCheckResult } from './timestamp-types.js';

const { DetachedTimestampFile, Ops, Notary } = OpenTimestamps;

interface EsploraLike {
  blockhash(height: string): Promise<string>;
  block(hash: string): Promise<{ merkleroot: string; time: number }>;
}
interface EsploraConstructor {
  new (options: { url?: string; timeout?: number }): EsploraLike;
}

async function loadEsplora(): Promise<EsploraConstructor> {
  const mod = (await import('opentimestamps/src/esplora.js')) as unknown as { default?: EsploraConstructor };
  return mod.default ?? (mod as unknown as EsploraConstructor);
}

/**
 * Real OpenTimestamps stamping: submits contentHash to public calendar servers
 * over the network and returns the resulting proof. Node-only by design.
 */
export async function createTimestampProof(contentHash: Uint8Array): Promise<Uint8Array> {
  const fileHashOp = new Ops.OpSHA256();
  const detached = DetachedTimestampFile.fromHash(fileHashOp, Array.from(contentHash));
  await OpenTimestamps.stamp(detached);
  return detached.serializeToBytes();
}

/**
 * Builds a structurally real OpenTimestamps proof with a single pending calendar
 * attestation, entirely offline. Node-only because it relies on the upstream OTS
 * serializer, whose module graph imports Node dependencies at load time.
 */
export function createLocalPendingProof(
  contentHash: Uint8Array,
  calendarUri = 'https://alice.btc.calendar.opentimestamps.org',
): Uint8Array {
  const fileHashOp = new Ops.OpSHA256();
  const detached = DetachedTimestampFile.fromHash(fileHashOp, Array.from(contentHash));
  detached.timestamp.attestations.push(new Notary.PendingAttestation(calendarUri));
  return detached.serializeToBytes();
}

/**
 * Opt-in chain confirmation: queries ONLY the Esplora-compatible endpoint the
 * caller supplies. Never imported by verifyPackageFiles' browser/default path.
 */
export async function confirmBitcoinAnchor(
  contentHashHex: string,
  proofBytes: Uint8Array,
  esploraSource: string,
): Promise<TimestampCheckResult> {
  const offline = await verifyTimestampProofOffline(contentHashHex, proofBytes);
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
        'Bitcoin block attestation is present yet (likely still pending in the calendar) - nothing to ' +
        `confirm against ${esploraSource} yet.`,
      attestations: offline.attestations,
    };
  }

  try {
    const Esplora = await loadEsplora();
    const esplora = new Esplora({ url: esploraSource, timeout: 10_000 });
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
        'the package is invalid - only that chain confirmation could not complete.',
      attestations: offline.attestations,
    };
  }
}
