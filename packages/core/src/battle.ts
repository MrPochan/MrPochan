// Wave battle simulation (spec 4.1: CORE-012..CORE-027, CORE-020 timing, CORE-025 positions).
// Deterministic: no PRNG, no clock. Integer ticks (50 ms each); every event also carries integer ms.
// Speed x1/x2 does not enter this function (CORE-011): the client only changes how fast it plays the events.

import { BATTLE, type EnemyDef, type EnemyType, type HeroId, type WaveKind } from './config.ts';
import { RuleError } from './errors.ts';
import { sha256, toHex, utf8 } from './sha256.ts';

/** Hero ids in the order of the slot sort (CORE-025: slots follow the hero id, not the pick order). */
export const HERO_ID_ORDER: readonly HeroId[] = ['archer', 'druid', 'knight', 'mage'];

/** Effective hero stats for one wave: base values, level and card modifiers already applied. */
export interface HeroStats {
  readonly id: HeroId;
  readonly hp: number;
  readonly dmg: number;
  readonly period: number;
}

/** Resurrection input (CORE-027): `h` is the hero slot 0..2 in the team order. */
export interface ResurrectCommand {
  readonly t: number;
  readonly k: 'res';
  readonly h: number;
}

export interface EnemySpec {
  readonly type: EnemyType;
  readonly slot: number;
}

export interface BattleInput {
  readonly wave: number;
  /** Exactly three heroes; slots are assigned by sorting on the hero id. */
  readonly team: readonly HeroStats[];
  /** True when the run still has its one resurrection (CORE-026) and it is reserved for this run. */
  readonly resurrectionAvailable: boolean;
  readonly commands?: readonly ResurrectCommand[];
  /** Replaces the wave composition from battle.json (tests and tools only). */
  readonly enemies?: readonly EnemySpec[];
  /** Replaces the wave limit in ticks (tests and tools only). */
  readonly limitTicks?: number;
}

export type EndReason = 'enemies_dead' | 'heroes_dead' | 'limit';

export type BattleEvent =
  | { readonly t: number; readonly ms: number; readonly e: 'hit'; readonly from: string; readonly to: string; readonly dmg: number; readonly hp: number; readonly splash: boolean }
  | { readonly t: number; readonly ms: number; readonly e: 'death'; readonly u: string }
  | { readonly t: number; readonly ms: number; readonly e: 'res'; readonly h: number; readonly hp: number }
  | { readonly t: number; readonly ms: number; readonly e: 'summon'; readonly f: string }
  | { readonly t: number; readonly ms: number; readonly e: 'expire'; readonly f: string }
  | { readonly t: number; readonly ms: number; readonly e: 'phase'; readonly u: string; readonly n: number }
  | { readonly t: number; readonly ms: number; readonly e: 'end'; readonly r: 'win' | 'lose'; readonly why: EndReason };

export interface BattleResult {
  readonly outcome: 'win' | 'lose';
  readonly reason: EndReason;
  /** Length of the step in ticks: max(T, Tmin1) on a win (CORE-021), T on a loss. */
  readonly durationTicks: number;
  readonly durationMs: number;
  readonly events: readonly BattleEvent[];
  readonly resurrectionUsed: boolean;
  /** Final hp of heroes by slot, 0 for a hero that is dead. */
  readonly heroHp: readonly number[];
  readonly enemiesAlive: number;
}

/** Event payload without the time fields, distributed over the union so each variant keeps its own keys. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventBody = DistributiveOmit<BattleEvent, 't' | 'ms'>;

interface HeroState {
  readonly id: HeroId;
  readonly slot: number;
  readonly maxHp: number;
  readonly dmg: number;
  readonly period: number;
  readonly splashRadius: number;
  hp: number;
  alive: boolean;
}

interface EnemyState {
  readonly slot: number;
  readonly def: EnemyDef;
  readonly maxHp: number;
  hp: number;
  alive: boolean;
  phase: number;
}

interface FrogState {
  readonly id: string;
  readonly spawnTick: number;
  alive: boolean;
}

/** Limit in ticks for a wave kind (CORE-020). */
export function waveLimitTicks(wave: number): number {
  const kind = waveKind(wave);
  return BATTLE.limitTicks[kind];
}

