// Leaderboard (API-015, API-016): today and this week. Guests get guest.forbidden (403).
import type { App, Screen } from '../app.ts';
import type { BoardResponse } from '../api-types.ts';
import { messageFor, t } from '../i18n.ts';
import { formatInt } from '../lib/format.ts';
import { button, el, header, screen } from '../ui/dom.ts';
import { menuScreen } from './menu.ts';

/** Table of board rows; the viewer's own row is marked. */
export function boardTable(res: BoardResponse): HTMLElement {
  if (res.entries.length === 0) return el('p', { class: 'muted' }, t('board.empty'));
  return el(
    'table',
    { class: 'board' },
    el(
      'thead',
      {},
      el('tr', {}, el('th', {}, t('board.col.rank')), el('th', {}, t('board.col.name')), el('th', {}, t('board.col.wave')), el('th', {}, t('board.col.score'))),
    ),
    el(
      'tbody',
      {},
      ...res.entries.map((row) =>
        el(
          'tr',
          { class: row.is_me ? 'is-me' : undefined },
          el('td', {}, formatInt(row.rank)),
          el('td', {}, row.is_me ? `${row.name} (${t('board.me')})` : row.name),
          el('td', {}, formatInt(row.wave)),
          el('td', {}, formatInt(row.score)),
        ),
      ),
    ),
  );
}

export function boardScreen(app: App): Screen {
  let tab: 'day' | 'week' = 'week';
  const list = el('div', { class: 'board-box' });
  const tabs = el('div', { class: 'segmented' });
  let token = 0;

  // The daily board (API-015) is not in this iteration: the day tab is drawn only when the server enables daily_seed.
  const dailyBoardOn = (): boolean => app.config?.flags.features.daily_seed === true;

  function drawTabs(): void {
    tabs.replaceChildren(
      ...(dailyBoardOn() ? [button(t('board.tab.day'), () => select('day'), { pressed: tab === 'day' })] : []),
      button(t('board.tab.week'), () => select('week'), { pressed: tab === 'week' }),
    );
  }

  function select(next: 'day' | 'week'): void {
    tab = next;
    drawTabs();
    void load();
  }

  async function load(): Promise<void> {
    const my = ++token;
    list.replaceChildren(el('p', { class: 'muted' }, t('app.loading')));
    try {
      const path = tab === 'day' && dailyBoardOn() ? '/board/daily' : '/board/weekly';
      const res = await app.api.get<BoardResponse>(path);
      if (my === token) list.replaceChildren(boardTable(res), el('p', { class: 'muted small' }, t('board.note')));
    } catch (e) {
      if (my === token) list.replaceChildren(el('p', { class: 'error' }, messageFor(e)));
    }
  }

  drawTabs();
  void load();
  return {
    el: screen(
      header(t('board.title'), button(t('app.back'), () => app.go(menuScreen), { className: 'btn-small' })),
      tabs,
      list,
    ),
    onBack: () => app.go(menuScreen),
    dispose: () => {
      token++;
    },
  };
}
