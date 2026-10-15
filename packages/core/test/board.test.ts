import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  boardViolations,
  buildFromSubseed,
  dropBall,
  fallbackSeeds,
  generateBoard,
  generateWith,
  GATE_CODE,
  GATE_TYPES,
  FALLBACK_ATTEMPT,
  BOARD_BYTES,
  type Board,
  type GateType,
} from '../src/board.ts';
import { kdf, SEED_BYTES, Xoshiro128ss } from '../src/prng.ts';
import { sha256, fromHex, toHex, utf8 } from '../src/sha256.ts';
import { FIELD } from '../src/config.ts';
import { simulateSample } from './support/sim.ts';
import fallbackJson from '../src/data/fallback_v1.json' with { type: 'json' };

const S_GOLD = fromHex('00112233445566778899aabbccddeeff');
const here = dirname(fileURLToPath(import.meta.url));

/** Seeds used by the validity sweeps: 2000 run seeds from a fixed root (test data only). */
function sweepSeeds(count: number): Uint8Array[] {
  const root = sha256(utf8('cupquest-test-sweep-v1'));
  const out: Uint8Array[] = [];
  for (let k = 0; k < count; k++) {
    const kBytes = new Uint8Array([(k >>> 24) & 0xff, (k >>> 16) & 0xff, (k >>> 8) & 0xff, k & 0xff]);
    out.push(sha256(new Uint8Array([...root, ...kBytes])).slice(0, SEED_BYTES));
  }
  return out;
}

describe('field golden vector (TV-001)', () => {
  const board = generateBoard(S_GOLD, 1);

  it('uses attempt 0 with template 2', () => {
    expect(board.attempt).toBe(0);
    expect(board.template).toBe(2);
    expect(board.slots).toEqual([0, 3, 5, 7, 8]);
  });

  it('has the spec gate types in the spec slot order', () => {
    expect(board.gates).toEqual(['x2', 'x1', 'x2', 'x5', 'x2']);
  });

  it('has the spec paths P_0..P_4', () => {
    expect(board.paths).toEqual([
      [0, 1, 0, 1, 1, 0, 1, 0, 0],
      [2, 2, 2, 2, 3, 4, 3, 3, 3],
      [4, 3, 4, 5, 4, 5, 5, 5, 5],
      [6, 7, 7, 6, 7, 7, 6, 7, 7],
      [8, 8, 8, 7, 8, 8, 8, 8, 8],
    ]);
  });

  it('serializes to 58 bytes with the spec SHA-256', () => {
    expect(board.bytes.length).toBe(BOARD_BYTES);
    expect(board.hash).toBe('08f83ad94c7b9c754f69c87b6b81cf241a93d3b66e5e1f34819bbabc8dabf474');
    expect(toHex(sha256(board.bytes))).toBe(board.hash);
    expect(toHex(board.bytes)).toBe(
      '01000200020301050207040802000100010100010000020202020304030303040304050405050505060707060707060707080808070808080808',
    );
  });
});

describe('board validity over many seeds (GEN-019, GEN-015)', () => {
  const seeds = sweepSeeds(2000);

  it('every board has 5 gates, at most one x0, paths of 9 cells that reach their gates', () => {
    let boards = 0;
    for (const seed of seeds) {
      for (let w = 1; w <= 15; w++) {
        const b = generateBoard(seed, w);
        boards++;
        expect(boardViolations(b)).toEqual([]);
        expect(b.gates.length).toBe(5);
        expect(b.gates.filter((g) => g === 'x0').length).toBeLessThanOrEqual(1);
        for (let col = 0; col < 5; col++) {
          const { path, gate } = dropBall(b, col);
          expect(path.length).toBe(9);
          expect(path[0]).toBe(FIELD.dropX[col]);
          expect(path[8]).toBe(b.slots[col]);
          expect(gate).toBe(b.gates[col]);
        }
      }
    }
    expect(boards).toBe(30000);
  }, 120000);

  it('covers all three templates and boards with two or more x0 before conversion (TV-002)', () => {
    const templates = new Set<number>();
    let multiX0 = 0;
    for (const seed of seeds) {
      for (let w = 1; w <= 15; w++) {
        const b = generateBoard(seed, w);
        templates.add(b.template);
        if (b.x0Before >= 2) multiX0++;
      }
    }
    expect([...templates].sort()).toEqual([0, 1, 2]);
    expect(multiX0).toBeGreaterThan(0);
  }, 60000);

  it('is reproducible: the same S and w give byte-identical boards', () => {
    const a = generateBoard(seeds[7] as Uint8Array, 9);
    const b = generateBoard(seeds[7] as Uint8Array, 9);
    expect(toHex(a.bytes)).toBe(toHex(b.bytes));
  });
});

describe('gate type shares on the BAL-005 sample (BAL-009, BAL-010)', () => {
  // 10 000 run seeds x 15 waves = 150 000 fields, 750 000 slots. The tolerance is the spec value of 0.5 percentage points.
  const sample = simulateSample(10000);

  it('every gate type is within 0.5 percentage points of its expected share (BAL-010)', () => {
    const expected: Record<GateType, number> = { x0: 0.082, x1: 0.168, x2: 0.3, x3: 0.25, x5: 0.2 };
    const slots = sample.fields * 5;
    for (const g of GATE_TYPES) {
      expect(Math.abs(sample.slots[g] / slots - expected[g]), g).toBeLessThanOrEqual(0.005);
    }
  }, 120000);

  it('has no fallback field and no dead end in the sample (BAL-010, TV-005)', () => {
    expect(sample.fallback).toBe(0);
    expect(sample.deadEndByAttempt.every((v) => v === 0)).toBe(true);
  });
});

