import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hashDeviceToken, INIT_DATA_MAX_AGE_S, verifyInitData, issueDeviceToken } from '../src/auth.ts';
import { ApiError } from '../src/errors.ts';
import {
  BOT_TOKEN,
  call,
  guestSession,
  makeHarness,
  nextInstallId,
  signInitData,
  T0,
  telegramInitData,
  type Harness,
} from './helpers.ts';

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.app.close();
  harness = undefined;
});

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  throw new Error('expected an ApiError');
}

describe('verifyInitData (AUTH-001)', () => {
  it('accepts a correctly signed fresh initData and returns the Telegram id', () => {
    const initData = telegramInitData(777, T0);
    expect(verifyInitData(initData, BOT_TOKEN, T0)).toEqual({ telegramId: 777, authDate: T0 });
  });

  it('rejects a changed field with auth.invalid', () => {
    const initData = telegramInitData(777, T0).replace('%22id%22%3A777', '%22id%22%3A778');
    expect(errorCode(() => verifyInitData(initData, BOT_TOKEN, T0))).toBe('auth.invalid');
  });

  it('rejects a signature made with another bot token', () => {
    const initData = telegramInitData(777, T0, 'another:token');
    expect(errorCode(() => verifyInitData(initData, BOT_TOKEN, T0))).toBe('auth.invalid');
  });

  it('rejects a missing or malformed hash', () => {
    const withoutHash = telegramInitData(777, T0).replace(/&hash=[0-9a-f]+/, '');
    expect(errorCode(() => verifyInitData(withoutHash, BOT_TOKEN, T0))).toBe('auth.invalid');
    expect(errorCode(() => verifyInitData('user=%7B%7D&auth_date=1&hash=xyz', BOT_TOKEN, T0))).toBe('auth.invalid');
  });

  it('rejects duplicated fields', () => {
    const initData = `${telegramInitData(777, T0)}&query_id=again`;
    expect(errorCode(() => verifyInitData(initData, BOT_TOKEN, T0))).toBe('auth.invalid');
  });

  it('accepts auth_date exactly 86 400 s old and rejects one second more as auth.expired', () => {
    const edge = signInitData({ user: JSON.stringify({ id: 9 }) }, T0 - INIT_DATA_MAX_AGE_S);
    expect(verifyInitData(edge, BOT_TOKEN, T0).telegramId).toBe(9);

    const expired = signInitData({ user: JSON.stringify({ id: 9 }) }, T0 - INIT_DATA_MAX_AGE_S - 1);
    expect(errorCode(() => verifyInitData(expired, BOT_TOKEN, T0))).toBe('auth.expired');
  });

  it('checks the signature before the age, so a forged old value is auth.invalid', () => {
    const forged = signInitData({ user: JSON.stringify({ id: 9 }) }, T0 - 10 * INIT_DATA_MAX_AGE_S, 'wrong:token');
    expect(errorCode(() => verifyInitData(forged, BOT_TOKEN, T0))).toBe('auth.invalid');
  });

  it('tolerates auth_date up to 60 s in the future and rejects more', () => {
    const near = signInitData({ user: JSON.stringify({ id: 9 }) }, T0 + 60);
    expect(verifyInitData(near, BOT_TOKEN, T0).telegramId).toBe(9);
    const far = signInitData({ user: JSON.stringify({ id: 9 }) }, T0 + 61);
    expect(errorCode(() => verifyInitData(far, BOT_TOKEN, T0))).toBe('auth.invalid');
  });

  it('rejects a user field without a positive id', () => {
    const noId = signInitData({ user: JSON.stringify({ first_name: 'x' }) }, T0);
    expect(errorCode(() => verifyInitData(noId, BOT_TOKEN, T0))).toBe('auth.invalid');
  });
});

