import { createHash } from 'node:crypto';

import canonicalize from 'canonicalize';
import { describe, expect, it } from 'vitest';

import content from './fixtures/crypto-contract/content.json' with { type: 'json' };
import expected from './fixtures/crypto-contract/expected-vectors.json' with { type: 'json' };
import validManifest from './fixtures/valid-manifest.json' with { type: 'json' };

function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input as never).digest('hex');
}

describe('crypto contract — canonicalization and hashing', () => {
  it('produces the locked JCS (RFC 8785) output for `content`', () => {
    expect(canonicalize(content)).toBe(expected.content_jcs);
  });

  it('produces the locked content_hash = SHA-256(JCS(content))', () => {
    expect(sha256Hex(canonicalize(content) as string)).toBe(expected.content_hash);
  });

  it('derives package_id = "sha256:" + content_hash, with no circularity', () => {
    // `content` here never contained package_id in the first place — that is
    // the fix for the circularity the naive "content = manifest \ {signature, org}"
    // definition would have produced (see CRYPTO_CONTRACT.md).
    expect('package_id' in content).toBe(false);
    expect(expected.package_id).toBe(`sha256:${expected.content_hash}`);
  });
});

describe('crypto contract — org countersignature payload', () => {
  it('produces the locked JCS output for signed_content = content ∪ { signature }', () => {
    const signature = {
      alg: 'ed25519',
      key_id: 'field-01',
      public_key_ref: 'keys/field-01.pub',
      public_key_sha256: expected.field_public_key.sha256,
      sig_ref: 'signatures/manifest.sig',
    };
    const signedContent = { ...content, signature };
    expect(canonicalize(signedContent)).toBe(expected.signed_content_jcs);
  });

  it('binds the field public key into signed_content via public_key_sha256 (no raw key duplication needed)', () => {
    const rawKey = Buffer.from(expected.field_public_key.raw_hex, 'hex');
    expect(sha256Hex(rawKey)).toBe(expected.field_public_key.sha256);
    expect(expected.signed_content_jcs).toContain(expected.field_public_key.sha256);
  });
});

describe('crypto contract — redaction commitment (injective by construction)', () => {
  function commitment(saltBase64: string, field: string, value: string): string {
    const jcs = canonicalize({ salt: saltBase64, field, value }) as string;
    return sha256Hex(jcs);
  }

  it('matches the locked vector for sha256(JCS({ salt, field, value }))', () => {
    const { salt_base64, field, value, commitment_hex } = expected.redaction_commitment;
    expect(commitment(salt_base64, field, value)).toBe(commitment_hex);
  });

  it('matches the locked JCS string for the commitment object', () => {
    const { salt_base64, field, value, commitment_jcs } = expected.redaction_commitment;
    expect(canonicalize({ salt: salt_base64, field, value })).toBe(commitment_jcs);
  });

  it('changes if field changes, even with the same salt and value (domain separation)', () => {
    const { salt_base64, value, commitment_hex } = expected.redaction_commitment;
    expect(commitment(salt_base64, 'some_other_field', value)).not.toBe(commitment_hex);
  });

  it('changes if value changes, even with the same salt and field', () => {
    const { salt_base64, field, commitment_hex } = expected.redaction_commitment;
    expect(commitment(salt_base64, field, 'A Different Value')).not.toBe(commitment_hex);
  });

  it('is injective at the field/value boundary — no separator needed, unlike raw concatenation', () => {
    const { salt_base64 } = expected.redaction_commitment;
    // Raw concatenation of field+value would collide here: "ab"+"c" === "a"+"bc".
    // JCS-encoding field and value as separate, quote-delimited JSON strings does not.
    expect(commitment(salt_base64, 'ab', 'c')).not.toBe(commitment(salt_base64, 'a', 'bc'));
  });

  it('never appears in cleartext anywhere in the package content, nor does the salt', () => {
    const jcs = canonicalize(content) as string;
    expect(jcs).not.toContain(expected.redaction_commitment.value);
    expect(jcs).not.toContain(expected.redaction_commitment.salt_base64);
  });
});

describe('crypto contract — custody event signing (§9, defined in M2)', () => {
  function eventHash(payload: { event: string; actor: string; at: string }): string {
    return sha256Hex(canonicalize(payload) as string);
  }

  it('matches the locked vector for event_hash = SHA-256(JCS({ event, actor, at })) — "captured"', () => {
    const captured = content.custody[0]!;
    expect(canonicalize({ event: captured.event, actor: captured.actor, at: captured.at })).toBe(
      expected.custody_events.captured.payload_jcs,
    );
    expect(eventHash({ event: captured.event, actor: captured.actor, at: captured.at })).toBe(
      expected.custody_events.captured.event_hash,
    );
  });

  it('matches the locked vector for event_hash — "imported"', () => {
    const imported = content.custody[1]!;
    expect(eventHash({ event: imported.event, actor: imported.actor, at: imported.at })).toBe(
      expected.custody_events.imported.event_hash,
    );
  });

  it('excludes sig_ref and the key-binding fields from event_payload (mirrors content excluding signature/org)', () => {
    const captured = content.custody[0]!;
    const payloadKeys = Object.keys(JSON.parse(expected.custody_events.captured.payload_jcs));
    expect(payloadKeys.sort()).toEqual(['actor', 'at', 'event']);
    expect(payloadKeys).not.toContain('sig_ref');
    expect(payloadKeys).not.toContain('actor_public_key_ref');
    expect(payloadKeys).not.toContain('actor_public_key_sha256');
    void captured;
  });

  it('two different actors produce two different event_hashes even with structurally similar payloads', () => {
    expect(expected.custody_events.captured.event_hash).not.toBe(expected.custody_events.imported.event_hash);
  });

  it("binds each custody actor's public key via actor_public_key_sha256, covered transitively by content_hash (no separate attestation chain needed — §9)", () => {
    const coordRawKey = Buffer.from(expected.coord_public_key.raw_hex, 'hex');
    expect(sha256Hex(coordRawKey)).toBe(expected.coord_public_key.sha256);
    expect(expected.content_jcs).toContain(expected.coord_public_key.sha256);
  });
});

describe('crypto contract — fixture self-consistency', () => {
  it('valid-manifest.json package_id matches the locked content_hash vector', () => {
    expect(validManifest.package_id).toBe(expected.package_id);
  });

  it('valid-manifest.json signature.public_key_sha256 matches the locked field key vector', () => {
    expect(validManifest.signature.public_key_sha256).toBe(expected.field_public_key.sha256);
  });

  it('valid-manifest.json redaction commitment matches the locked vector', () => {
    expect(validManifest.redactions[0]?.commitment).toBe(expected.redaction_commitment.commitment_hex);
  });

  it('valid-manifest.json timestamps target content_hash, not the whole manifest', () => {
    expect(validManifest.timestamps[0]?.target).toBe('content_hash');
  });

  it('valid-manifest.json custody actor key hashes match the locked vectors', () => {
    expect(validManifest.custody[0]?.actor_public_key_sha256).toBe(expected.field_public_key.sha256);
    expect(validManifest.custody[1]?.actor_public_key_sha256).toBe(expected.coord_public_key.sha256);
  });
});
