// API error model and mapping to UI text keys (spec 6.8, ERR-001, LOC-002). DOM-free.

/** Error codes from ERR-001 plus the client-only codes `network` and `battle.resurrect_used`. */
export const KNOWN_ERROR_CODES = [
  'auth.required',
  'auth.invalid',
  'auth.expired',
  'energy.empty',
  'coins.insufficient',
  'balls.insufficient',
  'gems.insufficient',
  'hero.already_open',
  'hero.locked',
  'pack.inactive',
  'starter.already_bought',
  'payments.disabled',
  'payments.blocked',
  'pay.failed',
  'help.cooldown',
  'run.invalid',
  'run.not_found',
  'run.already_submitted',
  'run.active',
  'run.timeout',
  'guest.forbidden',
  'client.too_old',
  'link.expired',
  'link.used',
  'validation.failed',
  'idempotency.conflict',
  'not_found',
  'rate_limited',
  'server.error',
  'network',
  'battle.resurrect_used',
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

const KNOWN: ReadonlySet<string> = new Set(KNOWN_ERROR_CODES);

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterS: number | undefined;

  constructor(code: string, status: number, retryAfterS?: number) {
    super(`API error ${code} (HTTP ${status})`);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

export function isKnownErrorCode(code: string): code is KnownErrorCode {
  return KNOWN.has(code);
}

/** Text key for an error code: `err.<code>` for known codes, otherwise the generic server error. */
export function errorKey(code: string): string {
  return `err.${isKnownErrorCode(code) ? code : 'server.error'}`;
}

/** Code used when the body carries none (proxy pages, empty bodies). */
function fallbackCode(status: number): string {
  if (status === 0) return 'network';
  if (status === 401) return 'auth.invalid';
  if (status === 404) return 'not_found';
  if (status === 426) return 'client.too_old';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server.error';
  return 'validation.failed';
}

/** Maps an HTTP failure (status + parsed JSON body) to an ApiError (ERR-001, ERR-012). */
export function errorFromResponse(status: number, body: unknown, retryAfterHeader?: string | null): ApiError {
  let code: string | undefined;
  let retryAfter: number | undefined;
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    if (typeof rec.code === 'string' && rec.code.length > 0) code = rec.code;
    if (typeof rec.retry_after === 'number' && Number.isFinite(rec.retry_after)) retryAfter = rec.retry_after;
  }
  if (retryAfter === undefined && retryAfterHeader) {
    const parsed = Number(retryAfterHeader);
    if (Number.isFinite(parsed) && parsed >= 0) retryAfter = parsed;
  }
  return new ApiError(code ?? fallbackCode(status), status, retryAfter);
}

/** Error for a request that never got an HTTP answer. */
export function networkError(): ApiError {
  return new ApiError('network', 0);
}
