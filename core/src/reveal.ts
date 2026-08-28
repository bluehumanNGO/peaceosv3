import { readFile } from 'node:fs/promises';

import { MANIFEST_FILE } from './layout.js';
import { resolveSafePath } from './paths.js';
import { verifyRedactionReveal } from './redaction.js';
import type { RevealInput, RevealResult } from './types.js';

/**
 * Reveal mode (B2): given salt + value the organization custodies outside
 * the package, confirm they recompute the commitment recorded in the
 * manifest for `field`. Never partial, never a guess — requires the exact
 * salt and value; there is no "attempt without salt" path.
 */
export async function reveal(packagePath: string, input: RevealInput): Promise<RevealResult> {
  const manifestPath = resolveSafePath(packagePath, MANIFEST_FILE);
  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as { redactions?: Array<{ field: string; commitment: string }> };

  const entry = (manifest.redactions ?? []).find((r) => r.field === input.field);
  if (!entry) {
    return {
      field: input.field,
      matched: false,
      message: `No redaction entry for field "${input.field}" in this manifest.`,
    };
  }

  const matched = await verifyRedactionReveal(entry.commitment, input);
  return {
    field: input.field,
    matched,
    message: matched
      ? `The supplied (salt, value) recomputes to the committed digest for "${input.field}" — the disclosure matches what was committed at packaging time.`
      : `The supplied (salt, value) does NOT recompute to the committed digest for "${input.field}".`,
  };
}
