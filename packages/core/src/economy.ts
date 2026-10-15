// Coins, balls, gems and energy (spec 4.3: ECO-001..ECO-012, C22). Integer math only.
// Energy is not a ledger currency (C22, ECO-001): the Currency type has no energy member.

import { ECONOMY } from './config.ts';
import { RuleError } from './errors.ts';
import type { GateType } from './board.ts';

/** Currencies that are written to the ledger (ECO-001). Energy is deliberately absent. */
export type Currency = 'coin' | 'ball' | 'gem';

export type RunMode = 'full' | 'short5';

/** Coins for winning wave `wave` (ECO-002): 20 + 5w, +500 on wave 15, +N on wave 8 in full mode. */
export function coinsForWin(wave: number, mode: RunMode = 'full'): number {
  if (!Number.isInteger(wave) || wave < 1 || wave > 15) throw new RangeError(`wave must be 1..15, got ${wave}`);
  if (mode === 'short5' && wave > ECONOMY.shortModeWaves) {
    throw new RangeError(`short5 mode has waves 1..${ECONOMY.shortModeWaves}`);
  }
  let coins = ECONOMY.coinWinBase + ECONOMY.coinWinPerWave * wave;
  if (mode === 'full') {
    if (wave === ECONOMY.bossWave) coins += ECONOMY.bossBonus;
    if (wave === ECONOMY.minibossWave) coins += ECONOMY.minibossBonus;
  }
  return coins;
}

/** Balls produced by a gate (ECO-006): B = 10 * m. */
export function ballsForGate(gate: GateType): number {
  return ECONOMY.ballUnit * ECONOMY.gateMultiplier[gate];
}

/** Cost of a reroll in balls (CARD-004). */
export function rerollCost(): number {
  return ECONOMY.rerollCost;
}

/** Cost of raising a card to `toTier` (1..3) in balls (CARD-006: 20 / 60 / 150). */
export function upgradeCost(toTier: number): number {
  if (!Number.isInteger(toTier) || toTier < 1 || toTier > ECONOMY.maxTier) {
    throw new RangeError(`tier must be 1..${ECONOMY.maxTier}, got ${toTier}`);
  }
  return ECONOMY.tierCost[toTier - 1] as number;
}

/** Cost in gems to unlock a hero in gems (ECO-005). */
export function druidGemCost(): number {
  return ECONOMY.druidGems;
}

/** Cost in coins to go from level L-1 to L (ECO-004): U(L) from the stored integer table. */
export function levelCost(level: number): number {
  if (!Number.isInteger(level) || level < ECONOMY.levelMin || level > ECONOMY.levelMax) {
    throw new RangeError(`level must be ${ECONOMY.levelMin}..${ECONOMY.levelMax}, got ${level}`);
  }
  return ECONOMY.levelCost[level - ECONOMY.levelMin] as number;
}

/** Energy pair (E, T) (ECO-011): E in 0..MAX, T is the server time of the last regeneration anchor, in seconds. */
export interface EnergyState {
  readonly e: number;
  readonly t: number;
}

/** energy_read(now) (ECO-011). `now` is unix seconds, now >= T. The phase of the anchor is kept. */
export function energyRead(state: EnergyState, now: number): EnergyState {
  const max = ECONOMY.energyMax;
  const period = ECONOMY.energyPeriodS;
  if (state.e >= max) return { e: max, t: now };
  const k = Math.floor((now - state.t) / period);
  if (state.e + k >= max) return { e: max, t: now };
  return { e: state.e + k, t: state.t + k * period };
}

/** energy_spend_one(now) (ECO-011): one energy for a run start. Throws energy.empty when none is available. */
export function energySpendOne(state: EnergyState, now: number): EnergyState {
  const read = energyRead(state, now);
  if (read.e < 1) throw new RuleError('energy.empty', 'no energy for a run start');
  const t = read.e === ECONOMY.energyMax ? now : read.t;
  return { e: read.e - 1, t };
}

/** Energy purchase is off for the MVP (ECO-012). Kept as a function so the API can answer clearly. */
export function energyPurchaseAvailable(): boolean {
  return ECONOMY.energyPurchaseEnabled;
}

/** One ledger entry (ECO-001). Energy never appears here. */
export interface LedgerEntry {
  readonly key: string;
  readonly userId: string;
  readonly currency: Currency;
  readonly delta: number;
  readonly reason: string;
  readonly runId: string | null;
  readonly at: number;
}

/** Idempotency keys of run-level entries (ECO-001). */
export const LedgerKeys = {
  coin: (runId: string, wave: number): string => `run:${runId}:w${wave}:coin`,
  ball: (runId: string, wave: number): string => `run:${runId}:w${wave}:ball`,
  spend: (runId: string, wave: number): string => `run:${runId}:w${wave}:spend`,
  burn: (runId: string): string => `run:${runId}:burn`,
  resurrect: (runId: string): string => `run:${runId}:res`,
} as const;

/** Balance of one user in one currency, computed from entries only (ECO-001: no direct balance writes). */
export function balanceOf(entries: readonly LedgerEntry[], userId: string, currency: Currency): number {
  let sum = 0;
  for (const e of applyIdempotent(entries)) {
    if (e.userId === userId && e.currency === currency) sum += e.delta;
  }
  return sum;
}

/** Keeps the first entry for each key; a repeated key does not change the balance (ECO-001). */
export function applyIdempotent(entries: readonly LedgerEntry[]): LedgerEntry[] {
  const seen = new Set<string>();
  const out: LedgerEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(e);
  }
  return out;
}

/**
 * Appends an entry if its key is new and the balance stays non-negative (ECO-007, ECO-010).
 * A negative balance is allowed only for gems and only through `allowNegativeGems` (refund case, ECO-010).
 */
export function appendEntry(
  entries: readonly LedgerEntry[],
  entry: LedgerEntry,
  allowNegativeGems = false,
): LedgerEntry[] {
  if (entries.some((e) => e.key === entry.key)) return [...entries];
  const after = balanceOf(entries, entry.userId, entry.currency) + entry.delta;
  if (after < 0 && !(entry.currency === 'gem' && allowNegativeGems)) {
    const code = entry.currency === 'ball' ? 'balls.insufficient' : entry.currency === 'gem' ? 'gems.insufficient' : 'coins.insufficient';
    throw new RuleError(code, `${entry.currency} balance would become ${after}`);
  }
  return [...entries, entry];
}
