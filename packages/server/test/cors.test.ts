// CORS for the static client hosted apart from the API (ТЗ 3): only listed origins get the headers.

import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, ConfigError, parseOrigins } from '../src/config.ts';
import { makeHarness, type Harness } from './helpers.ts';

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.app.close();
  harness = undefined;
});

const ORIGIN = 'https://game.example.com';

describe('CORS (ТЗ 3, API-000)', () => {
  it('answers a preflight from a listed origin with the allowed methods and headers', async () => {
    harness = await makeHarness({ corsOrigins: [ORIGIN] });
    const res = await harness.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/runs/submit',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('Idempotency-Key');
    expect(res.headers['access-control-allow-headers']).toContain('X-Client-Version');
    expect(res.headers.vary).toBe('Origin');
  });

  it('adds the allow-origin header to API replies for a listed origin and exposes Retry-After', async () => {
    harness = await makeHarness({ corsOrigins: [ORIGIN] });
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/config',
      headers: { origin: ORIGIN, 'x-client-version': '0.1.0' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-expose-headers']).toBe('Retry-After');
  });

  it('gives no CORS headers to an unlisted origin or when no origins are configured', async () => {
    harness = await makeHarness({ corsOrigins: [ORIGIN] });
    const other = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/config',
      headers: { origin: 'https://evil.example', 'x-client-version': '0.1.0' },
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();

    await harness.app.close();
    harness = await makeHarness();
    const none = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/config',
      headers: { origin: ORIGIN, 'x-client-version': '0.1.0' },
    });
    expect(none.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS_ORIGINS parsing', () => {
  it('reads a comma-separated list of bare origins', () => {
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins('  ')).toEqual([]);
    expect(parseOrigins('https://a.example.com, https://b.example.com:8443')).toEqual([
      'https://a.example.com',
      'https://b.example.com:8443',
    ]);
    expect(loadConfig({ CORS_ORIGINS: 'https://a.example.com' }).corsOrigins).toEqual(['https://a.example.com']);
  });

  it('rejects values that are not bare origins', () => {
    expect(() => parseOrigins('https://a.example.com/')).toThrow(ConfigError);
    expect(() => parseOrigins('https://a.example.com/play')).toThrow(ConfigError);
    expect(() => parseOrigins('not an origin')).toThrow(ConfigError);
  });
});
