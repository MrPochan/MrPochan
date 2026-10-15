// Battle view: the core simulates the wave at once and Phaser plays its events (spec 6.5, CORE-011, CORE-026).
// A hero death can open the resurrection dialog; the wave is then replayed with the chosen command (CORE-027).
import {
  coinsForWin,
  ECONOMY_VIEW,
  HERO_ID_ORDER,
  heroStatsFor,
  waveEnemies,
  waveKind,
  type BattleEvent,
} from '@cupquest/core';
import type { ActiveRun, App, Screen } from '../app.ts';
import { count, enemyName, heroName, t } from '../i18n.ts';
import type { TextKey } from '../strings.ru.ts';
import { button, el, header, screen } from '../ui/dom.ts';
import {
  battleEventsOf,
  offerForEvent,
  replayWithResurrection,
  simulateBattle,
  type BattleStep,
  type ResurrectOffer,
} from '../run/engine.ts';
import type { BattleGameHandle } from '../game/battleGame.ts';
import { confirmLeave } from './exit.ts';
import { runViewFactory } from './route.ts';

export function battleScreen(app: App): Screen {
  const run = app.run;
  if (!run) throw new Error('no active run');
  const active: ActiveRun = run;
  const pre = active.state;
  const wave = pre.wave;
  const lastWave = pre.lastWave;
  const kind = waveKind(wave);
  const team = heroStatsFor(pre.config.team, pre.config.levels, pre.taken);
  const enemies = waveEnemies(wave);
  const heroOrder = [...pre.config.team].sort((a, b) => HERO_ID_ORDER.indexOf(a) - HERO_ID_ORDER.indexOf(b));

  let current: BattleStep = simulateBattle(pre);
  let spentThisWave = false;
  let finished = false;
  let disposed = false;
  let speed: 1 | 2 = app.settings.speed;
  let game: BattleGameHandle | null = null;
  let closeLeave: (() => void) | null = null;

  const stage = el('div', { class: 'stage' });
  const result = el('div', { class: 'result-panel' });
  result.hidden = true;
  const resurrect = el('div', { class: 'overlay-inline' });
  resurrect.hidden = true;
  const speedRow = el('div', { class: 'segmented speed-toggle' });

  function renderSpeed(): void {
    speedRow.replaceChildren(
      button('x1', () => setSpeed(1), { pressed: speed === 1, ariaLabel: `${t('battle.speed')} x1` }),
      button('x2', () => setSpeed(2), { pressed: speed === 2, ariaLabel: `${t('battle.speed')} x2` }),
    );
  }

  function setSpeed(next: 1 | 2): void {
    speed = next;
    app.setSettings({ ...app.settings, speed: next });
    game?.setSpeed(next);
    renderSpeed();
  }

  /** Called by the arena for every event; a death that can be answered pauses playback. */
  function onEvent(ev: BattleEvent, index: number): 'continue' | 'pause' {
    if (ev.e !== 'death') return 'continue';
    const offer = offerForEvent(pre, ev, index, spentThisWave);
    if (!offer) return 'continue';
    openResurrect(offer);
    return 'pause';
  }

  function openResurrect(offer: ResurrectOffer): void {
    const heroId = heroOrder[offer.slot];
    const name = heroId ? heroName(heroId) : '';
    resurrect.hidden = false;
    resurrect.replaceChildren(
      el(
        'div',
        { class: 'dialog' },
        el('h2', {}, t('battle.resurrect.title')),
        el('p', {}, t('battle.resurrect.text', { hero: name })),
        el('p', { class: 'muted small' }, t('battle.resurrect.note')),
        el(
          'div',
          { class: 'dialog-actions' },
          button(t('battle.resurrect.yes', { gems: ECONOMY_VIEW.resurrectGems }), () => resurrectNow(offer), { primary: true }),
          button(t('battle.resurrect.no'), () => declineResurrect(offer)),
        ),
      ),
    );
  }

  function resurrectNow(offer: ResurrectOffer): void {
    closeResurrect();
    const next = replayWithResurrection(pre, offer, current.events);
    if (next) {
      current = next;
      spentThisWave = true;
      game?.resumeWith(current.events, offer.index);
    } else {
      game?.resumeWith(current.events, offer.index);
    }
  }

  function declineResurrect(offer: ResurrectOffer): void {
    closeResurrect();
    game?.resumeWith(current.events, offer.index);
  }

  function closeResurrect(): void {
    resurrect.hidden = true;
    resurrect.replaceChildren();
  }

  /** Playback reached the end: commit the wave to the run and show the outcome. */
  function onFinished(): void {
    if (finished || disposed) return;
    finished = true;
    app.setRun({ ...active, state: current.state });
    const endEvent = current.events.find((e) => e.e === 'end');
    const won = endEvent?.e === 'end' && endEvent.r === 'win';
    const reason = endEvent?.e === 'end' ? endEvent.why : 'limit';
    const coins = won ? coinsForWin(wave, pre.config.mode) : 0;
    result.hidden = false;
    result.replaceChildren(
      el('h2', { class: won ? 'win' : 'lose' }, t(won ? 'battle.win' : 'battle.lose')),
      el('p', {}, t(`battle.reason.${reason}` as TextKey)),
      ...(won ? [el('p', {}, t('battle.coins', { coins: count('unit.coin', coins) }))] : []),
      button(t('battle.next'), () => app.go(runViewFactory(app)), { primary: true }),
    );
  }

  function exitDialog(): void {
    closeLeave?.();
    closeLeave = confirmLeave(app);
  }

  const enemyList = enemies.map((e) => enemyName(e.type)).join(', ');
  const kindKey: TextKey = kind === 'boss' ? 'battle.kind.boss' : kind === 'miniboss' ? 'battle.kind.miniboss' : 'battle.kind.normal';

  renderSpeed();

  return {
    el: screen(
      header(t('battle.wave', { n: wave, total: lastWave }), button(t('battle.exit'), exitDialog, { className: 'btn-small' })),
      el('p', { class: 'muted small' }, `${t(kindKey)} · ${enemyList}`),
      stage,
      speedRow,
      result,
      resurrect,
    ),
    onMount: () => {
      void import('../game/battleGame.ts').then(({ createBattleGame }) => {
        if (disposed) return;
        game = createBattleGame(stage, {
          team,
          enemies,
          events: current.events,
          speed,
          onEvent,
          onFinished,
        });
      });
    },
    dispose: () => {
      disposed = true;
      game?.destroy();
      game = null;
      closeLeave?.();
    },
    onBack: exitDialog,
  };
}
