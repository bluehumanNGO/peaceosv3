import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCheck } from '../src/commands/check.js';
import { runCreate } from '../src/commands/create.js';
import { runKeygen } from '../src/commands/keygen.js';

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

async function makeWorkDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaceos-cli-'));
}

describe('peaceos-verify create + check (end to end through the CLI layer)', () => {
  it('creates a package with keygen-generated keys, and check reports it authentic', async () => {
    const workDir = await makeWorkDir();
    const outDir = join(workDir, 'package.vep');
    const transparencyDir = join(workDir, 'transparency');
    const assetPath = join(workDir, 'testimonio_01.txt');
    await writeFile(assetPath, 'evidence bytes\n', 'utf8');

    const fieldPrefix = join(workDir, 'field-01');
    const orgPrefix = join(workDir, 'org-2026');
    expect(await runKeygen(['--out', fieldPrefix])).toBe(0);
    expect(await runKeygen(['--out', orgPrefix])).toBe(0);

    const { readFile } = await import('node:fs/promises');
    const orgPublicKey = await readFile(`${orgPrefix}.pub`);
    await mkdir(join(transparencyDir, 'keys', 'org-recolectora'), { recursive: true });
    await writeFile(join(transparencyDir, 'keys', 'org-recolectora', 'org-2026.pub'), orgPublicKey);

    const createExitCode = await runCreate([
      '--asset',
      assetPath,
      '--field-key',
      fieldPrefix,
      '--field-key-id',
      'field-01',
      '--org-key',
      orgPrefix,
      '--org-id',
      'org-recolectora',
      '--org-key-id',
      'org-2026',
      '--transparency-ref',
      `git:keys@${'0'.repeat(40)}`,
      '--out',
      outDir,
      '--timestamp',
      'local-pending',
    ]);
    expect(createExitCode, errors.join('\n')).toBe(0);
    expect(logs.some((line) => line.startsWith('Created '))).toBe(true);

    logs = [];
    const checkExitCode = await runCheck([outDir, '--transparency', transparencyDir]);
    expect(checkExitCode, logs.join('\n')).toBe(0);
    expect(logs.join('\n')).toContain('Verdict: AUTHENTIC');
    expect(logs.join('\n')).toContain('Integrity: OK');
  });

  it('check exits non-zero and reports PROBLEMS DETECTED for a tampered asset', async () => {
    const workDir = await makeWorkDir();
    const outDir = join(workDir, 'package.vep');
    const transparencyDir = join(workDir, 'transparency');
    const assetPath = join(workDir, 'testimonio_01.txt');
    await writeFile(assetPath, 'evidence bytes\n', 'utf8');

    const fieldPrefix = join(workDir, 'field-01');
    const orgPrefix = join(workDir, 'org-2026');
    await runKeygen(['--out', fieldPrefix]);
    await runKeygen(['--out', orgPrefix]);

    const { readFile, writeFile: writeFileAsync } = await import('node:fs/promises');
    const orgPublicKey = await readFile(`${orgPrefix}.pub`);
    await mkdir(join(transparencyDir, 'keys', 'org-recolectora'), { recursive: true });
    await writeFile(join(transparencyDir, 'keys', 'org-recolectora', 'org-2026.pub'), orgPublicKey);

    await runCreate([
      '--asset',
      assetPath,
      '--field-key',
      fieldPrefix,
      '--field-key-id',
      'field-01',
      '--org-key',
      orgPrefix,
      '--org-id',
      'org-recolectora',
      '--org-key-id',
      'org-2026',
      '--transparency-ref',
      `git:keys@${'0'.repeat(40)}`,
      '--out',
      outDir,
      '--timestamp',
      'local-pending',
    ]);

    await writeFileAsync(join(outDir, 'assets', 'testimonio_01.txt'), 'tampered bytes\n', 'utf8');

    logs = [];
    const checkExitCode = await runCheck([outDir, '--transparency', transparencyDir]);
    expect(checkExitCode).toBe(1);
    expect(logs.join('\n')).toContain('Verdict: PROBLEMS DETECTED');
    expect(logs.join('\n')).toContain('Integrity: FAIL');
  });

  it('check --json emits a machine-readable report', async () => {
    const workDir = await makeWorkDir();
    const outDir = join(workDir, 'package.vep');
    const assetPath = join(workDir, 'testimonio_01.txt');
    await writeFile(assetPath, 'evidence bytes\n', 'utf8');

    const fieldPrefix = join(workDir, 'field-01');
    const orgPrefix = join(workDir, 'org-2026');
    await runKeygen(['--out', fieldPrefix]);
    await runKeygen(['--out', orgPrefix]);

    await runCreate([
      '--asset',
      assetPath,
      '--field-key',
      fieldPrefix,
      '--field-key-id',
      'field-01',
      '--org-key',
      orgPrefix,
      '--org-id',
      'org-recolectora',
      '--org-key-id',
      'org-2026',
      '--transparency-ref',
      `git:keys@${'0'.repeat(40)}`,
      '--out',
      outDir,
      '--timestamp',
      'local-pending',
    ]);

    logs = [];
    await runCheck([outDir, '--json']);
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.checks).toHaveLength(6);
    expect(typeof parsed.verdict).toBe('string');
  });
});
