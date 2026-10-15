// Sign-in: Telegram initData when the Mini App provides it, otherwise a guest device token (AUTH-002, spec 6.3).
// The Telegram token lives in memory only; the guest token is kept in localStorage under cq_device_token.
import { ApiError } from './lib/apiErrors.ts';
import type { Api } from './api.ts';
import type { AuthResponse, Me } from './api-types.ts';
import type { KeyValueStore } from './storage.ts';

export const DEVICE_TOKEN_KEY = 'cq_device_token';
export const INSTALL_ID_KEY = 'cq_install_id';

export interface AuthDeps {
  readonly api: Api;
  readonly store: KeyValueStore;
  /** Raw initData from the Telegram Mini App, or null outside Telegram. */
  readonly telegramInitData: string | null;
  readonly newId: () => string;
}

const AUTH_CODES: ReadonlySet<string> = new Set(['auth.required', 'auth.invalid', 'auth.expired']);

/** Stable install id for this device; created once and kept with the device token. */
export function installId(store: KeyValueStore, newId: () => string): string {
  const existing = store.get(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = newId();
  store.set(INSTALL_ID_KEY, id);
  return id;
}

/** Signs in and returns the profile (GET /me). Retries once as a new guest when a stored token is rejected. */
export async function bootstrap(deps: AuthDeps): Promise<Me> {
  const { api, store } = deps;
  const install = installId(store, deps.newId);
  if (deps.telegramInitData) {
    const auth = await api.post<AuthResponse>('/auth/telegram', { init_data: deps.telegramInitData, install_id: install });
    api.setToken(auth.device_token);
    return api.get<Me>('/me');
  }
  const stored = store.get(DEVICE_TOKEN_KEY);
  if (stored) {
    api.setToken(stored);
    try {
      return await api.get<Me>('/me');
    } catch (e) {
      if (!(e instanceof ApiError) || !AUTH_CODES.has(e.code)) throw e;
      store.remove(DEVICE_TOKEN_KEY);
      api.setToken(null);
    }
  }
  const guest = await api.post<AuthResponse>('/auth/guest', { install_id: install });
  api.setToken(guest.device_token);
  store.set(DEVICE_TOKEN_KEY, guest.device_token);
  return api.get<Me>('/me');
}
