import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from '../src/build.js';
import { generateEd25519Keypair } from '../src/keys.js';
import type { Ed25519Keypair } from '../src/keys.js';
import type { BuildResult } from '../src/types.js';

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `peaceos-${prefix}-`));
}

export interface TestPackageFixture {
  outDir: string;
  transparencyDir: string;
  orgId: string;
  orgKeyId: string;
  fieldKeyId: string;
  buildResult: BuildResult;
}

/**
 * Builds a real, valid .vep package (using local-pending timestamping, so
 * this never touches the network) plus a matching local transparency
 * directory with the org's public key correctly placed. Individual tests
 * tamper with the returned paths to construct negative cases.
 */
export async function buildValidTestPackage(): Promise<TestPackageFixture> {
  const workDir = await makeTempDir('build');
  const outDir = join(workDir, 'package.vep');
  const transparencyDir = join(workDir, 'transparency');

  const assetSourcePath = join(workDir, 'testimonio_01.txt');
  await writeFile(assetSourcePath, 'sample evidence bytes for testing\n', 'utf8');

  const [fieldKeypair, orgKeypair] = await Promise.all([generateEd25519Keypair(), generateEd25519Keypair()]);

  const orgId = 'org-test';
  const orgKeyId = `org-key-${randomUUID().slice(0, 8)}`;
  const fieldKeyId = `field-${randomUUID().slice(0, 8)}`;

  await mkdir(join(transparencyDir, 'keys', orgId), { recursive: true });
  await writeFile(join(transparencyDir, 'keys', orgId, `${orgKeyId}.pub`), Buffer.from(orgKeypair.publicKey));

  const buildResult = await build({
    outDir,
    assets: [{ sourcePath: assetSourcePath, filename: 'testimonio_01.txt', mediaType: 'text/plain' }],
    fieldKeyId,
    fieldPublicKey: fieldKeypair.publicKey,
    fieldPrivateKey: fieldKeypair.privateKey,
    orgId,
    orgKeyId,
    orgPrivateKey: orgKeypair.privateKey,
    transparencyRef: `git:keys@${'0'.repeat(40)}`,
    timestamp: { mode: 'local-pending' },
  });

  return { outDir, transparencyDir, orgId, orgKeyId, fieldKeyId, buildResult };
}

export interface FullTestPackageFixture extends TestPackageFixture {
  redactionField: string;
  redactionSaltBase64: string;
  redactionValue: string;
  withheldAssetFilename: string;
  coordActor: string;
  coordKeypair: Ed25519Keypair;
}

/**
 * Like buildValidTestPackage, but exercises M2: two custody events
 * (captured, imported — different actors), one field redaction with a
 * known salt/value (for reveal-mode tests), and one withheld asset.
 */
export async function buildFullTestPackage(): Promise<FullTestPackageFixture> {
  const workDir = await makeTempDir('build-full');
  const outDir = join(workDir, 'package.vep');
  const transparencyDir = join(workDir, 'transparency');

  const assetSourcePath = join(workDir, 'testimonio_01.txt');
  await writeFile(assetSourcePath, 'sample evidence bytes for testing\n', 'utf8');
  const withheldAssetFilename = 'sensitive_02.txt';
  const withheldAssetSourcePath = join(workDir, withheldAssetFilename);
  await writeFile(withheldAssetSourcePath, 'sensitive footage, not distributed yet\n', 'utf8');

  const [fieldKeypair, orgKeypair, coordKeypair] = await Promise.all([
    generateEd25519Keypair(),
    generateEd25519Keypair(),
    generateEd25519Keypair(),
  ]);

  const orgId = 'org-test';
  const orgKeyId = `org-key-${randomUUID().slice(0, 8)}`;
  const fieldKeyId = `field-${randomUUID().slice(0, 8)}`;
  const coordActor = `coord-${randomUUID().slice(0, 8)}`;

  await mkdir(join(transparencyDir, 'keys', orgId), { recursive: true });
  await writeFile(join(transparencyDir, 'keys', orgId, `${orgKeyId}.pub`), Buffer.from(orgKeypair.publicKey));

  const redactionField = 'witness_identity';
  const redactionSaltBase64 = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x10 + i)).toString('base64');
  const redactionValue = 'Jane Doe';

  const capturedAt = '2026-03-12T16:41:00.000Z';
  const importedAt = '2026-03-13T09:00:00.000Z';

  const buildResult = await build({
    outDir,
    assets: [
      { sourcePath: assetSourcePath, filename: 'testimonio_01.txt', mediaType: 'text/plain' },
      { sourcePath: withheldAssetSourcePath, filename: withheldAssetFilename, mediaType: 'text/plain', withheld: true },
    ],
    fieldKeyId,
    fieldPublicKey: fieldKeypair.publicKey,
    fieldPrivateKey: fieldKeypair.privateKey,
    orgId,
    orgKeyId,
    orgPrivateKey: orgKeypair.privateKey,
    transparencyRef: `git:keys@${'0'.repeat(40)}`,
    timestamp: { mode: 'local-pending' },
    custody: [
      {
        event: 'captured',
        actor: fieldKeyId,
        at: capturedAt,
        actorPublicKey: fieldKeypair.publicKey,
        actorPrivateKey: fieldKeypair.privateKey,
      },
      {
        event: 'imported',
        actor: coordActor,
        at: importedAt,
        actorPublicKey: coordKeypair.publicKey,
        actorPrivateKey: coordKeypair.privateKey,
      },
    ],
    redactions: [{ field: redactionField, saltBase64: redactionSaltBase64, value: redactionValue }],
  });

  return {
    outDir,
    transparencyDir,
    orgId,
    orgKeyId,
    fieldKeyId,
    buildResult,
    redactionField,
    redactionSaltBase64,
    redactionValue,
    withheldAssetFilename,
    coordActor,
    coordKeypair,
  };
}

export async function readManifest(outDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
}

export async function writeManifest(outDir: string, manifest: Record<string, unknown>): Promise<void> {
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

/** Flips the last byte of a file in place — a minimal, deterministic single-byte tamper. */
export async function flipLastByte(path: string): Promise<void> {
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`cannot flip a byte in an empty file: ${path}`);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
  await writeFile(path, bytes);
}
