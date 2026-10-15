// Checks of a submitted run (ТЗ 5.5: SEC-001 structure, SEC-002 duration, SEC-003 caps and
// consistency, SEC-004 balls and spending, SEC-005 resurrection).
//
// The server does not re-simulate the battle or the field (SEC-007). Structural violations are
// errors (run.invalid). Suspicious values are verdicts: the run becomes `flagged` and nothing is credited.

import {
  CARD_CATALOG,
  ECONOMY_VIEW,
  GATE_TYPES,
  ballsForGate,
  coinsForWin,
  sha256,
  toHex,
  waveLimitTicks,
  type RunMode,
} from '@cupquest/core';
import type { GateCounts, SubmitResult } from './contract.ts';
import { ApiError } from './errors.ts';

/** Minimum durations of steps in ticks (CORE-020, tick = 50 ms). */
export const T_MIN1 = 60;
export const T_MIN2 = 0;
export const T_MIN3 = 30;

/** SEC-002: allowance for the card choice (up to 5 s) and for the field (up to 15 s) per wave. */
export const CARD_ALLOWANCE_TICKS = 100;
export const FIELD_ALLOWANCE_TICKS = 300;

export const FULL_LAST_WAVE = 15;
export const SHORT_LAST_WAVE = 5;

const CARD_IDS: ReadonlySet<string> = new Set(CARD_CATALOG.map((c) => c.id));

export interface WaveReport {
  readonly w: number;
  readonly coins: number;
  readonly balls: number;
  readonly spend: number;
}

export interface RunReport {
  readonly mode: RunMode;
  readonly result: SubmitResult;
  readonly lastWave: number;
  readonly waves: readonly WaveReport[];
  readonly gates: GateCounts;
  readonly score: number;
  readonly durationTicks: number;
  readonly resurrections: number;
  /** Gems reserved at start (CORE-026); a server value, not the client's. */
  readonly reservedGems: number;
  /** Live gem balance of the account at submit time (sum of the ledger). Only the negative-balance guard reads it. */
  readonly gemBalance: number;
  readonly cards: readonly { readonly cardId: string; readonly tier: number }[];
  readonly log: string;
  readonly logSha256: string;
}

export const VERDICT_REASONS = [
  'duration_min',
  'duration_max',
  'score_cap',
  'score_mismatch',
  'gates_count',
  'gates_balls',
  'spend_over',
  'res_unreserved',
  'gems_negative',
] as const;

export type VerdictReason = (typeof VERDICT_REASONS)[number];

export function lastWaveLimit(mode: RunMode): number {
  return mode === 'short5' ? SHORT_LAST_WAVE : FULL_LAST_WAVE;
}

/** Waves completed in the run: all of them for a win, all but the last for loss and abandon. */
export function completedWaves(result: SubmitResult, lastWave: number): number {
  return result === 'win' ? lastWave : lastWave - 1;
}

/**
 * Allowed numbers of `waves` entries (SEC-001). A win lists every wave and a loss lists the waves before the lost one.
 * An abandon (ОВ-2) can happen after the battle win of the current wave and before its drop (card and field steps):
 * the current wave is then listed with coins but without a drop. So an abandon lists as many waves as it has drops,
 * or one more. The drop count is the sum of the gate counters, which the core records one per field step.
 */
export function allowedWaveCounts(report: RunReport): readonly number[] {
  if (report.result === 'abandon') {
    const drops = GATE_TYPES.reduce((sum, gate) => sum + report.gates[gate], 0);
    return [drops, drops + 1];
  }
  return [completedWaves(report.result, report.lastWave)];
}

/** SEC-002 lower bound D_min in ticks. */
export function minDurationTicks(result: SubmitResult, lastWave: number): number {
  const step = T_MIN1 + T_MIN2 + T_MIN3;
  if (result === 'win') return lastWave * (T_MIN1 + T_MIN3) + (lastWave - 1) * T_MIN2;
  if (result === 'loss') return (lastWave - 1) * step + 1;
  return (lastWave - 1) * step;
}

/** SEC-002 upper bound D_max in ticks. */
export function maxDurationTicks(lastWave: number): number {
  let limits = 0;
  for (let w = 1; w <= lastWave; w += 1) limits += waveLimitTicks(w);
  return limits + (lastWave - 1) * CARD_ALLOWANCE_TICKS + lastWave * FIELD_ALLOWANCE_TICKS;
}

