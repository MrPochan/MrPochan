// Error codes of the API (ТЗ 5.3, API-000; ERR-001). The response body carries only the code.

/** HTTP status of each error code. Codes marked "extra" are not in ТЗ 5.3 and are documented in README. */
export const ERROR_STATUS = {
  'auth.required': 401,
  'auth.invalid': 401,
  'auth.expired': 401,
  'validation.failed': 400,
  'guest.forbidden': 403,
  'not_found': 404,
  'run.not_found': 404,
  'run.already_submitted': 409,
  'idempotency.conflict': 409,
  'run.active': 409, // extra: a second run is started while one is open (DB-007)
  'run.timeout': 409, // extra: submit after 30 min from start (ERR-006, SEC-001)
  'energy.empty': 422,
  'hero.locked': 422,
  'run.invalid': 422,
  'client.too_old': 426,
  'rate_limited': 429,
  'server.error': 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** An error with a stable code. The message is for logs and tests, never for clients. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string = code) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}
