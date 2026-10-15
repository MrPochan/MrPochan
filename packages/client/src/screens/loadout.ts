// Hero selection and run start (spec 6.5, API-009). Three open heroes, mode, speed.
import type { RunMode } from '@cupquest/core';
import { ECONOMY_VIEW, HERO_CATALOG } from '@cupquest/core';
import type { App, Screen } from '../app.ts';
import type { HeroId, RunStartResponse } from '../api-types.ts';
import { randomId } from '../lib/ids.ts';
import { count, heroName, messageFor, t } from '../i18n.ts';
import { button, el, header, screen } from '../ui/dom.ts';
import { createRun } from '../run/engine.ts';
import { runViewFactory } from './route.ts';
import { menuScreen } from './menu.ts';

const HERO_ORDER: readonly HeroId[] = ['knight', 'archer', 'mage', 'druid'];
const TEAM_SIZE = 3;

export function loadoutScreen(app: App): Screen {
  const me = app.requireMe();
  const shortAllowed = app.config?.flags.features.short_run ?? false;
  const levels: Partial<Record<HeroId, number>> = Object.fromEntries(me.heroes.map((h) => [h.id, h.level]));
  const opened = new Set<HeroId>(me.heroes.map((h) => h.id));
  const defaultTeam = HERO_ORDER.filter((id) => opened.has(id)).slice(0, TEAM_SIZE);
  let team: HeroId[] = [...defaultTeam];
  let mode: RunMode = 'full';
  let speed: 1 | 2 = app.settings.speed;
  let busy = false;

  const teamLine = el('p', { class: 'muted' });
  const heroList = el('div', { class: 'hero-grid' });
  const modeRow = el('div', { class: 'segmented' });
  const speedRow = el('div', { class: 'segmented' });
  const message = el('p', { class: 'error', role: 'alert' });
  const startBtn = button(t('loadout.start'), () => void start(), { primary: true });

  function toggleHero(id: HeroId): void {
    if (!opened.has(id)) return;
    if (team.includes(id)) team = team.filter((x) => x !== id);
    else if (team.length < TEAM_SIZE) team = [...team, id];
    render();
  }

  function renderHeroes(): void {
    heroList.replaceChildren();
    for (const id of HERO_ORDER) {
      const stat = HERO_CATALOG.find((h) => h.id === id);
      const isOpen = opened.has(id);
      const selected = team.includes(id);
      const body = isOpen
        ? [
            el('strong', {}, heroName(id)),
            el('span', { class: 'muted small' }, t('loadout.level', { n: levels[id] ?? 1 })),
            stat ? el('span', { class: 'muted small' }, t('loadout.stats', { hp: stat.hp, dmg: stat.dmg })) : null,
          ]
        : [
            el('strong', {}, heroName(id)),
            el('span', { class: 'muted small' }, t('loadout.locked')),
            el(
              'span',
              { class: 'muted small' },
              t('loadout.price', {
                gems: count('unit.gem', ECONOMY_VIEW.druidGems),
                coins: count('unit.coin', ECONOMY_VIEW.druidCoins),
              }),
            ),
          ];
      heroList.append(
        button(
          '',
          () => toggleHero(id),
          { disabled: !isOpen, pressed: selected, className: `hero-card${selected ? ' is-selected' : ''}` },
        ),
      );
      const card = heroList.lastElementChild as HTMLElement;
      card.replaceChildren(...body.filter((x): x is HTMLElement => x !== null));
    }
  }

  function renderSegments(): void {
    modeRow.replaceChildren(
      button(t('loadout.mode.full'), () => {
        mode = 'full';
        render();
      }, { pressed: mode === 'full' }),
    );
    if (shortAllowed) {
      modeRow.append(
        button(t('loadout.mode.short5'), () => {
          mode = 'short5';
          render();
        }, { pressed: mode === 'short5' }),
      );
    }
    speedRow.replaceChildren(
      button('x1', () => setSpeed(1), { pressed: speed === 1 }),
      button('x2', () => setSpeed(2), { pressed: speed === 2 }),
    );
  }

  function setSpeed(next: 1 | 2): void {
    speed = next;
    render();
  }

  function render(): void {
    teamLine.textContent = t('loadout.team', { n: team.length });
    renderHeroes();
    renderSegments();
    startBtn.disabled = team.length !== TEAM_SIZE || busy;
    startBtn.textContent = busy ? t('loadout.starting') : t('loadout.start');
  }

  async function start(): Promise<void> {
    if (team.length !== TEAM_SIZE || busy) return;
    busy = true;
    message.textContent = '';
    render();
    try {
      const chosen = [...team];
      const r = await app.api.post<RunStartResponse>('/runs/start', { mode, speed, team: chosen, daily: false }, { idempotent: true });
      const state = createRun({
        runId: r.run_id,
        userId: me.user.id,
        seedHex: r.seed,
        team: chosen,
        mode,
        levels,
        resurrectionReserved: r.reserved_gems > 0,
        helpCard: r.help_card,
      });
      app.setSettings({ ...app.settings, speed });
      app.setRun({ runId: r.run_id, state, speed, submitKey: randomId(), team: chosen });
      if (r.help_card) app.notify(t('loadout.help', { card: r.help_card }));
      app.go(runViewFactory(app));
    } catch (e) {
      busy = false;
      message.textContent = messageFor(e);
      render();
    }
  }

  render();
  return {
    el: screen(
      header(t('loadout.title'), button(t('app.back'), () => app.go(menuScreen), { className: 'btn-small' })),
      el('p', { class: 'muted' }, t('loadout.hint')),
      teamLine,
      heroList,
      el('h2', { class: 'section' }, t('loadout.mode')),
      modeRow,
      el('h2', { class: 'section' }, t('loadout.speed')),
      speedRow,
      message,
      startBtn,
    ),
    onBack: () => app.go(menuScreen),
  };
}
