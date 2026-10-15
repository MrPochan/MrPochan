// Vibration feedback (TG-002, spec 6.3). Off in settings means no call at all.
import type { TelegramWebApp } from './telegram.ts';

export interface HapticsDeps {
  readonly telegram: TelegramWebApp | null;
  readonly vibrate: ((pattern: number | number[]) => boolean) | null;
  readonly enabled: () => boolean;
}

export interface Haptics {
  /** Light impact when a ball lands on any gate (field). */
  impact(): void;
  /** Success notification for x5 in addition to the impact. */
  success(): void;
}

export function createHaptics(deps: HapticsDeps): Haptics {
  const tg = deps.telegram;
  return {
    impact() {
      if (!deps.enabled()) return;
      const hf = tg?.HapticFeedback;
      if (hf && typeof hf.impactOccurred === 'function') {
        try {
          hf.impactOccurred('light');
          return;
        } catch {
          // fall through to the browser vibration
        }
      }
      try {
        deps.vibrate?.(15);
      } catch {
        // unsupported
      }
    },
    success() {
      if (!deps.enabled()) return;
      const hf = tg?.HapticFeedback;
      if (hf && typeof hf.notificationOccurred === 'function') {
        try {
          hf.notificationOccurred('success');
          return;
        } catch {
          // fall through
        }
      }
      try {
        deps.vibrate?.([30, 30, 30]);
      } catch {
        // unsupported
      }
    },
  };
}
