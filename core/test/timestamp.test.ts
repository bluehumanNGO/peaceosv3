import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createLocalPendingProof, verifyTimestampProofOffline } from '../src/timestamp.js';

function digest(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

describe('createLocalPendingProof + verifyTimestampProofOffline (offline round trip)', () => {
  it('accepts a freshly constructed proof for the digest it targets', () => {
    const contentHash = digest('example content');
    const proof = createLocalPendingProof(contentHash);
    const result = verifyTimestampProofOffline(contentHash.toString('hex'), proof);
    expect(result.status).toBe('ok');
    expect(result.attestations).toEqual([{ type: 'pending', detail: 'https://alice.btc.calendar.opentimestamps.org' }]);
  });

  it('fails when the proof targets a different digest than the one being checked (stale/swapped proof)', () => {
    const originalHash = digest('original content');
    const proof = createLocalPendingProof(originalHash);
    const differentHash = digest('different, newer content');
    const result = verifyTimestampProofOffline(differentHash.toString('hex'), proof);
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/does not belong to this package/i);
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
