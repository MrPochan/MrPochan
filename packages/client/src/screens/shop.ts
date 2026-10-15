// Shop (API-005). Payments are off in this build (the kill switch is respected), so purchase buttons stay disabled.
import type { App, Screen } from '../app.ts';
import type { ClientConfig } from '../api-types.ts';
import { count, hasString, messageFor, t } from '../i18n.ts';
import { formatInt } from '../lib/format.ts';
import { button, el, header, screen } from '../ui/dom.ts';
import { menuScreen } from './menu.ts';

const REFRESH_MS = 60_000;

export function shopScreen(app: App): Screen {
  const notice = el('p', { class: 'notice-line' });
  const list = el('div', { class: 'card-list' });
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  function draw(cfg: ClientConfig | null): void {
    notice.textContent = cfg && cfg.flags.payments_enabled ? '' : t('shop.disabled');
    list.replaceChildren(
      ...(cfg?.packs ?? []).map((p) => {
        const name = hasString(p.name_key) ? t(p.name_key) : p.id;
        return el(
          'article',
          { class: 'card' },
          el('h3', {}, name),
          el('p', { class: 'muted' }, t('shop.pack.gems', { stars: formatInt(p.stars), gems: count('unit.gem', p.gems) })),
          button(t('shop.buy.off'), () => undefined, { disabled: true }),
        );
      }),
    );
  }

  async function load(): Promise<void> {
    try {
      const cfg = await app.api.get<ClientConfig>('/config');
      app.config = cfg;
      if (!disposed) draw(cfg);
    } catch (e) {
      if (!disposed) {
        notice.textContent = messageFor(e);
        draw(app.config);
      }
    }
  }

  draw(app.config);
  void load();
  timer = setInterval(() => void load(), REFRESH_MS);

  return {
    el: screen(header(t('shop.title'), button(t('app.back'), () => app.go(menuScreen), { className: 'btn-small' })), notice, list),
    onBack: () => app.go(menuScreen),
    dispose: () => {
      disposed = true;
      if (timer !== undefined) clearInterval(timer);
    },
  };
}
