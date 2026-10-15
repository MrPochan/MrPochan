// Ball field generator (spec section 4.5, GEN-001..GEN-020).
// Pure function of (run seed S, wave w). No floating point, no Math.random, no Date.

import { FIELD } from './config.ts';
import { kdf, Xoshiro128ss, SEED_BYTES } from './prng.ts';
import { sha256, toHex, fromHex } from './sha256.ts';
import fallbackJson from './data/fallback_v1.json' with { type: 'json' };

/** Gate types in the order used by the weights and thresholds (GEN-013). */
export const GATE_TYPES = ['x0', 'x1', 'x2', 'x3', 'x5'] as const;
export type GateType = (typeof GATE_TYPES)[number];

/** Gate codes in the serialized board (GEN-020). */
export const GATE_CODE: Readonly<Record<GateType, number>> = { x0: 0, x1: 1, x2: 2, x3: 3, x5: 4 };

/** Attempt number stored for a board built from the fallback list (GEN-017). */
export const FALLBACK_ATTEMPT = 255;

/** Serialized board length in bytes (GEN-020). */
export const BOARD_BYTES = 58;

/** Number of route rows; the gate row is row 9 (GEN-010). */
export const ROUTE_ROWS = 9;

/** A generated ball field (GEN-020). Column i ends at gate i. */
export interface Board {
  readonly wave: number;
  /** 0..9 for a normal attempt, 255 for the fallback seed. */
  readonly attempt: number;
  /** Template index 0..2 (GEN-012). */
  readonly template: number;
  /** Gate positions 0..8, ascending. slots[i] is the gate of column i. */
  readonly slots: readonly number[];
  /** Gate type of each gate, same index as slots. */
  readonly gates: readonly GateType[];
  /** Number of x0 gates before the single-x0 conversion (TV-002). */
  readonly x0Before: number;
  /** paths[column][row] for rows 0..8; the ball enters at row 0 at x = drop_x[column]. */
  readonly paths: readonly (readonly number[])[];
  /** 58-byte serialization (GEN-020). */
  readonly bytes: Uint8Array;
  /** board_sha256, lowercase hex (GEN-020). */
  readonly hash: string;
}

export type BuildFailure = 'dead_end' | 'validation';
export type BuildResult = { ok: true; board: Board } | { ok: false; reason: BuildFailure };

/** Result of one generated attempt with the failure list, for the simulator (BAL-006). */
export interface GenerationTrace {
  readonly board: Board;
  /** Failure reason of every failed attempt, in order. */
  readonly failures: readonly BuildFailure[];
  /** True when the fallback list was used (GEN-017). */
  readonly fallback: boolean;
}

interface FallbackFile {
  version: number;
  waves: Record<string, string[]>;
}

const FALLBACK: FallbackFile = fallbackJson as FallbackFile;

/** Pre-validated fallback sub-seeds for a wave (GEN-018). */
export function fallbackSeeds(wave: number): Uint8Array[] {
  const list = FALLBACK.waves[String(wave)];
  if (!list || list.length === 0) throw new Error(`no fallback seeds for wave ${wave}`);
  return list.map((hex) => {
    const bytes = fromHex(hex);
    if (bytes.length !== SEED_BYTES) throw new Error('fallback seed must be 16 bytes');
    return bytes;
  });
}

/** Version of the fallback list (GEN-018). */
export const FALLBACK_VERSION: number = FALLBACK.version;

function checkWave(wave: number): void {
  if (!Number.isInteger(wave) || wave < 1 || wave > 15) {
    throw new RangeError(`wave must be an integer 1..15, got ${wave}`);
  }
}

