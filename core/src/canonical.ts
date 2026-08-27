import { createHash } from 'node:crypto';

import canonicalize from 'canonicalize';
import { PACKAGE_ID_PREFIX } from '@peaceos/spec';

export function canonicalizeJcs(value: unknown): string {
  const jcs = canonicalize(value);
  if (jcs === undefined) {
    throw new TypeError('Value is not JSON-canonicalizable (contains undefined, a function, or a symbol)');
  }
  return jcs;
}

export function sha256(input: string | Uint8Array): Buffer {
  return createHash('sha256').update(typeof input === 'string' ? Buffer.from(input, 'utf8') : input).digest();
}

export function sha256Hex(input: string | Uint8Array): string {
  return sha256(input).toString('hex');
}

export interface ContentHashResult {
  contentHash: Buffer;
  contentHashHex: string;
  jcs: string;
}

export function computeContentHash(content: Record<string, unknown>): ContentHashResult {
  const jcs = canonicalizeJcs(content);
  const contentHash = sha256(jcs);
  return { contentHash, contentHashHex: contentHash.toString('hex'), jcs };
}

export function derivePackageId(contentHashHex: string): string {
  return `${PACKAGE_ID_PREFIX}${contentHashHex}`;
}

export function buildSignedContent(
  content: Record<string, unknown>,
  signature: Record<string, unknown>,
): Record<string, unknown> {
  return { ...content, signature };
}
