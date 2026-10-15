// Typed view of the balance data in ./data/*.json (BAL-001, BAL-002).
// Every tunable number is stored as {"value": int | null, "source": "concept:<section>" | "assumption" | "open"}.
// This module unwraps them once at load time, so runtime code only sees plain integers.

import fieldJson from './data/field.json' with { type: 'json' };
import battleJson from './data/battle.json' with { type: 'json' };
import cardsJson from './data/cards.json' with { type: 'json' };
import economyJson from './data/economy.json' with { type: 'json' };

/** A balance number as stored in JSON (BAL-002). */
export interface Num {
  value: number | null;
  source: string;
}

/** Unwraps a balance number. Throws if the value is missing (null) or not an integer. */
export function num(n: Num, where: string): number {
  if (n.value === null || !Number.isInteger(n.value)) {
    throw new Error(`balance value at ${where} is not an integer (source: ${n.source})`);
  }
  return n.value;
}

// ---------------------------------------------------------------- field

export interface FieldConfig {
  readonly width: number;
  readonly routeRows: number;
  readonly dropX: readonly number[];
  readonly slotCount: number;
  readonly templates: readonly (readonly number[])[];
  /** Weights for x0, x1, x2, x3, x5 in that order (GEN-013). */
  readonly weights: readonly number[];
  /** Cumulative thresholds for x0, x1, x2, x3 (GEN-013); the x5 threshold is 100. */
  readonly thresholds: readonly number[];
  readonly maxX0PerField: number;
  readonly attempts: number;
}

function loadField(raw: typeof fieldJson): FieldConfig {
  const w = raw.weights;
  const weights = [
    num(w.x0, 'field.weights.x0'),
    num(w.x1, 'field.weights.x1'),
    num(w.x2, 'field.weights.x2'),
    num(w.x3, 'field.weights.x3'),
    num(w.x5, 'field.weights.x5'),
  ];
  const thresholds: number[] = [];
  let acc = 0;
  for (const v of weights) {
    acc += v;
    thresholds.push(acc);
  }
  if (acc !== 100) throw new Error(`field weights must sum to 100, got ${acc}`);
  const cfg: FieldConfig = {
    width: raw.geometry.width,
    routeRows: raw.geometry.route_rows,
    dropX: raw.geometry.drop_x,
    slotCount: raw.geometry.slot_count,
    templates: raw.templates,
    weights,
    thresholds,
    maxX0PerField: raw.max_x0_per_field,
    attempts: num(raw.attempts, 'field.attempts'),
  };
  if (cfg.slotCount !== 5) throw new Error('field must have exactly 5 gate slots');
  for (const t of cfg.templates) {
    if (t.length !== cfg.slotCount) throw new Error('every template must have 5 slots');
  }
  return cfg;
}

export const FIELD: FieldConfig = loadField(fieldJson);

// ---------------------------------------------------------------- battle

export type HeroId = 'knight' | 'archer' | 'mage' | 'druid';
export type EnemyType = 'grunt' | 'brute' | 'captain' | 'boss';
export type WaveKind = 'normal' | 'miniboss' | 'boss';

export interface HeroDef {
  readonly id: HeroId;
  readonly name: string;
  readonly hp: number;
  readonly dmg: number;
  /** Attack period in ticks; a unit attacks when tick % period === 0. */
  readonly period: number;
  /** Splash radius: living enemies within this index distance also take the full damage (CORE-025). */
  readonly splashRadius: number;
}

export interface EnemyDef {
  readonly type: EnemyType;
  readonly name: string;
  readonly hp: number;
  readonly dmg: number;
  readonly period: number;
  /** Boss phases, sorted by threshold descending: when hp * 100 <= maxHp * hpPctBelow, dmg becomes the phase dmg. */
  readonly phases: readonly { readonly hpPctBelow: number; readonly dmg: number }[];
}

export interface WaveDef {
  readonly wave: number;
  readonly kind: WaveKind;
  readonly enemies: readonly { readonly type: EnemyType; readonly slot: number }[];
}

export interface BattleConfig {
  readonly tickMs: number;
  readonly tmin1: number;
  readonly tmin2: number;
  readonly tminField: number;
  readonly limitTicks: Readonly<Record<WaveKind, number>>;
  readonly resurrectWaitTicks: number;
  readonly resurrectHpDivisor: number;
  readonly enemySlots: number;
  readonly heroSlots: number;
  readonly heroes: Readonly<Record<HeroId, HeroDef>>;
  readonly frog: {
    readonly hp: number;
    readonly dmg: number;
    readonly period: number;
    readonly life: number;
    readonly summonPeriod: number;
    readonly maxAlive: number;
  };
  readonly enemies: Readonly<Record<EnemyType, EnemyDef>>;
  readonly waves: readonly WaveDef[];
}

