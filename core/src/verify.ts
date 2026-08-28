import { bytesToUtf8, utf8ToBytes } from './bytes.js';
import { buildSignedContent, canonicalizeJcs, computeContentHash, derivePackageId, sha256Hex } from './canonical.js';
import { computeCustodyEventHash } from './custody.js';
import type { FileTree } from './file-tree.js';
import { MANIFEST_FILE } from './layout.js';
import { verifyDetached } from './keys.js';
import { assertSafePackageRef, UnsafePathError } from './refs.js';
import { validateManifestSchema } from './schema.js';
import { verifyTimestampProofOffline } from './timestamp-offline.js';
import type { ConfirmBitcoinAnchor } from './timestamp-types.js';
import type { CheckId, CheckResult, VerifyReport } from './types.js';

const ALL_CHECK_IDS: CheckId[] = [
  'integrity',
  'field_signature',
  'org_countersignature',
  'org_identity',
  'timestamp',
  'package_id',
  'custody',
  'redactions',
];

export interface VerifyFileTreeOptions {
  packagePath?: string;
  packageFiles?: FileTree;
  transparencyFiles?: FileTree;
  /**
   * Opt-in only (A2): an Esplora-compatible Bitcoin endpoint the CALLER
   * supplies (their own node/explorer). When set, the timestamp check
   * additionally queries this one source to upgrade "bound (offline)" to
   * "anchored (chain-confirmed)". When unset (the default), the timestamp
   * check never makes a network request - this is the sacred default.
   */
  checkBitcoinSource?: string;
  confirmBitcoinAnchor?: ConfirmBitcoinAnchor;
  readError?: string;
}

function failClosedReport(packagePath: string, schemaErrors: string[], packageId: string | null = null): VerifyReport {
  const checks: CheckResult[] = ALL_CHECK_IDS.map((id) => ({
    id,
    status: 'fail',
    message: 'Manifest failed schema validation; this check could not be attempted.',
  }));
  return { packagePath, packageId, schemaValid: false, schemaErrors, checks, verdict: 'problems_detected' };
}

function readFileBytes(files: FileTree, ref: string): Uint8Array {
  const safeRef = assertSafePackageRef(ref);
  const bytes = files.get(safeRef);
  if (!bytes) {
    throw new Error(`File not found in file tree: "${safeRef}"`);
  }
  return bytes;
}

