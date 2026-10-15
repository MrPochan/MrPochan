import { describe, expect, it } from 'vitest';
import { ApiError, errorFromResponse, errorKey, isKnownErrorCode, KNOWN_ERROR_CODES } from '../src/lib/apiErrors.ts';
import { STRINGS } from '../src/strings.ru.ts';

describe('errorFromResponse', () => {
  it('takes the code and retry_after from the body (ERR-001)', () => {
    const err = errorFromResponse(429, { code: 'rate_limited', retry_after: 7 });
    expect(err.code).toBe('rate_limited');
    expect(err.status).toBe(429);
    expect(err.retryAfterS).toBe(7);
  });

  it('falls back to the Retry-After header for rate limits', () => {
    const err = errorFromResponse(429, {}, '12');
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterS).toBe(12);
  });

  it('derives a code from the status when the body has none', () => {
    expect(errorFromResponse(500, undefined).code).toBe('server.error');
    expect(errorFromResponse(401, '').code).toBe('auth.invalid');
    expect(errorFromResponse(426, null).code).toBe('client.too_old');
    expect(errorFromResponse(400, {}).code).toBe('validation.failed');
  });
});

describe('errorKey', () => {
  it('maps known codes to err.<code> and unknown codes to the server error text', () => {
    expect(errorKey('energy.empty')).toBe('err.energy.empty');
    expect(errorKey('made.up.code')).toBe('err.server.error');
    expect(isKnownErrorCode('network')).toBe(true);
  });

  it('has a Russian text for every known code (LOC-002)', () => {
    for (const code of KNOWN_ERROR_CODES) {
      const key = `err.${code}` as keyof typeof STRINGS;
      expect(STRINGS[key], `missing text for ${code}`).toEqual(expect.any(String));
    }
  });

  it('is an ApiError with a stable code', () => {
    const err = new ApiError('network', 0);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('network');
  });
});
