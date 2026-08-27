import { basename, extname } from 'node:path';
import { parseArgs } from 'node:util';

import { build, type BuildAssetInput, type TimestampMode } from '@peaceos/core';

import { readPrivateKeyFile, readPublicKeyFile } from '../keyfile.js';

const USAGE =
  'Usage: peaceos-verify create --asset <path>[:<media-type>] [--asset ...]\n' +
  '  --field-key <prefix> --field-key-id <id>\n' +
  '  --org-key <prefix> --org-id <id> --org-key-id <id>\n' +
  '  --transparency-ref <ref> --out <dir> [--timestamp network|local-pending]';

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function inferMediaType(path: string): string {
  return EXTENSION_MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function parseAssetSpec(spec: string): BuildAssetInput {
  const sepIndex = spec.lastIndexOf(':');
  // sepIndex === 1 is a Windows drive letter (e.g. "C:\..."), not a media-type separator.
  const hasMediaType = sepIndex > 1;
  const sourcePath = hasMediaType ? spec.slice(0, sepIndex) : spec;
  const mediaType = hasMediaType ? spec.slice(sepIndex + 1) : inferMediaType(spec);
  return { sourcePath, filename: basename(sourcePath), mediaType };
}

const REQUIRED_FLAGS = ['field-key', 'field-key-id', 'org-key', 'org-id', 'org-key-id', 'transparency-ref', 'out'] as const;

export async function runCreate(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      asset: { type: 'string', multiple: true },
      'field-key': { type: 'string' },
      'field-key-id': { type: 'string' },
      'org-key': { type: 'string' },
      'org-id': { type: 'string' },
      'org-key-id': { type: 'string' },
      'transparency-ref': { type: 'string' },
      out: { type: 'string' },
      timestamp: { type: 'string', default: 'network' },
    },
  });

  const missing = REQUIRED_FLAGS.filter((flag) => !values[flag]);
  if (!values.asset || values.asset.length === 0 || missing.length > 0) {
    console.error(USAGE);
    if (missing.length > 0) console.error(`Missing required flag(s): ${missing.map((flag) => `--${flag}`).join(', ')}`);
    if (!values.asset || values.asset.length === 0) console.error('At least one --asset is required.');
    return 1;
  }

  if (values.timestamp !== 'network' && values.timestamp !== 'local-pending') {
    console.error(`--timestamp must be "network" or "local-pending", got "${values.timestamp}"`);
    return 1;
  }

  // The `missing` check above already guarantees these are present; the
  // non-null assertions just restate that for the type checker.
  const fieldKeyPrefix = values['field-key']!;
  const fieldKeyId = values['field-key-id']!;
  const orgKeyPrefix = values['org-key']!;
  const orgId = values['org-id']!;
  const orgKeyId = values['org-key-id']!;
  const transparencyRef = values['transparency-ref']!;
  const outDir = values.out!;

  const assets = values.asset.map(parseAssetSpec);

  const [fieldPublicKey, fieldPrivateKey, orgPrivateKey] = await Promise.all([
    readPublicKeyFile(`${fieldKeyPrefix}.pub`),
    readPrivateKeyFile(`${fieldKeyPrefix}.key`),
    readPrivateKeyFile(`${orgKeyPrefix}.key`),
  ]);

  const timestampMode: TimestampMode =
    values.timestamp === 'local-pending' ? { mode: 'local-pending' } : { mode: 'network' };

  const result = await build({
    outDir,
    assets,
    fieldKeyId,
    fieldPublicKey,
    fieldPrivateKey,
    orgId,
    orgKeyId,
    orgPrivateKey,
    transparencyRef,
    timestamp: timestampMode,
  });

  console.log(`Created ${result.outDir}`);
  console.log(`package_id: ${result.packageId}`);
  return 0;
}