describe('device tokens (AUTH-002)', () => {
  it('issues 43-character base64url tokens that differ between calls', () => {
    const first = issueDeviceToken();
    const second = issueDeviceToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it('stores only the SHA-256 hex of a token', () => {
    const token = 'example-token';
    expect(hashDeviceToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashDeviceToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('POST /auth/telegram', () => {
  it('creates an account, issues a token, and revokes the previous token on re-entry', async () => {
    harness = await makeHarness();
    const installId = nextInstallId();
    const body = { init_data: telegramInitData(42, harness.clock.now), install_id: installId };

    const first = await call(harness, 'POST', '/auth/telegram', { body });
    expect(first.status).toBe(200);
    expect(first.json.created).toBe(true);
    expect(first.json.user.is_guest).toBe(false);
    expect(first.json.user.referral_code).toMatch(/^[A-Z0-9]{8}$/);
    const oldToken: string = first.json.device_token;

    harness.clock.now += 60;
    const second = await call(harness, 'POST', '/auth/telegram', { body: { ...body, init_data: telegramInitData(42, harness.clock.now) } });
    expect(second.status).toBe(200);
    expect(second.json.created).toBe(false);
    expect(second.json.user.id).toBe(first.json.user.id);
    const newToken: string = second.json.device_token;

    const oldCall = await call(harness, 'GET', '/me', { token: oldToken });
    expect(oldCall.status).toBe(401);
    expect(oldCall.json.code).toBe('auth.invalid');

    const newCall = await call(harness, 'GET', '/me', { token: newToken });
    expect(newCall.status).toBe(200);
  });

  it('rejects initData with a bad signature with 401 auth.invalid', async () => {
    harness = await makeHarness();
    const reply = await call(harness, 'POST', '/auth/telegram', {
      body: { init_data: telegramInitData(42, harness.clock.now, 'wrong:token'), install_id: nextInstallId() },
    });
    expect(reply.status).toBe(401);
    expect(reply.json).toEqual({ code: 'auth.invalid' });
  });

  it('rejects expired initData with 401 auth.expired', async () => {
    harness = await makeHarness();
    const reply = await call(harness, 'POST', '/auth/telegram', {
      body: { init_data: telegramInitData(42, harness.clock.now - INIT_DATA_MAX_AGE_S - 5), install_id: nextInstallId() },
    });
    expect(reply.status).toBe(401);
    expect(reply.json).toEqual({ code: 'auth.expired' });
  });

  it('disables Telegram auth when BOT_TOKEN is absent, and guest auth still works', async () => {
    harness = await makeHarness({ botToken: null });
    const telegram = await call(harness, 'POST', '/auth/telegram', {
      body: { init_data: telegramInitData(42, harness.clock.now), install_id: nextInstallId() },
    });
    expect(telegram.status).toBe(401);
    expect(telegram.json.code).toBe('auth.invalid');

    const guest = await call(harness, 'POST', '/auth/guest', { body: { install_id: nextInstallId() } });
    expect(guest.status).toBe(200);
  });

  it('validates the body with validation.failed (400)', async () => {
    harness = await makeHarness();
    const reply = await call(harness, 'POST', '/auth/telegram', { body: { init_data: 'x' } });
    expect(reply.status).toBe(400);
    expect(reply.json).toEqual({ code: 'validation.failed' });
  });
});

describe('POST /auth/guest and the bearer token', () => {
  it('issues a web token whose stored form is only the hash', async () => {
    harness = await makeHarness();
    const reply = await call(harness, 'POST', '/auth/guest', { body: { install_id: nextInstallId() } });
    expect(reply.status).toBe(200);
    expect(reply.json.user.is_guest).toBe(true);
    expect(reply.json.user.id).toMatch(/^[0-9a-f-]{36}$/);
    const token: string = reply.json.device_token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const device = await harness.repo.devices.findByTokenHash(hashDeviceToken(token));
    expect(device?.kind).toBe('web');
    expect(device?.userId).toBe(reply.json.user.id);
    expect(await harness.repo.devices.findByTokenHash(token)).toBeNull();
    expect(JSON.stringify(await harness.repo.devices.listByUser(reply.json.user.id as string))).not.toContain(token);
  });

  it('rejects unknown body fields and wrong JSON types with validation.failed (400)', async () => {
    harness = await makeHarness();
    const extra = await call(harness, 'POST', '/auth/guest', { body: { install_id: nextInstallId(), extra: 1 } });
    expect(extra.status).toBe(400);
    expect(extra.json).toEqual({ code: 'validation.failed' });

    const wrongType = await call(harness, 'POST', '/runs/start', {
      token: (await guestSession(harness)).token,
      key: 'k-type',
      body: { mode: 'full', speed: '1', team: ['knight', 'archer', 'mage'], daily: false },
    });
    expect(wrongType.status).toBe(400);
    expect(wrongType.json).toEqual({ code: 'validation.failed' });
  });

  it('answers auth.required without a header and auth.invalid for an unknown token', async () => {
    harness = await makeHarness();
    const missing = await call(harness, 'GET', '/me');
    expect(missing.status).toBe(401);
    expect(missing.json.code).toBe('auth.required');

    const unknown = await call(harness, 'GET', '/me', { token: 'not-a-real-token' });
    expect(unknown.status).toBe(401);
    expect(unknown.json.code).toBe('auth.invalid');
  });

  it('returns the profile with balances, heroes and placeholders for quests and streak', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const me = await call(harness, 'GET', '/me', { token: session.token });
    expect(me.status).toBe(200);
    expect(me.json.balances).toEqual({ coin: 0, gem: 0 });
    expect(me.json.heroes).toEqual([
      { id: 'archer', level: 1 },
      { id: 'knight', level: 1 },
      { id: 'mage', level: 1 },
    ]);
    expect(me.json.quests).toEqual([]);
    expect(me.json.starter_bought).toBe(false);
  });
});

describe('client version (API-000)', () => {
  it('requires X-Client-Version on API requests', async () => {
    harness = await makeHarness();
    const reply = await call(harness, 'POST', '/auth/guest', { body: { install_id: nextInstallId() }, version: null });
    expect(reply.status).toBe(400);
    expect(reply.json.code).toBe('validation.failed');
  });

  it('answers client.too_old (426) below the minimum and accepts a build suffix', async () => {
    harness = await makeHarness();
    const old = await call(harness, 'POST', '/auth/guest', { body: { install_id: nextInstallId() }, version: '0.0.9' });
    expect(old.status).toBe(426);
    expect(old.json.code).toBe('client.too_old');

    const suffixed = await call(harness, 'POST', '/auth/guest', { body: { install_id: nextInstallId() }, version: '0.1.0+a1b2c3d' });
    expect(suffixed.status).toBe(200);
  });
});
