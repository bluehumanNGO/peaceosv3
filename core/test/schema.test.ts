import { describe, expect, it } from 'vitest';

import { validateManifestSchema } from '../src/schema.js';
import validManifest from '../../spec/test/fixtures/valid-manifest.json' with { type: 'json' };

describe('validateManifestSchema (core wiring over @peaceos/spec)', () => {
  it('accepts the locked valid manifest fixture', () => {
    const result = validateManifestSchema(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a manifest missing required fields, with a readable error', () => {
    const { org: _org, ...withoutOrg } = validManifest as Record<string, unknown>;
    void _org;
    const result = validateManifestSchema(withoutOrg);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
