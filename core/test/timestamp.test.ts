import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import OpenTimestamps from 'opentimestamps';
import { describe, expect, it, vi } from 'vitest';

import { computeContentHash } from '../src/canonical.js';
import { confirmBitcoinAnchor, createLocalPendingProof } from '../src/timestamp-node.js';
import { verifyTimestampProofOffline } from '../src/timestamp-offline.js';
import type { TimestampAttestationSummary, TimestampCheckResult } from '../src/timestamp-types.js';

const { DetachedTimestampFile, Notary, Ops } = OpenTimestamps;
const testDir = dirname(fileURLToPath(import.meta.url));

function digest(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

function summarizeReferenceAttestations(detached: InstanceType<typeof DetachedTimestampFile>): TimestampAttestationSummary[] {
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

function referenceVerifyTimestampProofOffline(contentHashHex: string, proofBytes: Uint8Array): TimestampCheckResult {
  let detached: InstanceType<typeof DetachedTimestampFile>;
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
      message: 'Timestamp proof targets a different package content_hash.',
      attestations: [],
    };
  }

  const attestations = summarizeReferenceAttestations(detached);
  if (attestations.length === 0) {
    return { status: 'fail', level: 'bound', message: 'Timestamp proof contains no attestations.', attestations: [] };
  }

  return {
    status: 'ok',
    level: 'bound',
    message: "Proof is well-formed and binds exactly this package's content_hash (offline check).",
    attestations,
  };
}

async function readExampleValidProof(): Promise<{ contentHashHex: string; proofBytes: Uint8Array }> {
  const packageDir = resolve(testDir, '../../examples/packages/valid.vep');
  const manifestBytes = await readFile(resolve(packageDir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>;
  const { package_id: _packageId, signature: _signature, org: _org, ...content } = manifest;
  void _packageId;
  void _signature;
  void _org;
  const { contentHashHex } = await computeContentHash(content);
  const proofBytes = new Uint8Array(await readFile(resolve(packageDir, 'timestamps/manifest.ots')));
  return { contentHashHex, proofBytes };
}

function comparable(result: TimestampCheckResult) {
  return {
    status: result.status,
    level: result.level,
    attestations: result.attestations,
  };
}

describe('verifyTimestampProofOffline (default, no network — A1)', () => {
  it('accepts a freshly constructed proof for the digest it targets, reported as "bound", not "anchored"', async () => {
    const contentHash = digest('example content');
    const proof = createLocalPendingProof(contentHash);
    const result = await verifyTimestampProofOffline(contentHash.toString('hex'), proof);
    expect(result.status).toBe('ok');
    expect(result.level).toBe('bound');
    expect(result.message).toMatch(/run with --check-bitcoin/i);
    expect(result.attestations).toEqual([{ type: 'pending', detail: 'https://alice.btc.calendar.opentimestamps.org' }]);
  });

  it('rejects a reused timestamp proof — a valid .ots from a different package, which does not bind this content_hash', async () => {
    // This is what M1's "backdated timestamp" negative test actually exercised
    // (renamed for accuracy in A3): reusing/swapping a genuine .ots proof from
    // ANOTHER package. It is fully detectable offline because the proof's own
    // embedded digest simply won't match. A well-formed but genuinely FORGED
    // Bitcoin attestation time is a different, harder problem this function
    // cannot catch by design — only confirmBitcoinAnchor (opt-in, network)
    // can, and even then only for the source the caller supplies.
    const originalHash = digest('original content');
    const proof = createLocalPendingProof(originalHash);
    const differentHash = digest('different, newer content');
    const result = await verifyTimestampProofOffline(differentHash.toString('hex'), proof);
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/reused from a different package/i);
  });

  it('fails on malformed proof bytes', async () => {
    const contentHash = digest('example content');
    const result = await verifyTimestampProofOffline(contentHash.toString('hex'), new Uint8Array([1, 2, 3, 4]));
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/malformed/i);
  });

  it('respects a custom calendar URI', async () => {
    const contentHash = digest('example content');
    const proof = createLocalPendingProof(contentHash, 'https://bob.calendar.example/');
    const result = await verifyTimestampProofOffline(contentHash.toString('hex'), proof);
    expect(result.attestations[0]?.detail).toBe('https://bob.calendar.example/');
  });
});

