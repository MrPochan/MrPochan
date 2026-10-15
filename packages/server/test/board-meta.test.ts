import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, ConfigError } from '../src/config.ts';
import {
  call,
  guestSession,
  makeHarness,
  telegramSession,
  type Harness,
} from './helpers.ts';

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.app.close();
  harness = undefined;
});

describe('GET /board/weekly (API-016, DB-013)', () => {
  it('is closed for guests (guest.forbidden)', async () => {
    harness = await makeHarness();
    const guest = await guestSession(harness);
    const reply = await call(harness, 'GET', '/board/weekly', { token: guest.token });
    expect(reply.status).toBe(403);
    expect(reply.json).toEqual({ code: 'guest.forbidden' });
  });

  it('ranks the player and friends by wave, score and creation time, and marks the player', async () => {
    const friendIds: string[] = [];
    harness = await makeHarness({ friends: { friendIds: async () => friendIds } });
    const me = await telegramSession(harness, 601);
    const b = await telegramSession(harness, 602);
    const c = await telegramSession(harness, 603);
    const outsider = await telegramSession(harness, 604);
    friendIds.push(b.userId, c.userId);

    const week = (await call(harness, 'GET', '/board/weekly', { token: me.token })).json.week as string;
    const row = (userId: string, wave: number, score: number, createdAt: number) =>
      harness!.repo.weeklyBest.upsert({ week, userId, wave, score, createdAt });
    await row(b.userId, 5, 100, harness.clock.now - 100);
    await row(c.userId, 5, 100, harness.clock.now - 200);
    await row(me.userId, 5, 90, harness.clock.now);
    await row(outsider.userId, 15, 1, harness.clock.now);

    const board = await call(harness, 'GET', '/board/weekly', { token: me.token });
    expect(board.status).toBe(200);
    expect(board.json.entries.map((e: { rank: number; score: number; is_me: boolean }) => [e.rank, e.score, e.is_me])).toEqual([
      [1, 100, false],
      [2, 100, false],
      [3, 90, true],
    ]);
    expect(board.json.me).toEqual({ rank: 3, wave: 5, score: 90 });
  });

  it('returns me: null before the player has a verified run this week', async () => {
    harness = await makeHarness();
    const session = await telegramSession(harness, 701);
    const board = await call(harness, 'GET', '/board/weekly', { token: session.token });
    expect(board.json.entries).toEqual([]);
    expect(board.json.me).toBeNull();
  });
});

describe('GET /shop and GET /config (PAY-007, PAY-008, API-005)', () => {
  it('keeps payments off: the kill switch and the missing implementation both answer false', async () => {
    harness = await makeHarness();
    const shop = await call(harness, 'GET', '/shop');
    expect(shop.status).toBe(200);
    expect(shop.json.payments_enabled).toBe(false);
    expect(shop.json.packs.map((p: { id: string }) => p.id)).toEqual(['gems_a', 'gems_b', 'starter']);
    expect(shop.json.packs[0]).toEqual({ id: 'gems_a', stars: 50, gems: 60, name_key: 'shop.pack_a.name' });

    await harness.repo.flags.set('payments.enabled', true);
    const flipped = await call(harness, 'GET', '/shop');
    expect(flipped.json.payments_enabled).toBe(false);
  });

  it('publishes flags and minimum version without a token, and never lists the staging pack', async () => {
    harness = await makeHarness();
    const config = await call(harness, 'GET', '/config');
    expect(config.status).toBe(200);
    expect(config.json.min_client_version).toBe('0.1.0');
    expect(config.json.flags.payments_enabled).toBe(false);
    expect(config.json.flags.features).toEqual({ short_run: true, daily_seed: false, referrals: false, help_after_defeats: true });
    expect(JSON.stringify(config.json.packs)).not.toContain('test_1');
  });
});

describe('GET /health and errors', () => {
  it('answers health without a client version, with no-store caching', async () => {
    harness = await makeHarness();
    const reply = await call(harness, 'GET', '/health', { version: null });
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ status: 'ok' });
    expect(reply.headers['cache-control']).toBe('no-store');
  });

  it('uses the ERR-001 body for unknown routes', async () => {
    harness = await makeHarness();
    const reply = await call(harness, 'GET', '/daily-board');
    expect(reply.status).toBe(404);
    expect(reply.json).toEqual({ code: 'not_found' });
  });
});

describe('loadConfig (env)', () => {
  it('defaults to development on port 8787 with Telegram auth off', () => {
    expect(loadConfig({})).toEqual({ port: 8787, nodeEnv: 'development', botToken: null, minClientVersion: '0.1.0', corsOrigins: [] });
  });

  it('requires BOT_TOKEN in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(loadConfig({ NODE_ENV: 'production', BOT_TOKEN: '1:abc', PORT: '9000' })).toMatchObject({ port: 9000, botToken: '1:abc' });
  });

  it('rejects a bad PORT, NODE_ENV or minimum version and treats a blank BOT_TOKEN as absent', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(ConfigError);
    expect(() => loadConfig({ MIN_CLIENT_VERSION: 'latest' })).toThrow(ConfigError);
    expect(loadConfig({ BOT_TOKEN: '   ' }).botToken).toBeNull();
  });
});
