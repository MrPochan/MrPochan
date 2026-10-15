import { describe, expect, it } from 'vitest';
import { Api, type ApiDeps } from '../src/api.ts';
import { submitWithRetry, type SubmitStatus } from '../src/run/submit.ts';
import { SUBMIT_RETRY_WINDOW_MS } from '../src/lib/retry.ts';
import type { SubmitBody } from '../src/api-types.ts';

const body = { run_id: 'r1' } as unknown as SubmitBody;

function apiWith(fetch: ApiDeps['fetch']): Api {
  return new Api({ baseUrl: '/api/v1', clientVersion: '0.1.0', fetch, sleep: async () => undefined, newKey: () => 'k' });
}

describe('submitWithRetry (ERR-005)', () => {
  it('keeps one idempotency key and reports done on success', async () => {
    const keys: string[] = [];
    // Three failures exhaust the transport retries of Api.send; the loop then waits 5 s and sends again.
    const failing = () => new Response(JSON.stringify({ code: 'network' }), { status: 503 });
    const replies = [
      failing,
      failing,
      failing,
      () => new Response(JSON.stringify({ run: { id: 'r1', state: 'verified' }, rewards: {} }), { status: 200 }),
    ];
    const fetch: ApiDeps['fetch'] = async (_url, init) => {
      keys.push((init.headers as Record<string, string>)['Idempotency-Key'] ?? 'none');
      return (replies.shift() as () => Response)();
    };
    const statuses: SubmitStatus['k'][] = [];
    let now = 0;
    const res = await submitWithRetry({
      api: apiWith(fetch),
      body,
      key: 'fixed-key',
      endedAt: 0,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      onStatus: (s) => statuses.push(s.k),
    });
    expect(res?.run.state).toBe('verified');
    expect(new Set(keys)).toEqual(new Set(['fixed-key']));
    expect(statuses).toEqual(['sending', 'retry', 'sending', 'done']);
    expect(keys.length).toBe(4);
  });

  it('reports a duplicate for run.already_submitted and stops', async () => {
    const fetch: ApiDeps['fetch'] = async () => new Response(JSON.stringify({ code: 'run.already_submitted' }), { status: 409 });
    const statuses: SubmitStatus['k'][] = [];
    const res = await submitWithRetry({
      api: apiWith(fetch),
      body,
      key: 'k',
      endedAt: 0,
      now: () => 0,
      sleep: async () => undefined,
      onStatus: (s) => statuses.push(s.k),
    });
    expect(res).toBeNull();
    expect(statuses.at(-1)).toBe('duplicate');
  });

  it('gives up after the 15-minute window and reports failure', async () => {
    const fetch: ApiDeps['fetch'] = async () => {
      throw new TypeError('offline');
    };
    let now = 0;
    const statuses: SubmitStatus[] = [];
    const res = await submitWithRetry({
      api: apiWith(fetch),
      body,
      key: 'k',
      endedAt: 0,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      onStatus: (s) => statuses.push(s),
    });
    expect(res).toBeNull();
    expect(now).toBeGreaterThanOrEqual(SUBMIT_RETRY_WINDOW_MS - 5000);
    expect(statuses.at(-1)?.k).toBe('failed');
  });
});
