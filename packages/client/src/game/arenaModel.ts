// Battle view state built only from core events (spec 6.5: the client renders what the core produces). DOM-free.
// Hero slots follow HERO_ID_ORDER (CORE-025); enemy slots are the line positions 0..4.
import { HERO_ID_ORDER, type BattleEvent, type EnemySpec, type EndReason, type HeroStats } from '@cupquest/core';

export interface UnitState {
  /** Event id: h<slot>, e<slot> or f<n>. */
  readonly id: string;
  readonly kind: 'hero' | 'enemy' | 'frog';
  readonly slot: number;
  /** Hero id or enemy type. */
  readonly type: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Enemies start with an unknown maximum; it is learned from the first hit (hp + dmg). */
  maxKnown: boolean;
  phase: number;
}

export type ArenaEffect =
  | { readonly k: 'hit'; readonly from: string; readonly to: string; readonly dmg: number; readonly splash: boolean }
  | { readonly k: 'death'; readonly id: string }
  | { readonly k: 'res'; readonly id: string }
  | { readonly k: 'summon'; readonly id: string }
  | { readonly k: 'expire'; readonly id: string }
  | { readonly k: 'phase'; readonly id: string; readonly n: number }
  | { readonly k: 'end'; readonly win: boolean; readonly reason: EndReason };

export class ArenaModel {
  readonly heroes: UnitState[];
  readonly enemies: UnitState[];
  readonly frogs = new Map<string, UnitState>();

  constructor(team: readonly HeroStats[], enemies: readonly EnemySpec[]) {
    const ordered = [...team].sort((a, b) => HERO_ID_ORDER.indexOf(a.id) - HERO_ID_ORDER.indexOf(b.id));
    this.heroes = ordered.map((h, slot) => ({
      id: `h${slot}`,
      kind: 'hero',
      slot,
      type: h.id,
      hp: h.hp,
      maxHp: h.hp,
      alive: true,
      maxKnown: true,
      phase: 0,
    }));
    this.enemies = enemies.map((e) => ({
      id: `e${e.slot}`,
      kind: 'enemy',
      slot: e.slot,
      type: e.type,
      hp: 0,
      maxHp: 0,
      alive: true,
      maxKnown: false,
      phase: 0,
    }));
  }

  unit(id: string): UnitState | undefined {
    if (id.startsWith('f')) return this.frogs.get(id);
    return [...this.heroes, ...this.enemies].find((u) => u.id === id);
  }

  /** Applies one core event and returns what the renderer should show. */
  apply(ev: BattleEvent): ArenaEffect {
    switch (ev.e) {
      case 'hit': {
        const target = this.unit(ev.to);
        if (target) {
          if (!target.maxKnown) {
            target.maxHp = ev.hp + ev.dmg;
            target.maxKnown = true;
          }
          target.hp = ev.hp;
        }
        return { k: 'hit', from: ev.from, to: ev.to, dmg: ev.dmg, splash: ev.splash };
      }
      case 'death': {
        const unit = this.unit(ev.u);
        if (unit) {
          unit.alive = false;
          unit.hp = 0;
        }
        return { k: 'death', id: ev.u };
      }
      case 'res': {
        const hero = this.heroes[ev.h];
        if (hero) {
          hero.alive = true;
          hero.hp = ev.hp;
        }
        return { k: 'res', id: `h${ev.h}` };
      }
      case 'summon': {
        this.frogs.set(ev.f, { id: ev.f, kind: 'frog', slot: this.frogs.size, type: 'frog', hp: 0, maxHp: 0, alive: true, maxKnown: false, phase: 0 });
        return { k: 'summon', id: ev.f };
      }
      case 'expire': {
        const frog = this.frogs.get(ev.f);
        if (frog) frog.alive = false;
        return { k: 'expire', id: ev.f };
      }
      case 'phase': {
        const enemy = this.unit(ev.u);
        if (enemy) enemy.phase = ev.n;
        return { k: 'phase', id: ev.u, n: ev.n };
      }
      case 'end':
        return { k: 'end', win: ev.r === 'win', reason: ev.why };
    }
  }
}
