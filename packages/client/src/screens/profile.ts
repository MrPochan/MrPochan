// Profile (API-006): balances, heroes and levels, quests, streak. Read-only in this build.
import type { App, Screen } from '../app.ts';
import type { Me } from '../api-types.ts';
import { heroName, messageFor, t } from '../i18n.ts';
import { formatInt } from '../lib/format.ts';
import { button, el, header, screen } from '../ui/dom.ts';
import { menuScreen } from './menu.ts';

const HERO_ORDER = ['knight', 'archer', 'mage', 'druid'] as const;

export function profileScreen(app: App): Screen {
  const box = el('div', { class: 'profile' });
  let disposed = false;

  function draw(me: Me): void {
    const opened = new Map(me.heroes.map((h) => [h.id, h.level]));
    box.replaceChildren(
      el('h2', { class: 'section' }, t('profile.balances')),
      el('p', {}, `${t('menu.coins', { n: formatInt(me.balances.coin) })} · ${t('menu.gems', { n: formatInt(me.balances.gem) })}`),
      el('h2', { class: 'section' }, t('profile.heroes')),
      ...HERO_ORDER.map((id) => {
        const level = opened.get(id);
        const state = level === undefined ? t('profile.hero.locked') : t('profile.hero.open', { n: level });
        return el('div', { class: 'row' }, el('span', {}, heroName(id)), el('span', { class: 'muted small' }, state));
      }),
      el('h2', { class: 'section' }, t('profile.quests')),
      ...(me.quests.length === 0
        ? [el('p', { class: 'muted' }, t('board.empty'))]
        : me.quests.map((q) =>
            el('div', { class: 'row' }, el('span', {}, q.id), el('span', { class: 'muted small' }, t('profile.quest.progress', { progress: q.progress, target: q.target }))),
          )),
      el('p', { class: 'muted small' }, t('profile.streak', { n: me.streak.day_no })),
      el(
        'p',
        { class: 'muted small' },
        t('profile.starter', { state: t(me.starter_bought ? 'profile.starter.yes' : 'profile.starter.no') }),
      ),
    );
  }

  const current = app.me;
  if (current) draw(current);
  else box.append(el('p', { class: 'muted' }, t('app.loading')));

  async function refresh(): Promise<void> {
    try {
      const me = await app.api.get<Me>('/me');
      app.setMe(me);
      if (!disposed) draw(me);
    } catch (e) {
      if (!disposed) box.append(el('p', { class: 'error' }, messageFor(e)));
    }
  }
  void refresh();

  return {
    el: screen(header(t('profile.title'), button(t('app.back'), () => app.go(menuScreen), { className: 'btn-small' })), box),
    onBack: () => app.go(menuScreen),
    dispose: () => {
      disposed = true;
    },
  };
}
