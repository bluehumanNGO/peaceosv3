import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveSafePath, UnsafePathError } from '../src/paths.js';

describe('resolveSafePath', () => {
  const root = resolve('/package-root');

  it('resolves an ordinary relative ref under the root', () => {
    expect(resolveSafePath(root, 'assets/testimonio_01.mp4')).toBe(join(root, 'assets', 'testimonio_01.mp4'));
  });

  it('resolves a nested ref under the root', () => {
    expect(resolveSafePath(root, 'keys/field-01.pub')).toBe(join(root, 'keys', 'field-01.pub'));
  });

  const attacks: Array<[string, string]> = [
    ['parent traversal', '../../../etc/passwd'],
    ['traversal after a legitimate-looking prefix', 'assets/../../../etc/passwd'],
    ['single-dot then traversal', './../secret'],
    ['bare parent segment', '..'],
    ['bare dot segment', '.'],
    ['absolute POSIX path', '/etc/passwd'],
    ['Windows drive-letter path', 'C:\\Windows\\System32\\config'],
    ['backslash separators', 'keys\\..\\..\\secret.pub'],
    ['empty string', ''],
    ['double slash producing an empty segment', 'assets//passwd'],
    ['trailing slash producing an empty segment', 'assets/'],
    ['embedded NUL byte', 'assets/file.txt\0.jpg'],
  ];

  it.each(attacks)('rejects %s ("%s") before any file would be opened', (_label, ref) => {
    expect(() => resolveSafePath(root, ref)).toThrow(UnsafePathError);
  });

  it('never returns a path outside the root, even when it does not throw', () => {
    const safeRefs = ['assets/a.txt', 'signatures/manifest.sig', 'keys/org/key.pub', 'a/b/c/d.bin'];
    for (const ref of safeRefs) {
      const resolved = resolveSafePath(root, ref);
      expect(resolved.startsWith(root)).toBe(true);
    }
  });
});
