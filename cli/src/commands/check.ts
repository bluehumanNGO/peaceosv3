import { parseArgs } from 'node:util';

import { verify } from '@peaceos/core';

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

  // --check-bitcoin is opt-in only: absent, `verify` never makes a network
  // request (see VerifyOptions.checkBitcoinSource in @peaceos/core). The
  // endpoint queried is always exactly and only what the caller passes here
  // — never a project-chosen default.
  const report = await verify(packagePath, {
    transparencyDir: values.transparency,
    checkBitcoinSource: values['check-bitcoin'],
  });

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportHuman(report));
  }

  return report.verdict === 'authentic' ? 0 : 1;
}
