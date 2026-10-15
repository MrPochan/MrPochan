// Run end (spec 6.5, ERR-005, API-010): the summary, the submit with retries, rewards and the weekly board.
import type { App, Screen } from '../app.ts';
import type { BoardResponse, HeroId, SubmitResponse } from '../api-types.ts';
import { heroName, count, gateName, messageFor, t } from '../i18n.ts';
import { bestGate, summarizeRun } from '../run/summary.ts';
import { buildSubmitBody } from '../run/summary.ts';
import { submitWithRetry, type SubmitStatus } from '../run/submit.ts';
import { formatInt } from '../lib/format.ts';
import { button, el, header, screen } from '../ui/dom.ts';
import { boardTable } from './board.ts';
import { loadoutScreen } from './loadout.ts';
import { menuScreen } from './menu.ts';

const HERO_IDS: readonly string[] = ['knight', 'archer', 'mage', 'druid'];

export function runEndScreen(app: App): Screen {
  const run = app.run;
  if (!run) return menuScreen(app);
  const state = run.state;
  const summary = summarizeRun(state);
  const endedAt = app.now();
  let disposed = false;
  app.finishedRuns += 1;

  const statusLine = el('p', { class: 'status-line', role: 'status' });
  const rewardBox = el('div', { class: 'rewards' });
  const boardBox = el('div');
  const resend = button(t('end.resend'), () => void submit(), { primary: true });
  resend.hidden = true;

  const headline =
    summary.result === 'win'
      ? t('end.win')
      : summary.result === 'loss'
        ? t('end.loss', { n: summary.lastWave })
        : summary.result === 'abandon'
          ? t('end.abandon', { n: summary.lastWave })
          : t('end.timeout');

  const gateLines = (['x5', 'x3', 'x2', 'x1', 'x0'] as const).map((g) =>
    el('div', { class: 'row' }, el('span', { class: 'gate-chip' }, gateName(g)), el('span', {}, formatInt(summary.gates[g]))),
  );
  const best = bestGate(summary.gates);

  function showStatus(s: SubmitStatus): void {
    resend.hidden = true;
    switch (s.k) {
      case 'sending':
        statusLine.textContent = t('end.submit.sending');
        return;
      case 'retry':
        statusLine.textContent = t('end.submit.retry', { s: Math.ceil(s.delayMs / 1000) });
        return;
      case 'duplicate':
        statusLine.textContent = t('end.submit.duplicate');
        return;
      case 'failed':
        statusLine.textContent = t('end.submit.failed');
        statusLine.append(` ${messageFor(s.error)}`);
        resend.hidden = false;
        return;
      case 'done':
        statusLine.textContent = t('end.submit.done');
        if (s.res.run.state === 'flagged') statusLine.append(` ${t('err.run_flagged')}`);
        renderRewards(s.res);
        return;
    }
  }

  function renderRewards(res: SubmitResponse): void {
    const unlock = res.next_unlock?.id;
    rewardBox.replaceChildren(
      el('h2', { class: 'section' }, t('end.rewards')),
      el('p', {}, t('end.reward.coins', { n: formatInt(res.rewards.coins) })),
      el('p', {}, t('end.reward.gems', { n: formatInt(res.rewards.gems) })),
      el('p', {}, t('end.reward.burned', { n: formatInt(res.rewards.balls_burned) })),
      ...(unlock && HERO_IDS.includes(unlock) ? [el('p', {}, t('end.unlock', { name: heroName(unlock as HeroId) }))] : []),
    );
    void loadBoard();
  }

  async function loadBoard(): Promise<void> {
    try {
      const res = await app.api.get<BoardResponse>('/board/weekly');
      if (!disposed) boardBox.replaceChildren(el('h2', { class: 'section' }, t('end.board')), boardTable(res));
    } catch (e) {
      if (!disposed) boardBox.replaceChildren(el('p', { class: 'muted small' }, messageFor(e)));
    }
  }

  async function submit(): Promise<void> {
    let body;
    try {
      body = buildSubmitBody(state, run!.runId);
    } catch (e) {
      statusLine.textContent = messageFor(e);
      return;
    }
    await submitWithRetry({
      api: app.api,
      body,
      key: run!.submitKey,
      endedAt,
      now: app.now,
      sleep: app.sleep,
      onStatus: (s) => {
        if (s.k === 'done') {
          const me = app.me;
          if (me) app.setMe({ ...me, balances: s.res.balances });
        }
        if (!disposed) showStatus(s);
      },
    });
  }

  void submit();

  return {
    el: screen(
      header(t('end.title')),
      el('h2', { class: 'headline' }, headline),
      el('p', {}, t('end.score', { n: formatInt(summary.score) })),
      el('p', { class: 'muted' }, t('end.coins', { n: count('unit.coin', summary.coins) })),
      el('p', { class: 'muted' }, t('end.balls', { n: count('unit.ball', summary.balls) })),
      el('p', { class: 'muted' }, t('end.resurrections', { n: summary.resurrections })),
      best ? el('p', { class: 'muted' }, t('end.best_gate', { gate: gateName(best) })) : el('p', { class: 'muted' }, t('end.no_gate')),
      el('div', { class: 'odds' }, ...gateLines),
      statusLine,
      resend,
      rewardBox,
      boardBox,
      el(
        'div',
        { class: 'cup-controls' },
        button(t('end.new_run'), () => {
          app.setRun(null);
          app.go(loadoutScreen);
        }, { primary: true }),
        button(t('app.menu'), () => {
          app.setRun(null);
          app.menu();
        }),
      ),
    ),
    isRoot: true,
    dispose: () => {
      disposed = true;
    },
  };
}
