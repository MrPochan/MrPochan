// TV-005 (acceptance of section 4.5, week 2): 1 000 sim seeds x 15 waves. No exception, every field passes GEN-019,
// no dead end, no fallback, and the attempt histogram is recorded in test/golden/tv005_v1.json.
// The sample is regenerated here, not read back from a report.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { boardViolations, generateBoardTrace } from '../src/board.ts';
import { simSeed, simulateSample } from './support/sim.ts';

const here = dirname(fileURLToPath(import.meta.url));
const recorded = JSON.parse(readFileSync(join(here, 'golden', 'tv005_v1.json'), 'utf8')) as {
  seeds: number;
  waves: number;
  fields: number;
  attempt_histogram: number[];
  fallback: number;
  dead_end_by_attempt: number[];
  validation_by_attempt: number[];
};

describe('TV-005: 1 000 seeds x 15 waves', () => {
  it('generates every field without an exception and every field passes GEN-019', () => {
    let fields = 0;
    for (let k = 0; k < recorded.seeds; k++) {
      const seed = simSeed(k);
      for (let w = 1; w <= recorded.waves; w++) {
        const trace = generateBoardTrace(seed, w);
        fields++;
        expect(boardViolations(trace.board), `S_${k} w=${w}`).toEqual([]);
      }
    }
    expect(fields).toBe(recorded.fields);
  }, 120000);

  it('regenerates the recorded histogram: attempts, fallback, dead ends and validation failures', () => {
    const sample = simulateSample(recorded.seeds);
    expect(sample.fields).toBe(recorded.fields);
    expect(sample.attemptHistogram).toEqual(recorded.attempt_histogram);
    expect(sample.fallback).toBe(recorded.fallback);
    expect(sample.deadEndByAttempt).toEqual(recorded.dead_end_by_attempt);
    expect(sample.validationByAttempt).toEqual(recorded.validation_by_attempt);
  }, 120000);

  it('has zero dead ends and zero fallback fields (the acceptance metric of TV-005)', () => {
    expect(recorded.dead_end_by_attempt.every((v) => v === 0)).toBe(true);
    expect(recorded.fallback).toBe(0);
    expect(recorded.attempt_histogram.slice(1).every((v) => v === 0)).toBe(true);
  });
});
