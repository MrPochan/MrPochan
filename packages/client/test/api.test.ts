import { describe, expect, it, vi } from 'vitest';
import { Api, type ApiDeps } from '../src/api.ts';
import { ApiError } from '../src/lib/apiErrors.ts';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift() ?? { status: 500, body: { code: 'server.error' } };
    const text = r.body === undefined ? '' : JSON.stringify(r.body);
    return new Response(text, { status: r.status, headers: r.headers });
  });
  return { fn, calls };
}

function deps(fetchFn: ApiDeps['fetch'], overrides: Partial<ApiDeps> = {}): { api: Api; sleeps: number[]; keys: string[] } {
  const sleeps: number[] = [];
  const keys: string[] = [];
  const api = new Api({
    baseUrl: '/api/v1',
    clientVersion: '0.1.0',
    fetch: fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    newKey: () => {
      const k = `key-${keys.length + 1}`;
      keys.push(k);
      return k;
    },
    ...overrides,
  });
  return { api, sleeps, keys };
}

describe('Api', () => {
  it('sends the client version and bearer token on every request', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { ok: true } }]);
    const { api } = deps(fn);
    api.setToken('tok');
    await api.get('/me', { day: '2026-10-15', none: undefined });
    expect(calls[0]?.url).toBe('/api/v1/me?day=2026-10-15');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['X-Client-Version']).toBe('0.1.0');
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('reuses one Idempotency-Key across retries of a POST (ERR-002)', async () => {
    const { fn, calls } = fakeFetch([
      { status: 500, body: { code: 'server.error' } },
      { status: 200, body: { run_id: 'r1' } },
    ]);
    const { api, sleeps } = deps(fn);
    const res = await api.post<{ run_id: string }>('/runs/start', { mode: 'full' }, { idempotent: true });
    expect(res.run_id).toBe('r1');
    expect(sleeps).toEqual([1000]);
    const keyOf = (i: number) => (calls[i]?.init.headers as Record<string, string>)['Idempotency-Key'];
    expect(keyOf(0)).toBe('key-1');
    expect(keyOf(1)).toBe('key-1');
  });

  it('retries a GET twice with 1 s and 3 s pauses, then throws the mapped error', async () => {
    const { fn } = fakeFetch([
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
    ]);
    const { api, sleeps } = deps(fn);
    await expect(api.get('/me')).rejects.toMatchObject({ code: 'server.error', status: 503 });
    expect(sleeps).toEqual([1000, 3000]);
  });

  it('turns a failed fetch into the network error', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const { api } = deps(fn as unknown as ApiDeps['fetch']);
    const err = await api.get('/energy').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('network');
  });

  it('waits for retry_after once on rate limits and reports client.too_old to the app', async () => {
    const onFatal = vi.fn();
    const { fn } = fakeFetch([
      { status: 429, body: { code: 'rate_limited', retry_after: 2 } },
      { status: 200, body: { ok: true } },
      { status: 426, body: { code: 'client.too_old' } },
    ]);
    const { api, sleeps } = deps(fn, { onFatal });
    await api.get('/config');
    expect(sleeps).toEqual([2000]);
    await expect(api.get('/config')).rejects.toMatchObject({ code: 'client.too_old' });
    expect(onFatal).toHaveBeenCalledOnce();
  });

  it('does not retry a validation error', async () => {
    const { fn } = fakeFetch([{ status: 422, body: { code: 'energy.empty' } }]);
    const { api, sleeps } = deps(fn);
    await expect(api.post('/runs/start', {}, { idempotent: true })).rejects.toMatchObject({ code: 'energy.empty' });
    expect(sleeps).toEqual([]);
  });
});
