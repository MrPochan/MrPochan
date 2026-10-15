import { describe, expect, it } from 'vitest';
import { ballsForGate, coinsForWin, waveLimitTicks } from '@cupquest/core';
import { settleRun } from '../src/settlement.ts';
import { ApiError } from '../src/errors.ts';
import {
  allowedWaveCounts,
  assertStructure,
  maxDurationTicks,
  minDurationTicks,
  verdictReasons,
  type RunReport,
} from '../src/validation.ts';
import { sha256Hex } from './helpers.ts';

const NO_GATES = { x0: 0, x1: 0, x2: 0, x3: 0, x5: 0 };

function report(patch: Partial<RunReport>): RunReport {
  const log = 'log';
  return {
    mode: 'full',
    result: 'loss',
    lastWave: 1,
    waves: [],
    gates: { ...NO_GATES },
    score: 0,
    durationTicks: 100,
    resurrections: 0,
    reservedGems: 0,
    gemBalance: 0,
    cards: [],
    log,
    logSha256: sha256Hex(log),
    ...patch,
  };
}

function code(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  return 'ok';
}

describe('duration bounds (SEC-002, CORE-020)', () => {
  it('computes D_min per result: win 1 350 ticks at wave 15, loss and abandon from the spec', () => {
    expect(minDurationTicks('win', 15)).toBe(1350);
    expect(minDurationTicks('loss', 3)).toBe(181);
    expect(minDurationTicks('abandon', 3)).toBe(180);
    expect(minDurationTicks('win', 5)).toBe(450);
  });

  it('computes D_max from the wave limits, the card and field allowances', () => {
    let limits = 0;
    for (let w = 1; w <= 15; w += 1) limits += waveLimitTicks(w);
    expect(maxDurationTicks(15)).toBe(limits + 14 * 100 + 15 * 300);
    expect(maxDurationTicks(1)).toBe(waveLimitTicks(1) + 300);
  });

  it('flags a run one tick faster than the minimum and accepts the minimum itself', () => {
    const minimum = minDurationTicks('loss', 3);
    const base = {
      lastWave: 3,
      waves: [
        { w: 1, coins: 25, balls: 10, spend: 0 },
        { w: 2, coins: 30, balls: 0, spend: 0 },
      ],
      gates: { x0: 1, x1: 1, x2: 0, x3: 0, x5: 0 },
      score: 65,
    };
    expect(verdictReasons(report({ ...base, durationTicks: minimum - 1 }))).toEqual(['duration_min']);
    expect(verdictReasons(report({ ...base, durationTicks: minimum }))).toEqual([]);
  });
});

describe('structural checks (SEC-001)', () => {
  it('rejects last_wave outside 1..15, or outside 1..5 for short5', () => {
    expect(code(() => assertStructure(report({ lastWave: 16 })))).toBe('run.invalid');
    expect(code(() => assertStructure(report({ lastWave: 0 })))).toBe('run.invalid');
    expect(code(() => assertStructure(report({ mode: 'short5', lastWave: 6 })))).toBe('run.invalid');
  });

  it('rejects a win that does not reach the last wave', () => {
    const waves = Array.from({ length: 14 }, (_, i) => ({ w: i + 1, coins: 0, balls: 0, spend: 0 }));
    expect(code(() => assertStructure(report({ result: 'win', lastWave: 14, waves, gates: { ...NO_GATES, x0: 14 } })))).toBe('run.invalid');
  });

  it('rejects waves that do not match last_wave, or that are not numbered from 1', () => {
    expect(code(() => assertStructure(report({ lastWave: 3, waves: [{ w: 1, coins: 0, balls: 0, spend: 0 }] })))).toBe('run.invalid');
    expect(code(() => assertStructure(report({ lastWave: 2, waves: [{ w: 2, coins: 0, balls: 0, spend: 0 }] })))).toBe('run.invalid');
  });

  it('rejects a log hash that does not match the log', () => {
    expect(code(() => assertStructure(report({ logSha256: '0'.repeat(64) })))).toBe('run.invalid');
    expect(code(() => assertStructure(report({})))).toBe('ok');
  });

  it('rejects an unknown card id', () => {
    expect(code(() => assertStructure(report({ cards: [{ cardId: 'no_such_card', tier: 1 }] })))).toBe('run.invalid');
  });
});

