import type { FileTree } from '@peaceos/core/file-tree';

export interface BrowserDirectoryFile {
  name: string;
  webkitRelativePath?: string;
  relativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface BrowserFileSystemEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

interface BrowserFileSystemFileEntry extends BrowserFileSystemEntry {
  file(success: (file: File) => void, error?: (err: DOMException) => void): void;
}

interface BrowserFileSystemDirectoryEntry extends BrowserFileSystemEntry {
  createReader(): {
    readEntries(success: (entries: BrowserFileSystemEntry[]) => void, error?: (err: DOMException) => void): void;
  };
}

type DirectoryDataTransferItem = Omit<DataTransferItem, 'webkitGetAsEntry'> & {
  webkitGetAsEntry?: () => BrowserFileSystemEntry | null;
};

function normalizeRef(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+/, '').split('/').filter(Boolean).join('/');
}

function stripCommonRoot(paths: string[]): string[] {
  const splitPaths = paths.map((path) => path.split('/'));
  const firstSegment = splitPaths[0]?.[0];
  if (!firstSegment || splitPaths.some((segments) => segments[0] !== firstSegment || segments.length === 1)) {
    return paths;
  }
  return splitPaths.map((segments) => segments.slice(1).join('/'));
}

export async function buildFileTreeFromFiles(files: readonly BrowserDirectoryFile[]): Promise<FileTree> {
  const entries = await Promise.all(
    files.map(async (file) => ({
      path: normalizeRef(file.relativePath || file.webkitRelativePath || file.name),
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );

  const refs = stripCommonRoot(entries.map((entry) => entry.path));
  const tree = new Map<string, Uint8Array>();
  for (let i = 0; i < entries.length; i++) {
    const ref = refs[i]!;
    if (!ref) continue;
    if (tree.has(ref)) {
      throw new Error(`Duplicate file path in uploaded directory: "${ref}"`);
    }
    tree.set(ref, entries[i]!.bytes);
  }
  return tree;
}

async function readAllDirectoryEntries(entry: BrowserFileSystemDirectoryEntry): Promise<BrowserFileSystemEntry[]> {
  const reader = entry.createReader();
  const entries: BrowserFileSystemEntry[] = [];

  while (true) {
    const batch = await new Promise<BrowserFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
}

async function walkEntry(entry: BrowserFileSystemEntry, parentPath: string): Promise<BrowserDirectoryFile[]> {
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as BrowserFileSystemFileEntry).file(resolve, reject);
    });
    return [Object.assign(file, { relativePath: path })];
  }

  if (!entry.isDirectory) return [];
  const children = await readAllDirectoryEntries(entry as BrowserFileSystemDirectoryEntry);
  const nested = await Promise.all(children.map((child) => walkEntry(child, path)));
  return nested.flat();
}

export async function collectDroppedDirectoryFiles(dataTransfer: DataTransfer): Promise<BrowserDirectoryFile[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => (item as DirectoryDataTransferItem).webkitGetAsEntry?.())
    .filter((entry): entry is BrowserFileSystemEntry => !!entry);

  if (entries.length === 0) {
    return Array.from(dataTransfer.files);
  }

  const files = await Promise.all(entries.map((entry) => walkEntry(entry, '')));
  return files.flat();
}

export function describeFileTree(tree: FileTree | null): string {
  if (!tree) return 'Ninguna carpeta seleccionada';
  return `${tree.size} archivo(s) cargado(s) en memoria`;
}
