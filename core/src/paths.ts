import { resolve, sep } from 'node:path';

import { assertSafePackageRef, UnsafePathError } from './refs.js';

export { UnsafePathError };

/**
 * Resolves a manifest-supplied relative ref (public_key_ref, sig_ref,
 * proof_ref, countersig_ref, "assets/<filename>") against packageRoot.
 * Throws UnsafePathError — never returns a path outside packageRoot — for
 * absolute paths, drive letters, backslashes, and any "." or ".." segment.
 * Segment-level rejection makes this correct independent of host OS path
 * semantics; the trailing startsWith(root) check is defense in depth on top
 * of that, not the primary guarantee. MUST be called, and MUST succeed,
 * before the referenced file is opened.
 */
export function resolveSafePath(packageRoot: string, ref: string): string {
  const safeRef = assertSafePackageRef(ref);

  const root = resolve(packageRoot);
  const resolved = resolve(root, safeRef);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new UnsafePathError(safeRef);
  }
  return resolved;
}
