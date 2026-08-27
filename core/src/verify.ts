import { readFile } from 'node:fs/promises';

import { buildSignedContent, canonicalizeJcs, computeContentHash, derivePackageId, sha256Hex } from './canonical.js';
import { MANIFEST_FILE } from './layout.js';
import { verifyDetached } from './keys.js';
import { resolveSafePath, UnsafePathError } from './paths.js';
import { validateManifestSchema } from './schema.js';
import { verifyTimestampProofOffline } from './timestamp.js';
import type { CheckId, CheckResult, VerifyReport } from './types.js';

const ALL_CHECK_IDS: CheckId[] = ['integrity', 'field_signature', 'org_countersignature', 'org_identity', 'timestamp', 'package_id'];

export interface VerifyOptions {
  /** Local checkout of the public organizational-key transparency repo. Without it, org_identity and org_countersignature report not_determined — never ok. */
  transparencyDir?: string;
}

function failClosedReport(packagePath: string, schemaErrors: string[], packageId: string | null = null): VerifyReport {
  const checks: CheckResult[] = ALL_CHECK_IDS.map((id) => ({
    id,
    status: 'fail',
    message: 'Manifest failed schema validation; this check could not be attempted.',
  }));
  return { packagePath, packageId, schemaValid: false, schemaErrors, checks, verdict: 'problems_detected' };
}

function checkPackageId(manifest: Record<string, unknown>, contentHashHex: string): CheckResult {
  const expected = derivePackageId(contentHashHex);
  if (manifest.package_id === expected) {
    return { id: 'package_id', status: 'ok', message: 'package_id equals "sha256:" + the recomputed content_hash.' };
  }
  return {
    id: 'package_id',
    status: 'fail',
    message: `package_id "${String(manifest.package_id)}" does not match the recomputed value "${expected}".`,
  };
}

async function checkIntegrity(packageRoot: string, assets: Array<Record<string, unknown>>): Promise<CheckResult> {
  const perAsset: Array<{ filename: unknown; ok: boolean; reason?: string }> = [];

  for (const asset of assets) {
    const filename = asset.filename;
    try {
      const path = resolveSafePath(packageRoot, `assets/${String(filename)}`);
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch (err) {
        perAsset.push({ filename, ok: false, reason: `file not readable: ${(err as Error).message}` });
        continue;
      }
      const actualSha256 = sha256Hex(bytes);
      if (actualSha256 === asset.sha256) {
        perAsset.push({ filename, ok: true });
      } else {
        perAsset.push({ filename, ok: false, reason: `sha256 mismatch: manifest says ${String(asset.sha256)}, file hashes to ${actualSha256}` });
      }
    } catch (err) {
      perAsset.push({ filename, ok: false, reason: (err as Error).message });
    }
  }

  const allOk = perAsset.length > 0 && perAsset.every((a) => a.ok);
  return {
    id: 'integrity',
    status: allOk ? 'ok' : 'fail',
    message: allOk ? `All ${perAsset.length} asset(s) match their recorded SHA-256.` : 'One or more assets failed integrity verification.',
    details: { assets: perAsset },
  };
}

