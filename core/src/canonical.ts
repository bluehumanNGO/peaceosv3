import canonicalize from 'canonicalize';
import { PACKAGE_ID_PREFIX } from '@peaceos/spec';

import { bytesToHex, utf8ToBytes } from './bytes.js';

export function canonicalizeJcs(value: unknown): string {
  const jcs = canonicalize(value);
  if (jcs === undefined) {
    throw new TypeError('Value is not JSON-canonicalizable (contains undefined, a function, or a symbol)');
  }
  return jcs;
}

export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof input === 'string' ? utf8ToBytes(input) : input;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return new Uint8Array(digest);
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  return bytesToHex(await sha256(input));
}

export interface ContentHashResult {
  contentHash: Uint8Array;
  contentHashHex: string;
  jcs: string;
}

export async function computeContentHash(content: Record<string, unknown>): Promise<ContentHashResult> {
  const jcs = canonicalizeJcs(content);
  const contentHash = await sha256(jcs);
  return { contentHash, contentHashHex: bytesToHex(contentHash), jcs };
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
