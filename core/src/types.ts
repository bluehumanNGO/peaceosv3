export type CheckStatus = 'ok' | 'fail' | 'not_determined';

export type CheckId =
  | 'integrity'
  | 'field_signature'
  | 'org_countersignature'
  | 'org_identity'
  | 'timestamp'
  | 'package_id'
  | 'custody'
  | 'redactions';

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface VerifyReport {
  packagePath: string;
  packageId: string | null;
  schemaValid: boolean;
  schemaErrors: string[];
  checks: CheckResult[];
  verdict: 'authentic' | 'problems_detected';
}

export interface BuildAssetInput {
  /** Local filesystem path to read the asset's bytes from. Read even when withheld, to compute sha256/size_bytes. */
  sourcePath: string;
  /** Filename inside the package (stored at assets/<filename>, unless withheld). */
  filename: string;
  mediaType: string;
  capturedAt?: string;
  captureClaim?: {
    app?: string;
    deviceKeyId?: string;
    locationPrecision?: string;
  };
  /** M2 §10: true = do not copy the bytes into assets/; the manifest still records sha256/size_bytes/media_type, signed as always. */
  withheld?: boolean;
}

export type CustodyEventType = 'captured' | 'imported' | 'exported' | 'reviewed';

export interface BuildCustodyEventInput {
  event: CustodyEventType;
  /** Also used as the key_id: the raw public key is written to keys/<actor>.pub. */
  actor: string;
  at: string;
  actorPublicKey: Uint8Array;
  actorPrivateKey: Uint8Array;
}

export interface BuildRedactionInput {
  field: string;
  /** Base64-encoded 32 random bytes (see generateRedactionSalt). Used only to compute the commitment; never written to the package. */
  saltBase64: string;
  /** The plaintext value being redacted. Used only to compute the commitment; never written to the package. */
  value: string;
  status?: 'withheld' | 'revealed';
}

export type TimestampMode =
  | { mode: 'network' }
  | { mode: 'local-pending'; calendarUri?: string }
  | { mode: 'precomputed'; proofBytes: Uint8Array };

export interface BuildInput {
  outDir: string;
  assets: BuildAssetInput[];
  createdAt?: string;
  fieldKeyId: string;
  fieldPublicKey: Uint8Array;
  fieldPrivateKey: Uint8Array;
  orgId: string;
  orgKeyId: string;
  orgPrivateKey: Uint8Array;
  transparencyRef: string;
  timestamp?: TimestampMode;
  custody?: BuildCustodyEventInput[];
  redactions?: BuildRedactionInput[];
}

export interface BuildResult {
  outDir: string;
  packageId: string;
  contentHashHex: string;
}

export interface RevealInput {
  field: string;
  saltBase64: string;
  value: string;
}

export interface RevealResult {
  field: string;
  matched: boolean;
  message: string;
}
