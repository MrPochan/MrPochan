// Card offer (spec 4.2, CARD-002..CARD-006, UI-002): three cards, reroll, upgrade, and a 5 s timer
// that takes the first card when it runs out (open item OV-4).
import { ECONOMY_VIEW, applyAction, upgradeCost, type RunAction } from '@cupquest/core';
import type { App, Screen } from '../app.ts';
import { count, messageFor, t } from '../i18n.ts';
import { formatCountdown } from '../lib/format.ts';
import { button, el, header, screen } from '../ui/dom.ts';
import { CARD_STEP_SECONDS, viewFor } from '../run/flow.ts';
import { cardText, catalogEntry, maxTierOf } from '../run/cardText.ts';
import { confirmLeave } from './exit.ts';
import { runViewFactory } from './route.ts';

export function cardsScreen(app: App): Screen {
  const run = app.run;
  if (!run) throw new Error('no active run');
  let left = CARD_STEP_SECONDS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closeLeave: (() => void) | null = null;
  let leaving = false;

  const timerLine = el('p', { class: 'timer', role: 'timer' });
  const balls = el('p', { class: 'balances' });
  const offers = el('div', { class: 'card-list' });
  const rerollLine = el('p', { class: 'muted small' });
  const reroll = el('div');
  const upgrades = el('div', { class: 'upgrade-list' });
  const message = el('p', { class: 'error', role: 'alert' });

  function apply(action: RunAction): void {
    if (leaving) return;
    try {
      run!.state = applyAction(run!.state, action).state;
    } catch (e) {
      message.textContent = messageFor(e);
      return;
    }
    if (viewFor(run!.state.phase) !== 'cards') {
      leaveToNext();
      return;
    }
    render();
  }

  function leaveToNext(): void {
    leaving = true;
    stopTimer();
    app.go(runViewFactory(app));
  }

  function stopTimer(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }

  function renderOffers(): void {
    offers.replaceChildren();
    for (const id of run!.state.offer) {
      const text = cardText(id, 0);
      offers.append(
        el(
          'article',
          { class: 'card' },
          el('h3', {}, text.title),
          el('p', { class: 'muted small' }, `${text.heroLabel} · ${text.tierLabel}`),
          el('p', {}, text.effect),
          button(t('cards.pick'), () => apply({ k: 'pick', card: id }), { primary: true }),
        ),
      );
    }
    if (run!.state.offer.length === 0) offers.append(el('p', { class: 'muted' }, t('cards.none')));
  }

  function renderUpgrades(): void {
    upgrades.replaceChildren();
    const taken = run!.state.taken;
    for (const item of taken) {
      const entry = catalogEntry(item.id);
      if (!entry) continue;
      const max = maxTierOf(entry);
      const text = cardText(item.id, item.tier);
      if (item.tier >= max) {
        upgrades.append(el('div', { class: 'row' }, el('span', {}, `${text.title} · ${text.tierLabel}`), el('span', { class: 'muted small' }, t('cards.upgrade.max'))));
        continue;
      }
      const cost = upgradeCost(item.tier + 1);
      upgrades.append(
        el(
          'div',
          { class: 'row' },
          el('span', {}, `${text.title} · ${text.tierLabel}`),
          button(t('cards.upgrade.button', { tier: item.tier + 2, cost: count('unit.ball', cost) }), () => apply({ k: 'upgrade', card: item.id }), {
            disabled: run!.state.balls < cost,
          }),
        ),
      );
    }
  }

  function render(): void {
    const state = run!.state;
    timerLine.textContent = t('cards.timer', { time: formatCountdown(left) });
    balls.textContent = t('cards.balls', { n: count('unit.ball', state.balls) });
    renderOffers();
    rerollLine.textContent = t('cards.rerolls', { n: state.reroll });
    reroll.replaceChildren(
      button(t('cards.reroll', { cost: count('unit.ball', ECONOMY_VIEW.rerollCost) }), () => apply({ k: 'reroll' }), {
        disabled: state.balls < ECONOMY_VIEW.rerollCost,
      }),
    );
    renderUpgrades();
  }

  timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      stopTimer();
      apply({ k: 'auto_pick' });
      return;
    }
    timerLine.textContent = t('cards.timer', { time: formatCountdown(left) });
  }, 1000);

  render();

  return {
    el: screen(
      header(
        t('cards.title'),
        button(t('battle.exit'), () => {
          closeLeave?.();
          closeLeave = confirmLeave(app);
        }, { className: 'btn-small' }),
      ),
      el('p', { class: 'muted' }, t('battle.wave', { n: run.state.wave, total: run.state.lastWave })),
      timerLine,
      balls,
      offers,
      rerollLine,
      reroll,
      el('h2', { class: 'section' }, t('cards.upgrade.title')),
      upgrades,
      message,
    ),
    dispose: () => {
      stopTimer();
      closeLeave?.();
    },
    onBack: () => {
      closeLeave?.();
      closeLeave = confirmLeave(app);
    },
  };
}
