import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verify } from '@peaceos/core';
import { describe, expect, it } from 'vitest';

const EXAMPLES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = join(EXAMPLES_ROOT, 'packages');
const TRANSPARENCY_DIR = join(EXAMPLES_ROOT, 'transparency');

describe('committed example packages behave as documented (fixture drift guard)', () => {
  it('valid.vep verifies as authentic', async () => {
    const report = await verify(join(PACKAGES_DIR, 'valid.vep'), { transparencyDir: TRANSPARENCY_DIR });
    expect(report.verdict, JSON.stringify(report, null, 2)).toBe('authentic');
  });

  const expectedFailures: Array<[string, string]> = [
    ['tampered-asset-altered.vep', 'integrity'],
    ['tampered-signature-invalid.vep', 'field_signature'],
    ['tampered-key-mismatch.vep', 'field_signature'],
    ['tampered-org-countersign-invalid.vep', 'org_countersignature'],
    ['tampered-path-traversal.vep', 'field_signature'],
  ];

  it.each(expectedFailures)('%s fails its %s check and the overall verdict', async (dir, checkId) => {
    const report = await verify(join(PACKAGES_DIR, dir), { transparencyDir: TRANSPARENCY_DIR });
    const check = report.checks.find((c) => c.id === checkId);
    expect(check?.status, JSON.stringify(report, null, 2)).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });
});