describe('verifyTimestampProofOffline differential tests against opentimestamps reference parser', () => {
  it('matches the reference verdict for the real examples/packages/valid.vep proof', async () => {
    const { contentHashHex, proofBytes } = await readExampleValidProof();
    const reference = referenceVerifyTimestampProofOffline(contentHashHex, proofBytes);
    const actual = await verifyTimestampProofOffline(contentHashHex, proofBytes);
    expect(comparable(actual)).toEqual(comparable(reference));
  });

  it('matches the reference verdict when a real valid .ots is reused for another package hash', async () => {
    const { proofBytes } = await readExampleValidProof();
    const otherContentHashHex = digest('different package content').toString('hex');
    const reference = referenceVerifyTimestampProofOffline(otherContentHashHex, proofBytes);
    const actual = await verifyTimestampProofOffline(otherContentHashHex, proofBytes);
    expect(comparable(actual)).toEqual(comparable(reference));
    expect(actual.status).toBe('fail');
    expect(actual.message).toMatch(/reused from a different package/i);
  });

  it('matches the reference verdict for malformed .ots bytes', async () => {
    const contentHashHex = digest('example content').toString('hex');
    const proofBytes = new Uint8Array([1, 2, 3, 4]);
    const reference = referenceVerifyTimestampProofOffline(contentHashHex, proofBytes);
    const actual = await verifyTimestampProofOffline(contentHashHex, proofBytes);
    expect(comparable(actual)).toEqual(comparable(reference));
    expect(actual.status).toBe('fail');
  });

  it('matches the reference verdict for a truncated real .ots proof', async () => {
    const { contentHashHex, proofBytes } = await readExampleValidProof();
    const truncated = proofBytes.slice(0, 120);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reference = referenceVerifyTimestampProofOffline(contentHashHex, truncated);
    consoleError.mockRestore();
    const actual = await verifyTimestampProofOffline(contentHashHex, truncated);
    expect(comparable(actual)).toEqual(comparable(reference));
    expect(actual.status).toBe('fail');
  });
});

describe('confirmBitcoinAnchor (opt-in, A2) — never network unless called, never a false ok/fail', () => {
  it('falls straight through the offline result when the proof itself is broken, without attempting network', async () => {
    const contentHash = digest('example content');
    const result = await confirmBitcoinAnchor(contentHash.toString('hex'), new Uint8Array([1, 2, 3, 4]), 'http://127.0.0.1:1/');
    expect(result.status).toBe('fail');
    expect(result.level).toBe('bound');
  });

  it('reports not_determined when there is no Bitcoin attestation yet (still pending) — never fail, never ok', async () => {
    const contentHash = digest('example content');
    const proof = createLocalPendingProof(contentHash);
    const result = await confirmBitcoinAnchor(contentHash.toString('hex'), proof, 'http://127.0.0.1:1/');
    expect(result.status).toBe('not_determined');
    expect(result.message).toMatch(/no bitcoin block attestation/i);
  });

  it('reports not_determined (never fail) when the supplied endpoint is unreachable', async () => {
    const contentHash = digest('example content');
    const fileHashOp = new Ops.OpSHA256();
    const detached = DetachedTimestampFile.fromHash(fileHashOp, Array.from(contentHash));
    // A syntactically valid Bitcoin attestation at an arbitrary height — not a
    // real chain fact, just enough to route this test into the "query the
    // endpoint" branch so we can prove an unreachable endpoint yields
    // not_determined rather than fail or a silent ok.
    detached.timestamp.attestations.push(new Notary.BitcoinBlockHeaderAttestation(700_000));
    const proof = detached.serializeToBytes();

    const result = await confirmBitcoinAnchor(contentHash.toString('hex'), proof, 'http://127.0.0.1:1/');
    expect(result.status).toBe('not_determined');
    expect(result.message).toMatch(/could not chain-confirm/i);
  });
});
