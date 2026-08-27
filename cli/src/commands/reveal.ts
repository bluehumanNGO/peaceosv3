import { parseArgs } from 'node:util';

import { reveal as revealField } from '@peaceos/core';

const USAGE = 'Usage: peaceos-verify reveal <package.vep> --field <name> --salt <base64> --value <text> [--json]';

export async function runReveal(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      field: { type: 'string' },
      salt: { type: 'string' },
      value: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const packagePath = positionals[0];
  const missing = (['field', 'salt', 'value'] as const).filter((flag) => !values[flag]);
  if (!packagePath || missing.length > 0) {
    console.error(USAGE);
    if (missing.length > 0) console.error(`Missing required flag(s): ${missing.map((flag) => `--${flag}`).join(', ')}`);
    return 1;
  }

  const result = await revealField(packagePath, { field: values.field!, saltBase64: values.salt!, value: values.value! });

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Field: ${result.field}`);
    console.log(`Matches committed value: ${result.matched ? 'YES' : 'NO'}`);
    console.log(result.message);
  }

  return result.matched ? 0 : 1;
}
