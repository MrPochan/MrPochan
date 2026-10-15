import { describe, expect, it } from 'vitest';
import { heroStatsFor, simulateWave, type BattleEvent, type EnemySpec } from '@cupquest/core';
import { ArenaModel } from '../src/game/arenaModel.ts';

const team = heroStatsFor(['mage', 'knight', 'archer'], {}, []);

function replay(events: readonly BattleEvent[], enemies: readonly EnemySpec[]): ArenaModel {
  const model = new ArenaModel(team, enemies);
  for (const ev of events) model.apply(ev);
  return model;
}

describe('ArenaModel (battle view state from core events)', () => {
  it('orders heroes by the core slot order (CORE-025): archer, knight, mage', () => {
    const model = new ArenaModel(team, []);
    expect(model.heroes.map((h) => h.type)).toEqual(['archer', 'knight', 'mage']);
  });

  it('ends with the same hero hit points as the core result', () => {
    const enemies: EnemySpec[] = [
      { type: 'grunt', slot: 0 },
      { type: 'grunt', slot: 1 },
      { type: 'brute', slot: 2 },
    ];
    const result = simulateWave({ wave: 1, team, resurrectionAvailable: false, enemies });
    const model = replay(result.events, enemies);
    expect(model.heroes.map((h) => h.hp)).toEqual([...result.heroHp]);
    expect(model.enemies.filter((e) => e.alive).length).toBe(result.enemiesAlive);
  });

  it('learns each enemy maximum from its first hit and never shows hp above it', () => {
    const enemies: EnemySpec[] = [{ type: 'grunt', slot: 0 }];
    const result = simulateWave({ wave: 1, team, resurrectionAvailable: false, enemies });
    const model = new ArenaModel(team, enemies);
    for (const ev of result.events) {
      model.apply(ev);
      for (const e of model.enemies) if (e.maxKnown) expect(e.hp).toBeLessThanOrEqual(e.maxHp);
    }
    expect(model.enemies[0]?.maxKnown).toBe(true);
  });

  it('marks a dead hero and restores it on a resurrection event', () => {
    const model = new ArenaModel(team, []);
    model.apply({ t: 5, ms: 250, e: 'death', u: 'h0' });
    expect(model.heroes[0]?.alive).toBe(false);
    model.apply({ t: 6, ms: 300, e: 'res', h: 0, hp: 60 });
    expect(model.heroes[0]).toMatchObject({ alive: true, hp: 60 });
  });

  it('tracks frogs from summon to expire', () => {
    const model = new ArenaModel(team, []);
    expect(model.apply({ t: 8, ms: 400, e: 'summon', f: 'f1' })).toEqual({ k: 'summon', id: 'f1' });
    expect(model.frogs.get('f1')?.alive).toBe(true);
    model.apply({ t: 20, ms: 1000, e: 'expire', f: 'f1' });
    expect(model.frogs.get('f1')?.alive).toBe(false);
  });
});
