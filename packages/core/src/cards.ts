// Card pool, offers, rerolls and hero modifiers (spec 4.2: CARD-001..CARD-008, CARD-002 algorithm).
// Offers are pure functions of (run seed, wave, reroll counter, team, taken cards).

import { BATTLE, CARDS, ECONOMY, type CardDef, type HeroId } from './config.ts';
import { kdf, Xoshiro128ss } from './prng.ts';
import type { HeroStats } from './battle.ts';

/** A card taken into the team, with its tier 0..3 (CARD-006). */
export interface TakenCard {
  readonly id: string;
  readonly tier: number;
}

/** Ids are ASCII ([a-z0-9_]+), so code-unit order equals the UTF-8 byte order required by CARD-002. */
function byIdBytes(a: CardDef, b: CardDef): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Card pool of a team, sorted by id, without the cards already in the team (CARD-001, CARD-002).
 * Druid cards are in the pool only when the druid is in the team (they are not listed otherwise).
 */
export function poolFor(team: readonly HeroId[], taken: readonly TakenCard[]): CardDef[] {
  const takenIds = new Set(taken.map((t) => t.id));
  return CARDS.filter((c) => (c.hero === 'common' || team.includes(c.hero as HeroId)) && !takenIds.has(c.id)).sort(
    byIdBytes,
  );
}

/**
 * Draws the offer from a pool sorted by id (CARD-002).
 * n < 3: the whole pool in id order, no PRNG. Otherwise a partial Fisher-Yates on the first three positions.
 */
export function drawOffer(sortedPool: readonly string[], rng: (n: number) => number): string[] {
  const n = sortedPool.length;
  if (n < 3) return [...sortedPool];
  const pool = [...sortedPool];
  for (let i = 0; i < 3; i++) {
    const j = i + rng(n - i);
    const tmp = pool[i] as string;
    pool[i] = pool[j] as string;
    pool[j] = tmp;
  }
  return pool.slice(0, 3);
}

/** Offer for step 2 of wave `wave` with reroll counter `reroll` (CARD-002, stream `cards`, RNG-005). */
export function offerFor(
  seed: Uint8Array,
  wave: number,
  reroll: number,
  team: readonly HeroId[],
  taken: readonly TakenCard[],
): string[] {
  const ids = poolFor(team, taken).map((c) => c.id);
  if (ids.length === 0) return [];
  if (ids.length < 3) return ids;
  const rng = new Xoshiro128ss(kdf(seed, 'cards', wave, reroll));
  return drawOffer(ids, (n) => rng.bounded(n));
}

/** Free card of the help rule (CARD-007): offer[0] of the `help` stream (i1 = 0, i2 = 0) from an empty team. */
export function helpCard(seed: Uint8Array, team: readonly HeroId[]): string | null {
  const ids = poolFor(team, []).map((c) => c.id);
  if (ids.length === 0) return null;
  if (ids.length < 3) return ids[0] ?? null;
  const rng = new Xoshiro128ss(kdf(seed, 'help', 0, 0));
  return drawOffer(ids, (n) => rng.bounded(n))[0] ?? null;
}

/** Looks up a card definition by id. */
export function cardById(id: string): CardDef {
  const c = CARDS.find((x) => x.id === id);
  if (!c) throw new RangeError(`unknown card ${id}`);
  return c;
}

/** Summed percent modifiers of one hero from the taken cards (CARD-006 tier values). */
export interface HeroModifiers {
  readonly dmgPct: number;
  readonly hpPct: number;
  readonly speedPct: number;
}

/** Modifiers of a hero: common cards apply to every team hero, hero cards only to their hero. */
export function modifiersFor(heroId: HeroId, taken: readonly TakenCard[]): HeroModifiers {
  let dmgPct = 0;
  let hpPct = 0;
  let speedPct = 0;
  for (const t of taken) {
    const c = cardById(t.id);
    if (c.hero !== 'common' && c.hero !== heroId) continue;
    const value = c.tiers[t.tier] as number;
    if (c.stat === 'dmg') dmgPct += value;
    else if (c.stat === 'hp') hpPct += value;
    else speedPct += value;
  }
  return { dmgPct, hpPct, speedPct };
}

/**
 * Effective hero stats for a wave (CORE-024 base values, ECO-004 level bonus, CARD-006 modifiers).
 * Integer math: bonuses are percent sums applied with floor. Attack speed shortens the period (never below 1 tick).
 */
export function heroStatsFor(
  team: readonly HeroId[],
  levels: Readonly<Partial<Record<HeroId, number>>>,
  taken: readonly TakenCard[],
): HeroStats[] {
  return team.map((id) => {
    const base = BATTLE.heroes[id];
    const level = levels[id] ?? 1;
    const levelPct = (level - 1) * ECONOMY.levelBonusPct;
    const mod = modifiersFor(id, taken);
    const hp = Math.floor((base.hp * (100 + levelPct + mod.hpPct)) / 100);
    const dmg = Math.floor((base.dmg * (100 + levelPct + mod.dmgPct)) / 100);
    const period = Math.max(1, Math.floor((base.period * 100) / (100 + mod.speedPct)));
    return { id, hp, dmg, period };
  });
}
