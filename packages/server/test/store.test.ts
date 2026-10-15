import { afterEach, describe, expect, it } from 'vitest';
import { ConflictError, type RunRecord } from '../src/store/repository.ts';
import { MemoryRepository } from '../src/store/memory.ts';
import { compareBoardRows, isBetterResult } from '../src/board.ts';
import { canonicalJson, hashBody } from '../src/idempotency.ts';
import type { LedgerEntry } from '@cupquest/core';

const T = 1_792_000_000;

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return { key: 'k', userId: 'u1', currency: 'coin', delta: 10, reason: 'run_coin', runId: null, at: T, ...overrides };
}

function run(overrides: Partial<RunRecord>): RunRecord {
  return {
    id: 'r1',
    userId: 'u1',
    seed: '00'.repeat(16),
    daily: false,
    day: null,
    mode: 'full',
    speed: 1,
    team: ['knight', 'archer', 'mage'],
    fieldVersion: 1,
    reservedGems: 0,
    state: 'started',
    result: null,
    lastWave: null,
    score: null,
    durationTicks: null,
    gates: null,
    resurrections: 0,
    cards: null,
    logSha256: null,
    verdictReason: [],
    startedAt: T,
    submittedAt: null,
    ...overrides,
  };
}

let repo: MemoryRepository | undefined;
afterEach(() => {
  repo = undefined;
});

describe('ledger (ECO-001, DB-006)', () => {
  it('ignores a repeated key for the same user and derives the balance from entries', async () => {
    repo = new MemoryRepository();
    const e = entry({ key: 'run:r1:w1:coin', delta: 20 });
    expect(await repo.ledger.append(e)).toBe('inserted');
    expect(await repo.ledger.append(e)).toBe('duplicate');
    expect(await repo.ledger.append(entry({ key: 'run:r1:w2:coin', delta: 5 }))).toBe('inserted');
    expect(await repo.ledger.balance('u1', 'coin')).toBe(25);
    expect(await repo.ledger.balance('u1', 'gem')).toBe(0);
  });

  it('scopes keys to the user, so the same key of another user is a separate entry', async () => {
    repo = new MemoryRepository();
    expect(await repo.ledger.append(entry({ key: 'hero:knight:open:coin', userId: 'u1', delta: -4000 }))).toBe('inserted');
    expect(await repo.ledger.append(entry({ key: 'hero:knight:open:coin', userId: 'u2', delta: -4000 }))).toBe('inserted');
    expect(await repo.ledger.balance('u2', 'coin')).toBe(-4000);
  });

  it('rolls back all writes of a transaction that throws', async () => {
    repo = new MemoryRepository();
    await expect(
      repo.transaction(async (tx) => {
        await tx.ledger.append(entry({ key: 'a', delta: 7 }));
        await tx.users.insert({
          id: 'u9',
          telegramId: null,
          isGuest: true,
          referralCode: 'ABCDEFGH',
          displayName: null,
          helpFails: 0,
          helpGrantedAt: null,
          deletedAt: null,
          createdAt: T,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await repo.ledger.balance('u1', 'coin')).toBe(0);
    expect(await repo.users.findById('u9')).toBeNull();
  });

  it('runs transactions one after another', async () => {
    repo = new MemoryRepository();
    await repo.flags.set('counter', 0);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        repo!.transaction(async (tx) => {
          const current = (await tx.flags.get('counter')) as number;
          await new Promise((resolve) => setTimeout(resolve, 1));
          await tx.flags.set('counter', current + 1);
        }),
      ),
    );
    expect(await repo.flags.get('counter')).toBe(5);
  });
});

describe('runs and devices (DB-002, DB-007)', () => {
  it('allows one started run per user', async () => {
    repo = new MemoryRepository();
    await repo.runs.insert(run({ id: 'r1' }));
    await expect(repo.runs.insert(run({ id: 'r2' }))).rejects.toBeInstanceOf(ConflictError);
    await repo.runs.insert(run({ id: 'r3', userId: 'u2' }));
    expect((await repo.runs.findStarted('u1'))?.id).toBe('r1');
  });

  it('revokes only unrevoked telegram tokens of the device hash', async () => {
    repo = new MemoryRepository();
    const base = { userId: 'u1', createdAt: T, revokedAt: null };
    await repo.devices.insert({ ...base, tokenHash: 'h1', kind: 'telegram', deviceHash: 'dev' });
    await repo.devices.insert({ ...base, tokenHash: 'h2', kind: 'web', deviceHash: 'dev' });
    await repo.devices.insert({ ...base, tokenHash: 'h3', kind: 'telegram', deviceHash: 'other' });
    expect(await repo.devices.revokeTelegramByDeviceHash('dev', T + 1)).toBe(1);
    expect((await repo.devices.findByTokenHash('h1'))?.revokedAt).toBe(T + 1);
    expect((await repo.devices.findByTokenHash('h2'))?.revokedAt).toBeNull();
    expect((await repo.devices.findByTokenHash('h3'))?.revokedAt).toBeNull();
  });
});

describe('weekly board order (DB-013, ТЗ 9.2)', () => {
  it('orders by wave, then score, then the earlier creation time', () => {
    const rows = [
      { userId: 'c', wave: 5, score: 100, createdAt: 30 },
      { userId: 'a', wave: 5, score: 100, createdAt: 10 },
      { userId: 'b', wave: 6, score: 1, createdAt: 99 },
      { userId: 'd', wave: 5, score: 200, createdAt: 50 },
    ].sort(compareBoardRows);
    expect(rows.map((r) => r.userId)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('puts the wave before the score: a higher wave with a lower score ranks first', () => {
    expect(compareBoardRows({ userId: 'x', wave: 7, score: 10, createdAt: 1 }, { userId: 'y', wave: 6, score: 9999, createdAt: 1 })).toBeLessThan(0);
  });

  it('replaces the stored best only by a better wave or the same wave with a higher score', () => {
    expect(isBetterResult({ wave: 3, score: 0 }, { wave: 2, score: 900 })).toBe(true);
    expect(isBetterResult({ wave: 3, score: 10 }, { wave: 3, score: 10 })).toBe(false);
    expect(isBetterResult({ wave: 3, score: 11 }, { wave: 3, score: 10 })).toBe(true);
  });
});

describe('idempotency body hash', () => {
  it('does not depend on the key order of the body', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 0 }] })).toBe('{"a":[2,{"c":0,"d":1}],"b":1}');
    expect(hashBody({ a: 1, b: 2 })).toBe(hashBody({ b: 2, a: 1 }));
    expect(hashBody({ a: 1 })).not.toBe(hashBody({ a: 2 }));
  });
});
