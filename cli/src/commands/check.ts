import { parseArgs } from 'node:util';

import { verify } from '@peaceos/core';

import { formatReportHuman } from '../report.js';

const USAGE = 'Usage: peaceos-verify check <package.vep> [--transparency <dir>] [--json]';

export async function runCheck(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      transparency: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const packagePath = positionals[0];
  if (!packagePath) {
    console.error(USAGE);
    return 1;
  }

  const report = await verify(packagePath, { transparencyDir: values.transparency });

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportHuman(report));
  }

  return report.verdict === 'authentic' ? 0 : 1;
}
