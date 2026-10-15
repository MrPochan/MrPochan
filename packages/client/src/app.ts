// Application shell: screen router, run state, sign-in and boot sequence, toasts and the update notice.
import { isVersionBelow } from './lib/semver.ts';
import { randomId } from './lib/ids.ts';
import { bootstrap } from './auth.ts';
import { Api } from './api.ts';
import { ApiError } from './lib/apiErrors.ts';
import { messageFor, t } from './i18n.ts';
import { el, button } from './ui/dom.ts';
import { setBackButton, type TelegramWebApp } from './platform/telegram.ts';
import type { Haptics } from './platform/haptics.ts';
import type { ClientConfig, HeroId, Me } from './api-types.ts';
import type { KeyValueStore } from './storage.ts';
import { readSettings, writeSettings, type Settings } from './lib/settings.ts';
import type { RunState } from '@cupquest/core';
import { noticeScreen, loadingScreen } from './screens/notice.ts';
import { menuScreen } from './screens/menu.ts';

/** A run in progress. It lives in memory only (UI-007): a reload does not restore it. */
export interface ActiveRun {
  readonly runId: string;
  /** Core state; replaced by every applied action. */
  state: RunState;
  readonly speed: 1 | 2;
  readonly submitKey: string;
  readonly team: readonly HeroId[];
}

export interface Screen {
  readonly el: HTMLElement;
  /** Root screens hide the Telegram BackButton. */
  readonly isRoot?: boolean;
  /** Runs after the element is in the document (Phaser needs a mounted parent). */
  onMount?(): void;
  dispose?(): void;
  /** Handler for the back action (Telegram BackButton, Escape); defaults to the menu. */
  onBack?(): void;
}

export type ScreenFactory = (app: App) => Screen | Promise<Screen>;

export interface AppDeps {
  readonly root: HTMLElement;
  readonly api: Api;
  readonly store: KeyValueStore;
  readonly telegram: TelegramWebApp | null;
  readonly haptics: Haptics;
  readonly clientVersion: string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly newId: () => string;
  /** Receives every crash (ERR-006). Defaults to the console; an error service is plugged in here. */
  readonly reportCrash?: (error: unknown) => void;
}

function consoleReport(error: unknown): void {
  console.error('[cupquest] crash', error);
}

/** Crashes within the reset window that send the player to the error notice instead of the menu (no loop). */
const MAX_CRASHES_IN_A_ROW = 3;
const CRASH_RESET_MS = 10_000;

export class App {
  settings: Settings;
  me: Me | null = null;
  config: ClientConfig | null = null;
  run: ActiveRun | null = null;
  /** Runs that reached the end screen in this session; the install button waits for the first one. */
  finishedRuns = 0;

  private current: Screen | null = null;
  private routeToken = 0;
  private crashing = false;
  private crashes = 0;

  constructor(readonly deps: AppDeps) {
    this.settings = readSettings(deps.store);
  }

  get root(): HTMLElement {
    return this.deps.root;
  }

  get api(): Api {
    return this.deps.api;
  }

  get store(): KeyValueStore {
    return this.deps.store;
  }

  get telegram(): TelegramWebApp | null {
    return this.deps.telegram;
  }

  get haptics(): Haptics {
    return this.deps.haptics;
  }

  get now(): () => number {
    return this.deps.now;
  }

  get sleep(): (ms: number) => Promise<void> {
    return this.deps.sleep;
  }

