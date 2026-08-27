export const MANIFEST_FILE = 'manifest.json';
export const ASSETS_DIR = 'assets';
export const SIGNATURES_DIR = 'signatures';
export const TIMESTAMPS_DIR = 'timestamps';
export const KEYS_DIR = 'keys';

export const MANIFEST_SIGNATURE_FILE = `${SIGNATURES_DIR}/manifest.sig`;
export const ORG_COUNTERSIGNATURE_FILE = `${SIGNATURES_DIR}/org-countersign.sig`;
export const TIMESTAMP_PROOF_FILE = `${TIMESTAMPS_DIR}/manifest.ots`;

export function assetRef(filename: string): string {
  return `${ASSETS_DIR}/${filename}`;
}

export function fieldPublicKeyRef(fieldKeyId: string): string {
  return `${KEYS_DIR}/${fieldKeyId}.pub`;
}

export function actorPublicKeyRef(actor: string): string {
  return `${KEYS_DIR}/${actor}.pub`;
}

/** Mirrors the spec-source.md example naming: signatures/captured-01.sig, signatures/imported-02.sig, ... */
export function custodyEventSigRef(event: string, indexOneBased: number): string {
  return `${SIGNATURES_DIR}/${event}-${String(indexOneBased).padStart(2, '0')}.sig`;
}
