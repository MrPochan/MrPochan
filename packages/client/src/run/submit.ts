// Run submit with retries (ERR-005, ERR-012, API-010). The loop keeps one Idempotency-Key for all attempts,
// so a repeated delivery cannot create a second run. DOM-free: time and sleep are injected.
import { ApiError } from '../lib/apiErrors.ts';
import { submitRetryDelay } from '../lib/retry.ts';
import type { Api } from '../api.ts';
import type { SubmitBody, SubmitResponse } from '../api-types.ts';

export type SubmitStatus =
  | { readonly k: 'sending' }
  | { readonly k: 'retry'; readonly delayMs: number }
  | { readonly k: 'done'; readonly res: SubmitResponse }
  | { readonly k: 'duplicate' }
  | { readonly k: 'failed'; readonly error: ApiError };

export interface SubmitDeps {
  readonly api: Api;
  readonly body: SubmitBody;
  readonly key: string;
  /** Time the run ended, in ms. The 15-minute window starts here (ERR-005). */
  readonly endedAt: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly onStatus: (status: SubmitStatus) => void;
}

/** Sends the run until it is accepted, reported as a duplicate, or the retry window closes. */
export async function submitWithRetry(deps: SubmitDeps): Promise<SubmitResponse | null> {
  for (;;) {
    deps.onStatus({ k: 'sending' });
    try {
      const res = await deps.api.post<SubmitResponse>('/runs/submit', deps.body, { key: deps.key });
      deps.onStatus({ k: 'done', res });
      return res;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.code === 'run.already_submitted') {
        deps.onStatus({ k: 'duplicate' });
        return null;
      }
      const transient = e.code === 'network' || e.code === 'server.error' || e.code === 'rate_limited';
      const delay = transient ? submitRetryDelay(deps.now() - deps.endedAt) : null;
      if (delay === null) {
        deps.onStatus({ k: 'failed', error: e });
        return null;
      }
      deps.onStatus({ k: 'retry', delayMs: delay });
      await deps.sleep(delay);
    }
  }
}
