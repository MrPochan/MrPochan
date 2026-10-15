// Release gate of the balance data (BAL-002, CORE-009). A release build fails while any balance value has
// source "open" or a null value. Test builds are not affected. Usage (from packages/core): npm run release:check

import { fileURLToPath } from 'node:url';
import { openBalanceEntries } from '../src/index.ts';

/** Exit code of the release gate: 0 when no balance entry is open, 1 otherwise. */
export function releaseExitCode(openEntries: readonly string[]): number {
  return openEntries.length === 0 ? 0 : 1;
}

function main(): void {
  const open = openBalanceEntries();
  if (open.length === 0) {
    console.log('release gate: every balance value is set (BAL-002)');
  } else {
    console.error(`release gate: ${open.length} balance values are still open (BAL-002, CORE-009):`);
    for (const path of open) console.error(`  ${path}`);
  }
  process.exitCode = releaseExitCode(open);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