/** Kind of the wave from battle.json (normal, miniboss on wave 8, boss on wave 15). */
export function waveKind(wave: number): WaveKind {
  const w = BATTLE.waves[wave - 1];
  if (!w || w.wave !== wave) throw new RangeError(`no battle data for wave ${wave}`);
  return w.kind;
}

/** Enemy composition of a wave from battle.json (CORE-009). */
export function waveEnemies(wave: number): readonly EnemySpec[] {
  const w = BATTLE.waves[wave - 1];
  if (!w || w.wave !== wave) throw new RangeError(`no battle data for wave ${wave}`);
  return w.enemies;
}

function validateTeam(team: readonly HeroStats[]): HeroStats[] {
  if (team.length !== BATTLE.heroSlots) throw new RangeError(`a team has ${BATTLE.heroSlots} heroes`);
  const ids = new Set(team.map((h) => h.id));
  if (ids.size !== team.length) throw new RangeError('team heroes must be unique');
  for (const h of team) {
    if (!HERO_ID_ORDER.includes(h.id)) throw new RangeError(`unknown hero ${h.id}`);
    if (!Number.isInteger(h.hp) || !Number.isInteger(h.dmg) || !Number.isInteger(h.period)) {
      throw new RangeError(`hero ${h.id} stats must be integers`);
    }
    if (h.hp < 1 || h.dmg < 0 || h.period < 1) throw new RangeError(`hero ${h.id} stats out of range`);
  }
  return [...team].sort((a, b) => (HERO_ID_ORDER.indexOf(a.id) - HERO_ID_ORDER.indexOf(b.id)));
}

