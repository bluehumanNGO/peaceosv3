export class UnsafePathError extends Error {
  constructor(public readonly ref: string) {
    super(`Unsafe path reference (rejected before any file was opened): "${ref}"`);
    this.name = 'UnsafePathError';
  }
}

export function assertSafePackageRef(ref: string): string {
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

  return ref;
}
