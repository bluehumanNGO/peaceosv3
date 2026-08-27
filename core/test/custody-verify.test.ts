import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { computeCustodyEventHash } from '../src/custody.js';
import { generateEd25519Keypair, signDetached } from '../src/keys.js';
import { verify } from '../src/verify.js';
import { buildFullTestPackage, buildValidTestPackage, flipLastByte, readManifest, writeManifest } from './helpers.js';

function checkFor(report: Awaited<ReturnType<typeof verify>>, id: string) {
  const check = report.checks.find((c) => c.id === id);
  if (!check) throw new Error(`no check with id "${id}" in report`);
  return check;
}

describe('custody chain — positive', () => {
  it('verifies a two-event chain (captured, imported by a different actor) as ok', async () => {
    const { outDir, transparencyDir } = await buildFullTestPackage();
    const report = await verify(outDir, { transparencyDir });

    const custody = checkFor(report, 'custody');
    expect(custody.status, custody.message).toBe('ok');
    expect((custody.details?.events as unknown[]).length).toBe(2);
  });

  it('reports "ok" (vacuously) when no custody events are present, per M1-compatible packages', async () => {
    const { outDir, transparencyDir } = await buildValidTestPackage();
    const report = await verify(outDir, { transparencyDir });
    expect(checkFor(report, 'custody').status).toBe('ok');
  });
});

describe('custody chain — negative (B4, each MUST fail)', () => {
  it('fails when a custody event signature is invalid', async () => {
    const { outDir, transparencyDir } = await buildFullTestPackage();
    await flipLastByte(join(outDir, 'signatures', 'captured-01.sig'));

    const report = await verify(outDir, { transparencyDir });
    const custody = checkFor(report, 'custody');
    expect(custody.status).toBe('fail');
    expect(custody.message).toMatch(/failed verification/i);
    expect(report.verdict).toBe('problems_detected');
  });

  it('fails when events are out of order — isolated from signature validity by re-signing the moved timestamp for real', async () => {
    const { outDir, transparencyDir, coordActor, coordKeypair } = await buildFullTestPackage();
    const manifest = await readManifest(outDir);
    const custody = manifest.custody as Array<Record<string, unknown>>;

    // Move the "imported" event to before "captured", but re-sign it
    // properly with the real actor key so THIS test isolates the ordering
    // failure from the (separately tested) signature-validity failure.
    const earlierAt = '2020-01-01T00:00:00.000Z';
    const newEventHash = computeCustodyEventHash({ event: 'imported', actor: coordActor, at: earlierAt });
    const newSig = await signDetached(newEventHash, coordKeypair.privateKey);
    await writeFile(join(outDir, String(custody[1]!.sig_ref)), newSig);
    custody[1]!.at = earlierAt;
    await writeManifest(outDir, manifest);

    const report = await verify(outDir, { transparencyDir });
    const custodyCheck = checkFor(report, 'custody');
    const events = custodyCheck.details?.events as Array<{ index: number; ok: boolean; reason?: string }>;
    expect(events[1]?.ok).toBe(false);
    expect(events[1]?.reason).toMatch(/out of order/i);
    expect(custodyCheck.status).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });

  it('fails when the chain does not start with "captured"', async () => {
    const { outDir, transparencyDir } = await buildFullTestPackage();
    const manifest = await readManifest(outDir);
    const custody = manifest.custody as Array<Record<string, unknown>>;
    custody[0]!.event = 'imported';
    await writeManifest(outDir, manifest);

    const report = await verify(outDir, { transparencyDir });
    const custodyCheck = checkFor(report, 'custody');
    expect(custodyCheck.status).toBe('fail');
    const events = custodyCheck.details?.events as Array<{ index: number; ok: boolean; reason?: string }>;
    expect(events[0]?.ok).toBe(false);
    expect(events[0]?.reason).toMatch(/must start with "captured"/i);
    expect(report.verdict).toBe('problems_detected');
  });

  it('fails when a custody actor public key does not match actor_public_key_sha256 (same non-substitutable-key requirement as the field signature)', async () => {
    const { outDir, transparencyDir } = await buildFullTestPackage();
    const manifest = await readManifest(outDir);
    const custody = manifest.custody as Array<Record<string, unknown>>;
    const actorKeyPath = join(outDir, String(custody[1]!.actor_public_key_ref));
    const substitute = await generateEd25519Keypair();
    await writeFile(actorKeyPath, Buffer.from(substitute.publicKey));

    const report = await verify(outDir, { transparencyDir });
    const custodyCheck = checkFor(report, 'custody');
    expect(custodyCheck.status).toBe('fail');
    expect(report.verdict).toBe('problems_detected');
  });
});
