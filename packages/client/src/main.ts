// Entry point: Telegram detection and init, service worker in production, then the app boot.
import './styles.css';
import { Api } from './api.ts';
import { App } from './app.ts';
import { APP_VERSION } from './version.ts';
import { browserBackend, createStore } from './storage.ts';
import { randomId } from './lib/ids.ts';
import { createHaptics } from './platform/haptics.ts';
import {
  initTelegram,
  loadTelegramSdk,
  needsTelegramSdk,
  requestFullscreenIfSupported,
  type TelegramWebApp,
} from './platform/telegram.ts';
import { captureInstallPrompt, registerServiceWorker } from './platform/pwa.ts';
import { isRenderCrash } from './lib/crash.ts';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app element');

  // Telegram Mini App launch URLs carry tgWebAppVersion in the hash; the SDK is loaded only there.
  // The wait is bounded so a blocked SDK host cannot stop the game from starting.
  if (needsTelegramSdk(location.hash)) await Promise.race([loadTelegramSdk(document), sleep(3000)]);
  const telegram = (window.Telegram?.WebApp ?? null) as TelegramWebApp | null;
  initTelegram(telegram);
  requestFullscreenIfSupported(telegram);

  let app: App | null = null;
  const api = new Api({
    baseUrl: import.meta.env.VITE_API_BASE || '/api/v1',
    clientVersion: APP_VERSION,
    fetch: (url, init) => fetch(url, init),
    sleep,
    newKey: randomId,
    onFatal: () => app?.showTooOld(),
  });
  const haptics = createHaptics({
    telegram,
    vibrate: typeof navigator.vibrate === 'function' ? navigator.vibrate.bind(navigator) : null,
    enabled: () => app?.settings.vibration ?? false,
  });
  app = new App({
    root,
    api,
    store: createStore(browserBackend()),
    telegram,
    haptics,
    clientVersion: APP_VERSION,
    sleep,
    now: () => Date.now(),
    newId: randomId,
  });
  const started = app;

  captureInstallPrompt(window, () => undefined);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') started.escape();
  });
  // Error boundary (ERR-006): uncaught errors end the run and return to the menu. Resource load errors are not ErrorEvents.
  window.addEventListener('error', (event) => {
    if (event instanceof ErrorEvent) started.crash(event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (isRenderCrash(event.reason)) started.crash(event.reason);
  });
  if (import.meta.env.PROD) {
    void registerServiceWorker(true, (activate) => started.showUpdate(activate));
  }
  await started.boot();
}

void main();
