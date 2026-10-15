// Run state machine as seen by the client (spec 6.5, CORE-012..014, CARD-002, UI-002, UI-003). DOM-free.
// The core owns the rules; this table decides which screen shows and which actions the UI may send.
import type { RunAction, RunPhase } from '@cupquest/core';

export type RunView = 'battle' | 'cards' | 'field' | 'end';

export const CARD_STEP_SECONDS = 5;
export const FIELD_STEP_SECONDS = 15;

const VIEW_OF: Readonly<Record<RunPhase, RunView>> = {
  battle: 'battle',
  cards: 'cards',
  field: 'field',
  finished: 'end',
};

const ACTIONS_OF: Readonly<Record<RunPhase, readonly RunAction['k'][]>> = {
  battle: ['battle', 'end'],
  cards: ['pick', 'reroll', 'upgrade', 'auto_pick', 'end'],
  field: ['drop', 'end'],
  finished: [],
};

/** Screen for a core phase. */
export function viewFor(phase: RunPhase): RunView {
  return VIEW_OF[phase];
}

/** Actions the UI may send in a phase. The core rejects anything else with run.wrong_phase. */
export function allowedActions(phase: RunPhase): readonly RunAction['k'][] {
  return ACTIONS_OF[phase];
}

export function isActionAllowed(phase: RunPhase, kind: RunAction['k']): boolean {
  return ACTIONS_OF[phase].includes(kind);
}

/** Leaving a running run asks for confirmation and ends it as abandon (UI-003, open item OV-2). */
export function leaveNeedsConfirm(phase: RunPhase): boolean {
  return phase !== 'finished';
}

/** Card step exists for every wave before the last one (CARD-002). */
export function hasCardStep(wave: number, lastWave: number): boolean {
  return wave < lastWave;
}

/** Timer length of a view in seconds, or null when the view has no timer (UI-002). */
export function timerSeconds(view: RunView): number | null {
  if (view === 'cards') return CARD_STEP_SECONDS;
  if (view === 'field') return FIELD_STEP_SECONDS;
  return null;
}
