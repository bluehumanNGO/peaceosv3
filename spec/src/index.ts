import schema from '../manifest.schema.json' with { type: 'json' };

export const MANIFEST_SCHEMA_VERSION = '0.1' as const;

export const manifestSchema = schema;

// Literals fixed by CRYPTO_CONTRACT.md. Named here so `core` (M1) has one
// canonical source for them instead of duplicating magic strings.
export const PACKAGE_ID_PREFIX = 'sha256:' as const;
export const CONTENT_HASH_ALG = 'sha256' as const;
export const FIELD_SIGNATURE_ALG = 'ed25519' as const;
export const TIMESTAMP_TARGET = 'content_hash' as const;
