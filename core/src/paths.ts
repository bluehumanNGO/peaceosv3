import { resolve, sep } from 'node:path';

export class UnsafePathError extends Error {
  constructor(public readonly ref: string) {
    super(`Unsafe path reference (rejected before any file was opened): "${ref}"`);
    this.name = 'UnsafePathError';
  }
}

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
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new UnsafePathError(String(ref));
  }
  if (ref.includes('\0') || ref.includes('\\')) {
    throw new UnsafePathError(ref);
  }
  if (ref.startsWith('/') || /^[a-zA-Z]:/.test(ref)) {
    throw new UnsafePathError(ref);
  }

  const segments = ref.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new UnsafePathError(ref);
  }

  const root = resolve(packageRoot);
  const resolved = resolve(root, ref);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new UnsafePathError(ref);
  }
  return resolved;
}
