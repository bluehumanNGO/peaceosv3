#!/usr/bin/env node
import { runCheck } from './commands/check.js';
import { runCreate } from './commands/create.js';
import { runKeygen } from './commands/keygen.js';
import { runReveal } from './commands/reveal.js';

const USAGE = 'Usage: peaceos-verify <create|check|keygen|reveal> [options]';

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'create':
      return runCreate(rest);
    case 'check':
      return runCheck(rest);
    case 'keygen':
      return runKeygen(rest);
    case 'reveal':
      return runReveal(rest);
    default:
      console.error(USAGE);
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
