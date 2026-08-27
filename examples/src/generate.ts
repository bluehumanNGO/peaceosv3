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
const COORD_KEY_ID = 'coord-02';
const WITHHELD_ASSET_FILENAME = 'testimonio_02_sensitive.txt';
const REDACTION_FIELD = 'witness_identity';
const REDACTION_VALUE = 'Jane Doe';
// Fixed, NOT randomly generated, so examples/README.md can show a working
// `reveal` command that stays correct across regenerations. This is only
// safe because the example is fictional evidence with a placeholder name —
// a real deployment MUST use generateRedactionSalt() (a fresh CSPRNG value
// per field), never a fixed constant.
const REDACTION_SALT_BASE64 = 'EBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8=';

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

  // --- M2: a package with a custody chain, a field redaction (reveal-mode
  // demo), and a withheld asset. Uses local-pending timestamping — the
  // network-stamped example above already demonstrates real submission;
  // repeating it here would just slow down `generate` for no new coverage.
  const coordKeypair = await generateEd25519Keypair();
  await writeFile(join(KEYS_DIR, `${COORD_KEY_ID}.pub`), Buffer.from(coordKeypair.publicKey));
  await writeFile(join(KEYS_DIR, `${COORD_KEY_ID}.key`), Buffer.from(coordKeypair.privateKey));

  const withheldAssetSourcePath = join(PACKAGE_ROOT, 'src', 'sample-withheld-asset.txt');

  const custodyResult = await build({
    outDir: join(PACKAGES_DIR, 'valid-with-custody.vep'),
    assets: [
      { sourcePath: assetSourcePath, filename: ASSET_FILENAME, mediaType: 'text/plain' },
      { sourcePath: withheldAssetSourcePath, filename: WITHHELD_ASSET_FILENAME, mediaType: 'text/plain', withheld: true },
    ],
    fieldKeyId: FIELD_KEY_ID,
    fieldPublicKey: fieldKeypair.publicKey,
    fieldPrivateKey: fieldKeypair.privateKey,
    orgId: ORG_ID,
    orgKeyId: ORG_KEY_ID,
    orgPrivateKey: orgKeypair.privateKey,
    transparencyRef: `git:keys@${randomBytes(20).toString('hex')}`,
    timestamp: { mode: 'local-pending' },
    custody: [
      {
        event: 'captured',
        actor: FIELD_KEY_ID,
        at: '2026-03-12T16:41:00.000Z',
        actorPublicKey: fieldKeypair.publicKey,
        actorPrivateKey: fieldKeypair.privateKey,
      },
      {
        event: 'imported',
        actor: COORD_KEY_ID,
        at: '2026-03-13T09:00:00.000Z',
        actorPublicKey: coordKeypair.publicKey,
        actorPrivateKey: coordKeypair.privateKey,
      },
    ],
    redactions: [{ field: REDACTION_FIELD, saltBase64: REDACTION_SALT_BASE64, value: REDACTION_VALUE }],
  });
  console.log(`  valid-with-custody.vep package_id: ${custodyResult.packageId}`);
  console.log('  valid-with-custody.vep — custody chain + redaction + withheld asset; see examples/README.md for the reveal-mode command.');

  const custodyOutOfOrder = await copyPackage('tampered-custody-out-of-order');
  // copyPackage always clones valid.vep, which has no custody[] — regenerate
  // this one from valid-with-custody.vep specifically instead.
  await rm(custodyOutOfOrder, { recursive: true, force: true });
  await cp(join(PACKAGES_DIR, 'valid-with-custody.vep'), custodyOutOfOrder, { recursive: true });
  const custodyManifest = await readManifest(custodyOutOfOrder);
  const custodyEvents = custodyManifest.custody as Array<Record<string, unknown>>;
  const swappedAt = custodyEvents[0]!.at;
  custodyEvents[0]!.at = custodyEvents[1]!.at;
  custodyEvents[1]!.at = swappedAt;
  await writeManifest(custodyOutOfOrder, custodyManifest);
  console.log('  tampered-custody-out-of-order.vep — captured/imported timestamps swapped (also breaks both event signatures).');

  console.log('Done.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
