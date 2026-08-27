import { createHash } from 'node:crypto';

import OpenTimestamps from 'opentimestamps';
import { describe, expect, it } from 'vitest';

import { confirmBitcoinAnchor, createLocalPendingProof, verifyTimestampProofOffline } from '../src/timestamp.js';

const { DetachedTimestampFile, Notary, Ops } = OpenTimestamps;

function digest(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

describe('verifyTimestampProofOffline (default, no network — A1)', () => {
  it('accepts a freshly constructed proof for the digest it targets, reported as "bound", not "anchored"', () => {
    const contentHash = digest('example content');
    const proof = createLocalPendingProof(contentHash);
    const result = verifyTimestampProofOffline(contentHash.toString('hex'), proof);
    expect(result.status).toBe('ok');
    expect(result.level).toBe('bound');
    expect(result.message).toMatch(/run with --check-bitcoin/i);
    expect(result.attestations).toEqual([{ type: 'pending', detail: 'https://alice.btc.calendar.opentimestamps.org' }]);
  });

  it('rejects a reused timestamp proof — a valid .ots from a different package, which does not bind this content_hash', () => {
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
    const result = verifyTimestampProofOffline(differentHash.toString('hex'), proof);
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/reused from a different package/i);
  });

  it('fails on malformed proof bytes', () => {
    const contentHash = digest('example content');
    const result = verifyTimestampProofOffline(contentHash.toString('hex'), new Uint8Array([1, 2, 3, 4]));
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/malformed/i);
  });

  it('respects a custom calendar URI', () => {
    const contentHash = digest('example content');
    const proof = createLocalPendingProof(contentHash, 'https://bob.calendar.example/');
    const result = verifyTimestampProofOffline(contentHash.toString('hex'), proof);
    expect(result.attestations[0]?.detail).toBe('https://bob.calendar.example/');
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
