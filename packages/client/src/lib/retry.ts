// Retry rules: ERR-002 (GET and idempotent POST), ERR-012 (rate limit), ERR-005 (run submit). DOM-free.
import { ApiError } from './apiErrors.ts';

/** GET (and idempotent POST) retries after 1 s and 3 s (ERR-002). */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 3000];
/** Wait used for rate_limited when the server gives no retry_after (ERR-012). */
export const RATE_LIMIT_DEFAULT_WAIT_S = 5;
/** Longest wait accepted from retry_after; a larger value gives up (ERR-012). */
export const RATE_LIMIT_MAX_WAIT_S = 60;
/** Run submit is retried every 5 s for up to 15 minutes (ERR-005). */
export const SUBMIT_RETRY_INTERVAL_MS = 5000;
export const SUBMIT_RETRY_WINDOW_MS = 15 * 60 * 1000;

export interface RetryContext {
  /** Retries already made for this request (0 for the first failure). */
  readonly attempt: number;
  /** True for GET, and for POST that carries an Idempotency-Key (ERR-002). */
  readonly replaySafe: boolean;
}

/**
 * Delay before the next attempt, or null when the request must fail now.
 * Network failures and 5xx are retried only when the request is replay-safe.
 * rate_limited is retried once after retry_after seconds (ERR-012).
 */
export function planRetry(error: ApiError, ctx: RetryContext): number | null {
  if (error.code === 'rate_limited') {
    if (ctx.attempt !== 0) return null;
    const waitS = error.retryAfterS ?? RATE_LIMIT_DEFAULT_WAIT_S;
    if (waitS > RATE_LIMIT_MAX_WAIT_S) return null;
    return Math.max(0, Math.round(waitS * 1000));
  }
  const transient = error.code === 'network' || error.code === 'server.error';
  if (!transient || !ctx.replaySafe) return null;
  return RETRY_DELAYS_MS[ctx.attempt] ?? null;
}

/**
 * Delay before the next submit attempt given the time since the run ended (ERR-005),
 * or null when the 15-minute window is over.
 */
export function submitRetryDelay(elapsedMs: number): number | null {
  if (elapsedMs >= SUBMIT_RETRY_WINDOW_MS) return null;
  return SUBMIT_RETRY_INTERVAL_MS;
}
