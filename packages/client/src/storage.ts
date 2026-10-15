// Per-device key-value storage (PWA-003: only settings, the device token and two install keys may live here).
// Every access is wrapped: localStorage can throw or be missing (private windows, blocked site data).

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Store over a Storage-like backend; falls back to memory for the page lifetime when the backend fails. */
export function createStore(backend: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): KeyValueStore {
  const memory = new Map<string, string>();
  return {
    get(key) {
      try {
        const v = backend ? backend.getItem(key) : null;
        if (v !== null) return v;
      } catch {
        // fall through to memory
      }
      return memory.get(key) ?? null;
    },
    set(key, value) {
      memory.set(key, value);
      try {
        backend?.setItem(key, value);
      } catch {
        // keep the in-memory copy only
      }
    },
    remove(key) {
      memory.delete(key);
      try {
        backend?.removeItem(key);
      } catch {
        // nothing else to clear
      }
    },
  };
}

/** The browser's localStorage when it can be reached, otherwise null. */
export function browserBackend(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