function fileExists(files: FileTree, ref: string): boolean {
  return files.has(assertSafePackageRef(ref));
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

async function checkIntegrity(packageFiles: FileTree, assets: Array<Record<string, unknown>>): Promise<CheckResult> {
  const perAsset: Array<{ filename: unknown; ok: boolean; reason?: string }> = [];

  for (const asset of assets) {
    const filename = asset.filename;
    const withheld = asset.withheld === true;
    try {
      let bytes: Uint8Array;
      try {
        bytes = readFileBytes(packageFiles, `assets/${String(filename)}`);
      } catch (err) {
        if (withheld) {
          continue;
        }
        perAsset.push({ filename, ok: false, reason: `file not readable: ${(err as Error).message}` });
        continue;
      }
      const actualSha256 = await sha256Hex(bytes);
      if (actualSha256 === asset.sha256) {
        perAsset.push({ filename, ok: true });
      } else {
        perAsset.push({ filename, ok: false, reason: `sha256 mismatch: manifest says ${String(asset.sha256)}, file hashes to ${actualSha256}` });
      }
    } catch (err) {
      if (withheld) continue;
      perAsset.push({ filename, ok: false, reason: (err as Error).message });
    }
  }

  const allOk = perAsset.every((a) => a.ok);
  return {
    id: 'integrity',
    status: allOk ? 'ok' : 'fail',
    message: allOk
      ? `${perAsset.length} present asset(s) match their recorded SHA-256 (withheld assets, if any, are reported by the redactions check).`
      : 'One or more assets failed integrity verification.',
    details: { assets: perAsset },
  };
}

async function checkFieldSignature(
  packageFiles: FileTree,
  signature: Record<string, unknown>,
  contentHash: Uint8Array,
): Promise<CheckResult> {
  let pubKeyRef: string;
  let sigRef: string;
  try {
    pubKeyRef = assertSafePackageRef(String(signature.public_key_ref));
    sigRef = assertSafePackageRef(String(signature.sig_ref));
  } catch (err) {
    return { id: 'field_signature', status: 'fail', message: `Unsafe path in signature refs: ${(err as Error).message}` };
  }

  let pubKeyBytes: Uint8Array;
  try {
    pubKeyBytes = readFileBytes(packageFiles, pubKeyRef);
  } catch (err) {
    return { id: 'field_signature', status: 'fail', message: `Field public key file not readable: ${(err as Error).message}` };
  }

  const actualKeySha256 = await sha256Hex(pubKeyBytes);
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

  let sigBytes: Uint8Array;
  try {
    sigBytes = readFileBytes(packageFiles, sigRef);
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
  orgPublicKey: Uint8Array | null;
}

function checkOrgIdentity(org: Record<string, unknown>, transparencyFiles: FileTree | undefined): OrgIdentityOutcome {
  if (!transparencyFiles) {
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

  let keyRef: string;
  try {
    keyRef = assertSafePackageRef(`keys/${orgId}/${keyId}.pub`);
  } catch (err) {
    return {
      orgPublicKey: null,
      result: { id: 'org_identity', status: 'fail', message: `Unsafe org_id/key_id: ${(err as Error).message}` },
    };
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = readFileBytes(transparencyFiles, keyRef);
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
  packageFiles: FileTree,
  org: Record<string, unknown>,
  content: Record<string, unknown>,
  signature: Record<string, unknown>,
  orgIdentity: CheckResult,
  orgPublicKey: Uint8Array | null,
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

  let sigRef: string;
  try {
    sigRef = assertSafePackageRef(String(org.countersig_ref));
  } catch (err) {
    return { id: 'org_countersignature', status: 'fail', message: `Unsafe path: ${(err as Error).message}` };
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = readFileBytes(packageFiles, sigRef);
  } catch (err) {
    return { id: 'org_countersignature', status: 'fail', message: `Org countersignature file not readable: ${(err as Error).message}` };
  }

  const signedContentJcs = canonicalizeJcs(buildSignedContent(content, signature));
  const ok = await verifyDetached(sigBytes, utf8ToBytes(signedContentJcs), orgPublicKey);
  return {
    id: 'org_countersignature',
    status: ok ? 'ok' : 'fail',
    message: ok
      ? 'Organizational Ed25519 countersignature over signed_content (content ∪ signature) verifies.'
      : 'Organizational countersignature does not verify against signed_content.',
  };
}

async function checkTimestamp(
  packageFiles: FileTree,
  timestamps: Array<Record<string, unknown>> | undefined,
  contentHashHex: string,
  checkBitcoinSource: string | undefined,
  confirmBitcoinAnchor: ConfirmBitcoinAnchor | undefined,
): Promise<CheckResult> {
  const proofRef = timestamps?.[0]?.proof_ref;
  if (typeof proofRef !== 'string') {
    return { id: 'timestamp', status: 'fail', message: 'No timestamp proof_ref present in the manifest.' };
  }

  let safeProofRef: string;
  try {
    safeProofRef = assertSafePackageRef(proofRef);
  } catch (err) {
    return { id: 'timestamp', status: 'fail', message: `Unsafe path: ${(err as Error).message}` };
  }

  let proofBytes: Uint8Array;
  try {
    proofBytes = readFileBytes(packageFiles, safeProofRef);
  } catch (err) {
    return { id: 'timestamp', status: 'fail', message: `Timestamp proof file not readable: ${(err as Error).message}` };
  }

  const result = checkBitcoinSource
    ? await (confirmBitcoinAnchor?.(contentHashHex, proofBytes, checkBitcoinSource) ??
        Promise.resolve({
          status: 'not_determined' as const,
          level: 'bound' as const,
          message:
            'Bitcoin chain confirmation was requested, but no Node-only confirmer was provided. ' +
            'The browser/default verifier did not attempt network confirmation.',
          attestations: [],
        }))
    : await verifyTimestampProofOffline(contentHashHex, proofBytes);

  return {
    id: 'timestamp',
    status: result.status,
    message: result.message,
    details: { level: result.level, attestations: result.attestations },
  };
}

interface CustodyEventReport {
  index: number;
  event: unknown;
  actor: unknown;
  ok: boolean;
  reason?: string;
}

async function checkCustody(packageFiles: FileTree, custody: Array<Record<string, unknown>> | undefined): Promise<CheckResult> {
  if (!custody || custody.length === 0) {
    return { id: 'custody', status: 'ok', message: 'No custody events present.' };
  }

  const perEvent: CustodyEventReport[] = [];
  let previousAtMs: number | null = null;

  for (let i = 0; i < custody.length; i++) {
    const event = custody[i]!;
    const issues: string[] = [];

    if (i === 0 && event.event !== 'captured') {
      issues.push(`chain must start with "captured", but custody[0].event is "${String(event.event)}"`);
    }

    const at = String(event.at);
    const atMs = Date.parse(at);
    if (Number.isNaN(atMs)) {
      issues.push(`malformed "at" timestamp: "${at}"`);
    } else {
      if (previousAtMs !== null && atMs < previousAtMs) {
        issues.push(`out of order: at (${at}) precedes the previous event's at`);
      }
      previousAtMs = atMs;
    }

    let pubKeyRef: string | null = null;
    let sigRef: string | null = null;
    try {
      pubKeyRef = assertSafePackageRef(String(event.actor_public_key_ref));
      sigRef = assertSafePackageRef(String(event.sig_ref));
    } catch (err) {
      issues.push(`unsafe path: ${(err as Error).message}`);
    }

    if (pubKeyRef && sigRef) {
      let pubKeyBytes: Uint8Array | null = null;
      try {
        pubKeyBytes = readFileBytes(packageFiles, pubKeyRef);
      } catch (err) {
        issues.push(`actor public key not readable: ${(err as Error).message}`);
      }

      if (pubKeyBytes) {
        const actualKeySha256 = await sha256Hex(pubKeyBytes);
        if (actualKeySha256 !== event.actor_public_key_sha256) {
          issues.push(
            `actor public key hashes to ${actualKeySha256}, not actor_public_key_sha256 (${String(event.actor_public_key_sha256)})`,
          );
        } else {
          try {
            const sigBytes = readFileBytes(packageFiles, sigRef);
            const eventHash = await computeCustodyEventHash({ event: String(event.event), actor: String(event.actor), at });
            const ok = await verifyDetached(sigBytes, eventHash, pubKeyBytes);
            if (!ok) issues.push('signature does not verify against event_hash');
          } catch (err) {
            issues.push(`signature file not readable: ${(err as Error).message}`);
          }
        }
      }
    }

    perEvent.push({ index: i, event: event.event, actor: event.actor, ok: issues.length === 0, reason: issues.length > 0 ? issues.join('; ') : undefined });
  }

  const allOk = perEvent.every((e) => e.ok);
  return {
    id: 'custody',
    status: allOk ? 'ok' : 'fail',
    message: allOk
      ? `All ${perEvent.length} custody event(s) verified: starts with "captured", chronologically ordered, each actor's signature verifies.`
      : 'One or more custody events failed verification (see details).',
    details: { events: perEvent },
  };
}

async function checkRedactions(
  packageFiles: FileTree,
  redactions: Array<Record<string, unknown>> | undefined,
  assets: Array<Record<string, unknown>>,
): Promise<CheckResult> {
  const fieldResults = (redactions ?? []).map((redaction) => {
    const commitment = redaction.commitment;
    const wellFormed = typeof commitment === 'string' && /^[0-9a-f]{64}$/.test(commitment);
    return {
      field: redaction.field,
      status: redaction.status,
      ok: wellFormed,
      reason: wellFormed ? undefined : 'commitment is not a well-formed 64-hex SHA-256 digest',
    };
  });

  const withheldAssets = assets.filter((asset) => asset.withheld === true);
  const assetResults = await Promise.all(
    withheldAssets.map(async (asset) => {
      let present = false;
      try {
        present = fileExists(packageFiles, `assets/${String(asset.filename)}`);
      } catch {
        present = false;
      }
      return {
        filename: asset.filename,
        sha256: asset.sha256,
        present,
        status: 'withheld but committed',
      };
    }),
  );

  if (fieldResults.length === 0 && assetResults.length === 0) {
    return { id: 'redactions', status: 'ok', message: 'No redactions present.' };
  }

  const allOk = fieldResults.every((f) => f.ok);
  return {
    id: 'redactions',
    status: allOk ? 'ok' : 'fail',
    message: allOk
      ? `${fieldResults.length} field redaction(s) well-formed; ${assetResults.length} withheld asset(s) committed via their signed sha256. ` +
        'Confirming a specific commitment matches a real (salt, value) requires reveal mode.'
      : 'One or more redaction commitments are malformed.',
    details: { fields: fieldResults, assets: assetResults },
  };
}

export async function verifyPackageFiles(packageFiles: FileTree, options: VerifyFileTreeOptions = {}): Promise<VerifyReport> {
  const packagePath = options.packagePath ?? '(in-memory package)';
  if (options.readError) {
    return failClosedReport(packagePath, [options.readError]);
  }

  let manifestRaw: string;
  try {
    manifestRaw = bytesToUtf8(readFileBytes(packageFiles, MANIFEST_FILE));
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
  const { contentHash, contentHashHex } = await computeContentHash(content);

  const packageIdCheck = checkPackageId(manifest, contentHashHex);
  const integrityCheck = await checkIntegrity(packageFiles, manifest.assets as Array<Record<string, unknown>>);
  const fieldSigCheck = await checkFieldSignature(packageFiles, signature as Record<string, unknown>, contentHash);
  const { result: orgIdentityCheck, orgPublicKey } = checkOrgIdentity(org as Record<string, unknown>, options.transparencyFiles);
  const orgCountersigCheck = await checkOrgCountersignature(
    packageFiles,
    org as Record<string, unknown>,
    content,
    signature as Record<string, unknown>,
    orgIdentityCheck,
    orgPublicKey,
  );
  const timestampCheck = await checkTimestamp(
    packageFiles,
    manifest.timestamps as Array<Record<string, unknown>> | undefined,
    contentHashHex,
    options.checkBitcoinSource,
    options.confirmBitcoinAnchor,
  );
  const custodyCheck = await checkCustody(packageFiles, manifest.custody as Array<Record<string, unknown>> | undefined);
  const redactionsCheck = await checkRedactions(
    packageFiles,
    manifest.redactions as Array<Record<string, unknown>> | undefined,
    manifest.assets as Array<Record<string, unknown>>,
  );

  const checks: CheckResult[] = [
    integrityCheck,
    fieldSigCheck,
    orgCountersigCheck,
    orgIdentityCheck,
    timestampCheck,
    packageIdCheck,
    custodyCheck,
    redactionsCheck,
  ];
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
