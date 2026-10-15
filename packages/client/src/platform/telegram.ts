// Telegram Mini App support (spec 6.3, PLT-003, TG-001, TG-008). Every call is feature-detected and guarded.
// The functions take the WebApp object as a parameter, so they can be tested without a window.

export interface TelegramWebApp {
  readonly initData?: string;
  readonly version?: string;
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => unknown;
  isVersionAtLeast?: (version: string) => boolean;
  HapticFeedback?: {
    impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
  };
  BackButton?: {
    show?: () => void;
    hide?: () => void;
    onClick?: (cb: () => void) => void;
    offClick?: (cb: () => void) => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** Minimum Bot API version for requestFullscreen (concept value, not yet confirmed; open item PLT-002). */
export const FULLSCREEN_MIN_VERSION = '8.0';

function isFn(v: unknown): v is (...args: never[]) => unknown {
  return typeof v === 'function';
}

/** Calls ready() and expand() when the client has them. Errors are ignored (ERR-007). */
export function initTelegram(app: TelegramWebApp | null | undefined): void {
  if (!app) return;
  try {
    if (isFn(app.ready)) app.ready();
  } catch {
    // ready is best effort
  }
  try {
    if (isFn(app.expand)) app.expand();
  } catch {
    // expand is best effort
  }
}

/**
 * Requests fullscreen once at start when the method exists and the client version is new enough (TG-001, PLT-003).
 * Returns true when the request was made. A failure never throws.
 */
export function requestFullscreenIfSupported(app: TelegramWebApp | null | undefined, minVersion = FULLSCREEN_MIN_VERSION): boolean {
  if (!app || !isFn(app.requestFullscreen) || !isFn(app.isVersionAtLeast)) return false;
  try {
    if (!app.isVersionAtLeast(minVersion)) return false;
    const result = app.requestFullscreen();
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

/** Shows or hides the Telegram BackButton; the handler is bound once (TG-008). */
export function setBackButton(app: TelegramWebApp | null | undefined, visible: boolean, handler: () => void): void {
  const bb = app?.BackButton;
  if (!bb) return;
  try {
    if (visible) {
      if (isFn(bb.onClick)) bb.onClick(handler);
      if (isFn(bb.show)) bb.show();
    } else {
      if (isFn(bb.offClick)) bb.offClick(handler);
      if (isFn(bb.hide)) bb.hide();
    }
  } catch {
    // the button is optional
  }
}

/** Loads the official WebApp script only inside Telegram (Mini App launch URLs carry tgWebAppVersion in the hash). */
export function needsTelegramSdk(hash: string): boolean {
  return hash.includes('tgWebAppVersion=');
}

export function loadTelegramSdk(doc: Document, src = 'https://telegram.org/js/telegram-web-app.js'): Promise<void> {
  return new Promise((resolve) => {
    const script = doc.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    doc.head.appendChild(script);
  });
}