describe('verdict checks (SEC-003..SEC-005)', () => {
  const twoWaves = {
    lastWave: 3,
    waves: [
      { w: 1, coins: 25, balls: 10, spend: 0 },
      { w: 2, coins: 30, balls: 0, spend: 0 },
    ],
    gates: { x0: 1, x1: 1, x2: 0, x3: 0, x5: 0 },
    score: 65,
    durationTicks: 1000,
  };

  it('accepts a consistent run', () => {
    expect(verdictReasons(report(twoWaves))).toEqual([]);
  });

  it('flags coins above the win value of a wave (score_cap)', () => {
    expect(coinsForWin(1)).toBe(25);
    const reasons = verdictReasons(
      report({
        lastWave: 2,
        waves: [{ w: 1, coins: 26, balls: 0, spend: 0 }],
        gates: { ...NO_GATES, x0: 1 },
        score: 26,
        durationTicks: 500,
      }),
    );
    expect(reasons).toEqual(['score_cap']);
  });

  it('flags a score that is not the sum of coins and balls (score_mismatch)', () => {
    expect(verdictReasons(report({ score: 5 }))).toEqual(['score_mismatch']);
  });

  it('flags gate counts and balls that do not agree (gates_count, gates_balls)', () => {
    expect(verdictReasons(report({ gates: { ...NO_GATES, x1: 1 } }))).toEqual(['gates_count', 'gates_balls']);
    expect(ballsForGate('x5')).toBe(50);
  });

  it('flags spending beyond the balls of earlier waves (spend_over)', () => {
    const reasons = verdictReasons(
      report({
        ...twoWaves,
        waves: [
          { w: 1, coins: 25, balls: 10, spend: 0 },
          { w: 2, coins: 30, balls: 0, spend: 11 },
        ],
      }),
    );
    expect(reasons).toEqual(['spend_over']);
  });

  it('flags a resurrection without the 10-gem reserve (res_unreserved)', () => {
    expect(verdictReasons(report({ resurrections: 1, reservedGems: 0, gemBalance: 10 }))).toEqual(['res_unreserved']);
    expect(verdictReasons(report({ resurrections: 1, reservedGems: 10, gemBalance: 10 }))).toEqual([]);
  });

  it('reads the reserve, not the live balance, for res_unreserved', () => {
    // A reserved resurrection with an empty live balance is a different reason: gems_negative.
    expect(verdictReasons(report({ resurrections: 1, reservedGems: 10, gemBalance: 0 }))).toEqual(['gems_negative']);
    expect(verdictReasons(report({ resurrections: 1, reservedGems: 0, gemBalance: 0 }))).toEqual(['res_unreserved']);
  });

  it('does not check the gem balance when no resurrection is used', () => {
    expect(verdictReasons(report({ ...twoWaves, resurrections: 0, reservedGems: 10, gemBalance: 0 }))).toEqual([]);
  });
});

describe('abandon wave records (ОВ-2, SEC-001)', () => {
  const wave = (w: number, coins: number, balls = 0) => ({ w, coins, balls, spend: 0 });

  it('allows as many waves as drops, or one more (the current wave with its battle win and no drop)', () => {
    expect(allowedWaveCounts(report({ result: 'abandon', lastWave: 1 }))).toEqual([0, 1]);
    expect(allowedWaveCounts(report({ result: 'abandon', lastWave: 3, gates: { ...NO_GATES, x1: 2 } }))).toEqual([2, 3]);
  });

  it('accepts an abandon in the card or field step of wave 1 after its battle win', () => {
    const cardStep = report({ result: 'abandon', lastWave: 1, waves: [wave(1, 25)], score: 25, durationTicks: 500 });
    expect(code(() => assertStructure(cardStep))).toBe('ok');
    expect(verdictReasons(cardStep)).toEqual([]);
  });

  it('accepts an abandon in the field step of wave 2 (one drop, wave 2 listed without a drop)', () => {
    const fieldStep = report({
      result: 'abandon',
      lastWave: 2,
      waves: [wave(1, 25, 10), wave(2, 30)],
      gates: { ...NO_GATES, x1: 1 },
      score: 65,
      durationTicks: 1000,
    });
    expect(code(() => assertStructure(fieldStep))).toBe('ok');
    expect(verdictReasons(fieldStep)).toEqual([]);
  });

  it('rejects an abandon that lists more waves than its drops allow', () => {
    const extra = report({ result: 'abandon', lastWave: 3, waves: [wave(1, 25), wave(2, 30), wave(3, 30)] });
    expect(code(() => assertStructure(extra))).toBe('run.invalid');
  });

  it('flags an abandon whose drop count does not match last_wave (gates_count)', () => {
    const reasons = verdictReasons(report({ result: 'abandon', lastWave: 3, waves: [wave(1, 25, 10)], gates: { ...NO_GATES, x1: 1 }, score: 35 }));
    expect(reasons).toContain('gates_count');
  });
});

describe('settlement (ECO-001, ECO-008)', () => {
  it('writes per-wave entries with run keys and burns the remaining balls', () => {
    const settlement = settleRun({
      runId: 'run-1',
      userId: 'u1',
      at: 1,
      resurrected: false,
      waves: [
        { w: 1, coins: 25, balls: 10, spend: 0 },
        { w: 2, coins: 30, balls: 0, spend: 5 },
      ],
    });
    expect(settlement.coins).toBe(55);
    expect(settlement.burnedBalls).toBe(5);
    expect(settlement.entries.map((e) => [e.key, e.currency, e.delta, e.reason])).toEqual([
      ['run:run-1:w1:coin', 'coin', 25, 'run_coin'],
      ['run:run-1:w1:ball', 'ball', 10, 'run_ball'],
      ['run:run-1:w2:coin', 'coin', 30, 'run_coin'],
      ['run:run-1:w2:spend', 'ball', -5, 'card_spend'],
      ['run:run-1:burn', 'ball', -5, 'burn'],
    ]);
  });

  it('adds the resurrection as -10 gems only when it was used', () => {
    const used = settleRun({ runId: 'r', userId: 'u', at: 1, resurrected: true, waves: [] });
    expect(used.entries.at(-1)).toMatchObject({ key: 'run:r:res', currency: 'gem', delta: -10, reason: 'resurrect' });
    const unused = settleRun({ runId: 'r', userId: 'u', at: 1, resurrected: false, waves: [] });
    expect(unused.entries.some((e) => e.key === 'run:r:res')).toBe(false);
  });
});
