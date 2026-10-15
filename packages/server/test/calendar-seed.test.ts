import { afterEach, describe, expect, it } from 'vitest';
import { isoWeek, utcDay } from '../src/calendar.ts';
import { dailySeedFor, newSeedHex } from '../src/seed.ts';
import { call, guestSession, makeHarness, T0, type Harness } from './helpers.ts';

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.app.close();
  harness = undefined;
});

const unix = (iso: string): number => Date.parse(iso) / 1000;

describe('calendar (DB-000)', () => {
  it('takes the UTC date', () => {
    expect(utcDay(unix('2026-10-15T23:59:59Z'))).toBe('2026-10-15');
    expect(utcDay(unix('2026-10-16T00:00:00Z'))).toBe('2026-10-16');
  });

  it('uses ISO weeks that start on Monday', () => {
    expect(isoWeek(unix('2026-10-15T12:00:00Z'))).toBe('2026-W42');
    expect(isoWeek(unix('2026-10-12T00:00:00Z'))).toBe('2026-W42'); // Monday
    expect(isoWeek(unix('2026-10-11T23:59:59Z'))).toBe('2026-W41'); // Sunday before
    expect(isoWeek(unix('2025-12-29T00:00:00Z'))).toBe('2026-W01'); // first ISO week of 2026 starts in 2025
    expect(isoWeek(unix('2026-01-04T00:00:00Z'))).toBe('2026-W01');
    expect(isoWeek(unix('2026-12-28T00:00:00Z'))).toBe('2026-W53'); // 2026 has 53 ISO weeks
  });
});

describe('seeds (RNG-006, DB-009)', () => {
  it('makes a 16-byte hex seed from the random source', () => {
    expect(newSeedHex(() => new Uint8Array(16).fill(0xab))).toBe('ab'.repeat(16));
    expect(() => newSeedHex(() => new Uint8Array(15))).toThrow();
  });

  it('draws fresh 16-byte seeds from crypto by default', () => {
    const first = newSeedHex();
    const second = newSeedHex();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });

  it('keeps the first stored daily seed and does not draw another one', async () => {
    harness = await makeHarness();
    const day = '2026-10-15';
    await harness.repo.dailySeeds.insertIfAbsent({ day, seed: 'aa'.repeat(16) });
    let drawn = 0;
    const seed = await dailySeedFor(harness.repo, day, (size) => {
      drawn += 1;
      return new Uint8Array(size).fill(1);
    });
    expect(seed).toBe('aa'.repeat(16));
    expect(drawn).toBe(0);

    const later = await harness.repo.dailySeeds.insertIfAbsent({ day, seed: 'bb'.repeat(16) });
    expect(later.seed).toBe('aa'.repeat(16));
  });

  it('gives the same daily seed within one UTC day and a new one on the next day', async () => {
    let counter = 0;
    harness = await makeHarness({
      random: (size) => {
        counter += 1;
        return new Uint8Array(size).fill(counter);
      },
    });
    const session = await guestSession(harness);

    const morning = await call(harness, 'GET', '/seeds/daily', { token: session.token });
    expect(morning.status).toBe(200);
    expect(morning.json).toEqual({ day: '2026-10-15', seed: morning.json.seed, field_version: 1 });
    expect(morning.json.seed).toMatch(/^[0-9a-f]{32}$/);

    harness.clock.now = T0 + 13 * 3600; // 23:00 UTC, same day
    const evening = await call(harness, 'GET', '/seeds/daily', { token: session.token });
    expect(evening.json.seed).toBe(morning.json.seed);

    harness.clock.now = Date.UTC(2026, 9, 16, 0, 0, 0) / 1000; // next UTC day
    const nextDay = await call(harness, 'GET', '/seeds/daily', { token: session.token });
    expect(nextDay.json.day).toBe('2026-10-16');
    expect(nextDay.json.seed).not.toBe(morning.json.seed);
  });
});
