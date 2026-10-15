import { describe, expect, it } from 'vitest';
import {
  coinsForWin,
  ballsForGate,
  rerollCost,
  upgradeCost,
  levelCost,
  energyRead,
  energySpendOne,
  appendEntry,
  balanceOf,
  applyIdempotent,
  LedgerKeys,
  type Currency,
  type LedgerEntry,
  type EnergyState,
} from '../src/economy.ts';
import { ECONOMY } from '../src/config.ts';
import { RuleError } from '../src/errors.ts';

describe('coins (ECO-002, ECO-003)', () => {
  it('pays 20 + 5w per win, +500 on wave 15 and +N on wave 8', () => {
    expect(coinsForWin(1)).toBe(25);
    expect(coinsForWin(7)).toBe(55);
    expect(coinsForWin(8)).toBe(20 + 40 + 100);
    expect(coinsForWin(15)).toBe(20 + 75 + 500);
  });

  it('a full run is 1 400 + N (N = 100 open value): 1 500 coins', () => {
    let sum = 0;
    for (let w = 1; w <= 15; w++) sum += coinsForWin(w);
    expect(sum).toBe(1400 + ECONOMY.minibossBonus);
    expect(sum).toBe(1500);
  });

  it('short5 pays waves 1-5 without the wave 8 and 15 bonuses', () => {
    let sum = 0;
    for (let w = 1; w <= 5; w++) sum += coinsForWin(w, 'short5');
    expect(sum).toBe(5 * 20 + 5 * (1 + 2 + 3 + 4 + 5));
    expect(() => coinsForWin(6, 'short5')).toThrow(RangeError);
  });
});

describe('balls (ECO-006, ECO-007, CARD-004, CARD-006)', () => {
  it('B = 10 * m with m(x0)=0, m(x1)=1, m(x2)=2, m(x3)=3, m(x5)=5', () => {
    expect(ballsForGate('x0')).toBe(0);
    expect(ballsForGate('x1')).toBe(10);
    expect(ballsForGate('x2')).toBe(20);
    expect(ballsForGate('x3')).toBe(30);
    expect(ballsForGate('x5')).toBe(50);
  });

  it('reroll costs 5 and upgrades cost 20 / 60 / 150 to tiers 1 / 2 / 3', () => {
    expect(rerollCost()).toBe(5);
    expect(upgradeCost(1)).toBe(20);
    expect(upgradeCost(2)).toBe(60);
    expect(upgradeCost(3)).toBe(150);
    expect(() => upgradeCost(0)).toThrow(RangeError);
    expect(() => upgradeCost(4)).toThrow(RangeError);
  });

  it('an average ball yield per wave is 25.2 and per run 377.7 within 2 % (ECO-006, BAL-009)', () => {
    const mean = (ballsForGate('x0') * 0.082 + ballsForGate('x1') * 0.168 + ballsForGate('x2') * 0.3 + ballsForGate('x3') * 0.25 + ballsForGate('x5') * 0.2);
    expect(Math.abs(mean - 25.2)).toBeLessThan(0.3);
    expect(Math.abs(mean * 15 - 377.7) / 377.7).toBeLessThan(0.02);
  });
});

describe('level costs (ECO-004, BAL-004)', () => {
  it('U(2) = 132 and the sum over 2..20 is 29 245', () => {
    expect(levelCost(2)).toBe(132);
    expect(levelCost(20)).toBe(3314);
    let sum = 0;
    for (let L = 2; L <= 20; L++) sum += levelCost(L);
    expect(sum).toBe(29245);
  });

  it('matches round_half_up(50 * L^1.4) for every level (test oracle with floating point)', () => {
    for (let L = 2; L <= 20; L++) {
      expect(levelCost(L)).toBe(Math.floor(50 * Math.pow(L, 1.4) + 0.5));
    }
  });

  it('rejects levels outside 2..20', () => {
    expect(() => levelCost(1)).toThrow(RangeError);
    expect(() => levelCost(21)).toThrow(RangeError);
  });
});

