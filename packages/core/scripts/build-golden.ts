// Golden vectors of the field generator (spec TV-001, TV-005). Generated from the rules of GEN-001..GEN-020;
// the tests in test/golden.test.ts recompute every entry and compare it byte for byte.
// Usage (from packages/core):
//   npx tsx scripts/build-golden.ts golden  -> writes test/golden/field_v1.json (21 seeds x 15 waves = 315 fields)
//   npx tsx scripts/build-golden.ts tv005   -> writes test/golden/tv005_v1.json (1 000 seeds x 15 waves histogram)
// The files are generated; do not edit them by hand (TV-004: a change of bytes is a new version).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateBoardTrace, GATE_TYPES, type GateType } from '../src/board.ts';
import { kdf, Xoshiro128ss, u32be, SEED_BYTES } from '../src/prng.ts';
import { sha256, toHex, fromHex, utf8 } from '../src/sha256.ts';

export const GOLDEN_FIXED_SEED = '00112233445566778899aabbccddeeff';
export const GOLDEN_SEED_COUNT = 20;
export const GOLDEN_WAVES = 15;
export const TV005_SEEDS = 1000;

/** GEN-001 golden seeds: G_k = first 16 bytes of SHA-256("cupquest-golden-v1" || u32be(k)), k = 0..19, then the fixed S. */
export function goldenSeeds(): { index: number; label: string; seed: Uint8Array }[] {
  const root = utf8('cupquest-golden-v1');
  const out: { index: number; label: string; seed: Uint8Array }[] = [];
  for (let k = 0; k < GOLDEN_SEED_COUNT; k++) {
    out.push({ index: k, label: `G_${k}`, seed: sha256(new Uint8Array([...root, ...u32be(k)])).slice(0, SEED_BYTES) });
  }
  out.push({ index: GOLDEN_SEED_COUNT, label: 'S_fixed', seed: fromHex(GOLDEN_FIXED_SEED) });
  return out;
}

/** KDF records of TV-001: the spec vector, the two other `field` subseeds of the spec, and further labels. */
export function kdfRecords(): { label: string; s_hex: string; i1: number; i2: number; subseed_hex: string; m_hex: string }[] {
  const S = fromHex(GOLDEN_FIXED_SEED);
  const G0 = goldenSeeds()[0]!.seed;
  const G1 = goldenSeeds()[1]!.seed;
  const cases: { s: Uint8Array; label: string; i1: number; i2: number }[] = [
    { s: S, label: 'field', i1: 1, i2: 0 },
    { s: S, label: 'field', i1: 2, i2: 0 },
    { s: S, label: 'field', i1: 3, i2: 0 },
    { s: S, label: 'fallback', i1: 1, i2: 0 },
    { s: S, label: 'cards', i1: 1, i2: 0 },
    { s: S, label: 'cards', i1: 1, i2: 1 },
    { s: S, label: 'help', i1: 0, i2: 0 },
    { s: S, label: 'battle', i1: 1, i2: 0 },
    { s: S, label: 'test', i1: 0, i2: 0 },
    { s: G0, label: 'field', i1: 1, i2: 0 },
    { s: G1, label: 'field', i1: 15, i2: 9 },
    { s: G1, label: 'sim', i1: 0, i2: 4 },
  ];
  return cases.map(({ s, label, i1, i2 }) => {
    const labelBytes = utf8(label);
    const m = new Uint8Array([...utf8('CQ1'), ...s, labelBytes.length, ...labelBytes, ...u32be(i1), ...u32be(i2)]);
    return {
      label,
      s_hex: toHex(s),
      i1,
      i2,
      m_hex: toHex(m),
      subseed_hex: toHex(kdf(s, label, i1, i2)),
    };
  });
}

/** Sub-seeds and outputs of the PRNG vector of TV-001 (RNG-001, RNG-002). */
export function prngVector(): { subseed_hex: string; outputs: number[] } {
  const sub = kdf(fromHex(GOLDEN_FIXED_SEED), 'field', 1, 0);
  const rng = new Xoshiro128ss(sub);
  return { subseed_hex: toHex(sub), outputs: Array.from({ length: 16 }, () => rng.next()) };
}

export function buildGoldenFile(): object {
  const seeds = goldenSeeds();
  const fields: object[] = [];
  for (const { index, label, seed } of seeds) {
    for (let w = 1; w <= GOLDEN_WAVES; w++) {
      const trace = generateBoardTrace(seed, w);
      const b = trace.board;
      fields.push({
        seed_index: index,
        seed_label: label,
        S: toHex(seed),
        w,
        attempt: b.attempt,
        fallback: trace.fallback,
        x0_before: b.x0Before,
        template: b.template,
        slots: [...b.slots],
        gates: b.gates.map((g: GateType) => g),
        paths: b.paths.map((p) => [...p]),
        bytes_hex: toHex(b.bytes),
        board_sha256: b.hash,
      });
    }
  }
  return {
    version: 1,
    generated_by: 'scripts/build-golden.ts golden (TV-001)',
    field_version: 1,
    gate_types: [...GATE_TYPES],
    sha256_vectors: [
      { message_ascii: 'abc', sha256: toHex(sha256(utf8('abc'))) },
      { message_ascii: '', sha256: toHex(sha256(new Uint8Array(0))) },
    ],
    prng_vector: { S: GOLDEN_FIXED_SEED, label: 'field', i1: 1, i2: 0, ...prngVector() },
    kdf_records: kdfRecords(),
    golden_seeds: seeds.map(({ index, label, seed }) => ({ index, label, S: toHex(seed) })),
    fields,
  };
}

export function buildTv005File(): object {
  const root = sha256(utf8('cupquest-sim-v1')).slice(0, SEED_BYTES);
  const attempts = new Array<number>(10).fill(0);
  const deadEnd = new Array<number>(10).fill(0);
  const validation = new Array<number>(10).fill(0);
  let fallback = 0;
  let fields = 0;
  for (let k = 0; k < TV005_SEEDS; k++) {
    const seed = kdf(root, 'sim', 0, k);
    for (let w = 1; w <= GOLDEN_WAVES; w++) {
      const trace = generateBoardTrace(seed, w);
      fields++;
      if (trace.fallback) fallback++;
      else attempts[trace.board.attempt] = (attempts[trace.board.attempt] as number) + 1;
      trace.failures.forEach((reason, a) => {
        if (reason === 'dead_end') deadEnd[a] = (deadEnd[a] as number) + 1;
        else validation[a] = (validation[a] as number) + 1;
      });
    }
  }
  return {
    version: 1,
    generated_by: 'scripts/build-golden.ts tv005 (TV-005)',
    seeds: TV005_SEEDS,
    waves: GOLDEN_WAVES,
    fields,
    sim_seed_root: 'cupquest-sim-v1',
    seed_label: 'sim',
    attempt_histogram: attempts,
    fallback,
    dead_end_by_attempt: deadEnd,
    validation_by_attempt: validation,
  };
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const cmd = process.argv[2];
  const outDir = join(here, '..', 'test', 'golden');
  mkdirSync(outDir, { recursive: true });
  if (cmd === 'golden') {
    writeFileSync(join(outDir, 'field_v1.json'), JSON.stringify(buildGoldenFile(), null, 2) + '\n');
    console.log('wrote test/golden/field_v1.json');
  } else if (cmd === 'tv005') {
    writeFileSync(join(outDir, 'tv005_v1.json'), JSON.stringify(buildTv005File(), null, 2) + '\n');
    console.log('wrote test/golden/tv005_v1.json');
  } else {
    console.error('usage: build-golden.ts golden | tv005');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
