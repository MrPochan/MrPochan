import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiErrors.ts';
import { planRetry, submitRetryDelay, SUBMIT_RETRY_WINDOW_MS } from '../src/lib/retry.ts';

describe('planRetry (ERR-002, ERR-012)', () => {
  it('retries GET network and 5xx failures after 1 s and then 3 s, then gives up', () => {
    const net = new ApiError('network', 0);
    expect(planRetry(net, { attempt: 0, replaySafe: true })).toBe(1000);
    expect(planRetry(net, { attempt: 1, replaySafe: true })).toBe(3000);
    expect(planRetry(net, { attempt: 2, replaySafe: true })).toBeNull();
    expect(planRetry(new ApiError('server.error', 500), { attempt: 0, replaySafe: true })).toBe(1000);
  });

  it('does not retry a POST without an Idempotency-Key', () => {
    expect(planRetry(new ApiError('network', 0), { attempt: 0, replaySafe: false })).toBeNull();
  });

  it('never retries client errors', () => {
    expect(planRetry(new ApiError('energy.empty', 422), { attempt: 0, replaySafe: true })).toBeNull();
    expect(planRetry(new ApiError('validation.failed', 400), { attempt: 0, replaySafe: true })).toBeNull();
  });

  it('retries rate limits once after retry_after seconds, and gives up above 60 s', () => {
    expect(planRetry(new ApiError('rate_limited', 429, 7), { attempt: 0, replaySafe: false })).toBe(7000);
    expect(planRetry(new ApiError('rate_limited', 429, 7), { attempt: 1, replaySafe: true })).toBeNull();
    expect(planRetry(new ApiError('rate_limited', 429, 120), { attempt: 0, replaySafe: true })).toBeNull();
    expect(planRetry(new ApiError('rate_limited', 429), { attempt: 0, replaySafe: true })).toBe(5000);
  });
});

describe('submitRetryDelay (ERR-005)', () => {
  it('repeats every 5 s until 15 minutes have passed', () => {
    expect(submitRetryDelay(0)).toBe(5000);
    expect(submitRetryDelay(SUBMIT_RETRY_WINDOW_MS - 1)).toBe(5000);
    expect(submitRetryDelay(SUBMIT_RETRY_WINDOW_MS)).toBeNull();
  });
});