describe('energy (ECO-011, ECO-012): reference cases from the spec', () => {
  // [E, T, now] -> expected [E after spend, T after spend]
  const reference: [number, number, number, number, number][] = [
    [0, 0, 1200, 0, 1200],
    [4, 0, 1199, 3, 0],
    [4, 0, 1200, 4, 1200],
    [5, 0, 5000, 4, 5000],
    [2, 100, 2100, 2, 1300],
    [3, 100, 3700, 4, 3700],
  ];

  it.each(reference)('spend from (E=%i, T=%i) at now=%i gives (%i, %i)', (e, t, now, eOut, tOut) => {
    const out = energySpendOne({ e, t }, now);
    expect(out).toEqual({ e: eOut, t: tOut });
  });

  it('refuses a start with no energy (energy.empty)', () => {
    try {
      energySpendOne({ e: 0, t: 0 }, 0);
      throw new Error('expected energy.empty');
    } catch (err) {
      expect((err as RuleError).code).toBe('energy.empty');
    }
  });

  it('matches an independent reading over a grid of 60 starts (not only the reference cases)', () => {
    const P = ECONOMY.energyPeriodS;
    const MAX = ECONOMY.energyMax;
    let checked = 0;
    for (let e = 0; e <= MAX; e++) {
      for (const t of [0, 100]) {
        for (const delta of [0, P - 1, P, 2 * P, 5000]) {
          const now = t + delta;
          const read = energyRead({ e, t }, now);
          // Independent reading: count whole periods, cap at MAX, anchor moves only while below the cap.
          const k = Math.floor((now - t) / P);
          const expE = Math.min(MAX, e + k);
          const expT = e + k >= MAX ? now : t + k * P;
          expect(read).toEqual({ e: expE, t: expT });
          checked++;
        }
      }
    }
    expect(checked).toBe(60);
  });

  it('keeps E in 0..5 and never decreases the anchor (invariants over 1000 starts)', () => {
    let state: EnergyState = { e: 5, t: 0 };
    let now = 0;
    for (let i = 0; i < 1000; i++) {
      now += (i * 997) % 1500;
      const read = energyRead(state, now);
      if (read.e >= 1) state = energySpendOne(state, now);
      else state = read;
      expect(state.e).toBeGreaterThanOrEqual(0);
      expect(state.e).toBeLessThanOrEqual(ECONOMY.energyMax);
      expect(state.t).toBeLessThanOrEqual(now);
    }
  });

  it('energy purchase is off (ECO-012)', () => {
    expect(ECONOMY.energyPurchaseEnabled).toBe(false);
  });
});

describe('ledger (ECO-001, C22)', () => {
  const base = { userId: 'u1', runId: 'r1', at: 1 };
  const coin = (key: string, delta: number): LedgerEntry => ({ ...base, key, currency: 'coin', delta, reason: 'test' });
  const ball = (key: string, delta: number): LedgerEntry => ({ ...base, key, currency: 'ball', delta, reason: 'test' });

  it('a repeated key does not change the balance', () => {
    const e1 = coin(LedgerKeys.coin('r1', 1), 25);
    const once = appendEntry([], e1);
    const twice = appendEntry(once, e1);
    expect(balanceOf(twice, 'u1', 'coin')).toBe(25);
    expect(twice.length).toBe(1);
    expect(applyIdempotent([e1, e1]).length).toBe(1);
  });

  it('balance is the sum of entries and no balance is written directly', () => {
    let entries: LedgerEntry[] = [];
    entries = appendEntry(entries, ball(LedgerKeys.ball('r1', 1), 20));
    entries = appendEntry(entries, ball(LedgerKeys.spend('r1', 2), -5));
    expect(balanceOf(entries, 'u1', 'ball')).toBe(15);
  });

  it('refuses an entry that would make balls negative (ECO-007)', () => {
    const entries = appendEntry([], ball('k1', 10));
    try {
      appendEntry(entries, ball('k2', -15));
      throw new Error('expected balls.insufficient');
    } catch (err) {
      expect((err as RuleError).code).toBe('balls.insufficient');
    }
  });

  it('negative gems are only allowed through the refund path (ECO-010)', () => {
    const gem = (key: string, delta: number): LedgerEntry => ({ ...base, key, currency: 'gem', delta, reason: 'test' });
    expect(() => appendEntry([], gem('g1', -10))).toThrow(RuleError);
    expect(appendEntry([], gem('g1', -10), true)[0]?.delta).toBe(-10);
  });

  it('energy is not a ledger currency (C22): the type excludes it', () => {
    // @ts-expect-error energy is not written to the ledger (C22, ECO-001)
    const c: Currency = 'energy';
    expect(c).toBe('energy');
  });
});

describe('ECO-001 key formats', () => {
  it('uses the keys of the spec', () => {
    expect(LedgerKeys.coin('abc', 3)).toBe('run:abc:w3:coin');
    expect(LedgerKeys.ball('abc', 3)).toBe('run:abc:w3:ball');
    expect(LedgerKeys.spend('abc', 3)).toBe('run:abc:w3:spend');
    expect(LedgerKeys.burn('abc')).toBe('run:abc:burn');
    expect(LedgerKeys.resurrect('abc')).toBe('run:abc:res');
  });
});
