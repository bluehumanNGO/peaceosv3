import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { verify } from '../src/verify.js';
import { buildFullTestPackage, buildValidTestPackage, readManifest, writeManifest } from './helpers.js';

function checkFor(report: Awaited<ReturnType<typeof verify>>, id: string) {
  const check = report.checks.find((c) => c.id === id);
  if (!check) throw new Error(`no check with id "${id}" in report`);
  return check;
}

describe('redactions — positive', () => {
  it('reports a well-formed field commitment and a withheld-but-committed asset as ok', async () => {
    const { outDir, transparencyDir, withheldAssetFilename } = await buildFullTestPackage();
    const report = await verify(outDir, { transparencyDir });

    const redactions = checkFor(report, 'redactions');
    expect(redactions.status, redactions.message).toBe('ok');
    const fields = redactions.details?.fields as Array<{ field: string; ok: boolean }>;
    const assets = redactions.details?.assets as Array<{ filename: string; present: boolean; status: string }>;
    expect(fields).toEqual([{ field: 'witness_identity', status: 'withheld', ok: true, reason: undefined }]);
    expect(assets[0]?.filename).toBe(withheldAssetFilename);
    expect(assets[0]?.present).toBe(false);
    expect(assets[0]?.status).toBe('withheld but committed');

    // The withheld asset's own integrity is not a failure just because the
    // file is absent — see integrity's message and status.
    expect(checkFor(report, 'integrity').status).toBe('ok');
  });

  it('reports "ok" (vacuously) when there are no redactions and no withheld assets', async () => {
    const { outDir, transparencyDir } = await buildValidTestPackage();
    const report = await verify(outDir, { transparencyDir });
    expect(checkFor(report, 'redactions').status).toBe('ok');
  });

  it('still verifies a withheld asset\'s hash normally if the file happens to be present anyway', async () => {
    const { outDir, transparencyDir, withheldAssetFilename } = await buildFullTestPackage();
    // Manually place the withheld asset's bytes back — build() never wrote
    // them since it was marked withheld, so this simulates an org that
    // chooses to ship it after all without changing the manifest.
    const manifest = await readManifest(outDir);
    const assets = manifest.assets as Array<{ filename: string; sha256: string }>;
    const withheldEntry = assets.find((a) => a.filename === withheldAssetFilename)!;
    const { writeFile } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const bytes = Buffer.from('sensitive footage, not distributed yet\n', 'utf8');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(withheldEntry.sha256);
    await writeFile(join(outDir, 'assets', withheldAssetFilename), bytes);

    const report = await verify(outDir, { transparencyDir });
    expect(checkFor(report, 'integrity').status).toBe('ok');
    const integrityAssets = checkFor(report, 'integrity').details?.assets as Array<{ filename: string; ok: boolean }>;
    expect(integrityAssets.some((a) => a.filename === withheldAssetFilename && a.ok)).toBe(true);
  });
});

describe('redactions — negative (B4, each MUST fail)', () => {
  it('fails when a redaction commitment is manipulated', async () => {
    const { outDir, transparencyDir } = await buildFullTestPackage();
    const manifest = await readManifest(outDir);
    const redactions = manifest.redactions as Array<{ commitment: string }>;
    redactions[0]!.commitment = 'not-a-valid-hash';
    await writeManifest(outDir, manifest);

    const report = await verify(outDir, { transparencyDir });
    expect(checkFor(report, 'redactions').status).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });

  it('fails integrity for an asset that is simply missing (not marked withheld) — omission without proper redaction is not tolerated', async () => {
    const { outDir, transparencyDir } = await buildValidTestPackage();
    await unlink(join(outDir, 'assets', 'testimonio_01.txt'));

    const report = await verify(outDir, { transparencyDir });
    expect(checkFor(report, 'integrity').status).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });
});
