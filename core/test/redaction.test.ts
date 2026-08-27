import { describe, expect, it } from 'vitest';

import { computeRedactionCommitment, generateRedactionSalt, verifyRedactionReveal } from '../src/redaction.js';
import expected from '../../spec/test/fixtures/crypto-contract/expected-vectors.json' with { type: 'json' };

describe('computeRedactionCommitment matches the locked spec/ vector', () => {
  it('reproduces the locked commitment hex', () => {
    const { salt_base64, field, value, commitment_hex } = expected.redaction_commitment;
    expect(computeRedactionCommitment({ saltBase64: salt_base64, field, value })).toBe(commitment_hex);
  });

  it('changes when the field changes (domain separation)', () => {
    const { salt_base64, value, commitment_hex } = expected.redaction_commitment;
    expect(computeRedactionCommitment({ saltBase64: salt_base64, field: 'other_field', value })).not.toBe(commitment_hex);
  });
});

describe('verifyRedactionReveal (constant-time digest comparison)', () => {
  const { salt_base64, field, value, commitment_hex } = expected.redaction_commitment;

  it('returns true (YES) for the exact committed salt/field/value', () => {
    expect(verifyRedactionReveal(commitment_hex, { saltBase64: salt_base64, field, value })).toBe(true);
  });

  it('returns false (NO) for a wrong value', () => {
    expect(verifyRedactionReveal(commitment_hex, { saltBase64: salt_base64, field, value: 'Someone Else' })).toBe(false);
  });

  it('returns false, not throw, for a malformed/wrong-length manifest commitment', () => {
    expect(verifyRedactionReveal('not-a-valid-hash', { saltBase64: salt_base64, field, value })).toBe(false);
  });
});

describe('generateRedactionSalt', () => {
  it('produces distinct, well-formed base64 salts', () => {
    const a = generateRedactionSalt();
    const b = generateRedactionSalt();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64').length).toBe(32);
  });
});