/** Trace one attempt from a sub-seed (steps 1-4, GEN-012..GEN-015). */
export function buildFromSubseed(subseed: Uint8Array, wave: number, attempt: number): BuildResult {
  checkWave(wave);
  const rng = new Xoshiro128ss(subseed);

  // GEN-012: template.
  const template = rng.bounded(FIELD.templates.length);
  const slots = FIELD.templates[template] as readonly number[];

  // GEN-013: gate type per slot in ascending position order.
  const types: number[] = [];
  for (let j = 0; j < FIELD.slotCount; j++) {
    const u = rng.bounded(100);
    let type = FIELD.thresholds.length - 1;
    for (let t = 0; t < FIELD.thresholds.length - 1; t++) {
      if (u < (FIELD.thresholds[t] as number)) {
        type = t;
        break;
      }
    }
    types.push(type);
  }
  const x0Indices: number[] = [];
  types.forEach((t, j) => {
    if (t === 0) x0Indices.push(j);
  });
  const x0Before = x0Indices.length;
  if (x0Before >= 2) {
    const keep = x0Indices[rng.bounded(x0Before)] as number;
    for (const j of x0Indices) {
      if (j !== keep) types[j] = 1;
    }
  }

  // GEN-014: path tracing, row by row, column by column.
  // P_i has 9 cells, P_i[0..8]. At k = 8 the reachability rule leaves only the slot itself,
  // so P_i[8] = slot_i holds by construction (checked again in V2).
  const paths: number[][] = [];
  for (let i = 0; i < FIELD.slotCount; i++) {
    const row = new Array<number>(ROUTE_ROWS).fill(0);
    row[0] = FIELD.dropX[i] as number;
    paths.push(row);
  }
  for (let k = 1; k <= ROUTE_ROWS - 1; k++) {
    for (let i = 0; i < FIELD.slotCount; i++) {
      const pathRow = paths[i] as number[];
      const prev = pathRow[k - 1] as number;
      const slot = slots[i] as number;
      const cands: number[] = [];
      for (const d of [-1, 0, 1]) {
        const x = prev + d;
        if (x < 0 || x > FIELD.width - 1) continue;
        if (Math.abs(slot - x) > ROUTE_ROWS - 1 - k) continue; // slot still reachable
        if (i > 0 && !(x > (paths[i - 1] as number[])[k]!)) continue; // strict order, no crossing
        if (i <= 3 && x > 4 + i) continue; // room for the right-hand paths
        cands.push(x);
      }
      if (cands.length === 0) return { ok: false, reason: 'dead_end' };
      pathRow[k] = cands[rng.bounded(cands.length)] as number;
    }
  }
  // GEN-015: validation V1..V4.
  if (!validatePaths(paths, slots, types)) return { ok: false, reason: 'validation' };

  const gates = types.map((t) => GATE_TYPES[t] as GateType);
  const board = assemble(wave, attempt, template, slots, gates, x0Before, paths);
  return { ok: true, board };
}

function validatePaths(paths: number[][], slots: readonly number[], types: readonly number[]): boolean {
  // V1: cells in range, neighbours differ by at most 1.
  for (const path of paths) {
    if (path.length !== ROUTE_ROWS) return false;
    for (let k = 0; k < path.length; k++) {
      const c = path[k] as number;
      if (c < 0 || c > FIELD.width - 1) return false;
      if (k > 0 && Math.abs(c - (path[k - 1] as number)) > 1) return false;
    }
  }
  // V2: the path of column i ends at the gate cell of slot i.
  for (let i = 0; i < paths.length; i++) {
    if ((paths[i] as number[])[ROUTE_ROWS - 1] !== slots[i]) return false;
  }
  // V3: paths are strictly ordered in every row.
  for (let k = 0; k < ROUTE_ROWS; k++) {
    for (let i = 1; i < paths.length; i++) {
      if (!((paths[i - 1] as number[])[k]! < (paths[i] as number[])[k]!)) return false;
    }
  }
  // V4: slots distinct and ascending, types allowed, at most one x0.
  for (let j = 1; j < slots.length; j++) {
    if (!((slots[j - 1] as number) < (slots[j] as number))) return false;
  }
  let x0 = 0;
  for (const t of types) {
    if (t < 0 || t >= GATE_TYPES.length) return false;
    if (t === 0) x0++;
  }
  return x0 <= FIELD.maxX0PerField;
}