function loadBattle(raw: typeof battleJson): BattleConfig {
  const heroes = {} as Record<HeroId, HeroDef>;
  for (const id of ['knight', 'archer', 'mage', 'druid'] as const) {
    const h = raw.heroes[id];
    heroes[id] = {
      id,
      name: h.name,
      hp: num(h.hp, `heroes.${id}.hp`),
      dmg: num(h.dmg, `heroes.${id}.dmg`),
      period: num(h.period, `heroes.${id}.period`),
      splashRadius: num(h.splash_radius, `heroes.${id}.splash_radius`),
    };
  }
  const enemies = {} as Record<EnemyType, EnemyDef>;
  for (const type of ['grunt', 'brute', 'captain', 'boss'] as const) {
    const e = raw.enemies[type];
    const phases = ('phases' in e ? (e.phases as { hp_pct_below: Num; dmg: Num }[]) : []).map((p) => ({
      hpPctBelow: num(p.hp_pct_below, `enemies.${type}.phases.hp_pct_below`),
      dmg: num(p.dmg, `enemies.${type}.phases.dmg`),
    }));
    enemies[type] = {
      type,
      name: e.name,
      hp: num(e.hp, `enemies.${type}.hp`),
      dmg: num(e.dmg, `enemies.${type}.dmg`),
      period: num(e.period, `enemies.${type}.period`),
      phases,
    };
  }
  const waves: WaveDef[] = raw.waves.map((w) => ({
    wave: w.wave,
    kind: w.kind as WaveKind,
    enemies: w.enemies.map((e) => ({ type: e.type as EnemyType, slot: e.slot })),
  }));
  const cfg: BattleConfig = {
    tickMs: num(raw.tick_ms, 'tick_ms'),
    tmin1: num(raw.tmin1, 'tmin1'),
    tmin2: num(raw.tmin2, 'tmin2'),
    tminField: num(raw.tmin3_tanim, 'tmin3_tanim'),
    limitTicks: {
      normal: num(raw.limits_ticks.normal, 'limits_ticks.normal'),
      miniboss: num(raw.limits_ticks.miniboss, 'limits_ticks.miniboss'),
      boss: num(raw.limits_ticks.boss, 'limits_ticks.boss'),
    },
    resurrectWaitTicks: num(raw.resurrect.wait_ticks, 'resurrect.wait_ticks'),
    resurrectHpDivisor: num(raw.resurrect.hp_divisor, 'resurrect.hp_divisor'),
    enemySlots: raw.formation.enemy_slots,
    heroSlots: raw.formation.hero_slots,
    heroes,
    frog: {
      hp: num(raw.frog.hp, 'frog.hp'),
      dmg: num(raw.frog.dmg, 'frog.dmg'),
      period: num(raw.frog.period, 'frog.period'),
      life: num(raw.frog.life, 'frog.life'),
      summonPeriod: num(raw.frog.summon_period, 'frog.summon_period'),
      maxAlive: num(raw.frog.max_alive, 'frog.max_alive'),
    },
    enemies,
    waves,
  };
  if (cfg.heroSlots !== 3) throw new Error('a team has exactly 3 heroes');
  if (cfg.enemySlots !== 5) throw new Error('the enemy line has exactly 5 slots');
  if (waves.length !== 15) throw new Error('battle.json must describe 15 waves');
  for (const w of waves) {
    const used = new Set<number>();
    for (const e of w.enemies) {
      if (e.slot < 0 || e.slot >= cfg.enemySlots || used.has(e.slot)) {
        throw new Error(`wave ${w.wave}: bad enemy slot ${e.slot}`);
      }
      used.add(e.slot);
    }
  }
  return cfg;
}

export const BATTLE: BattleConfig = loadBattle(battleJson);

// ---------------------------------------------------------------- cards

export type CardStat = 'dmg' | 'hp' | 'speed';
export type CardHero = HeroId | 'common';

export interface CardDef {
  readonly id: string;
  readonly hero: CardHero;
  readonly stat: CardStat;
  /** Percent value per tier 0..3 (CARD-006). */
  readonly tiers: readonly [number, number, number, number];
}

function loadCards(raw: typeof cardsJson): readonly CardDef[] {
  const cards: CardDef[] = raw.cards.map((c) => {
    const eff = c.effects[0];
    if (!eff || c.effects.length !== 1) throw new Error(`card ${c.id}: exactly one effect expected`);
    const tiers = eff.tiers.map((t, i) => num(t, `cards.${c.id}.tiers[${i}]`));
    if (tiers.length !== 4) throw new Error(`card ${c.id}: four tier values expected`);
    if (!/^[a-z0-9_]+$/.test(c.id)) throw new Error(`card id ${c.id} is not [a-z0-9_]+`);
    return {
      id: c.id,
      hero: c.hero as CardHero,
      stat: eff.stat as CardStat,
      tiers: [tiers[0] as number, tiers[1] as number, tiers[2] as number, tiers[3] as number],
    };
  });
  if (cards.length !== 30) throw new Error('the MVP card pool has 30 cards');
  const ids = new Set(cards.map((c) => c.id));
  if (ids.size !== cards.length) throw new Error('card ids must be unique');
  return cards;
}

