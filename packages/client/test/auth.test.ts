import { describe, expect, it } from 'vitest';
import { Api, type ApiDeps } from '../src/api.ts';
import { bootstrap, DEVICE_TOKEN_KEY, INSTALL_ID_KEY } from '../src/auth.ts';
import { createStore, type KeyValueStore } from '../src/storage.ts';

const me = (id: string) => ({
  user: { id, is_guest: id.startsWith('g'), referral_code: 'ABCDEFGH' },
  balances: { coin: 0, gem: 0 },
  heroes: [],
  quests: [],
  streak: { day_no: 1, claimed_today: false },
  starter_bought: false,
});

/** Routes requests by path; `meFails` makes GET /me reject the first call with a given code. */
function routes(opts: { meFirstError?: string } = {}) {
  const log: string[] = [];
  let meCalls = 0;
  const fetch: ApiDeps['fetch'] = async (url, init) => {
    const path = url.replace('/api/v1', '');
    log.push(`${init.method} ${path}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (path === '/auth/guest') return json(200, { device_token: 'guest-token', user: me('g1').user });
    if (path === '/auth/telegram') return json(200, { device_token: 'tg-token', created: true, user: me('u1').user });
    if (path === '/me') {
      meCalls++;
      if (meCalls === 1 && opts.meFirstError) return json(401, { code: opts.meFirstError });
      return json(200, me('g1'));
    }
    return json(404, { code: 'not_found' });
  };
  return { fetch, log };
}

function setup(telegramInitData: string | null, store: KeyValueStore, fetch: ApiDeps['fetch']) {
  const api = new Api({ baseUrl: '/api/v1', clientVersion: '0.1.0', fetch, sleep: async () => undefined, newKey: () => 'k' });
  return bootstrap({ api, store, telegramInitData, newId: () => 'install-1' });
}

describe('bootstrap (AUTH-002, spec 6.3)', () => {
  it('creates a guest device token on first visit and keeps it in the store', async () => {
    const store = createStore(null);
    const { fetch, log } = routes();
    const profile = await setup(null, store, fetch);
    expect(profile.user.is_guest).toBe(true);
    expect(store.get(DEVICE_TOKEN_KEY)).toBe('guest-token');
    expect(store.get(INSTALL_ID_KEY)).toBe('install-1');
    expect(log).toEqual(['POST /auth/guest', 'GET /me']);
  });

  it('reuses a stored token without a new guest', async () => {
    const store = createStore(null);
    store.set(DEVICE_TOKEN_KEY, 'stored');
    const { fetch, log } = routes();
    await setup(null, store, fetch);
    expect(log).toEqual(['GET /me']);
  });

  it('replaces a rejected stored token with a new guest token', async () => {
    const store = createStore(null);
    store.set(DEVICE_TOKEN_KEY, 'old');
    const { fetch, log } = routes({ meFirstError: 'auth.invalid' });
    await setup(null, store, fetch);
    expect(log).toEqual(['GET /me', 'POST /auth/guest', 'GET /me']);
    expect(store.get(DEVICE_TOKEN_KEY)).toBe('guest-token');
  });

  it('signs in with Telegram initData and keeps that token out of the store', async () => {
    const store = createStore(null);
    const { fetch, log } = routes();
    await setup('query_id=1&hash=abc', store, fetch);
    expect(log[0]).toBe('POST /auth/telegram');
    expect(store.get(DEVICE_TOKEN_KEY)).toBeNull();
  });
});
