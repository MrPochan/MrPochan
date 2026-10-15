import { describe, expect, it, vi } from 'vitest';
import { initTelegram, needsTelegramSdk, requestFullscreenIfSupported, setBackButton, type TelegramWebApp } from '../src/platform/telegram.ts';
import { createHaptics } from '../src/platform/haptics.ts';

describe('Telegram helpers (TG-001, PLT-003, ERR-007)', () => {
  it('calls ready and expand when the methods exist, and survives a throw', () => {
    const ready = vi.fn();
    const expand = vi.fn(() => {
      throw new Error('boom');
    });
    expect(() => initTelegram({ ready, expand } as unknown as TelegramWebApp)).not.toThrow();
    expect(ready).toHaveBeenCalledOnce();
    expect(() => initTelegram(null)).not.toThrow();
  });

  it('requests fullscreen only when the method exists and the version is new enough', () => {
    const request = vi.fn();
    expect(requestFullscreenIfSupported({ requestFullscreen: request } as unknown as TelegramWebApp)).toBe(false);
    expect(
      requestFullscreenIfSupported({ requestFullscreen: request, isVersionAtLeast: () => false } as unknown as TelegramWebApp),
    ).toBe(false);
    expect(
      requestFullscreenIfSupported({ requestFullscreen: request, isVersionAtLeast: () => true } as unknown as TelegramWebApp),
    ).toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not throw when fullscreen fails', () => {
    const app = {
      requestFullscreen: () => {
        throw new Error('denied');
      },
      isVersionAtLeast: () => true,
    } as unknown as TelegramWebApp;
    expect(requestFullscreenIfSupported(app)).toBe(false);
  });

  it('binds and hides the BackButton without errors when it is missing', () => {
    const handler = vi.fn();
    const show = vi.fn();
    const hide = vi.fn();
    const onClick = vi.fn();
    const offClick = vi.fn();
    setBackButton({ BackButton: { show, hide, onClick, offClick } } as unknown as TelegramWebApp, true, handler);
    expect(onClick).toHaveBeenCalledWith(handler);
    expect(show).toHaveBeenCalledOnce();
    setBackButton({ BackButton: { show, hide, onClick, offClick } } as unknown as TelegramWebApp, false, handler);
    expect(hide).toHaveBeenCalledOnce();
    expect(() => setBackButton({} as TelegramWebApp, true, handler)).not.toThrow();
  });

  it('loads the SDK only for Mini App launch URLs', () => {
    expect(needsTelegramSdk('#tgWebAppData=x&tgWebAppVersion=8.0')).toBe(true);
    expect(needsTelegramSdk('')).toBe(false);
  });
});

describe('haptics (TG-002)', () => {
  it('makes no call at all while vibration is off', () => {
    const impactOccurred = vi.fn();
    const vibrate = vi.fn(() => true);
    const h = createHaptics({
      telegram: { HapticFeedback: { impactOccurred } } as unknown as TelegramWebApp,
      vibrate,
      enabled: () => false,
    });
    h.impact();
    h.success();
    expect(impactOccurred).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('uses Telegram feedback first and the browser vibration as the fallback', () => {
    const impactOccurred = vi.fn();
    const notificationOccurred = vi.fn();
    const withTg = createHaptics({
      telegram: { HapticFeedback: { impactOccurred, notificationOccurred } } as unknown as TelegramWebApp,
      vibrate: vi.fn(() => true),
      enabled: () => true,
    });
    withTg.impact();
    withTg.success();
    expect(impactOccurred).toHaveBeenCalledWith('light');
    expect(notificationOccurred).toHaveBeenCalledWith('success');

    const vibrate = vi.fn(() => true);
    const browser = createHaptics({ telegram: null, vibrate, enabled: () => true });
    browser.impact();
    expect(vibrate).toHaveBeenCalledWith(15);
  });
});