describe('fallback list (GEN-017, GEN-018)', () => {
  it('has 20 valid 16-byte seeds for each wave, all passing steps 1-4', () => {
    expect(fallbackJson.version).toBe(1);
    for (let w = 1; w <= 15; w++) {
      const hexes = (fallbackJson.waves as Record<string, string[]>)[String(w)] ?? [];
      expect(hexes.length).toBe(20);
      for (const hex of hexes) expect(hex).toMatch(/^[0-9a-f]{32}$/);
      const seeds = fallbackSeeds(w);
      for (const s of seeds) {
        const res = buildFromSubseed(s, w, FALLBACK_ATTEMPT);
        expect(res.ok).toBe(true);
      }
    }
  });

  it('regenerates the list exactly from the documented rule (GEN-018)', () => {
    for (let w = 1; w <= 15; w++) {
      const list: string[] = [];
      for (let k = 0; list.length < 20; k++) {
        const m = new Uint8Array([...utf8('cupquest-fb-v1'), (w >>> 24) & 0xff, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff, (k >>> 24) & 0xff, (k >>> 16) & 0xff, (k >>> 8) & 0xff, k & 0xff]);
        const seed = sha256(m).slice(0, 16);
        if (buildFromSubseed(seed, w, FALLBACK_ATTEMPT).ok) list.push(toHex(seed));
        expect(k).toBeLessThan(10000);
      }
      expect(list).toEqual((fallbackJson.waves as Record<string, string[]>)[String(w)]);
    }
  });

  it('uses the fallback branch when all ten attempts fail (injected builder, tests only)', () => {
    const forcedFail = (subseed: Uint8Array, wave: number, attempt: number) => {
      // Fail every normal attempt, keep the fallback seeds working.
      if (attempt !== FALLBACK_ATTEMPT) return { ok: false as const, reason: 'dead_end' as const };
      return buildFromSubseed(subseed, wave, attempt);
    };
    const trace = generateWith(S_GOLD, 3, forcedFail);
    expect(trace.fallback).toBe(true);
    expect(trace.failures.length).toBe(FIELD.attempts);
    expect(trace.board.attempt).toBe(FALLBACK_ATTEMPT);
    expect(boardViolations(trace.board)).toEqual([]);
    // GEN-017: the child is FB[w][bounded(n)] from the stream Xo(KDF(S, "fallback", w, 0)).
    const seeds = fallbackSeeds(3);
    const rng = new Xoshiro128ss(kdf(S_GOLD, 'fallback', 3, 0));
    const expected = buildFromSubseed(seeds[rng.bounded(seeds.length)] as Uint8Array, 3, FALLBACK_ATTEMPT);
    expect(expected.ok).toBe(true);
    if (expected.ok) expect(toHex(trace.board.bytes)).toBe(toHex(expected.board.bytes));
    // Deterministic in S.
    const again = generateWith(S_GOLD, 3, forcedFail);
    expect(toHex(again.board.bytes)).toBe(toHex(trace.board.bytes));
  });

  it('refuses to build a board when the attempt builder never succeeds on a fallback seed', () => {
    const alwaysFail = () => ({ ok: false as const, reason: 'validation' as const });
    expect(() => generateWith(S_GOLD, 2, alwaysFail)).toThrow(/fallback/);
  });
});

describe('retry branch (GEN-016) with an injected attempt builder (tests only)', () => {
  // TV-002 asks for a natural field with attempt >= 1. None was found (see README, open item); this test covers
  // the retry branch through the injected builder only, so it does not claim the natural case.
  it('uses attempt index 1 when attempt 0 is forced to fail', () => {
    const failFirst = (subseed: Uint8Array, wave: number, attempt: number) => {
      if (attempt === 0) return { ok: false as const, reason: 'dead_end' as const };
      return buildFromSubseed(subseed, wave, attempt);
    };
    const trace = generateWith(S_GOLD, 1, failFirst);
    expect(trace.board.attempt).toBe(1);
    expect(trace.failures).toEqual(['dead_end']);
    expect(trace.fallback).toBe(false);
  });
});

describe('no floating point or clock in the generator (GEN-003)', () => {
  it('the generator sources contain no Math.random, Date, parseFloat or fractional literals', () => {
    const files = ['../src/board.ts', '../src/prng.ts', '../src/sha256.ts', '../src/cards.ts'];
    for (const f of files) {
      const text = readFileSync(join(here, f), 'utf8')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n');
      expect(text, f).not.toMatch(/Math\.random/);
      expect(text, f).not.toMatch(/\bDate\b/);
      expect(text, f).not.toMatch(/parseFloat/);
      expect(text, f).not.toMatch(/\b\d+\.\d+\b/);
    }
  });
});

describe('gate codes (GEN-020)', () => {
  it('maps gate types to the byte codes of the spec', () => {
    expect(GATE_CODE).toEqual({ x0: 0, x1: 1, x2: 2, x3: 3, x5: 4 });
    expect(GATE_TYPES).toEqual(['x0', 'x1', 'x2', 'x3', 'x5']);
  });

  it('serialization round-trips the slot and gate pairs', () => {
    const b: Board = generateBoard(S_GOLD, 1);
    for (let j = 0; j < 5; j++) {
      expect(b.bytes[3 + 2 * j]).toBe(b.slots[j]);
      expect(b.bytes[4 + 2 * j]).toBe(GATE_CODE[b.gates[j]!]);
    }
  });
});
