import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build, generateEd25519Keypair } from '@peaceos/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runReveal } from '../src/commands/reveal.js';

let logs: string[];
let errors: string[];

beforeEach(() => {
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((msg: string) => {
    logs.push(msg);
  });
  vi.spyOn(console, 'error').mockImplementation((msg: string) => {
    errors.push(msg);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function buildPackageWithRedaction() {
  const workDir = await mkdtemp(join(tmpdir(), 'peaceos-cli-reveal-'));
  const outDir = join(workDir, 'package.vep');
  const assetPath = join(workDir, 'testimonio_01.txt');
  await writeFile(assetPath, 'evidence bytes\n', 'utf8');
  await mkdir(workDir, { recursive: true });

  const [fieldKeypair, orgKeypair] = await Promise.all([generateEd25519Keypair(), generateEd25519Keypair()]);
  const saltBase64 = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');

  await build({
    outDir,
    assets: [{ sourcePath: assetPath, filename: 'testimonio_01.txt', mediaType: 'text/plain' }],
    fieldKeyId: 'field-01',
    fieldPublicKey: fieldKeypair.publicKey,
    fieldPrivateKey: fieldKeypair.privateKey,
    orgId: 'org-recolectora',
    orgKeyId: 'org-2026',
    orgPrivateKey: orgKeypair.privateKey,
    transparencyRef: `git:keys@${'0'.repeat(40)}`,
    timestamp: { mode: 'local-pending' },
    redactions: [{ field: 'witness_identity', saltBase64, value: 'Jane Doe' }],
  });

  return { outDir, saltBase64 };
}

describe('peaceos-verify reveal', () => {
  it('exits 0 and reports a match with the correct salt and value', async () => {
    const { outDir, saltBase64 } = await buildPackageWithRedaction();

    const exitCode = await runReveal([outDir, '--field', 'witness_identity', '--salt', saltBase64, '--value', 'Jane Doe']);

    expect(exitCode, errors.join('\n')).toBe(0);
    expect(logs.join('\n')).toContain('Matches committed value: YES');
  });

  it('exits 1 and reports no match with the wrong value', async () => {
    const { outDir, saltBase64 } = await buildPackageWithRedaction();

    const exitCode = await runReveal([outDir, '--field', 'witness_identity', '--salt', saltBase64, '--value', 'Someone Else']);

    expect(exitCode).toBe(1);
    expect(logs.join('\n')).toContain('Matches committed value: NO');
  });

  it('requires --field, --salt and --value', async () => {
    const exitCode = await runReveal(['some.vep']);
    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/missing required flag/i);
  });
});
