// Regenerates the simulator sample of BAL-005 (test-side only). Used by the tests that compare the stored
// balance data with the generator, so no test trusts a self-report that nothing recomputes.

import { generateBoardTrace, GATE_TYPES, type GateType } from '../../src/board.ts';
import { kdf, SEED_BYTES } from '../../src/prng.ts';
import { sha256, utf8 } from '../../src/sha256.ts';

export interface SimSample {
  readonly seeds: number;
  readonly fields: number;
  /** Count of slots of each gate type over all fields. */
  readonly slots: Readonly<Record<GateType, number>>;
  /** Count of fields by attempt index 0..9 (fallback fields are not counted here). */
  readonly attemptHistogram: readonly number[];
  readonly fallback: number;
  readonly deadEndByAttempt: readonly number[];
  readonly validationByAttempt: readonly number[];
}

/** S_k = KDF(SIM, "sim", 0, k) with SIM = first 16 bytes of SHA-256("cupquest-sim-v1") (BAL-005). */
export function simSeed(k: number): Uint8Array {
  const root = sha256(utf8('cupquest-sim-v1')).slice(0, SEED_BYTES);
  return kdf(root, 'sim', 0, k);
}

/** Generates the fields of waves 1..15 for the first `seeds` sim seeds. */
export function simulateSample(seeds: number): SimSample {
  const slots: Record<GateType, number> = { x0: 0, x1: 0, x2: 0, x3: 0, x5: 0 };
  const attemptHistogram = new Array<number>(10).fill(0);
  const deadEndByAttempt = new Array<number>(10).fill(0);
  const validationByAttempt = new Array<number>(10).fill(0);
  let fallback = 0;
  let fields = 0;
  for (let k = 0; k < seeds; k++) {
    const seed = simSeed(k);
    for (let w = 1; w <= 15; w++) {
      const trace = generateBoardTrace(seed, w);
      fields++;
      if (trace.fallback) fallback++;
      else attemptHistogram[trace.board.attempt] = (attemptHistogram[trace.board.attempt] as number) + 1;
      trace.failures.forEach((reason, a) => {
        if (reason === 'dead_end') deadEndByAttempt[a] = (deadEndByAttempt[a] as number) + 1;
        else validationByAttempt[a] = (validationByAttempt[a] as number) + 1;
      });
      for (const g of trace.board.gates) slots[g] += 1;
    }
  }
  return { seeds, fields, slots, attemptHistogram, fallback, deadEndByAttempt, validationByAttempt };
}

export { GATE_TYPES };