/** Simulates one wave of step 1 (CORE-012..CORE-027). Throws RuleError for an invalid command. */
export function simulateWave(input: BattleInput): BattleResult {
  const wave = input.wave;
  if (!Number.isInteger(wave) || wave < 1 || wave > 15) throw new RangeError(`wave must be 1..15, got ${wave}`);
  const heroDefs = validateTeam(input.team);
  const limit = input.limitTicks ?? waveLimitTicks(wave);
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  const tickMs = BATTLE.tickMs;
  const enemySpecs = input.enemies ?? waveEnemies(wave);

  const commands = [...(input.commands ?? [])];
  for (const c of commands) {
    if (c.k !== 'res') throw new RuleError('battle.bad_command', `unknown battle command ${String(c.k)}`);
    if (!Number.isInteger(c.t) || c.t < 1 || c.t > limit) throw new RuleError('battle.bad_tick', `bad tick ${c.t}`);
    if (!Number.isInteger(c.h) || c.h < 0 || c.h >= BATTLE.heroSlots) {
      throw new RuleError('battle.bad_hero', `hero slot must be 0..${BATTLE.heroSlots - 1}`);
    }
    if (!input.resurrectionAvailable) {
      throw new RuleError('battle.resurrect_unavailable', 'no resurrection is reserved for this run');
    }
  }
  commands.sort((a, b) => a.t - b.t);

  const heroes: HeroState[] = heroDefs.map((h, slot) => {
    const def = BATTLE.heroes[h.id];
    return {
      id: h.id,
      slot,
      maxHp: h.hp,
      dmg: h.dmg,
      period: h.period,
      splashRadius: def.splashRadius,
      hp: h.hp,
      alive: true,
    };
  });
  const enemies: (EnemyState | undefined)[] = new Array<EnemyState | undefined>(BATTLE.enemySlots).fill(undefined);
  for (const e of enemySpecs) {
    if (e.slot < 0 || e.slot >= BATTLE.enemySlots || enemies[e.slot] !== undefined) {
      throw new RangeError(`bad enemy slot ${e.slot}`);
    }
    const def = BATTLE.enemies[e.type];
    enemies[e.slot] = { slot: e.slot, def, maxHp: def.hp, hp: def.hp, alive: true, phase: -1 };
  }
  const druid = heroes.find((h) => h.id === 'druid');
  const frogs: FrogState[] = [];
  let frogCounter = 0;

  const events: BattleEvent[] = [];
  const push = (t: number, ev: EventBody): void => {
    events.push({ t, ms: t * tickMs, ...ev } as BattleEvent);
  };

  let resurrectionUsed = false;
  let waitStart: number | null = null;

  const enemyList = (): EnemyState[] => enemies.filter((e): e is EnemyState => e !== undefined && e.alive);
  const firstAliveEnemy = (): EnemyState | undefined => enemyList()[0];
  const firstAliveHero = (): HeroState | undefined => heroes.find((h) => h.alive);

  const updatePhase = (t: number, en: EnemyState): void => {
    let phase = -1;
    en.def.phases.forEach((p, idx) => {
      if (en.hp * 100 <= en.maxHp * p.hpPctBelow) phase = idx;
    });
    if (phase > en.phase) {
      en.phase = phase;
      push(t, { e: 'phase', u: `e${en.slot}`, n: phase + 1 });
    }
  };

  const currentEnemyDamage = (en: EnemyState): number => {
    if (en.phase >= 0) {
      const p = en.def.phases[en.phase];
      if (p) return p.dmg;
    }
    return en.def.dmg;
  };

  const damageEnemy = (t: number, from: string, dmg: number, en: EnemyState, splash: boolean): void => {
    en.hp = Math.max(0, en.hp - dmg);
    push(t, { e: 'hit', from, to: `e${en.slot}`, dmg, hp: en.hp, splash });
    if (en.hp <= 0) {
      en.alive = false;
      push(t, { e: 'death', u: `e${en.slot}` });
    } else {
      updatePhase(t, en);
    }
  };

  const damageHero = (t: number, from: string, dmg: number, h: HeroState): void => {
    h.hp = Math.max(0, h.hp - dmg);
    push(t, { e: 'hit', from, to: `h${h.slot}`, dmg, hp: h.hp, splash: false });
    if (h.hp <= 0) {
      h.alive = false;
      push(t, { e: 'death', u: `h${h.slot}` });
    }
  };

  const finish = (t: number, outcome: 'win' | 'lose', reason: EndReason): BattleResult => {
    push(t, { e: 'end', r: outcome, why: reason });
    const durationTicks = outcome === 'win' ? Math.max(t, BATTLE.tmin1) : t;
    return {
      outcome,
      reason,
      durationTicks,
      durationMs: durationTicks * tickMs,
      events,
      resurrectionUsed,
      heroHp: heroes.map((h) => (h.alive ? h.hp : 0)),
      enemiesAlive: enemyList().length,
    };
  };

  let cursor = 0;
  for (let t = 1; t <= limit; t++) {
    // Start of tick: frogs expire, the druid summons (CORE-025 frog rules, battle.json frog).
    for (const f of frogs) {
      if (f.alive && t >= f.spawnTick + BATTLE.frog.life) {
        f.alive = false;
        push(t, { e: 'expire', f: f.id });
      }
    }
    if (druid && druid.alive && t % BATTLE.frog.summonPeriod === 0) {
      const aliveFrogs = frogs.filter((f) => f.alive).length;
      if (aliveFrogs < BATTLE.frog.maxAlive) {
        frogCounter++;
        const id = `f${frogCounter}`;
        frogs.push({ id, spawnTick: t, alive: true });
        push(t, { e: 'summon', f: id });
      }
    }

    // Start of tick: resurrection inputs (CORE-026). An input is applied to the state at its tick.
    while (cursor < commands.length && (commands[cursor] as ResurrectCommand).t === t) {
      const cmd = commands[cursor] as ResurrectCommand;
      cursor++;
      const target = heroes[cmd.h] as HeroState;
      if (resurrectionUsed) throw new RuleError('battle.resurrect_used', 'the run already used its resurrection');
      if (target.alive) throw new RuleError('battle.resurrect_target_alive', `hero slot ${cmd.h} is alive`);
      resurrectionUsed = true;
      target.alive = true;
      target.hp = Math.floor(target.maxHp / BATTLE.resurrectHpDivisor);
      waitStart = null;
      push(t, { e: 'res', h: cmd.h, hp: target.hp });
    }

    // Phase 1: heroes by ascending slot, then frogs in summon order (CORE-023).
    for (const h of heroes) {
      if (!h.alive || t % h.period !== 0) continue;
      const target = firstAliveEnemy();
      if (!target) break;
      const from = `h${h.slot}`;
      damageEnemy(t, from, h.dmg, target, false);
      if (h.splashRadius > 0) {
        // Living enemies within the splash radius take the same damage in the same blow (CORE-025).
        for (let d = -h.splashRadius; d <= h.splashRadius; d++) {
          if (d === 0) continue;
          const idx = target.slot + d;
          if (idx < 0 || idx >= BATTLE.enemySlots) continue;
          const neighbour = enemies[idx];
          if (neighbour && neighbour.alive) damageEnemy(t, from, h.dmg, neighbour, true);
        }
      }
    }
    for (const f of frogs) {
      if (!f.alive || t % BATTLE.frog.period !== 0) continue;
      const target = firstAliveEnemy();
      if (!target) break;
      damageEnemy(t, f.id, BATTLE.frog.dmg, target, false);
    }

    // Check (a): no living enemies, the step ends at max(T, Tmin1) (CORE-021, CORE-022).
    if (enemyList().length === 0) return finish(t, 'win', 'enemies_dead');

    // Phase 2: enemies by ascending index, each hits the living hero with the lowest slot (CORE-023).
    for (const en of enemies) {
      if (!en || !en.alive || t % en.def.period !== 0) continue;
      const target = firstAliveHero();
      if (!target) break;
      const dmg = currentEnemyDamage(en);
      damageHero(t, `e${en.slot}`, dmg, target);
    }

    // Check (b): no living heroes. With a resurrection still available the battle waits 60 ticks (CORE-026).
    if (!heroes.some((h) => h.alive)) {
      const canRevive = input.resurrectionAvailable && !resurrectionUsed;
      if (!canRevive) return finish(t, 'lose', 'heroes_dead');
      if (waitStart === null) waitStart = t;
      if (t - waitStart >= BATTLE.resurrectWaitTicks) return finish(t, 'lose', 'heroes_dead');
    }

    // Check (c): the wave limit is reached with living enemies (CORE-021).
    if (t >= limit && enemyList().length > 0) return finish(t, 'lose', 'limit');
  }
  throw new Error('internal error: battle loop ended without a result');
}

