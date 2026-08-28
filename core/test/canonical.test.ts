import { describe, expect, it } from 'vitest';

import { computeContentHash, derivePackageId } from '../src/canonical.js';
import content from '../../spec/test/fixtures/crypto-contract/content.json' with { type: 'json' };
import expected from '../../spec/test/fixtures/crypto-contract/expected-vectors.json' with { type: 'json' };

describe('core matches the locked spec/ crypto-contract vectors', () => {
  it('computeContentHash reproduces the locked JCS and content_hash exactly', async () => {
    const result = await computeContentHash(content);
    expect(result.jcs).toBe(expected.content_jcs);
    expect(result.contentHashHex).toBe(expected.content_hash);
    expect(Buffer.from(result.contentHash).toString('hex')).toBe(expected.content_hash);
  });

  it('derivePackageId reproduces the locked package_id', async () => {
    const { contentHashHex } = await computeContentHash(content);
    expect(derivePackageId(contentHashHex)).toBe(expected.package_id);
  });
});
