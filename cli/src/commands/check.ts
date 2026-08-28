import { parseArgs } from 'node:util';

import { readFileTreeFromDirectory } from '@peaceos/core/node-file-tree';
import { verifyPackageFiles } from '@peaceos/core/verify';

import { formatReportHuman } from '../report.js';

const USAGE = 'Usage: peaceos-verify check <package.vep> [--transparency <dir>] [--check-bitcoin <esplora-url>] [--json]';

export async function runCheck(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      transparency: { type: 'string' },
      'check-bitcoin': { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const packagePath = positionals[0];
  if (!packagePath) {
    console.error(USAGE);
    return 1;
  }

  // --check-bitcoin is opt-in only: absent, Verify never makes a network
  // request (see VerifyOptions.checkBitcoinSource in @peaceos/core). The
  // endpoint queried is always exactly and only what the caller passes here
  // — never a project-chosen default.
  let packageFiles;
  try {
    packageFiles = await readFileTreeFromDirectory(packagePath);
  } catch (err) {
    packageFiles = new Map();
    const report = await verifyPackageFiles(packageFiles, {
      packagePath,
      readError: `manifest.json not readable: ${(err as Error).message}`,
    });
    console.log(values.json ? JSON.stringify(report, null, 2) : formatReportHuman(report));
    return 1;
  }

  let transparencyFiles;
  try {
    transparencyFiles = values.transparency ? await readFileTreeFromDirectory(values.transparency) : undefined;
  } catch {
    transparencyFiles = new Map();
  }

  const report = await verifyPackageFiles(packageFiles, {
    packagePath,
    transparencyFiles,
    checkBitcoinSource: values['check-bitcoin'],
    confirmBitcoinAnchor: values['check-bitcoin']
      ? (await import('@peaceos/core/timestamp-node')).confirmBitcoinAnchor
      : undefined,
  });

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportHuman(report));
  }

  return report.verdict === 'authentic' ? 0 : 1;
}
