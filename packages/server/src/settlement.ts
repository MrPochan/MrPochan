// Ledger entries of a verified run (ECO-001, ECO-008, SEC-006). Pure: the caller writes the entries.

import { ECONOMY_VIEW, LedgerKeys, type LedgerEntry } from '@cupquest/core';
import type { WaveReport } from './validation.ts';

export interface Settlement {
  readonly entries: readonly LedgerEntry[];
  /** Sum of coins of all waves. */
  readonly coins: number;
  /** Balls left at the end of the run and burned (ECO-008). */
  readonly burnedBalls: number;
}

export function settleRun(input: {
  readonly runId: string;
  readonly userId: string;
  readonly at: number;
  readonly waves: readonly WaveReport[];
  readonly resurrected: boolean;
}): Settlement {
  const entries: LedgerEntry[] = [];
  const push = (entry: LedgerEntry): void => {
    if (entry.delta !== 0) entries.push(entry);
  };
  const base = { userId: input.userId, runId: input.runId, at: input.at };

  let coins = 0;
  let balls = 0;
  let spent = 0;
  for (const wave of input.waves) {
    coins += wave.coins;
    balls += wave.balls;
    spent += wave.spend;
    push({ ...base, key: LedgerKeys.coin(input.runId, wave.w), currency: 'coin', delta: wave.coins, reason: 'run_coin' });
    push({ ...base, key: LedgerKeys.ball(input.runId, wave.w), currency: 'ball', delta: wave.balls, reason: 'run_ball' });
    push({ ...base, key: LedgerKeys.spend(input.runId, wave.w), currency: 'ball', delta: -wave.spend, reason: 'card_spend' });
  }

  const burned = balls - spent;
  push({ ...base, key: LedgerKeys.burn(input.runId), currency: 'ball', delta: -burned, reason: 'burn' });
  if (input.resurrected) {
    push({
      ...base,
      key: LedgerKeys.resurrect(input.runId),
      currency: 'gem',
      delta: -ECONOMY_VIEW.resurrectGems,
      reason: 'resurrect',
    });
  }

  return { entries, coins, burnedBalls: burned };
}
