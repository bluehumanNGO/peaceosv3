import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

interface TestPackage {
  outDir: string;
  transparencyDir: string;
}

async function createTestPackage(): Promise<TestPackage> {
  const workDir = await mkdtemp(join(tmpdir(), 'peaceos-cli-'));
  const outDir = join(workDir, 'package.vep');
  const transparencyDir = join(workDir, 'transparency');
  const assetPath = join(workDir, 'testimonio_01.txt');
  await writeFile(assetPath, 'evidence bytes\n', 'utf8');

  const fieldPrefix = join(workDir, 'field-01');
  const orgPrefix = join(workDir, 'org-2026');
  await runKeygen(['--out', fieldPrefix]);
  await runKeygen(['--out', orgPrefix]);

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
  if (createExitCode !== 0) throw new Error(`test fixture setup: create failed:\n${errors.join('\n')}`);

  return { outDir, transparencyDir };
}

describe('peaceos-verify create + check (end to end through the CLI layer)', () => {
  it('creates a package with keygen-generated keys, and check reports it authentic', async () => {
    const { outDir, transparencyDir } = await createTestPackage();

    logs = [];
    const checkExitCode = await runCheck([outDir, '--transparency', transparencyDir]);
    expect(checkExitCode, logs.join('\n')).toBe(0);
    expect(logs.join('\n')).toContain('Verdict: AUTHENTIC');
    expect(logs.join('\n')).toContain('Integrity: OK');
  });

  it('check exits non-zero and reports PROBLEMS DETECTED for a tampered asset', async () => {
    const { outDir, transparencyDir } = await createTestPackage();
    await writeFile(join(outDir, 'assets', 'testimonio_01.txt'), 'tampered bytes\n', 'utf8');

    logs = [];
    const checkExitCode = await runCheck([outDir, '--transparency', transparencyDir]);
    expect(checkExitCode).toBe(1);
    expect(logs.join('\n')).toContain('Verdict: PROBLEMS DETECTED');
    expect(logs.join('\n')).toContain('Integrity: FAIL');
  });

  it('check --json emits a machine-readable report', async () => {
    const { outDir } = await createTestPackage();

    logs = [];
    await runCheck([outDir, '--json']);
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.checks).toHaveLength(8);
    expect(typeof parsed.verdict).toBe('string');
  });

  it('A1: default check (no --check-bitcoin) reports "Timestamp: bound (offline)" and a chain-confirmation note under an AUTHENTIC verdict', async () => {
    const { outDir, transparencyDir } = await createTestPackage();

    logs = [];
    await runCheck([outDir, '--transparency', transparencyDir]);
    const output = logs.join('\n');
    expect(output).toContain('Timestamp: bound (offline)');
    expect(output).not.toContain('anchored (chain-confirmed)');
    expect(output).toContain('Note: timestamp not chain-confirmed; run with --check-bitcoin');
  });

  it('A2: --check-bitcoin reports NOT DETERMINED (never fail, never a silent ok) when chain confirmation cannot complete', async () => {
    // The fixture package is stamped with `--timestamp local-pending`, i.e.
    // its .ots only has a pending calendar attestation, no Bitcoin block yet
    // — exactly the "nothing to confirm against the chain yet" case. The
    // unreachable-endpoint path (a Bitcoin attestation present but the
    // supplied source can't be reached) is covered at the core level in
    // core/test/timestamp.test.ts; this test proves the CLI plumbs
    // not_determined through correctly either way.
    const { outDir, transparencyDir } = await createTestPackage();

    logs = [];
    const checkExitCode = await runCheck([outDir, '--transparency', transparencyDir, '--check-bitcoin', 'http://127.0.0.1:1/']);
    const output = logs.join('\n');
    expect(output).toContain('Timestamp: NOT DETERMINED (chain confirmation attempted)');
    expect(output).not.toContain('anchored (chain-confirmed)');
    expect(checkExitCode).toBe(1);
    expect(output).toContain('Verdict: PROBLEMS DETECTED');
  });
});
