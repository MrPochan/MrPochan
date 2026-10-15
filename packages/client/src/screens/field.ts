// Drop step (spec 6.5, UI-002, UI-004, UI-005, CORE-013). The cup moves by buttons or drag; the drop is
// applied by the core and the Phaser board plays its events. The timer drops into the current column.
import { applyAction, ballsForGate, generateBoard, type FieldEvent, type GateType, type RunEvent } from '@cupquest/core';
import type { App, Screen } from '../app.ts';
import { count, gateName, t } from '../i18n.ts';
import { formatCountdown, formatPercent } from '../lib/format.ts';
import { oddsRows } from '../lib/odds.ts';
import { clampColumn, COLUMN_COUNT, shiftColumn } from '../lib/columns.ts';
import { button, el, header, screen } from '../ui/dom.ts';
import { FIELD_STEP_SECONDS } from '../run/flow.ts';
import type { BoardGameHandle } from '../game/boardGame.ts';
import { messageFor } from '../i18n.ts';
import { confirmLeave } from './exit.ts';
import { runViewFactory } from './route.ts';

const isFieldEvent = (e: RunEvent): e is FieldEvent => e.e === 'drop' || e.e === 'gate';

export function fieldScreen(app: App): Screen {
  const run = app.run;
  if (!run) throw new Error('no active run');
  const state = run.state;
  const board = generateBoard(state.config.seed, state.wave);
  let column = Math.floor(COLUMN_COUNT / 2);
  let left = FIELD_STEP_SECONDS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let dropped = false;
  let disposed = false;
  let game: BoardGameHandle | null = null;
  let closeLeave: (() => void) | null = null;

  const stage = el('div', { class: 'stage' });
  const columnLine = el('p', { class: 'column-line' });
  const timerLine = el('p', { class: 'timer', role: 'timer' });
  const landed = el('p', { class: 'landed', role: 'status' });
  const message = el('p', { class: 'error', role: 'alert' });
  const leftBtn = button(t('field.left'), () => moveCup(-1), { ariaLabel: t('field.left') });
  const rightBtn = button(t('field.right'), () => moveCup(1), { ariaLabel: t('field.right') });
  const dropBtn = button(t('field.drop'), () => drop(false), { primary: true });
  const nextBtn = button(t('field.next'), () => app.go(runViewFactory(app)), { primary: true });
  nextBtn.hidden = true;

  const odds = el(
    'div',
    { class: 'odds' },
    el('h2', { class: 'section' }, t('field.odds')),
    ...oddsRows().map((row) =>
      el(
        'div',
        { class: 'row odds-row' },
        el('span', { class: 'gate-chip' }, gateName(row.gate)),
        el('span', {}, formatPercent(row.tenths)),
        el('span', { class: 'muted small' }, count('unit.ball', ballsForGate(row.gate))),
      ),
    ),
    el('p', { class: 'muted small' }, t('field.odds.note')),
  );

  function updateColumn(): void {
    columnLine.textContent = t('field.column', { n: column + 1 });
  }

  function moveCup(delta: number): void {
    if (dropped) return;
    setColumn(shiftColumn(column, delta));
  }

  function setColumn(next: number): void {
    column = clampColumn(next);
    game?.setColumn(column);
    updateColumn();
  }

  function stopTimer(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }

  function drop(auto: boolean): void {
    if (dropped || disposed) return;
    dropped = true;
    stopTimer();
    leftBtn.disabled = true;
    rightBtn.disabled = true;
    dropBtn.disabled = true;
    timerLine.textContent = t('field.dropping');
    try {
      const step = applyAction(run!.state, { k: 'drop', c: column, auto });
      run!.state = step.state;
      const events = step.events.filter(isFieldEvent);
      const onLanded = (gate: GateType, balls: number): void => {
        if (disposed) return;
        landed.textContent = t('field.landed', { gate: gateName(gate), balls: count('unit.ball', balls) });
        app.haptics.impact();
        if (gate === 'x5') app.haptics.success();
        timerLine.textContent = '';
        nextBtn.hidden = false;
      };
      if (game) {
        game.playDrop(events, onLanded);
      } else {
        // The board module has not loaded yet: show the outcome without the ball animation.
        const gateEv = events.find((e) => e.e === 'gate');
        if (gateEv?.e === 'gate') onLanded(gateEv.gate, gateEv.balls);
      }
    } catch (e) {
      dropped = false;
      leftBtn.disabled = false;
      rightBtn.disabled = false;
      dropBtn.disabled = false;
      message.textContent = messageFor(e);
    }
  }

  timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      drop(true);
      return;
    }
    if (!dropped) timerLine.textContent = t('field.timer', { time: formatCountdown(left) });
  }, 1000);
  timerLine.textContent = t('field.timer', { time: formatCountdown(left) });
  updateColumn();

  const body = screen(
    header(
      t('field.title'),
      button(t('battle.exit'), () => {
        closeLeave?.();
        closeLeave = confirmLeave(app);
      }, { className: 'btn-small' }),
    ),
    el('p', { class: 'muted small' }, t('battle.wave', { n: state.wave, total: state.lastWave })),
    el('p', { class: 'muted small' }, t('field.hint')),
    stage,
    el('div', { class: 'cup-controls' }, leftBtn, columnLine, rightBtn),
    el('div', { class: 'cup-controls' }, dropBtn, nextBtn),
    timerLine,
    landed,
    message,
    odds,
  );

  return {
    el: body,
    onMount: () => {
      void import('../game/boardGame.ts').then(({ createBoardGame }) => {
        if (disposed) return;
        game = createBoardGame(stage, {
          board,
          initialColumn: column,
          onColumn: (c) => {
            column = c;
            updateColumn();
          },
        });
      });
    },
    dispose: () => {
      disposed = true;
      stopTimer();
      game?.destroy();
      game = null;
      closeLeave?.();
    },
    onBack: () => {
      closeLeave?.();
      closeLeave = confirmLeave(app);
    },
  };
}
