// Golden vectors of the field generator (TV-001). Every entry of test/golden/field_v1.json is recomputed
// from its rule and compared byte for byte. The file is written by scripts/build-golden.ts (TV-004: a change
// of bytes is a new version, field_v2.json).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateBoardTrace, BOARD_BYTES, boardViolations, type GateType } from '../src/board.ts';
import { kdf, SEED_BYTES, u32be, Xoshiro128ss } from '../src/prng.ts';
import { sha256, toHex, fromHex, utf8 } from '../src/sha256.ts';
import { GOLDEN_WAVES, GOLDEN_SEED_COUNT } from '../scripts/build-golden.ts';

interface GoldenField {
  seed_index: number;
  seed_label: string;
  S: string;
  w: number;
  attempt: number;
  fallback: boolean;
  x0_before: number;
  template: number;
  slots: number[];
  gates: GateType[];
  paths: number[][];
  bytes_hex: string;
  board_sha256: string;
}

interface GoldenFile {
  version: number;
  sha256_vectors: { message_ascii: string; sha256: string }[];
  prng_vector: { S: string; label: string; i1: number; i2: number; subseed_hex: string; outputs: number[] };
  kdf_records: { label: string; s_hex: string; i1: number; i2: number; subseed_hex: string; m_hex: string }[];
  golden_seeds: { index: number; label: string; S: string }[];
  fields: GoldenField[];
}

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden', 'field_v1.json'), 'utf8')) as GoldenFile;

describe('golden file layout (TV-001)', () => {
  it('has 21 seeds (20 G_k and the fixed S) and 15 waves, so 315 fields', () => {
    expect(golden.golden_seeds.length).toBe(GOLDEN_SEED_COUNT + 1);
    expect(golden.fields.length).toBe((GOLDEN_SEED_COUNT + 1) * GOLDEN_WAVES);
    expect(golden.version).toBe(1);
  });

  it('has at least 10 KDF records with their subseeds', () => {
    expect(golden.kdf_records.length).toBeGreaterThanOrEqual(10);
  });
});

describe('golden vectors are reproduced byte for byte (TV-001)', () => {
  it('reproduces the SHA-256 vectors of RNG-004', () => {
    for (const v of golden.sha256_vectors) {
      expect(toHex(sha256(utf8(v.message_ascii)))).toBe(v.sha256);
    }
  });

  it('reproduces the 16 PRNG outputs of the spec subseed', () => {
    const v = golden.prng_vector;
    const sub = kdf(fromHex(v.S), v.label, v.i1, v.i2);
    expect(toHex(sub)).toBe(v.subseed_hex);
    const rng = new Xoshiro128ss(sub);
    expect(Array.from({ length: 16 }, () => rng.next())).toEqual(v.outputs);
  });

  it('reproduces every KDF record: message and subseed', () => {
    for (const r of golden.kdf_records) {
      const s = fromHex(r.s_hex);
      const label = utf8(r.label);
      const m = new Uint8Array([...utf8('CQ1'), ...s, label.length, ...label, ...u32be(r.i1), ...u32be(r.i2)]);
      expect(toHex(m)).toBe(r.m_hex);
      expect(toHex(kdf(s, r.label, r.i1, r.i2))).toBe(r.subseed_hex);
    }
  });

  it('reproduces the 21 golden seeds from the documented rule (G_k = SHA-256("cupquest-golden-v1" || u32be(k)))', () => {
    const expected: string[] = [];
    for (let k = 0; k < GOLDEN_SEED_COUNT; k++) {
      expected.push(toHex(sha256(new Uint8Array([...utf8('cupquest-golden-v1'), ...u32be(k)])).slice(0, SEED_BYTES)));
    }
    expected.push('00112233445566778899aabbccddeeff');
    expect(golden.golden_seeds.map((g) => g.S)).toEqual(expected);
  });

  it('reproduces every one of the 315 fields: all values, bytes and board hash', () => {
    for (const entry of golden.fields) {
      const seedHex = golden.golden_seeds[entry.seed_index]?.S;
      expect(seedHex, `seed ${entry.seed_index}`).toBe(entry.S);
      const trace = generateBoardTrace(fromHex(entry.S), entry.w);
      const b = trace.board;
      const where = `${entry.seed_label} w=${entry.w}`;
      expect(b.attempt, where).toBe(entry.attempt);
      expect(trace.fallback, where).toBe(entry.fallback);
      expect(b.x0Before, where).toBe(entry.x0_before);
      expect(b.template, where).toBe(entry.template);
      expect([...b.slots], where).toEqual(entry.slots);
      expect([...b.gates], where).toEqual(entry.gates);
      expect(b.paths.map((p) => [...p]), where).toEqual(entry.paths);
      expect(toHex(b.bytes), where).toBe(entry.bytes_hex);
      expect(entry.bytes_hex.length, where).toBe(BOARD_BYTES * 2);
      expect(b.hash, where).toBe(entry.board_sha256);
      expect(toHex(sha256(b.bytes)), where).toBe(entry.board_sha256);
      expect(boardViolations(b), where).toEqual([]);
    }
  });

  it('keeps the fixed-seed wave 1 entry equal to the spec vector (TV-001)', () => {
    const entry = golden.fields.find((f) => f.seed_label === 'S_fixed' && f.w === 1);
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      attempt: 0,
      template: 2,
      slots: [0, 3, 5, 7, 8],
      gates: ['x2', 'x1', 'x2', 'x5', 'x2'],
      board_sha256: '08f83ad94c7b9c754f69c87b6b81cf241a93d3b66e5e1f34819bbabc8dabf474',
    });
  });
});

describe('golden coverage (TV-002)', () => {
  it('has one field of each template, and a field with two or more x0 before conversion', () => {
    const templates = new Set(golden.fields.map((f) => f.template));
    expect([...templates].sort()).toEqual([0, 1, 2]);
    expect(golden.fields.some((f) => f.x0_before >= 2)).toBe(true);
  });

  it('has no fallback field, since the fallback is used only when all ten attempts fail (TV-005)', () => {
    expect(golden.fields.some((f) => f.fallback)).toBe(false);
  });
});