  online(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  /** Current profile; screens call this only after boot has loaded it. */
  requireMe(): Me {
    if (!this.me) throw new Error('profile is not loaded');
    return this.me;
  }

  setMe(me: Me): void {
    this.me = me;
  }

  setSettings(next: Settings): void {
    this.settings = next;
    writeSettings(this.deps.store, next);
  }

  setRun(run: ActiveRun | null): void {
    this.run = run;
  }

  /** Replaces the visible screen. Older navigation requests that finish late are dropped. */
  go(factory: ScreenFactory): void {
    const token = ++this.routeToken;
    this.disposeCurrent();
    this.root.replaceChildren(loadingScreen(this).el);
    Promise.resolve()
      .then(() => factory(this))
      .then((screen) => {
        if (token !== this.routeToken) {
          screen.dispose?.();
          return;
        }
        this.show(screen);
      })
      .catch((e: unknown) => {
        if (token !== this.routeToken) return;
        this.notify(messageFor(e));
        this.show(noticeScreen(this, t('notice.error.title'), messageFor(e), () => this.go(menuScreen)));
      });
  }

  private show(screen: Screen): void {
    this.current = screen;
    this.root.replaceChildren(screen.el);
    setBackButton(this.telegram, screen.isRoot !== true, () => this.back());
    try {
      screen.onMount?.();
    } catch (error) {
      this.crash(error);
    }
  }

  private disposeCurrent(): void {
    const screen = this.current;
    this.current = null;
    try {
      screen?.dispose?.();
    } catch (error) {
      (this.deps.reportCrash ?? consoleReport)(error);
    }
  }

  /**
   * ERR-006: a render or runtime failure ends the run without a result. The error is reported, the run is dropped
   * and the main menu is shown with the err.run_crashed text. The server closes such a run as timeout after 30 min.
   */
  crash(error: unknown): void {
    if (this.crashing) return;
    this.crashing = true;
    try {
      (this.deps.reportCrash ?? consoleReport)(error);
      this.setRun(null);
      this.crashes += 1;
      setTimeout(() => {
        this.crashes = Math.max(0, this.crashes - 1);
      }, CRASH_RESET_MS);
      if (this.crashes > MAX_CRASHES_IN_A_ROW) {
        // The menu itself fails: stop going back to it and show the error with a reload button.
        this.show(noticeScreen(this, t('notice.error.title'), t('err.run_crashed'), () => window.location.reload()));
        return;
      }
      this.menu();
      this.notify(t('err.run_crashed'));
    } finally {
      this.crashing = false;
    }
  }

  back(): void {
    if (this.current?.onBack) this.current.onBack();
    else this.menu();
  }

  /** Escape key: only screens that define onBack react (the menu does not). */
  escape(): void {
    this.current?.onBack?.();
  }

  menu(): void {
    this.go(menuScreen);
  }

  /** Short message shown over the screen. */
  notify(text: string): void {
    const node = el('div', { class: 'toast', role: 'status' }, text);
    document.body.append(node);
    setTimeout(() => node.remove(), 3500);
  }

  /** Update notice (PWA-004): reload only when the player presses the button. */
  showUpdate(activate: () => void): void {
    if (document.querySelector('.update-banner')) return;
    const banner = el(
      'div',
      { class: 'update-banner', role: 'status' },
      el('span', {}, t('app.update.available')),
      button(t('app.update.button'), () => {
        activate();
        banner.remove();
      }, { className: 'btn-small' }),
    );
    document.body.append(banner);
  }

  /** Full start: sign-in, client version check, config, then the menu. */
  async boot(): Promise<void> {
    this.go(loadingScreen);
    try {
      const me = await bootstrap({
        api: this.api,
        store: this.store,
        telegramInitData: this.telegram?.initData ? this.telegram.initData : null,
        newId: this.deps.newId,
      });
      this.setMe(me);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'client.too_old') {
        this.showTooOld();
        return;
      }
      this.show(noticeScreen(this, t('notice.error.title'), messageFor(e), () => void this.boot()));
      return;
    }
    try {
      this.config = await this.api.get<ClientConfig>('/config');
    } catch {
      this.config = null;
    }
    if (this.config && isVersionBelow(this.deps.clientVersion, this.config.min_client_version)) {
      this.showTooOld();
      return;
    }
    this.menu();
  }

  showTooOld(): void {
    this.disposeCurrent();
    this.show(noticeScreen(this, t('notice.too_old.title'), t('notice.too_old.text'), () => window.location.reload()));
  }
}

