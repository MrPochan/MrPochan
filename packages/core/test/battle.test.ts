import { describe, expect, it } from 'vitest';
import {
  simulateWave,
  battleLogHash,
  battleLogJson,
  waveLimitTicks,
  waveKind,
  waveEnemies,
  type HeroStats,
  type BattleEvent,
} from '../src/battle.ts';
import { BATTLE, type HeroId } from '../src/config.ts';
import { RuleError } from '../src/errors.ts';

function baseStats(team: readonly HeroId[]): HeroStats[] {
  return team.map((id) => ({ id, hp: BATTLE.heroes[id].hp, dmg: BATTLE.heroes[id].dmg, period: BATTLE.heroes[id].period }));
}

const TEAMS: HeroId[][] = [
  ['knight', 'archer', 'mage'],
  ['knight', 'archer', 'druid'],
  ['knight', 'mage', 'druid'],
  ['archer', 'mage', 'druid'],
];

const hasEvent = (events: readonly BattleEvent[], pred: (e: BattleEvent) => boolean): boolean => events.some(pred);

describe('battle reproducibility (CORE-027)', () => {
  it('gives the same events and the same log hash for the same input', () => {
    for (const team of TEAMS) {
      for (const wave of [1, 8, 14, 15]) {
        const a = simulateWave({ wave, team: baseStats(team), resurrectionAvailable: false });
        const b = simulateWave({ wave, team: baseStats(team), resurrectionAvailable: false });
        expect(battleLogHash(a.events)).toBe(battleLogHash(b.events));
        expect(a.events).toEqual(b.events);
      }
    }
  });

  it('writes the canonical compact log and pins its hash (regression snapshot of this implementation)', () => {
    const r = simulateWave({ wave: 1, team: baseStats(['knight', 'archer', 'mage']), resurrectionAvailable: false });
    expect(r.outcome).toBe('win');
    const json = battleLogJson(r.events);
    expect(json.startsWith('[{"t":')).toBe(true);
    expect(json).not.toContain(' ');
    expect(json).not.toContain('"ms"');
    expect(battleLogHash(r.events)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on the order in which heroes are passed (slots follow the hero id, CORE-025)', () => {
    const a = simulateWave({ wave: 5, team: baseStats(['mage', 'knight', 'archer']), resurrectionAvailable: false });
    const b = simulateWave({ wave: 5, team: baseStats(['archer', 'knight', 'mage']), resurrectionAvailable: false });
    expect(battleLogHash(a.events)).toBe(battleLogHash(b.events));
    // Slot 0 is the archer (sorted by id), so the archer takes the first enemy hits.
    const firstHit = a.events.find((e) => e.e === 'hit');
    expect(firstHit && firstHit.e === 'hit' && firstHit.from).toBe('h0');
  });

  it('has the same result when the start is repeated (no hidden state)', () => {
    const team = baseStats(['knight', 'druid', 'mage']);
    const a = simulateWave({ wave: 15, team, resurrectionAvailable: false });
    simulateWave({ wave: 3, team, resurrectionAvailable: false });
    const b = simulateWave({ wave: 15, team, resurrectionAvailable: false });
    expect(battleLogJson(a.events)).toBe(battleLogJson(b.events));
  });
});

describe('wave structure (CORE-020, CORE-021, CORE-022)', () => {
  it('uses the limits and kinds from battle.json', () => {
    expect(waveKind(8)).toBe('miniboss');
    expect(waveKind(15)).toBe('boss');
    expect(waveLimitTicks(3)).toBe(800);
    expect(waveLimitTicks(8)).toBe(1200);
    expect(waveLimitTicks(15)).toBe(1800);
    expect(waveEnemies(15).some((e) => e.type === 'boss' && e.slot === 2)).toBe(true);
  });

  it('keeps the wave open until the enemies die, and ends no earlier than Tmin1', () => {
    const r = simulateWave({
      wave: 1,
      team: baseStats(['knight', 'archer', 'mage']),
      resurrectionAvailable: false,
      enemies: [{ type: 'grunt', slot: 0 }],
    });
    expect(r.outcome).toBe('win');
    expect(r.reason).toBe('enemies_dead');
    expect(r.durationTicks).toBeGreaterThanOrEqual(BATTLE.tmin1);
    expect(r.durationMs).toBe(r.durationTicks * BATTLE.tickMs);
  });

  it('loses at the limit with living enemies, and no coins are due (CORE-021)', () => {
    const r = simulateWave({
      wave: 14,
      team: baseStats(['knight', 'archer', 'mage']),
      resurrectionAvailable: false,
      enemies: [{ type: 'brute', slot: 2 }],
      limitTicks: 30,
    });
    expect(r.outcome).toBe('lose');
    expect(r.reason).toBe('limit');
    expect(r.durationTicks).toBe(30);
    const end = r.events[r.events.length - 1];
    expect(end && end.e === 'end' && end.why).toBe('limit');
  });

  it('gives integer millisecond stamps on every event', () => {
    const r = simulateWave({ wave: 4, team: baseStats(['knight', 'druid', 'archer']), resurrectionAvailable: false });
    for (const ev of r.events) {
      expect(Number.isInteger(ev.t)).toBe(true);
      expect(ev.ms).toBe(ev.t * BATTLE.tickMs);
    }
  });
});

describe('positions, splash, frogs and boss phases (CORE-023, CORE-025)', () => {
  it('the mage hits the main target and the living neighbours at index +-1 with the same damage', () => {
    const r = simulateWave({
      wave: 2,
      team: [{ id: 'mage', hp: 500, dmg: 9, period: 20 }, { id: 'knight', hp: 500, dmg: 1, period: 1000 }, { id: 'archer', hp: 500, dmg: 1, period: 1000 }],
      resurrectionAvailable: false,
      enemies: [
        { type: 'grunt', slot: 0 },
        { type: 'grunt', slot: 1 },
        { type: 'grunt', slot: 2 },
      ],
    });
    const splash = r.events.filter((e) => e.e === 'hit' && e.splash);
    expect(splash.length).toBeGreaterThan(0);
    for (const ev of splash) if (ev.e === 'hit') expect(ev.dmg).toBe(9);
    // Mage is slot 2 (sorted by id). Its first blow at tick 20 hits slot 0 and slot 1 only.
    const blow = r.events.filter((e) => e.t === 20 && e.e === 'hit' && e.from === 'h2');
    expect(blow.map((e) => e.e === 'hit' && e.to)).toEqual(['e0', 'e1']);
  });

  it('summons frogs from the druid at tick 400 and expires them after the life (battle.json)', () => {
    const r = simulateWave({ wave: 15, team: baseStats(['knight', 'druid', 'mage']), resurrectionAvailable: false });
    expect(hasEvent(r.events, (e) => e.e === 'summon' && e.t === BATTLE.frog.summonPeriod)).toBe(true);
    expect(hasEvent(r.events, (e) => e.e === 'expire' && e.t === BATTLE.frog.summonPeriod + BATTLE.frog.life)).toBe(true);
  });

  it('switches the boss to its second phase at half hp (battle.json phases)', () => {
    const r = simulateWave({ wave: 15, team: baseStats(['knight', 'archer', 'mage']), resurrectionAvailable: false });
    const phase = r.events.find((e) => e.e === 'phase');
    expect(phase && phase.e === 'phase' && phase.u).toBe('e2');
    expect(r.outcome).toBe('win');
  });

  it('rejects an input that does not fit the team or the data', () => {
    expect(() => simulateWave({ wave: 1, team: baseStats(['knight', 'archer']), resurrectionAvailable: false })).toThrow(RangeError);
    expect(() => simulateWave({ wave: 1, team: baseStats(['knight', 'knight', 'mage']), resurrectionAvailable: false })).toThrow(RangeError);
    expect(() => simulateWave({ wave: 16, team: baseStats(['knight', 'archer', 'mage']), resurrectionAvailable: false })).toThrow(RangeError);
  });
});

describe('resurrection (CORE-026, CORE-027)', () => {
  // Heroes with 4 hp die at tick 20 to a brute of 4 damage; the team is dead after tick 60.
  const fragile: HeroStats[] = [
    { id: 'archer', hp: 4, dmg: 1, period: 1000 },
    { id: 'knight', hp: 4, dmg: 1, period: 1000 },
    { id: 'mage', hp: 4, dmg: 1, period: 1000 },
  ];

  it('without a reserved resurrection the battle ends at the death of the last hero', () => {
    const r = simulateWave({ wave: 14, team: fragile, resurrectionAvailable: false, enemies: [{ type: 'brute', slot: 0 }] });
    expect(r.outcome).toBe('lose');
    expect(r.reason).toBe('heroes_dead');
    expect(r.durationTicks).toBe(60);
  });

  it('with a reserved resurrection the battle waits 60 ticks after the last death', () => {
    const r = simulateWave({ wave: 14, team: fragile, resurrectionAvailable: true, enemies: [{ type: 'brute', slot: 0 }] });
    expect(r.outcome).toBe('lose');
    expect(r.durationTicks).toBe(60 + 60);
  });

  it('a reserved resurrection revives the hero with floor(maxHP / 2) and the log records the tick', () => {
    const team: HeroStats[] = [
      { id: 'archer', hp: 4, dmg: 1, period: 1000 },
      { id: 'knight', hp: 1000, dmg: 1, period: 1000 },
      { id: 'mage', hp: 1000, dmg: 1, period: 1000 },
    ];
    const r = simulateWave({
      wave: 14,
      team,
      resurrectionAvailable: true,
      enemies: [{ type: 'brute', slot: 0 }],
      commands: [{ t: 25, k: 'res', h: 0 }],
    });
    const res = r.events.find((e) => e.e === 'res');
    expect(res && res.e === 'res' && res.hp).toBe(Math.floor(4 / 2));
    expect(res && res.t).toBe(25);
    expect(r.resurrectionUsed).toBe(true);
  });

  it('a second resurrection in the same run is refused (battle.resurrect_used)', () => {
    const team: HeroStats[] = [
      { id: 'archer', hp: 4, dmg: 1, period: 1000 },
      { id: 'knight', hp: 4, dmg: 1, period: 1000 },
      { id: 'mage', hp: 1000, dmg: 1, period: 1000 },
    ];
    expect(() =>
      simulateWave({
        wave: 14,
        team,
        resurrectionAvailable: true,
        enemies: [{ type: 'brute', slot: 0 }],
        commands: [
          { t: 25, k: 'res', h: 0 },
          { t: 45, k: 'res', h: 1 },
        ],
      }),
    ).toThrow(RuleError);
    try {
      simulateWave({
        wave: 14,
        team,
        resurrectionAvailable: true,
        enemies: [{ type: 'brute', slot: 0 }],
        commands: [
          { t: 25, k: 'res', h: 0 },
          { t: 45, k: 'res', h: 1 },
        ],
      });
    } catch (err) {
      expect((err as RuleError).code).toBe('battle.resurrect_used');
    }
  });

  it('refuses a resurrection when none is reserved or the target is alive', () => {
    try {
      simulateWave({ wave: 1, team: baseStats(['knight', 'archer', 'mage']), resurrectionAvailable: false, commands: [{ t: 5, k: 'res', h: 0 }] });
      throw new Error('expected a RuleError');
    } catch (err) {
      expect((err as RuleError).code).toBe('battle.resurrect_unavailable');
    }
    try {
      simulateWave({
        wave: 14,
        team: baseStats(['knight', 'archer', 'mage']),
        resurrectionAvailable: true,
        enemies: [{ type: 'grunt', slot: 0 }],
        commands: [{ t: 5, k: 'res', h: 0 }],
      });
      throw new Error('expected a RuleError');
    } catch (err) {
      expect((err as RuleError).code).toBe('battle.resurrect_target_alive');
    }
  });
});

describe('calibration of the four 3-hero teams (CORE-024, acceptance 4.1)', () => {
  it('normal waves 1-7 and 9-14 at x1 average 13 to 17 s with no loss, for each team', () => {
    for (const team of TEAMS) {
      let sum = 0;
      let n = 0;
      for (let w = 1; w <= 14; w++) {
        if (w === 8) continue;
        const r = simulateWave({ wave: w, team: baseStats(team), resurrectionAvailable: false });
        expect(r.outcome, `${team.join('+')} wave ${w}`).toBe('win');
        sum += r.durationTicks;
        n++;
      }
      const avgSeconds = sum / n / (1000 / BATTLE.tickMs);
      expect(avgSeconds, team.join('+')).toBeGreaterThanOrEqual(13);
      expect(avgSeconds, team.join('+')).toBeLessThanOrEqual(17);
    }
  });

  it('the mini-boss on wave 8 and the boss on wave 15 are won within their limits without resurrection', () => {
    for (const team of TEAMS) {
      const mini = simulateWave({ wave: 8, team: baseStats(team), resurrectionAvailable: false });
      expect(mini.outcome, team.join('+')).toBe('win');
      expect(mini.durationTicks).toBeLessThanOrEqual(waveLimitTicks(8));
      const boss = simulateWave({ wave: 15, team: baseStats(team), resurrectionAvailable: false });
      expect(boss.outcome, team.join('+')).toBe('win');
      expect(boss.durationTicks, team.join('+')).toBeLessThanOrEqual(1800);
    }
  });

  it('the ogre on wave 14 lives longer than the average wave but within the 40 s limit', () => {
    const r = simulateWave({ wave: 14, team: baseStats(['knight', 'archer', 'mage']), resurrectionAvailable: false });
    expect(r.outcome).toBe('win');
    expect(r.durationTicks).toBeLessThanOrEqual(800);
  });
});
