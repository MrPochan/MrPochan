// Offline build step for the balance data (spec GEN-018, BAL-004, BAL-005, BAL-006).
// Usage (from packages/core):
//   npx tsx scripts/build-data.ts fallback   -> writes src/data/fallback_v1.json
//   npx tsx scripts/build-data.ts gates      -> writes src/data/gates.json (10 000 run seeds, 150 000 fields)
//   npx tsx scripts/build-data.ts levels     -> prints the U(L) table and its sum (BAL-004)
// The fallback list and gates.json are generated files; do not edit them by hand (BAL-008).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildFromSubseed, generateBoardTrace, GATE_TYPES, FALLBACK_ATTEMPT, type GateType } from '../src/board.ts';
import { kdf, u32be, SEED_BYTES } from '../src/prng.ts';
import { sha256, utf8, toHex } from '../src/sha256.ts';
import { FIELD } from '../src/config.ts';
import economy from '../src/data/economy.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'src', 'data');
const cmd = process.argv[2];

const FALLBACK_PER_WAVE = 20;

function buildFallback(): void {
  const waves: Record<string, string[]> = {};
  for (let w = 1; w <= 15; w++) {
    const list: string[] = [];
    for (let k = 0; list.length < FALLBACK_PER_WAVE; k++) {
      // GEN-018: seed = first 16 bytes of SHA-256("cupquest-fb-v1" || u32be(w) || u32be(k)).
      const m = new Uint8Array([...utf8('cupquest-fb-v1'), ...u32be(w), ...u32be(k)]);
      const seed = sha256(m).slice(0, SEED_BYTES);
      const res = buildFromSubseed(seed, w, FALLBACK_ATTEMPT);
      if (res.ok) list.push(toHex(seed));
      if (k > 100000) throw new Error('could not find enough fallback seeds');
    }
    waves[String(w)] = list;
  }
  const out = { version: 1, generated_by: 'scripts/build-data.ts fallback (GEN-018)', waves };
  writeFileSync(join(dataDir, 'fallback_v1.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote fallback_v1.json: ${FALLBACK_PER_WAVE} seeds x 15 waves`);
}

function levelTable(): number[] {
  // ECO-004: U(L) = round_half_up(50 * L^1.4). Used only to cross-check the stored table.
  const out: number[] = [];
  for (let L = 2; L <= 20; L++) {
    const exact = 50 * Math.pow(L, 1.4);
    out.push(Math.floor(exact + 0.5));
  }
  return out;
}

function buildLevels(): void {
  const table = levelTable();
  const stored = economy.level.table.map((n) => n.value);
  const sum = table.reduce((a, b) => a + b, 0);
  console.log('U(2..20) =', table.join(', '));
  console.log('sum =', sum, '(expected 29245)');
  console.log('matches stored table:', JSON.stringify(table) === JSON.stringify(stored));
}

type Counter = Record<GateType, number>;
const zero = (): Counter => ({ x0: 0, x1: 0, x2: 0, x3: 0, x5: 0 });

interface WaveStats {
  fields: number;
  slots: Counter;
  columnSlots: Counter[];
  attempts: number[];
  fallback: number;
  deadEnd: number[];
  validation: number[];
  balls: number;
}

const newStats = (): WaveStats => ({
  fields: 0,
  slots: zero(),
  columnSlots: [zero(), zero(), zero(), zero(), zero()],
  attempts: new Array<number>(10).fill(0),
  fallback: 0,
  deadEnd: new Array<number>(10).fill(0),
  validation: new Array<number>(10).fill(0),
  balls: 0,
});

/** BAL-007: chances in tenths of a percent, rounded once from integer counts. */
function tenths(count: number, n: number): number {
  return Math.floor((2000 * count + 5 * n) / (10 * n));
}
function columnTenths(count: number, n: number): number {
  return Math.floor((2000 * count + n) / (2 * n));
}

function ballsFor(g: GateType): number {
  const mult = (economy.ball.gate_multiplier as Record<string, { value: number }>)[g]!.value;
  return economy.ball.unit.value * mult;
}

function gatesSim(): void {
  const SEEDS = 10000;
  const simRoot = sha256(utf8('cupquest-sim-v1')).slice(0, SEED_BYTES);
  const perWave: WaveStats[] = Array.from({ length: 15 }, newStats);
  const perRunBalls: number[] = [];
  for (let k = 0; k < SEEDS; k++) {
    const seed = kdf(simRoot, 'sim', 0, k);
    let runBalls = 0;
    for (let w = 1; w <= 15; w++) {
      const trace = generateBoardTrace(seed, w);
      const st = perWave[w - 1] as WaveStats;
      st.fields++;
      if (trace.fallback) st.fallback++;
      else st.attempts[trace.board.attempt] = (st.attempts[trace.board.attempt] as number) + 1;
      trace.failures.forEach((reason, a) => {
        if (reason === 'dead_end') st.deadEnd[a] = (st.deadEnd[a] as number) + 1;
        else st.validation[a] = (st.validation[a] as number) + 1;
      });
      const board = trace.board;
      let fieldBalls = 0;
      for (let i = 0; i < FIELD.slotCount; i++) {
        const g = board.gates[i] as GateType;
        st.slots[g]++;
        st.columnSlots[i]![g]++;
        fieldBalls += ballsFor(g);
      }
      st.balls += fieldBalls;
      runBalls += fieldBalls;
    }
    perRunBalls.push(runBalls);
  }
  const out = {
    version: 1,
    generated_by: 'scripts/build-data.ts gates (BAL-005, BAL-006)',
    sim: { seeds: SEEDS, label: 'sim', seed_root: 'cupquest-sim-v1', seed_index_i1: 0 },
  };
  const waves: Record<string, unknown> = {};
  const sumAll = newStats();
  for (let w = 1; w <= 15; w++) {
    const st = perWave[w - 1] as WaveStats;
    mergeInto(sumAll, st);
    waves[String(w)] = block(st);
  }
  const runAvg = Math.floor((100 * perRunBalls.reduce((a, b) => a + b, 0)) / (FIELD.slotCount * SEEDS));
  const totalBlock = block(sumAll);
  (totalBlock as Record<string, unknown>).avg_run_hundredths = runAvg;
  const final = { ...out, waves, total: totalBlock };
  writeFileSync(join(dataDir, 'gates.json'), JSON.stringify(final, null, 2) + '\n');
  console.log('wrote gates.json; total fields =', sumAll.fields, 'avg run balls (x100) =', runAvg);
}

function mergeInto(acc: WaveStats, st: WaveStats): void {
  acc.fields += st.fields;
  acc.fallback += st.fallback;
  acc.balls += st.balls;
  for (const g of GATE_TYPES) acc.slots[g] += st.slots[g];
  for (let i = 0; i < 5; i++) for (const g of GATE_TYPES) acc.columnSlots[i]![g] += st.columnSlots[i]![g];
  for (let a = 0; a < 10; a++) {
    acc.attempts[a] = (acc.attempts[a] as number) + (st.attempts[a] as number);
    acc.deadEnd[a] = (acc.deadEnd[a] as number) + (st.deadEnd[a] as number);
    acc.validation[a] = (acc.validation[a] as number) + (st.validation[a] as number);
  }
}

function block(st: WaveStats): Record<string, unknown> {
  const n = st.fields;
  const chance: Record<string, number> = {};
  for (const g of GATE_TYPES) chance[g] = tenths(st.slots[g], n);
  const column = st.columnSlots.map((c) => {
    const o: Record<string, number> = {};
    for (const g of GATE_TYPES) o[g] = columnTenths(c[g], n);
    return o;
  });
  return {
    fields: n,
    slot_counts: st.slots,
    column_slot_counts: st.columnSlots,
    attempt_histogram: st.attempts,
    fallback: st.fallback,
    dead_end_by_attempt: st.deadEnd,
    validation_by_attempt: st.validation,
    balls_sum: st.balls,
    // One drop per wave lands in one column chosen uniformly among 5, so the expected yield is the mean over columns.
    avg_balls_hundredths: Math.floor((100 * st.balls) / (FIELD.slotCount * n)),
    chance_tenths: chance,
    column_chance_tenths: column,
  };
}

if (cmd === 'fallback') buildFallback();
else if (cmd === 'gates') gatesSim();
else if (cmd === 'levels') buildLevels();
else {
  console.error('usage: build-data.ts fallback | gates | levels');
  process.exit(1);
}
