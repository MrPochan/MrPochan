// Main menu: balances, energy with the countdown to the next unit (API-007), and entry points.
import type { App, Screen } from '../app.ts';
import type { Energy, Me } from '../api-types.ts';
import { ApiError } from '../lib/apiErrors.ts';
import { messageFor, t } from '../i18n.ts';
import { formatCountdown, formatInt } from '../lib/format.ts';
import { button, el, screen } from '../ui/dom.ts';
import { INSTALL_DISMISS_KEY, installPromptAvailable, runInstallPrompt, shouldOfferInstall } from '../platform/pwa.ts';
import { loadoutScreen } from './loadout.ts';
import { boardScreen } from './board.ts';
import { profileScreen } from './profile.ts';
import { shopScreen } from './shop.ts';
import { settingsScreen } from './settings.ts';

export function menuScreen(app: App): Screen {
  let energy: Energy | null = null;
  let energyAt = app.now();
  let timer: ReturnType<typeof setInterval> | undefined;

  const balances = el('p', { class: 'balances' });
  const energyLine = el('p', { class: 'muted' });
  const offline = el('p', { class: 'notice-line' });
  const installSlot = el('div', { class: 'install-slot' });
  const guest = el('p', { class: 'muted small' }, t('menu.guest'));

  const playBtn = button(t('menu.play'), () => app.go(loadoutScreen), { primary: true });
  const boardBtn = button(t('menu.board'), () => app.go(boardScreen));
  const profileBtn = button(t('menu.profile'), () => app.go(profileScreen));
  const shopBtn = button(t('menu.shop'), () => app.go(shopScreen));
  const settingsBtn = button(t('menu.settings'), () => app.go(settingsScreen));
  const onlineOnly = [playBtn, boardBtn, profileBtn, shopBtn];

  const body = screen(
    el('h1', { class: 'title' }, t('app.title')),
    balances,
    energyLine,
    offline,
    installSlot,
    el('nav', { class: 'menu-list' }, playBtn, boardBtn, profileBtn, shopBtn, settingsBtn),
    guest,
  );

  function energyText(): string {
    if (!energy) return '';
    const base = t('menu.energy', { e: energy.e, max: energy.max });
    if (energy.e >= energy.max || energy.next_in_s === null) return `${base}, ${t('menu.energy.full')}`;
    const elapsedS = (app.now() - energyAt) / 1000;
    const left = Math.max(0, energy.next_in_s - elapsedS);
    return `${base}, ${t('menu.energy.next', { time: formatCountdown(left) })}`;
  }

  function render(): void {
    const me = app.me;
    balances.textContent = me
      ? `${t('menu.coins', { n: formatInt(me.balances.coin) })} · ${t('menu.gems', { n: formatInt(me.balances.gem) })}`
      : '';
    energyLine.textContent = energyText();
    const online = app.online();
    for (const b of onlineOnly) b.disabled = !online;
    offline.textContent = online ? '' : t('app.offline.hint');
    renderInstall();
  }

  function renderInstall(): void {
    installSlot.replaceChildren();
    const raw = app.store.get(INSTALL_DISMISS_KEY);
    const dismissedAt = raw === null ? null : Number(raw);
    const offer = shouldOfferInstall({
      hasPrompt: installPromptAvailable(),
      dismissedAtMs: dismissedAt === null || Number.isNaN(dismissedAt) ? null : dismissedAt,
      nowMs: app.now(),
      inRun: false,
    });
    if (app.finishedRuns === 0 || !offer) return;
    installSlot.append(
      el('p', { class: 'muted small' }, t('menu.install.hint')),
      button(t('app.install.button'), () => {
        void runInstallPrompt().then((outcome) => {
          if (outcome === 'dismissed') app.store.set(INSTALL_DISMISS_KEY, String(app.now()));
          render();
        });
      }),
    );
  }

  async function refresh(): Promise<void> {
    if (!app.online()) return render();
    try {
      const [me, en] = await Promise.all([app.api.get<Me>('/me'), app.api.get<Energy>('/energy')]);
      app.setMe(me);
      energy = en;
      energyAt = app.now();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'client.too_old')) app.notify(messageFor(e));
    }
    render();
  }

  render();
  void refresh();
  timer = setInterval(render, 1000);

  return {
    el: body,
    isRoot: true,
    dispose: () => {
      if (timer !== undefined) clearInterval(timer);
    },
  };
}

