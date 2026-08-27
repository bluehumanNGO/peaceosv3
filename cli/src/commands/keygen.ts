import { parseArgs } from 'node:util';

import { generateEd25519Keypair } from '@peaceos/core';

import { writeKeypairFiles } from '../keyfile.js';

const USAGE = 'Usage: peaceos-verify keygen --out <key-file-prefix>';

export async function runKeygen(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { out: { type: 'string' } },
  });

  if (!values.out) {
    console.error(USAGE);
    return 1;
  }

  const keypair = await generateEd25519Keypair();
  const { publicKeyPath, privateKeyPath } = await writeKeypairFiles(values.out, keypair);
  console.log(`Wrote ${publicKeyPath} (public) and ${privateKeyPath} (private — keep this secret, never commit it).`);
  return 0;
}
