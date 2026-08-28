import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertSafePackageRef } from './refs.js';
import type { FileTree } from './file-tree.js';
import { verifyPackageFiles, type VerifyFileTreeOptions } from './verify.js';

export interface VerifyOptions {
  /** Local checkout of the public organizational-key transparency repo. Without it, org_identity and org_countersignature report not_determined — never ok. */
  transparencyDir?: string;
  /**
   * Opt-in only (A2): an Esplora-compatible Bitcoin endpoint the CALLER
   * supplies (their own node/explorer). When set, the timestamp check
   * additionally queries this one source to upgrade "bound (offline)" to
   * "anchored (chain-confirmed)". When unset (the default), the timestamp
   * check never makes a network request — this is the sacred default.
   */
  checkBitcoinSource?: string;
}

export async function readFileTreeFromDirectory(root: string): Promise<FileTree> {
  const files = new Map<string, Uint8Array>();

  async function walk(dir: string, segments: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const nextSegments = [...segments, entry.name];
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path, nextSegments);
        continue;
      }
      if (!entry.isFile()) continue;

      const ref = assertSafePackageRef(nextSegments.join('/'));
      files.set(ref, await readFile(path));
    }
  }

  await walk(root, []);
  return files;
}

export async function verifyDirectory(packagePath: string, options: VerifyOptions = {}) {
  let packageFiles: FileTree;
  try {
    packageFiles = await readFileTreeFromDirectory(packagePath);
  } catch (err) {
    return verifyPackageFiles(new Map(), { packagePath, readError: `manifest.json not readable: ${(err as Error).message}` });
  }

  const fileOptions: VerifyFileTreeOptions = {
    packagePath,
    packageFiles,
    checkBitcoinSource: options.checkBitcoinSource,
  };
  if (options.checkBitcoinSource) {
    fileOptions.confirmBitcoinAnchor = (await import('./timestamp-node.js')).confirmBitcoinAnchor;
  }

  if (options.transparencyDir) {
    try {
      fileOptions.transparencyFiles = await readFileTreeFromDirectory(options.transparencyDir);
    } catch {
      fileOptions.transparencyFiles = new Map();
    }
  }

  return verifyPackageFiles(packageFiles, fileOptions);
}
