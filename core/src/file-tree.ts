import { bytesToUtf8 } from './bytes.js';
import { assertSafePackageRef } from './refs.js';

export type FileTree = ReadonlyMap<string, Uint8Array>;

export function readTreeFile(files: FileTree, ref: string, label = 'file'): Uint8Array {
  const safeRef = assertSafePackageRef(ref);
  const bytes = files.get(safeRef);
  if (!bytes) {
    throw new Error(`${label} not found in file tree: "${safeRef}"`);
  }
  return bytes;
}

export function readTreeText(files: FileTree, ref: string, label = 'file'): string {
  return bytesToUtf8(readTreeFile(files, ref, label));
}