async function checkFieldSignature(
  packageRoot: string,
  signature: Record<string, unknown>,
  contentHash: Buffer,
): Promise<CheckResult> {
  let pubKeyPath: string;
  let sigPath: string;
  try {
    pubKeyPath = resolveSafePath(packageRoot, String(signature.public_key_ref));
    sigPath = resolveSafePath(packageRoot, String(signature.sig_ref));
  } catch (err) {
    return { id: 'field_signature', status: 'fail', message: `Unsafe path in signature refs: ${(err as Error).message}` };
  }

  let pubKeyBytes: Buffer;
  try {
    pubKeyBytes = await readFile(pubKeyPath);
  } catch (err) {
    return { id: 'field_signature', status: 'fail', message: `Field public key file not readable: ${(err as Error).message}` };
  }

  // Mandatory before any signature math: an unattested key must never be
  // trusted, even if it would happen to verify a signature correctly.
  const actualKeySha256 = sha256Hex(pubKeyBytes);
  if (actualKeySha256 !== signature.public_key_sha256) {
    return {
      id: 'field_signature',
      status: 'fail',
      message:
        `Field public key at "${String(signature.public_key_ref)}" hashes to ${actualKeySha256}, ` +
        `not signature.public_key_sha256 (${String(signature.public_key_sha256)}). The key may have been ` +
        'swapped after the org countersigned it; refusing to verify with an unattested key.',
    };
  }

  let sigBytes: Buffer;
  try {
    sigBytes = await readFile(sigPath);
  } catch (err) {
    return { id: 'field_signature', status: 'fail', message: `Field signature file not readable: ${(err as Error).message}` };
  }

  const ok = await verifyDetached(sigBytes, contentHash, pubKeyBytes);
  return {
    id: 'field_signature',
    status: ok ? 'ok' : 'fail',
    message: ok
      ? 'Field (pseudonymous) Ed25519 signature over content_hash verifies, using a key attested by public_key_sha256.'
      : 'Field Ed25519 signature does not verify against content_hash.',
  };
}

interface OrgIdentityOutcome {
  result: CheckResult;
  orgPublicKey: Buffer | null;
}

async function checkOrgIdentity(org: Record<string, unknown>, transparencyDir: string | undefined): Promise<OrgIdentityOutcome> {
  if (!transparencyDir) {
    return {
      orgPublicKey: null,
      result: {
        id: 'org_identity',
        status: 'not_determined',
        message:
          'No local transparency directory was provided to Verify, so the organizational key cannot be ' +
          'resolved. Pass a local checkout of the public transparency repo to complete this check.',
      },
    };
  }

  const orgId = String(org.org_id);
  const keyId = String(org.key_id);

  let keyPath: string;
  try {
    keyPath = resolveSafePath(transparencyDir, `keys/${orgId}/${keyId}.pub`);
  } catch (err) {
    return {
      orgPublicKey: null,
      result: { id: 'org_identity', status: 'fail', message: `Unsafe org_id/key_id: ${(err as Error).message}` },
    };
  }

  let keyBytes: Buffer;
  try {
    keyBytes = await readFile(keyPath);
  } catch {
    return {
      orgPublicKey: null,
      result: {
        id: 'org_identity',
        status: 'fail',
        message: `Organizational key not found in the local transparency directory (org_id="${orgId}", key_id="${keyId}").`,
        details: { trust_level: 'unresolved' },
      },
    };
  }

  if (keyBytes.length !== 32) {
    return {
      orgPublicKey: null,
      result: {
        id: 'org_identity',
        status: 'fail',
        message: `Organizational key file is malformed: expected 32 raw bytes, got ${keyBytes.length}.`,
        details: { trust_level: 'unresolved' },
      },
    };
  }

  return {
    orgPublicKey: keyBytes,
    result: {
      id: 'org_identity',
      status: 'ok',
      message: `Organizational key resolved from the local transparency directory (org_id="${orgId}", key_id="${keyId}"). Field key stays pseudonymous.`,
      details: { trust_level: 'resolved' },
    },
  };
}

async function checkOrgCountersignature(
  packageRoot: string,
  org: Record<string, unknown>,
  content: Record<string, unknown>,
  signature: Record<string, unknown>,
  orgIdentity: CheckResult,
  orgPublicKey: Buffer | null,
): Promise<CheckResult> {
  if (orgIdentity.status === 'not_determined') {
    return {
      id: 'org_countersignature',
      status: 'not_determined',
      message: 'Cannot verify without a resolved organizational key (see org_identity).',
    };
  }
  if (orgIdentity.status === 'fail' || !orgPublicKey) {
    return {
      id: 'org_countersignature',
      status: 'fail',
      message: 'Cannot verify: the organizational key did not resolve (see org_identity).',
    };
  }

  let sigPath: string;
  try {
    sigPath = resolveSafePath(packageRoot, String(org.countersig_ref));
  } catch (err) {
    return { id: 'org_countersignature', status: 'fail', message: `Unsafe path: ${(err as Error).message}` };
  }

  let sigBytes: Buffer;
  try {
    sigBytes = await readFile(sigPath);
  } catch (err) {
    return { id: 'org_countersignature', status: 'fail', message: `Org countersignature file not readable: ${(err as Error).message}` };
  }

  const signedContentJcs = canonicalizeJcs(buildSignedContent(content, signature));
  const ok = await verifyDetached(sigBytes, Buffer.from(signedContentJcs, 'utf8'), orgPublicKey);
  return {
    id: 'org_countersignature',
    status: ok ? 'ok' : 'fail',
    message: ok
      ? 'Organizational Ed25519 countersignature over signed_content (content ∪ signature) verifies.'
      : 'Organizational countersignature does not verify against signed_content.',
  };
}

