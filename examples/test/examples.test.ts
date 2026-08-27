import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reveal, verify } from '@peaceos/core';
import { describe, expect, it } from 'vitest';

const EXAMPLES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = join(EXAMPLES_ROOT, 'packages');
const TRANSPARENCY_DIR = join(EXAMPLES_ROOT, 'transparency');

const REDACTION_FIELD = 'witness_identity';
const REDACTION_SALT_BASE64 = 'EBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8=';
const REDACTION_VALUE = 'Jane Doe';

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
    ['tampered-custody-out-of-order.vep', 'custody'],
  ];

  it.each(expectedFailures)('%s fails its %s check and the overall verdict', async (dir, checkId) => {
    const report = await verify(join(PACKAGES_DIR, dir), { transparencyDir: TRANSPARENCY_DIR });
    const check = report.checks.find((c) => c.id === checkId);
    expect(check?.status, JSON.stringify(report, null, 2)).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });

  it('valid-with-custody.vep verifies as authentic, with custody and redactions both ok', async () => {
    const report = await verify(join(PACKAGES_DIR, 'valid-with-custody.vep'), { transparencyDir: TRANSPARENCY_DIR });
    expect(report.verdict, JSON.stringify(report, null, 2)).toBe('authentic');
    expect(report.checks.find((c) => c.id === 'custody')?.status).toBe('ok');
    expect(report.checks.find((c) => c.id === 'redactions')?.status).toBe('ok');
  });

  it('reveal mode matches valid-with-custody.vep\'s committed redaction with the documented demo salt/value', async () => {
    const result = await reveal(join(PACKAGES_DIR, 'valid-with-custody.vep'), {
      field: REDACTION_FIELD,
      saltBase64: REDACTION_SALT_BASE64,
      value: REDACTION_VALUE,
    });
    expect(result.matched, result.message).toBe(true);
  });

  it('reveal mode does not match a wrong value against valid-with-custody.vep', async () => {
    const result = await reveal(join(PACKAGES_DIR, 'valid-with-custody.vep'), {
      field: REDACTION_FIELD,
      saltBase64: REDACTION_SALT_BASE64,
      value: 'Someone Else',
    });
    expect(result.matched).toBe(false);
  });
});