/** Converts events to the canonical log records: fixed key order, no ms field (CORE-027). */
export function battleLogRecords(events: readonly BattleEvent[]): unknown[] {
  return events.map((ev) => {
    switch (ev.e) {
      case 'hit':
        return { t: ev.t, e: ev.e, from: ev.from, to: ev.to, dmg: ev.dmg, hp: ev.hp, splash: ev.splash };
      case 'death':
        return { t: ev.t, e: ev.e, u: ev.u };
      case 'res':
        return { t: ev.t, e: ev.e, h: ev.h, hp: ev.hp };
      case 'summon':
      case 'expire':
        return { t: ev.t, e: ev.e, f: ev.f };
      case 'phase':
        return { t: ev.t, e: ev.e, u: ev.u, n: ev.n };
      case 'end':
        return { t: ev.t, e: ev.e, r: ev.r, why: ev.why };
    }
  });
}

/** Canonical battle log: compact JSON, UTF-8 (CORE-027). */
export function battleLogJson(events: readonly BattleEvent[]): string {
  return JSON.stringify(battleLogRecords(events));
}

/** SHA-256 of the canonical log, lowercase hex. Used to compare runs across platforms (CORE-027). */
export function battleLogHash(events: readonly BattleEvent[]): string {
  return toHex(sha256(utf8(battleLogJson(events))));
}
