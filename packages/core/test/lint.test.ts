// GEN-003: the generator is checked by ESLint (no-restricted-globals and the related rules) and by a run with
// Math.random and Date replaced by throwing functions (acceptance of section 4.5).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ESLint, Linter } from 'eslint';
import { generateBoard, generateBoardTrace } from '../src/board.ts';
import { sha256, toHex, utf8, fromHex } from '../src/sha256.ts';
import eslintConfig, { GENERATOR_FILES } from '../eslint.config.js';

const coreDir = join(dirname(fileURLToPath(import.meta.url)), '..');
// typescript-eslint and @eslint/core declare slightly different config types; the runtime shape is the same.
const config = eslintConfig as unknown as Linter.Config[];

describe('ESLint rules of the generator (GEN-003)', () => {
  it('the generator files have no lint errors', async () => {
    const eslint = new ESLint({ cwd: coreDir });
    const results = await eslint.lintFiles(GENERATOR_FILES);
    const problems = results.flatMap((r) => r.messages.map((m) => `${r.filePath}:${m.line} ${m.ruleId} ${m.message}`));
    expect(problems).toEqual([]);
  }, 120000);

  it('the rules reject Math.random, Date, parseFloat and fractional literals in generator code', () => {
    const linter = new Linter({ configType: 'flat' });
    const file = join(coreDir, 'src', 'board.ts');
    const cases: [string, string][] = [
      ['const r = Math.random();', 'no-restricted-properties'],
      ['const t = Date.now();', 'no-restricted-globals'],
      ['const p = parseFloat("1");', 'no-restricted-globals'],
      ['const f = 0.5;', 'no-restricted-syntax'],
    ];
    for (const [code, rule] of cases) {
      const ruleIds = linter.verify(code, config, file).map((m) => m.ruleId);
      expect(ruleIds, code).toContain(rule);
    }
    expect(linter.verify('const n = 4294967296 % 7;', config, file)).toEqual([]);
  });
});

describe('generator with Math.random and Date replaced by throwing functions (GEN-003)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('gives the same boards when the clock and the random source throw', () => {
    const seeds = [fromHex('00112233445566778899aabbccddeeff'), sha256(utf8('lint-seed')).slice(0, 16)];
    const expected: string[] = [];
    for (const seed of seeds) for (let w = 1; w <= 15; w++) expected.push(toHex(generateBoard(seed, w).bytes));

    const ThrowingDate = class {
      constructor() {
        throw new Error('Date must not be used by the generator');
      }
      static now(): number {
        throw new Error('Date.now must not be used by the generator');
      }
    };
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used by the generator');
    });
    vi.stubGlobal('Date', ThrowingDate);
    const got: string[] = [];
    let failure: unknown = null;
    try {
      for (const seed of seeds) for (let w = 1; w <= 15; w++) got.push(toHex(generateBoardTrace(seed, w).board.bytes));
    } catch (error) {
      failure = error;
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
    expect(failure).toBeNull();
    expect(got).toEqual(expected);
  });
});
