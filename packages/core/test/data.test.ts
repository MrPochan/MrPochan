import { describe, expect, it } from 'vitest';
import gates from '../src/data/gates.json' with { type: 'json' };
import { CARD_CATALOG, HERO_CATALOG } from '../src/index.ts';
import { BATTLE, CARDS, ECONOMY } from '../src/config.ts';
import { simulateSample } from './support/sim.ts';

type ChanceBlock = {
  fields: number;
  slot_counts: Record<string, number>;
  attempt_histogram: number[];
  column_slot_counts: Record<string, number>[];
  fallback: number;
  dead_end_by_attempt: number[];
  validation_by_attempt: number[];
  chance_tenths: Record<string, number>;
  column_chance_tenths: Record<string, number>[];
  avg_balls_hundredths: number;
  avg_run_hundredths?: number;
};

const total = gates.total as unknown as ChanceBlock;

describe('gates.json (BAL-005, BAL-006, BAL-007, BAL-010)', () => {
  it('covers 10 000 run seeds x 15 waves = 150 000 fields with no fallback and no dead ends', () => {
    expect(total.fields).toBe(150000);
    expect(total.fallback).toBe(0);
    expect(total.dead_end_by_attempt.every((v) => v === 0)).toBe(true);
    expect(total.validation_by_attempt.every((v) => v === 0)).toBe(true);
  });

  it('matches a fresh regeneration of the BAL-005 sample (BAL-006, BAL-008: the file is not a self-report)', () => {
    const sample = simulateSample(10000);
    expect(sample.fields).toBe(total.fields);
    for (const [g, count] of Object.entries(sample.slots)) {
      expect(count, g).toBe((total.slot_counts as Record<string, number>)[g]);
    }
    expect([...sample.attemptHistogram]).toEqual(total.attempt_histogram);
    expect(sample.fallback).toBe(total.fallback);
    expect([...sample.deadEndByAttempt]).toEqual(total.dead_end_by_attempt);
    expect([...sample.validationByAttempt]).toEqual(total.validation_by_attempt);
  }, 120000);

  it('recomputes the chances from the integer counts (BAL-007)', () => {
    const n = total.fields;
    for (const [t, count] of Object.entries(total.slot_counts)) {
      expect(total.chance_tenths[t]).toBe(Math.floor((2000 * count + 5 * n) / (10 * n)));
    }
  });

  it('matches the expected chances of BAL-009 within 0.5 percentage points (BAL-010)', () => {
    const expected = { x0: 82, x1: 168, x2: 300, x3: 250, x5: 200 };
    for (const [t, v] of Object.entries(expected)) {
      expect(Math.abs((total.chance_tenths[t] as number) - v)).toBeLessThanOrEqual(5);
    }
    const sum = Object.values(total.chance_tenths).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1000)).toBeLessThanOrEqual(2);
  });

  it('keeps every column within 0.5 percentage points of the overall share (BAL-010)', () => {
    for (const col of total.column_chance_tenths) {
      for (const [t, v] of Object.entries(col)) {
        expect(Math.abs(v - (total.chance_tenths[t] as number))).toBeLessThanOrEqual(5);
      }
    }
  });

  it('average yield is 25.2 per wave and 377.7 per run within 2 % (BAL-006, BAL-009)', () => {
    expect(Math.abs(total.avg_balls_hundredths - 2520)).toBeLessThanOrEqual(10);
    expect(Math.abs((total.avg_run_hundredths as number) - 37770) / 37770).toBeLessThan(0.02);
  });
});

describe('data files and catalogues', () => {
  it('has 30 cards, six for each hero and six common (CARD-001)', () => {
    expect(CARDS.length).toBe(30);
    expect(CARD_CATALOG.length).toBe(30);
    for (const hero of ['knight', 'archer', 'mage', 'druid', 'common'] as const) {
      expect(CARDS.filter((c) => c.hero === hero).length).toBe(hero === 'common' ? 6 : 6);
    }
  });

  it('has the four heroes with the names of the specification', () => {
    expect(HERO_CATALOG.map((h) => h.name).sort()).toEqual(['Друид', 'Лучник', 'Маг', 'Рыцарь']);
  });

  it('has 15 waves with a mini-boss on 8 and a boss on 15', () => {
    expect(BATTLE.waves.length).toBe(15);
    expect(BATTLE.waves[7]?.kind).toBe('miniboss');
    expect(BATTLE.waves[14]?.kind).toBe('boss');
  });

  it('the economy constants are the ones of the specification', () => {
    expect(ECONOMY.energyMax).toBe(5);
    expect(ECONOMY.energyPeriodS).toBe(1200);
    expect(ECONOMY.druidCoins).toBe(4000);
    expect(ECONOMY.druidGems).toBe(300);
    expect(ECONOMY.resurrectGems).toBe(10);
  });
});
