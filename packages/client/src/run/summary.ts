// Run summary and submit body (API-010, SEC-003). Score and gate counts are computed from the core's run state,
// so the client sends what the core recorded; the server re-checks it.
import { sha256, toHex, type GateType, type RunState } from '@cupquest/core';
import type { SubmitBody } from '../api-types.ts';

export type FinishedResult = 'win' | 'loss' | 'abandon';

export interface RunSummary {
  readonly result: FinishedResult | 'timeout' | null;
  readonly lastWave: number;
  /** Sum of coins and balls gained, without spending (SEC-003). */
  readonly score: number;
  readonly coins: number;
  readonly balls: number;
  readonly gates: Readonly<Record<GateType, number>>;
  readonly bestGate: GateType | null;
  readonly durationTicks: number;
  readonly resurrections: 0 | 1;
}

const GATE_RANK: readonly GateType[] = ['x5', 'x3', 'x2', 'x1', 'x0'];

export function emptyGateCounts(): Record<GateType, number> {
  return { x0: 0, x1: 0, x2: 0, x3: 0, x5: 0 };
}

/** Count of every gate reached by a drop in this run. */
export function gateCounts(state: RunState): Record<GateType, number> {
  const counts = emptyGateCounts();
  for (const r of state.records) if (r.gate !== null) counts[r.gate] += 1;
  return counts;
}

/** Highest gate reached (x5 > x3 > x2 > x1 > x0, TG-003). */
export function bestGate(counts: Readonly<Record<GateType, number>>): GateType | null {
  for (const g of GATE_RANK) if (counts[g] > 0) return g;
  return null;
}

/** Sum of the battle step lengths in ticks, from the run log (SEC-002). */
export function battleTicks(state: RunState): number {
  let total = 0;
  for (const entry of state.log) {
    if (typeof entry === 'object' && entry !== null && (entry as { e?: unknown }).e === 'battle') {
      const ticks = (entry as { ticks?: unknown }).ticks;
      if (typeof ticks === 'number') total += ticks;
    }
  }
  return total;
}

export function summarizeRun(state: RunState): RunSummary {
  const coins = state.records.reduce((sum, r) => sum + r.coins, 0);
  const balls = state.records.reduce((sum, r) => sum + r.ballsGained, 0);
  const gates = gateCounts(state);
  return {
    result: state.result,
    lastWave: state.wave,
    score: coins + balls,
    coins,
    balls,
    gates,
    bestGate: bestGate(gates),
    durationTicks: battleTicks(state),
    resurrections: state.resurrectionUsed ? 1 : 0,
  };
}

/** Run log as the canonical JSON array of the core's records (CORE-027: no spaces). */
export function runLogJson(state: RunState): string {
  return JSON.stringify(state.log);
}

/** Body of POST /runs/submit for a finished run (API-010). */
export function buildSubmitBody(state: RunState, runId: string): SubmitBody {
  if (state.result === null || state.result === 'timeout') {
    throw new RangeError('only a run ended by the player or by a loss or win can be submitted');
  }
  const summary = summarizeRun(state);
  const log = runLogJson(state);
  const logHash = toHex(sha256(new TextEncoder().encode(log)));
  return {
    run_id: runId,
    result: state.result,
    last_wave: state.wave,
    waves: state.records.map((r) => ({ w: r.wave, coins: r.coins, balls: r.ballsGained, spend: r.ballsSpent })),
    gates: summary.gates,
    score: summary.score,
    duration_ticks: summary.durationTicks,
    resurrections: summary.resurrections,
    cards: state.taken.map((t) => ({ card_id: t.id, tier: t.tier })),
    log,
    log_sha256: logHash,
  };
}

