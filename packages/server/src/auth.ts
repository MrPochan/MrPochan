// Authentication primitives: Telegram initData (AUTH-001), device tokens (AUTH-002).

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.ts';

/** AUTH-001 step 6: maximum age of auth_date in seconds (inclusive). */
export const INIT_DATA_MAX_AGE_S = 86_400;
/** AUTH-001 step 6: tolerated lead of auth_date over the server clock, in seconds. */
export const INIT_DATA_MAX_LEAD_S = 60;
/** AUTH-002: device token is 32 random bytes, sent as base64url (43 characters). */
export const DEVICE_TOKEN_BYTES = 32;

export interface VerifiedInitData {
  /** Telegram user id from the `user` field. */
  readonly telegramId: number;
  readonly authDate: number;
}

/**
 * Verifies Telegram Mini App initData (AUTH-001).
 * Signature is checked before freshness, so a forged value never reports as "expired".
 * Throws ApiError `auth.invalid` for format and signature errors, `auth.expired` for old auth_date.
 */
export function verifyInitData(initData: string, botToken: string, nowSec: number): VerifiedInitData {
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(initData)) {
    if (fields.has(key)) throw new ApiError('auth.invalid', `duplicate initData field ${key}`);
    fields.set(key, value);
  }

  const hash = fields.get('hash');
  if (hash === undefined || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw new ApiError('auth.invalid', 'missing or malformed hash');
  }
  fields.delete('hash');

  // Step 2: key=value pairs sorted by key, joined with a newline.
  const dataCheckString = [...fields]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Steps 3-4: secret = HMAC(key = "WebAppData", data = bot_token); check = HMAC(key = secret, data = dcs).
  const secret = createHmac('sha256', 'WebAppData').update(botToken, 'utf8').digest();
  const expected = createHmac('sha256', secret).update(dataCheckString, 'utf8').digest('hex');

  // Step 5: constant-time comparison of the hex digests.
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(hash.toLowerCase(), 'utf8');
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new ApiError('auth.invalid', 'signature mismatch');
  }

  // Step 6: freshness.
  const authDateRaw = fields.get('auth_date');
  if (authDateRaw === undefined || !/^\d{1,12}$/.test(authDateRaw)) {
    throw new ApiError('auth.invalid', 'missing or malformed auth_date');
  }
  const authDate = Number(authDateRaw);
  if (nowSec - authDate > INIT_DATA_MAX_AGE_S) throw new ApiError('auth.expired', 'auth_date is older than 86400 s');
  if (authDate - nowSec > INIT_DATA_MAX_LEAD_S) throw new ApiError('auth.invalid', 'auth_date is in the future');

  return { telegramId: parseTelegramId(fields.get('user')), authDate };
}

function parseTelegramId(rawUser: string | undefined): number {
  if (rawUser === undefined) throw new ApiError('auth.invalid', 'missing user field');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser);
  } catch {
    throw new ApiError('auth.invalid', 'user field is not JSON');
  }
  const id = typeof parsed === 'object' && parsed !== null ? (parsed as { id?: unknown }).id : undefined;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError('auth.invalid', 'user.id is missing');
  }
  return id;
}

/** Creates a new device token from the CSPRNG (AUTH-002). The token itself is never stored. */
export function issueDeviceToken(): string {
  return randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
}

/** SHA-256 of the token in hex; this is the only form kept in `devices` (AUTH-002, DB-002). */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** SHA-256 of install_id in hex (`device_hash`, AUTH-002). */
export function hashInstallId(installId: string): string {
  return createHash('sha256').update(installId, 'utf8').digest('hex');
}
