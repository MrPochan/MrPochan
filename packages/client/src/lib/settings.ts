// Local settings (TG-006, PWA-003). Values are "0"/"1" for toggles and "1"/"2" for speed.
import type { KeyValueStore } from '../storage.ts';

export interface Settings {
  readonly sound: boolean;
  readonly vibration: boolean;
  readonly speed: 1 | 2;
}

export const SETTING_KEYS = {
  sound: 'cq_sound',
  vibration: 'cq_vibration',
  speed: 'cq_speed',
} as const;

export const DEFAULT_SETTINGS: Settings = { sound: true, vibration: true, speed: 1 };

/** Reads settings from the store; any missing or malformed value takes its default. */
export function readSettings(store: KeyValueStore): Settings {
  const sound = store.get(SETTING_KEYS.sound);
  const vibration = store.get(SETTING_KEYS.vibration);
  const speed = store.get(SETTING_KEYS.speed);
  return {
    sound: sound === null ? DEFAULT_SETTINGS.sound : sound === '1',
    vibration: vibration === null ? DEFAULT_SETTINGS.vibration : vibration === '1',
    speed: speed === '2' ? 2 : 1,
  };
}

export function writeSettings(store: KeyValueStore, s: Settings): void {
  store.set(SETTING_KEYS.sound, s.sound ? '1' : '0');
  store.set(SETTING_KEYS.vibration, s.vibration ? '1' : '0');
  store.set(SETTING_KEYS.speed, s.speed === 2 ? '2' : '1');
}
