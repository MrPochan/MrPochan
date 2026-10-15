// Chooses the screen for the current run phase (spec 6.5 transitions, run/flow.ts table).
import type { App, ScreenFactory } from '../app.ts';
import { viewFor } from '../run/flow.ts';
import { menuScreen } from './menu.ts';
import { battleScreen } from './battle.ts';
import { cardsScreen } from './cards.ts';
import { fieldScreen } from './field.ts';
import { runEndScreen } from './runEnd.ts';

export function runViewFactory(app: App): ScreenFactory {
  const run = app.run;
  if (!run) return menuScreen;
  switch (viewFor(run.state.phase)) {
    case 'battle':
      return battleScreen;
    case 'cards':
      return cardsScreen;
    case 'field':
      return fieldScreen;
    case 'end':
      return runEndScreen;
  }
}
