import { describe, expect, it } from 'vitest';

import { computeCustodyEventHash } from '../src/custody.js';
import expected from '../../spec/test/fixtures/crypto-contract/expected-vectors.json' with { type: 'json' };

describe('computeCustodyEventHash matches the locked spec/ vectors (§9)', () => {
  it('reproduces the locked "captured" event_hash', () => {
    expect(computeCustodyEventHash({ event: 'captured', actor: 'field-01', at: '2026-03-12T16:41:00Z' })).toEqual(
      Buffer.from(expected.custody_events.captured.event_hash, 'hex'),
    );
  });

  it('reproduces the locked "imported" event_hash', () => {
    expect(computeCustodyEventHash({ event: 'imported', actor: 'coord-02', at: '2026-03-13T09:00:00Z' })).toEqual(
      Buffer.from(expected.custody_events.imported.event_hash, 'hex'),
    );
  });

  it('changes if actor changes, even with the same event/at', () => {
    const a = computeCustodyEventHash({ event: 'captured', actor: 'field-01', at: '2026-03-12T16:41:00Z' });
    const b = computeCustodyEventHash({ event: 'captured', actor: 'field-99', at: '2026-03-12T16:41:00Z' });
    expect(a.equals(b)).toBe(false);
  });
});
