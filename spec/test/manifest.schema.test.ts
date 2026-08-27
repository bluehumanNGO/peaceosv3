import { createRequire } from 'node:module';

import type { FormatsPlugin } from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

// See core/src/schema.ts for why these two are imported this way: a plain
// default import of either does not type-check under moduleResolution
// NodeNext, even though both resolve correctly at runtime.
const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as FormatsPlugin;

import schema from '../manifest.schema.json' with { type: 'json' };
import validManifest from './fixtures/valid-manifest.json' with { type: 'json' };

function compileValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

describe('manifest.schema.json', () => {
  it('compiles as a valid draft 2020-12 JSON Schema', () => {
    expect(() => compileValidator()).not.toThrow();
  });

  it('accepts a well-formed manifest', () => {
    const validate = compileValidator();
    const ok = validate(validManifest);
    expect(validate.errors).toBeNull();
    expect(ok).toBe(true);
  });

  it('rejects a manifest missing the organizational countersignature', () => {
    const validate = compileValidator();
    const { org, ...withoutOrg } = validManifest as Record<string, unknown>;
    expect(validate(withoutOrg)).toBe(false);
  });

  it('rejects a manifest missing the field signature', () => {
    const validate = compileValidator();
    const { signature, ...withoutSignature } = validManifest as Record<string, unknown>;
    expect(validate(withoutSignature)).toBe(false);
  });

  it('rejects unknown top-level fields (fail closed)', () => {
    const validate = compileValidator();
    expect(validate({ ...validManifest, unexpected_field: true })).toBe(false);
  });

  it('rejects a malformed sha256 digest', () => {
    const validate = compileValidator();
    const tampered = structuredClone(validManifest) as { assets: Array<{ sha256: string }> };
    tampered.assets[0]!.sha256 = 'not-a-valid-hash';
    expect(validate(tampered)).toBe(false);
  });

  it('rejects a wrong vep_version', () => {
    const validate = compileValidator();
    expect(validate({ ...validManifest, vep_version: '0.2' })).toBe(false);
  });

  it('rejects a redaction with no commitment', () => {
    const validate = compileValidator();
    const tampered = structuredClone(validManifest) as { redactions: Array<Record<string, unknown>> };
    delete tampered.redactions[0]?.commitment;
    expect(validate(tampered)).toBe(false);
  });

  it('rejects a package_id that is not "sha256:<64 hex>"', () => {
    const validate = compileValidator();
    expect(validate({ ...validManifest, package_id: 'b1f7c2b0-1a2b-4c3d-8e9f-0a1b2c3d4e5f' })).toBe(false);
  });

  it('rejects a signature missing the field public key reference', () => {
    const validate = compileValidator();
    const tampered = structuredClone(validManifest) as { signature: Record<string, unknown> };
    delete tampered.signature.public_key_ref;
    expect(validate(tampered)).toBe(false);
  });

  it('rejects a signature missing public_key_sha256 (the org-covered key binding)', () => {
    const validate = compileValidator();
    const tampered = structuredClone(validManifest) as { signature: Record<string, unknown> };
    delete tampered.signature.public_key_sha256;
    expect(validate(tampered)).toBe(false);
  });

  it('rejects a commitment still carrying the old label-wrapper shape', () => {
    const validate = compileValidator();
    const tampered = structuredClone(validManifest) as { redactions: Array<{ commitment: string }> };
    const hex = tampered.redactions[0]!.commitment;
    tampered.redactions[0]!.commitment = `sha256(salt||field_name||value)=${hex}`;
    expect(validate(tampered)).toBe(false);
  });

  it('rejects a commitment that is not a bare 64-hex digest', () => {
    const validate = compileValidator();
    const tampered = structuredClone(validManifest) as { redactions: Array<{ commitment: string }> };
    tampered.redactions[0]!.commitment = 'not-a-valid-hash';
    expect(validate(tampered)).toBe(false);
  });

  it('rejects a timestamp target of "manifest_sha256" (the old, ambiguous label)', () => {
    const validate = compileValidator();
    const tampered = structuredClone(validManifest) as { timestamps: Array<{ target: string }> };
    tampered.timestamps[0]!.target = 'manifest_sha256';
    expect(validate(tampered)).toBe(false);
  });
});
