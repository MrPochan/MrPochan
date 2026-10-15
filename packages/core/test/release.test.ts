// Release gate (BAL-002, CORE-009): the check exits 1 while a balance value is open, and 0 once none is.
// The expectations follow the data, so the test stays valid when the open values are filled in.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openBalanceEntries } from '../src/index.ts';
import { releaseExitCode } from '../scripts/release-check.ts';

const coreDir = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('release gate (BAL-002, CORE-009)', () => {
  it('exits 1 for any open entry and 0 for none', () => {
    expect(releaseExitCode([])).toBe(0);
    expect(releaseExitCode(['battle.waves[0].enemies'])).toBe(1);
  });

  it('the release command exits with the code the data implies, and names the open entries', () => {
    const open = openBalanceEntries();
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/release-check.ts'], { cwd: coreDir, encoding: 'utf8' });
    expect(run.status).toBe(open.length === 0 ? 0 : 1);
    if (open.length > 0) {
      expect(run.stderr).toContain(open[0]!);
    } else {
      expect(run.stdout).toContain('every balance value is set');
    }
  }, 60000);
});
