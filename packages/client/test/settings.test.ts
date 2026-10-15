import { describe, expect, it } from 'vitest';
import { createStore } from '../src/storage.ts';
import { DEFAULT_SETTINGS, readSettings, SETTING_KEYS, writeSettings } from '../src/lib/settings.ts';

describe('settings (PWA-003, TG-006)', () => {
  it('uses defaults for missing or malformed values', () => {
    const store = createStore(null);
    expect(readSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.set(SETTING_KEYS.speed, '7');
    expect(readSettings(store).speed).toBe(1);
  });

  it('round-trips the values as "0"/"1" and "1"/"2"', () => {
    const store = createStore(null);
    writeSettings(store, { sound: false, vibration: true, speed: 2 });
    expect(store.get(SETTING_KEYS.sound)).toBe('0');
    expect(store.get(SETTING_KEYS.speed)).toBe('2');
    expect(readSettings(store)).toEqual({ sound: false, vibration: true, speed: 2 });
  });
});

describe('storage fallback', () => {
  it('keeps values in memory when the backend throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createStore(broken);
    expect(() => store.set('k', 'v')).not.toThrow();
    expect(store.get('k')).toBe('v');
    store.remove('k');
    expect(store.get('k')).toBeNull();
  });
});
