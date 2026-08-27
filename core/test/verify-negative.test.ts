import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateEd25519Keypair } from '../src/keys.js';
import type { VerifyReport } from '../src/types.js';
import { verify } from '../src/verify.js';
import { buildValidTestPackage, flipLastByte, readManifest, writeManifest } from './helpers.js';

function checkFor(report: VerifyReport, id: string) {
  const check = report.checks.find((c) => c.id === id);
  if (!check) throw new Error(`no check with id "${id}" in report`);
  return check;
}

describe('verify — negative cases (each MUST fail, per M1 requirements)', () => {
  it('fails integrity when an asset byte is altered after packaging', async () => {
    const { outDir, transparencyDir } = await buildValidTestPackage();
    await flipLastByte(join(outDir, 'assets', 'testimonio_01.txt'));

    const report = await verify(outDir, { transparencyDir });

    expect(checkFor(report, 'integrity').status).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });

  it('fails the field signature when the signature bytes are corrupted', async () => {
    const { outDir, transparencyDir } = await buildValidTestPackage();
    await flipLastByte(join(outDir, 'signatures', 'manifest.sig'));

    const report = await verify(outDir, { transparencyDir });

    expect(checkFor(report, 'field_signature').status).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });

  it('fails the field signature when public_key_sha256 does not match keys/<id>.pub — the check that makes the field key non-substitutable', async () => {
    const { outDir, transparencyDir, fieldKeyId } = await buildValidTestPackage();
    const substituteKeypair = await generateEd25519Keypair();

    // Swap in a DIFFERENT, validly-shaped Ed25519 public key. The manifest's
    // signature.public_key_sha256 (org-attested) still points at the
    // original key's hash, so this must be caught before any Ed25519 math
    // is attempted at all — see verify.ts's checkFieldSignature.
    await writeFile(join(outDir, 'keys', `${fieldKeyId}.pub`), Buffer.from(substituteKeypair.publicKey));

    const report = await verify(outDir, { transparencyDir });

    const fieldSig = checkFor(report, 'field_signature');
    expect(fieldSig.status).toBe('fail');
    expect(fieldSig.message).toMatch(/public_key_sha256/i);
    expect(report.verdict).toBe('problems_detected');
  });

  it('fails the org countersignature when it is corrupted', async () => {
    const { outDir, transparencyDir } = await buildValidTestPackage();
    await flipLastByte(join(outDir, 'signatures', 'org-countersign.sig'));

    const report = await verify(outDir, { transparencyDir });

    expect(checkFor(report, 'org_countersignature').status).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });

  it('fails org_identity and org_countersignature when the org key is absent from the transparency directory', async () => {
    const { outDir } = await buildValidTestPackage();
    const emptyTransparencyDir = await mkdtemp(join(tmpdir(), 'peaceos-empty-transparency-'));

    const report = await verify(outDir, { transparencyDir: emptyTransparencyDir });

    expect(checkFor(report, 'org_identity').status).toBe('fail');
    expect(checkFor(report, 'org_countersignature').status).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });

  it('fails the timestamp check when the proof is swapped for one targeting a different (stale) content_hash', async () => {
    const stale = await buildValidTestPackage();
    const fresh = await buildValidTestPackage();

    await copyFile(join(stale.outDir, 'timestamps', 'manifest.ots'), join(fresh.outDir, 'timestamps', 'manifest.ots'));

    const report = await verify(fresh.outDir, { transparencyDir: fresh.transparencyDir });

    const timestampCheck = checkFor(report, 'timestamp');
    expect(timestampCheck.status).toBe('fail');
    expect(timestampCheck.message).toMatch(/does not belong to this package/i);
    expect(report.verdict).toBe('problems_detected');
  });

  it('fails the package_id check when package_id does not derive from content_hash', async () => {
    const { outDir, transparencyDir } = await buildValidTestPackage();
    const manifest = await readManifest(outDir);
    manifest.package_id = `sha256:${'0'.repeat(64)}`;
    await writeManifest(outDir, manifest);

    const report = await verify(outDir, { transparencyDir });

    expect(checkFor(report, 'package_id').status).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });

  it('rejects a path-traversal ref (../) before opening any file, instead of crashing or leaking data', async () => {
    const { outDir, transparencyDir } = await buildValidTestPackage();
    const manifest = await readManifest(outDir);
    (manifest.signature as Record<string, unknown>).sig_ref = '../../../../../../etc/passwd';
    await writeManifest(outDir, manifest);

    const report = await verify(outDir, { transparencyDir });

    const fieldSig = checkFor(report, 'field_signature');
    expect(fieldSig.status).toBe('fail');
    expect(fieldSig.message).toMatch(/unsafe path/i);
    expect(report.verdict).toBe('problems_detected');
  });

  it('rejects a manifest that fails schema validation without ever reporting an ok check', async () => {
    const { outDir, transparencyDir } = await buildValidTestPackage();
    const manifest = await readManifest(outDir);
    delete manifest.org;
    await writeManifest(outDir, manifest);

    const report = await verify(outDir, { transparencyDir });

    expect(report.schemaValid).toBe(false);
    expect(report.checks).toHaveLength(6);
    for (const check of report.checks) {
      expect(check.status).not.toBe('ok');
    }
    expect(report.verdict).toBe('problems_detected');
  });
});
