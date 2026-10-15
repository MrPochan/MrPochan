import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GATE_SLOT_COUNTS, GATE_SLOT_TOTAL, oddsRows, oddsTenths } from '../src/lib/odds.ts';

const gatesJson = JSON.parse(
  readFileSync(new URL('../../core/src/data/gates.json', import.meta.url), 'utf8'),
) as { total: { fields: number; slot_counts: Record<string, number> } };

describe('gate odds (UI-004, BAL-009)', () => {
  it('matches the chance table of the core data file (drift check)', () => {
    expect(GATE_SLOT_TOTAL).toBe(gatesJson.total.fields * 5);
    for (const [gate, count] of Object.entries(gatesJson.total.slot_counts)) {
      expect(GATE_SLOT_COUNTS[gate as keyof typeof GATE_SLOT_COUNTS]).toBe(count);
    }
  });

  it('rounds to the published values 8.2 / 16.8 / 30.0 / 25.0 / 20.1 %', () => {
    expect(oddsRows().map((r) => [r.gate, r.tenths])).toEqual([
      ['x0', 82],
      ['x1', 168],
      ['x2', 300],
      ['x3', 250],
      ['x5', 201],
    ]);
    expect(oddsTenths('x2')).toBe(300);
  });
});