export const CARDS: readonly CardDef[] = loadCards(cardsJson);

// ---------------------------------------------------------------- economy

export interface EconomyConfig {
  readonly coinWinBase: number;
  readonly coinWinPerWave: number;
  readonly bossWave: number;
  readonly bossBonus: number;
  readonly minibossWave: number;
  readonly minibossBonus: number;
  readonly shortModeWaves: number;
  readonly levelMin: number;
  readonly levelMax: number;
  /** U(L) for L = levelMin..levelMax (ECO-004). */
  readonly levelCost: readonly number[];
  readonly ballUnit: number;
  /** Ball multiplier per gate type, same order as GATE_TYPES. */
  readonly gateMultiplier: Readonly<Record<'x0' | 'x1' | 'x2' | 'x3' | 'x5', number>>;
  readonly rerollCost: number;
  /** Cost to reach tier 1, 2, 3 (CARD-006). */
  readonly tierCost: readonly [number, number, number];
  readonly maxTier: number;
  readonly energyMax: number;
  readonly energyPeriodS: number;
  readonly energyPurchaseEnabled: boolean;
  readonly resurrectGems: number;
  readonly druidGems: number;
  readonly druidCoins: number;
  readonly levelBonusPct: number;
}

function loadEconomy(raw: typeof economyJson): EconomyConfig {
  const levelCost = raw.level.table.map((n, i) => num(n, `level.table[${i}]`));
  if (levelCost.length !== raw.level.max_level - raw.level.min_level + 1) {
    throw new Error('level table length does not match min/max level');
  }
  const t = raw.ball.tier_cost;
  return {
    coinWinBase: num(raw.coin.win_base, 'coin.win_base'),
    coinWinPerWave: num(raw.coin.win_per_wave, 'coin.win_per_wave'),
    bossWave: num(raw.coin.boss_wave, 'coin.boss_wave'),
    bossBonus: num(raw.coin.boss_bonus, 'coin.boss_bonus'),
    minibossWave: num(raw.coin.miniboss_wave, 'coin.miniboss_wave'),
    minibossBonus: num(raw.coin.miniboss_bonus, 'coin.miniboss_bonus'),
    shortModeWaves: num(raw.coin.short_mode_waves, 'coin.short_mode_waves'),
    levelMin: raw.level.min_level,
    levelMax: raw.level.max_level,
    levelCost,
    ballUnit: num(raw.ball.unit, 'ball.unit'),
    gateMultiplier: {
      x0: num(raw.ball.gate_multiplier.x0, 'ball.gate_multiplier.x0'),
      x1: num(raw.ball.gate_multiplier.x1, 'ball.gate_multiplier.x1'),
      x2: num(raw.ball.gate_multiplier.x2, 'ball.gate_multiplier.x2'),
      x3: num(raw.ball.gate_multiplier.x3, 'ball.gate_multiplier.x3'),
      x5: num(raw.ball.gate_multiplier.x5, 'ball.gate_multiplier.x5'),
    },
    rerollCost: num(raw.ball.reroll_cost, 'ball.reroll_cost'),
    tierCost: [num(t[0]!, 'ball.tier_cost[0]'), num(t[1]!, 'ball.tier_cost[1]'), num(t[2]!, 'ball.tier_cost[2]')],
    maxTier: num(raw.ball.max_tier, 'ball.max_tier'),
    energyMax: num(raw.energy.max, 'energy.max'),
    energyPeriodS: num(raw.energy.period_s, 'energy.period_s'),
    energyPurchaseEnabled: raw.energy.purchase_enabled,
    resurrectGems: num(raw.gems.resurrect, 'gems.resurrect'),
    druidGems: num(raw.gems.druid_unlock, 'gems.druid_unlock'),
    druidCoins: num(raw.coins_unlock.druid, 'coins_unlock.druid'),
    levelBonusPct: num(raw.level.bonus_pct_per_level, 'level.bonus_pct_per_level'),
  };
}

export const ECONOMY: EconomyConfig = loadEconomy(economyJson);

/**
 * Every balance value that is still open (source "open" or value null), plus every wave with status "open".
 * A release build must fail when this list is not empty (BAL-002, CORE-009). The test build allows it.
 */
export function openBalanceEntries(): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if ('value' in obj && typeof obj.source === 'string') {
      if (obj.source === 'open' || obj.value === null) out.push(path);
      return;
    }
    if (obj.status === 'open') out.push(path);
    for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`);
  };
  walk(battleJson, 'battle');
  walk(cardsJson, 'cards');
  walk(economyJson, 'economy');
  walk(fieldJson, 'field');
  return out;
}