function assemble(
  wave: number,
  attempt: number,
  template: number,
  slots: readonly number[],
  gates: readonly GateType[],
  x0Before: number,
  paths: number[][],
): Board {
  const bytes = new Uint8Array(BOARD_BYTES);
  bytes[0] = 1; // format version
  bytes[1] = attempt;
  bytes[2] = template;
  for (let j = 0; j < FIELD.slotCount; j++) {
    bytes[3 + 2 * j] = slots[j] as number;
    bytes[4 + 2 * j] = GATE_CODE[gates[j] as GateType];
  }
  for (let i = 0; i < FIELD.slotCount; i++) {
    for (let k = 0; k < ROUTE_ROWS; k++) {
      bytes[13 + 9 * i + k] = (paths[i] as number[])[k] as number;
    }
  }
  return {
    wave,
    attempt,
    template,
    slots,
    gates,
    x0Before,
    paths,
    bytes,
    hash: toHex(sha256(bytes)),
  };
}

/** Attempt builder signature; tests may substitute it to force the fallback branch (TV-002). */
export type AttemptBuilder = (subseed: Uint8Array, wave: number, attempt: number) => BuildResult;

/** Generates the field for run seed S and wave w, with the trace of failed attempts (GEN-016, GEN-017). */
export function generateBoardTrace(seed: Uint8Array, wave: number): GenerationTrace {
  return generateWith(seed, wave, buildFromSubseed);
}

/** Same as generateBoardTrace with an injectable attempt builder. Not exported from the package index. */
export function generateWith(seed: Uint8Array, wave: number, builder: AttemptBuilder): GenerationTrace {
  checkWave(wave);
  const failures: BuildFailure[] = [];
  for (let a = 0; a < FIELD.attempts; a++) {
    const res = builder(kdf(seed, 'field', wave, a), wave, a);
    if (res.ok) return { board: res.board, failures, fallback: false };
    failures.push(res.reason);
  }
  // GEN-017: deterministic choice of a verified fallback seed by S.
  const seeds = fallbackSeeds(wave);
  const rng = new Xoshiro128ss(kdf(seed, 'fallback', wave, 0));
  const child = seeds[rng.bounded(seeds.length)] as Uint8Array;
  const res = builder(child, wave, FALLBACK_ATTEMPT);
  if (!res.ok) {
    throw new Error(`internal error: fallback seed failed for wave ${wave} (${res.reason})`);
  }
  return { board: res.board, failures, fallback: true };
}

/** Generates the field for run seed S and wave w (GEN-001). */
export function generateBoard(seed: Uint8Array, wave: number): Board {
  return generateBoardTrace(seed, wave).board;
}

/** Path of the ball dropped from column `column` and the gate it reaches (CORE-013, GEN-014). */
export function dropBall(board: Board, column: number): { path: readonly number[]; gate: GateType } {
  if (!Number.isInteger(column) || column < 0 || column >= FIELD.slotCount) {
    throw new RangeError(`column must be 0..${FIELD.slotCount - 1}, got ${column}`);
  }
  return { path: board.paths[column] as readonly number[], gate: board.gates[column] as GateType };
}

/** Checks the invariants of GEN-019 on any board, including fallback boards. Returns the list of violations. */
export function boardViolations(board: Board): string[] {
  const problems: string[] = [];
  if (board.slots.length !== FIELD.slotCount) problems.push('slot count');
  if (board.paths.length !== FIELD.slotCount) problems.push('path count');
  for (const p of board.paths) if (p.length !== ROUTE_ROWS) problems.push('path length');
  const x0 = board.gates.filter((g) => g === 'x0').length;
  if (x0 > 1) problems.push('more than one x0');
  for (const g of board.gates) if (!(GATE_TYPES as readonly string[]).includes(g)) problems.push(`gate ${g}`);
  if (!validatePaths(board.paths.map((p) => [...p]), board.slots, board.gates.map((g) => GATE_TYPES.indexOf(g)))) {
    problems.push('paths do not reach their gates');
  }
  return problems;
}
