export type CheckStatus = 'ok' | 'fail' | 'not_determined';

export type CheckId = 'integrity' | 'field_signature' | 'org_countersignature' | 'org_identity' | 'timestamp' | 'package_id';

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
  /** Local filesystem path to read the asset's bytes from. */
  sourcePath: string;
  /** Filename inside the package (stored at assets/<filename>). */
  filename: string;
  mediaType: string;
  capturedAt?: string;
  captureClaim?: {
    app?: string;
    deviceKeyId?: string;
    locationPrecision?: string;
  };
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
}

export interface BuildResult {
  outDir: string;
  packageId: string;
  contentHashHex: string;
}
