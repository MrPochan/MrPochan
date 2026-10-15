// PWA helpers (PWA-004, PWA-005): service worker registration in production builds, update notice,
// and the install prompt rule. The pure rule is separate from the DOM event wiring.

export const INSTALL_DISMISS_KEY = 'cq_install_dismissed_at';
export const INSTALL_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/** Whether the install button may be shown now (PWA-005): a prompt is available and no refusal in the last 14 days. */
export function shouldOfferInstall(input: { hasPrompt: boolean; dismissedAtMs: number | null; nowMs: number; inRun: boolean }): boolean {
  if (!input.hasPrompt || input.inRun) return false;
  if (input.dismissedAtMs === null) return true;
  return input.nowMs - input.dismissedAtMs >= INSTALL_COOLDOWN_MS;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

/** Captures beforeinstallprompt so the game can show its own install button (PWA-005). */
export function captureInstallPrompt(win: Window, onChange: () => void): void {
  win.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    onChange();
  });
  win.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    onChange();
  });
}

export function installPromptAvailable(): boolean {
  return deferredPrompt !== null;
}

/** Shows the browser install prompt. Returns the outcome, or null when no prompt is available. */
export async function runInstallPrompt(): Promise<'accepted' | 'dismissed' | null> {
  const ev = deferredPrompt;
  if (!ev) return null;
  deferredPrompt = null;
  await ev.prompt();
  const choice = await ev.userChoice;
  return choice.outcome;
}

/**
 * Registers /sw.js in production builds only (spec 6.4). When a new worker waits, onUpdate is called;
 * the page reloads only after the player presses the update button (PWA-004).
 */
export async function registerServiceWorker(enabled: boolean, onUpdate: (activate: () => void) => void): Promise<void> {
  if (!enabled || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const notifyIfWaiting = (): void => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        onUpdate(() => reg.waiting?.postMessage({ type: 'SKIP_WAITING' }));
      }
    };
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') notifyIfWaiting();
      });
    });
    notifyIfWaiting();
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  } catch {
    // the game works without the worker
  }
}
