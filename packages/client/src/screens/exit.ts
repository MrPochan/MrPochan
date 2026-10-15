// Leave-run confirmation (UI-003, open item OV-2). Confirming ends the run as abandon.
import type { App } from '../app.ts';
import { applyAction } from '@cupquest/core';
import { t } from '../i18n.ts';
import { button, dialog, el } from '../ui/dom.ts';
import { leaveNeedsConfirm } from '../run/flow.ts';
import { runViewFactory } from './route.ts';

/** Opens the confirmation dialog; returns a function that closes it. */
export function confirmLeave(app: App): () => void {
  const run = app.run;
  if (!run || !leaveNeedsConfirm(run.state.phase)) return () => undefined;
  const panel = dialog(
    t('battle.exit.title'),
    [el('p', {}, t('battle.exit.text'))],
    [
      button(t('app.cancel'), () => close()),
      button(
        t('app.confirm'),
        () => {
          close();
          abandon(app);
        },
        { primary: true },
      ),
    ],
  );
  const close = (): void => panel.remove();
  document.body.append(panel);
  return close;
}

/** Ends the current run as abandon and shows the end screen. */
export function abandon(app: App): void {
  const run = app.run;
  if (!run) return;
  const step = applyAction(run.state, { k: 'end', result: 'abandon' });
  app.setRun({ ...run, state: step.state });
  app.go(runViewFactory(app));
}