async function checkTimestamp(
  packageRoot: string,
  timestamps: Array<Record<string, unknown>> | undefined,
  contentHashHex: string,
): Promise<CheckResult> {
  const proofRef = timestamps?.[0]?.proof_ref;
  if (typeof proofRef !== 'string') {
    return { id: 'timestamp', status: 'fail', message: 'No timestamp proof_ref present in the manifest.' };
  }

  let proofPath: string;
  try {
    proofPath = resolveSafePath(packageRoot, proofRef);
  } catch (err) {
    return { id: 'timestamp', status: 'fail', message: `Unsafe path: ${(err as Error).message}` };
  }

  let proofBytes: Buffer;
  try {
    proofBytes = await readFile(proofPath);
  } catch (err) {
    return { id: 'timestamp', status: 'fail', message: `Timestamp proof file not readable: ${(err as Error).message}` };
  }

  const result = verifyTimestampProofOffline(contentHashHex, proofBytes);
  return { id: 'timestamp', status: result.status, message: result.message, details: { attestations: result.attestations } };
}

export async function verify(packagePath: string, options: VerifyOptions = {}): Promise<VerifyReport> {
  let manifestPath: string;
  try {
    manifestPath = resolveSafePath(packagePath, MANIFEST_FILE);
  } catch (err) {
    return failClosedReport(packagePath, [`Unsafe package path: ${(err as Error).message}`]);
  }

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, 'utf8');
  } catch (err) {
    return failClosedReport(packagePath, [`manifest.json not readable: ${(err as Error).message}`]);
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    return failClosedReport(packagePath, [`manifest.json is not valid JSON: ${(err as Error).message}`]);
  }

  const schemaResult = validateManifestSchema(manifest);
  if (!schemaResult.valid) {
    const packageId = typeof manifest.package_id === 'string' ? manifest.package_id : null;
    return failClosedReport(packagePath, schemaResult.errors, packageId);
  }

  const { package_id: _packageId, signature, org, ...content } = manifest;
  void _packageId;
  const { contentHash, contentHashHex } = computeContentHash(content);

  const packageIdCheck = checkPackageId(manifest, contentHashHex);
  const integrityCheck = await checkIntegrity(packagePath, manifest.assets as Array<Record<string, unknown>>);
  const fieldSigCheck = await checkFieldSignature(packagePath, signature as Record<string, unknown>, contentHash);
  const { result: orgIdentityCheck, orgPublicKey } = await checkOrgIdentity(org as Record<string, unknown>, options.transparencyDir);
  const orgCountersigCheck = await checkOrgCountersignature(
    packagePath,
    org as Record<string, unknown>,
    content,
    signature as Record<string, unknown>,
    orgIdentityCheck,
    orgPublicKey,
  );
  const timestampCheck = await checkTimestamp(packagePath, manifest.timestamps as Array<Record<string, unknown>> | undefined, contentHashHex);

  const checks: CheckResult[] = [integrityCheck, fieldSigCheck, orgCountersigCheck, orgIdentityCheck, timestampCheck, packageIdCheck];
  const verdict = checks.every((c) => c.status === 'ok') ? 'authentic' : 'problems_detected';

  return {
    packagePath,
    packageId: typeof manifest.package_id === 'string' ? manifest.package_id : null,
    schemaValid: true,
    schemaErrors: [],
    checks,
    verdict,
  };
}

export { UnsafePathError };