/** SEC-001: structural checks. Any violation is `run.invalid` (422) and nothing is stored. */
export function assertStructure(report: RunReport): void {
  const limit = lastWaveLimit(report.mode);
  if (!Number.isInteger(report.lastWave) || report.lastWave < 1 || report.lastWave > limit) {
    throw new ApiError('run.invalid', `last_wave must be 1..${limit}`);
  }
  if (report.result === 'win' && report.lastWave !== limit) {
    throw new ApiError('run.invalid', 'a win must reach the last wave');
  }
  if (!allowedWaveCounts(report).includes(report.waves.length)) {
    throw new ApiError('run.invalid', 'waves do not match last_wave');
  }
  report.waves.forEach((wave, index) => {
    if (wave.w !== index + 1) throw new ApiError('run.invalid', 'waves must be listed from wave 1 without gaps');
  });
  for (const card of report.cards) {
    if (!CARD_IDS.has(card.cardId)) throw new ApiError('run.invalid', `unknown card ${card.cardId}`);
  }
  const actualHash = toHex(sha256(new TextEncoder().encode(report.log)));
  if (actualHash !== report.logSha256.toLowerCase()) {
    throw new ApiError('run.invalid', 'log_sha256 does not match log');
  }
}

/**
 * Verdict checks (SEC-002..SEC-005). Returns the reasons in a fixed order; an empty list means `ok`.
 * The live gem balance comes in `report.gemBalance` (read from the ledger by the caller).
 */
export function verdictReasons(report: RunReport): VerdictReason[] {
  const reasons = new Set<VerdictReason>();

  // SEC-002: duration.
  if (report.durationTicks < minDurationTicks(report.result, report.lastWave)) reasons.add('duration_min');
  if (report.durationTicks > maxDurationTicks(report.lastWave)) reasons.add('duration_max');

  // SEC-003: per-wave caps. Coins may not exceed the win value of the wave; balls may not exceed x5.
  const ballsCap = ballsForGate('x5');
  for (const wave of report.waves) {
    if (wave.coins > coinsForWin(wave.w, report.mode) || wave.balls > ballsCap) reasons.add('score_cap');
  }

  // SEC-003: score is the sum of coins and balls, without spending.
  const earned = report.waves.reduce((sum, wave) => sum + wave.coins + wave.balls, 0);
  if (report.score !== earned) reasons.add('score_mismatch');

  // SEC-003: gate counts agree with the number of field steps, and balls agree with the gates (ECO-006).
  const gateSteps = GATE_TYPES.reduce((sum, gate) => sum + report.gates[gate], 0);
  if (gateSteps !== completedWaves(report.result, report.lastWave)) reasons.add('gates_count');
  const ballsFromGates = GATE_TYPES.reduce((sum, gate) => sum + report.gates[gate] * ballsForGate(gate), 0);
  const ballsReported = report.waves.reduce((sum, wave) => sum + wave.balls, 0);
  if (ballsFromGates !== ballsReported) reasons.add('gates_balls');

  // SEC-004: spending in wave w is funded by the balls of earlier waves minus earlier spending.
  let available = 0;
  for (const wave of report.waves) {
    if (wave.spend > available) reasons.add('spend_over');
    available += wave.balls - wave.spend;
  }

  // SEC-005: a resurrection needs the reserve of exactly RESURRECT_GEMS (10) gems (CORE-026).
  // It reads the reserve taken at start, not the live balance.
  if (report.resurrections === 1 && report.reservedGems !== ECONOMY_VIEW.resurrectGems) {
    reasons.add('res_unreserved');
  }

  // Negative-balance guard, separate from SEC-005: the reserved resurrection (-10 gems, DB-006) must not take
  // the live gem balance below zero. Gems can go negative only through a refund (ECO-010).
  if (
    report.resurrections === 1 &&
    report.reservedGems === ECONOMY_VIEW.resurrectGems &&
    report.gemBalance < ECONOMY_VIEW.resurrectGems
  ) {
    reasons.add('gems_negative');
  }

  return VERDICT_REASONS.filter((reason) => reasons.has(reason));
}
