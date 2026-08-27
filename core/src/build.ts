import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { MANIFEST_SCHEMA_VERSION } from '@peaceos/spec';

import { buildSignedContent, canonicalizeJcs, computeContentHash, derivePackageId, sha256Hex } from './canonical.js';
import { computeCustodyEventHash } from './custody.js';
import {
  actorPublicKeyRef,
  assetRef,
  custodyEventSigRef,
  fieldPublicKeyRef,
  KEYS_DIR,
  MANIFEST_FILE,
  MANIFEST_SIGNATURE_FILE,
  ORG_COUNTERSIGNATURE_FILE,
  TIMESTAMP_PROOF_FILE,
} from './layout.js';
import { signDetached } from './keys.js';
import { resolveSafePath } from './paths.js';
import { computeRedactionCommitment } from './redaction.js';
import { validateManifestSchema } from './schema.js';
import { createLocalPendingProof, createTimestampProof } from './timestamp.js';
import type { BuildInput, BuildResult } from './types.js';

async function writeFileSafely(outDir: string, ref: string, data: Uint8Array): Promise<void> {
  const dest = resolveSafePath(outDir, ref);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, data);
}

export async function build(input: BuildInput): Promise<BuildResult> {
  if (input.assets.length === 0) {
    throw new Error('build: at least one asset is required');
  }

  const createdAt = input.createdAt ?? new Date().toISOString();

  const assetEntries = await Promise.all(
    input.assets.map(async (asset) => {
      const sourceBytes = await readFile(asset.sourcePath);
      const entry: Record<string, unknown> = {
        filename: asset.filename,
        media_type: asset.mediaType,
        size_bytes: sourceBytes.byteLength,
        sha256: sha256Hex(sourceBytes),
      };
      if (asset.capturedAt) entry.captured_at = asset.capturedAt;
      if (asset.captureClaim) {
        const claim: Record<string, unknown> = {};
        if (asset.captureClaim.app) claim.app = asset.captureClaim.app;
        if (asset.captureClaim.deviceKeyId) claim.device_key_id = asset.captureClaim.deviceKeyId;
        if (asset.captureClaim.locationPrecision) claim.location_precision = asset.captureClaim.locationPrecision;
        if (Object.keys(claim).length > 0) entry.capture_claim = claim;
      }
      if (asset.withheld) entry.withheld = true;
      return { entry, sourceBytes, withheld: asset.withheld === true };
    }),
  );

  const custodyEvents = input.custody ?? [];
  const custodyEntries = custodyEvents.map((event, index) => {
    const payload = { event: event.event, actor: event.actor, at: event.at };
    const eventHash = computeCustodyEventHash(payload);
    return {
      entry: {
        event: event.event,
        actor: event.actor,
        at: event.at,
        actor_public_key_ref: actorPublicKeyRef(event.actor),
        actor_public_key_sha256: sha256Hex(Buffer.from(event.actorPublicKey)),
        sig_ref: custodyEventSigRef(event.event, index + 1),
      },
      eventHash,
      actorPublicKeyBytes: Buffer.from(event.actorPublicKey),
      actorPrivateKey: event.actorPrivateKey,
    };
  });

  const redactionInputs = input.redactions ?? [];
  const redactionEntries = redactionInputs.map((redaction) => ({
    field: redaction.field,
    commitment: computeRedactionCommitment(redaction),
    status: redaction.status ?? ('withheld' as const),
  }));

  const content: Record<string, unknown> = {
    vep_version: MANIFEST_SCHEMA_VERSION,
    created_at: createdAt,
    assets: assetEntries.map((a) => a.entry),
    timestamps: [{ type: 'opentimestamps', target: 'content_hash', proof_ref: TIMESTAMP_PROOF_FILE }],
  };
  if (custodyEntries.length > 0) content.custody = custodyEntries.map((c) => c.entry);
  if (redactionEntries.length > 0) content.redactions = redactionEntries;

  const { contentHash, contentHashHex } = computeContentHash(content);
  const packageId = derivePackageId(contentHashHex);

  const fieldPublicKeyBytes = Buffer.from(input.fieldPublicKey);
  const signature = {
    alg: 'ed25519' as const,
    key_id: input.fieldKeyId,
    public_key_ref: fieldPublicKeyRef(input.fieldKeyId),
    public_key_sha256: sha256Hex(fieldPublicKeyBytes),
    sig_ref: MANIFEST_SIGNATURE_FILE,
  };
  const fieldSigBytes = await signDetached(contentHash, input.fieldPrivateKey);

  const signedContent = buildSignedContent(content, signature);
  const signedContentJcs = canonicalizeJcs(signedContent);
  const orgSigBytes = await signDetached(Buffer.from(signedContentJcs, 'utf8'), input.orgPrivateKey);

  const org = {
    org_id: input.orgId,
    key_id: input.orgKeyId,
    transparency_ref: input.transparencyRef,
    countersig_ref: ORG_COUNTERSIGNATURE_FILE,
  };

  const manifest = { package_id: packageId, ...content, signature, org };

  const validation = validateManifestSchema(manifest);
  if (!validation.valid) {
    throw new Error(`build produced a manifest that fails its own schema (this is a core bug): ${validation.errors.join('; ')}`);
  }

  const timestampMode = input.timestamp ?? { mode: 'network' as const };
  let proofBytes: Uint8Array;
  if (timestampMode.mode === 'precomputed') {
    proofBytes = timestampMode.proofBytes;
  } else if (timestampMode.mode === 'local-pending') {
    proofBytes = createLocalPendingProof(contentHash, timestampMode.calendarUri);
  } else {
    proofBytes = await createTimestampProof(contentHash);
  }

  for (const { entry, sourceBytes, withheld } of assetEntries) {
    if (withheld) continue;
    await writeFileSafely(input.outDir, assetRef(entry.filename as string), sourceBytes);
  }
  await writeFileSafely(input.outDir, KEYS_DIR + '/' + input.fieldKeyId + '.pub', fieldPublicKeyBytes);
  await writeFileSafely(input.outDir, MANIFEST_SIGNATURE_FILE, fieldSigBytes);
  await writeFileSafely(input.outDir, ORG_COUNTERSIGNATURE_FILE, orgSigBytes);
  await writeFileSafely(input.outDir, TIMESTAMP_PROOF_FILE, proofBytes);

  for (const custodyEvent of custodyEntries) {
    await writeFileSafely(input.outDir, custodyEvent.entry.actor_public_key_ref, custodyEvent.actorPublicKeyBytes);
    const eventSigBytes = await signDetached(custodyEvent.eventHash, custodyEvent.actorPrivateKey);
    await writeFileSafely(input.outDir, custodyEvent.entry.sig_ref, eventSigBytes);
  }

  await writeFileSafely(input.outDir, MANIFEST_FILE, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

  return { outDir: input.outDir, packageId, contentHashHex };
}
