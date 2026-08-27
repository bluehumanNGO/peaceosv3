import { randomBytes } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, generateEd25519Keypair, type BuildResult } from '@peaceos/core';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS_DIR = join(PACKAGE_ROOT, 'keys');
const TRANSPARENCY_DIR = join(PACKAGE_ROOT, 'transparency');
const PACKAGES_DIR = join(PACKAGE_ROOT, 'packages');
const ASSET_FILENAME = 'testimonio_01.txt';

const ORG_ID = 'org-recolectora';
const ORG_KEY_ID = 'org-2026';
const FIELD_KEY_ID = 'field-01';

async function flipLastByte(path: string): Promise<void> {
  const bytes = await readFile(path);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
  await writeFile(path, bytes);
}

async function readManifest(vepDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(vepDir, 'manifest.json'), 'utf8'));
}

async function writeManifest(vepDir: string, manifest: Record<string, unknown>): Promise<void> {
  await writeFile(join(vepDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

async function copyPackage(name: string): Promise<string> {
  const dest = join(PACKAGES_DIR, `${name}.vep`);
  await rm(dest, { recursive: true, force: true });
  await cp(join(PACKAGES_DIR, 'valid.vep'), dest, { recursive: true });
  return dest;
}

async function main(): Promise<void> {
  console.log('Generating example VEP packages (M1 reference set)...');

  await rm(PACKAGES_DIR, { recursive: true, force: true });
  await mkdir(KEYS_DIR, { recursive: true });
  await mkdir(join(TRANSPARENCY_DIR, 'keys', ORG_ID), { recursive: true });
  await mkdir(PACKAGES_DIR, { recursive: true });

  const fieldKeypair = await generateEd25519Keypair();
  const orgKeypair = await generateEd25519Keypair();

  await writeFile(join(KEYS_DIR, `${FIELD_KEY_ID}.pub`), Buffer.from(fieldKeypair.publicKey));
  await writeFile(join(KEYS_DIR, `${FIELD_KEY_ID}.key`), Buffer.from(fieldKeypair.privateKey));
  await writeFile(join(KEYS_DIR, `${ORG_KEY_ID}.pub`), Buffer.from(orgKeypair.publicKey));
  await writeFile(join(KEYS_DIR, `${ORG_KEY_ID}.key`), Buffer.from(orgKeypair.privateKey));
  await writeFile(join(TRANSPARENCY_DIR, 'keys', ORG_ID, `${ORG_KEY_ID}.pub`), Buffer.from(orgKeypair.publicKey));

  const assetSourcePath = join(PACKAGE_ROOT, 'src', 'sample-asset.txt');

  let buildResult: BuildResult;
  try {
    buildResult = await build({
      outDir: join(PACKAGES_DIR, 'valid.vep'),
      assets: [{ sourcePath: assetSourcePath, filename: ASSET_FILENAME, mediaType: 'text/plain' }],
      fieldKeyId: FIELD_KEY_ID,
      fieldPublicKey: fieldKeypair.publicKey,
      fieldPrivateKey: fieldKeypair.privateKey,
      orgId: ORG_ID,
      orgKeyId: ORG_KEY_ID,
      orgPrivateKey: orgKeypair.privateKey,
      transparencyRef: `git:keys@${randomBytes(20).toString('hex')}`,
      timestamp: { mode: 'network' },
    });
    console.log('  valid.vep — timestamped over the network (real OpenTimestamps calendar submission).');
  } catch (err) {
    console.warn(`  Network timestamping failed (${(err as Error).message}); falling back to a local-only pending proof.`);
    buildResult = await build({
      outDir: join(PACKAGES_DIR, 'valid.vep'),
      assets: [{ sourcePath: assetSourcePath, filename: ASSET_FILENAME, mediaType: 'text/plain' }],
      fieldKeyId: FIELD_KEY_ID,
      fieldPublicKey: fieldKeypair.publicKey,
      fieldPrivateKey: fieldKeypair.privateKey,
      orgId: ORG_ID,
      orgKeyId: ORG_KEY_ID,
      orgPrivateKey: orgKeypair.privateKey,
      transparencyRef: `git:keys@${randomBytes(20).toString('hex')}`,
      timestamp: { mode: 'local-pending' },
    });
  }
  console.log(`  valid.vep package_id: ${buildResult.packageId}`);

  const assetAltered = await copyPackage('tampered-asset-altered');
  await flipLastByte(join(assetAltered, 'assets', ASSET_FILENAME));
  console.log('  tampered-asset-altered.vep — one asset byte flipped after packaging.');

  const signatureInvalid = await copyPackage('tampered-signature-invalid');
  await flipLastByte(join(signatureInvalid, 'signatures', 'manifest.sig'));
  console.log('  tampered-signature-invalid.vep — field signature bytes corrupted.');

  const keyMismatch = await copyPackage('tampered-key-mismatch');
  const substituteKeypair = await generateEd25519Keypair();
  await writeFile(join(keyMismatch, 'keys', `${FIELD_KEY_ID}.pub`), Buffer.from(substituteKeypair.publicKey));
  console.log('  tampered-key-mismatch.vep — field public key swapped; no longer matches public_key_sha256.');

  const orgCountersignInvalid = await copyPackage('tampered-org-countersign-invalid');
  await flipLastByte(join(orgCountersignInvalid, 'signatures', 'org-countersign.sig'));
  console.log('  tampered-org-countersign-invalid.vep — organizational countersignature bytes corrupted.');

  const pathTraversal = await copyPackage('tampered-path-traversal');
  const manifest = await readManifest(pathTraversal);
  (manifest.signature as Record<string, unknown>).sig_ref = '../../../../../../etc/passwd';
  await writeManifest(pathTraversal, manifest);
  console.log('  tampered-path-traversal.vep — signature.sig_ref rewritten to a "../" path.');

  console.log('Done.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
