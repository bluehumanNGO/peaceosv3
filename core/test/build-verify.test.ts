import { describe, expect, it } from 'vitest';

import { verifyDirectory as verify } from '../src/node-file-tree.js';
import { buildValidTestPackage } from './helpers.js';

describe('build + verify round trip', () => {
  it('produces a package that verifies as authentic with all six checks OK', async () => {
    const { outDir, transparencyDir } = await buildValidTestPackage();
    const report = await verify(outDir, { transparencyDir });

    expect(report.schemaValid).toBe(true);
    expect(report.checks).toHaveLength(8);
    for (const check of report.checks) {
      expect(check.status, `${check.id}: ${check.message}`).toBe('ok');
    }
    expect(report.verdict).toBe('authentic');

    // A1: the default (no --check-bitcoin) verdict rests on "bound", never
    // silently on "anchored" — that label only ever appears after a real
    // network confirmation the caller explicitly opted into.
    const timestampCheck = report.checks.find((c) => c.id === 'timestamp');
    expect(timestampCheck?.details?.level).toBe('bound');
    expect(timestampCheck?.message).toMatch(/run with --check-bitcoin/i);
  });

  it('never reports the org checks as ok (fails closed to not_determined) when no transparency directory is given', async () => {
    const { outDir } = await buildValidTestPackage();
    const report = await verify(outDir);

    const orgIdentity = report.checks.find((c) => c.id === 'org_identity');
    const orgCountersig = report.checks.find((c) => c.id === 'org_countersignature');
    expect(orgIdentity?.status).toBe('not_determined');
    expect(orgCountersig?.status).toBe('not_determined');
    expect(report.verdict).toBe('problems_detected');
  });
});
