import { describe, expect, it } from 'vitest';
import { applyAction, RuleError, startRun, type RunAction, type RunPhase } from '@cupquest/core';
import { allowedActions, isActionAllowed, leaveNeedsConfirm, timerSeconds, viewFor } from '../src/run/flow.ts';
import { createRun, simulateBattle } from '../src/run/engine.ts';

const PHASES: RunPhase[] = ['battle', 'cards', 'field', 'finished'];
const KINDS: RunAction['k'][] = ['battle', 'pick', 'reroll', 'upgrade', 'auto_pick', 'drop', 'end'];

const seedHex = '00112233445566778899aabbccddeeff';
const team = ['knight', 'archer', 'mage'] as const;

describe('run state machine table (spec 6.5, CARD-002, UI-002)', () => {
  it('maps each core phase to one screen', () => {
    expect(viewFor('battle')).toBe('battle');
    expect(viewFor('cards')).toBe('cards');
    expect(viewFor('field')).toBe('field');
    expect(viewFor('finished')).toBe('end');
  });

  it('lets the player act only where the core accepts the action', () => {
    expect(allowedActions('battle')).toEqual(['battle', 'end']);
    expect(isActionAllowed('cards', 'drop')).toBe(false);
    expect(isActionAllowed('field', 'drop')).toBe(true);
    expect(allowedActions('finished')).toEqual([]);
  });

  it('agrees with the core: a table-forbidden action is refused by the core as a wrong phase', () => {
    const state = startRun({ runId: 'r', userId: 'u', seed: new Uint8Array(16).fill(1), team: [...team] });
    for (const phase of PHASES) {
      for (const kind of KINDS) {
        if (isActionAllowed(phase, kind)) continue;
        const probe = { ...state, phase } as typeof state;
        let code: string | null = null;
        try {
          applyAction(probe, kind === 'end' ? { k: 'end', result: 'abandon' } : ({ k: kind } as RunAction));
        } catch (e) {
          code = e instanceof RuleError ? e.code : 'other';
        }
        expect(['run.wrong_phase', 'run.finished'], `${phase}/${kind}`).toContain(code);
      }
    }
  });

  it('asks for confirmation before leaving any run that is still going', () => {
    expect(leaveNeedsConfirm('battle')).toBe(true);
    expect(leaveNeedsConfirm('finished')).toBe(false);
  });

  it('gives the card step 5 s and the drop step 15 s (UI-002)', () => {
    expect(timerSeconds('cards')).toBe(5);
    expect(timerSeconds('field')).toBe(15);
    expect(timerSeconds('battle')).toBeNull();
  });

  it('walks a full wave cycle through the core: battle, cards, field, next battle', () => {
    const seed = Uint8Array.from(Buffer.from(seedHex, 'hex'));
    let state = startRun({ runId: 'r1', userId: 'u1', seed, team: [...team] });
    const views: string[] = [viewFor(state.phase)];
    const step = (action: RunAction) => {
      state = applyAction(state, action).state;
      views.push(viewFor(state.phase));
    };
    step({ k: 'battle' });
    step({ k: 'auto_pick' });
    step({ k: 'drop', c: 0 });
    expect(views).toEqual(['battle', 'cards', 'field', 'battle']);
    expect(state.wave).toBe(2);
  });
});

describe('engine helpers on core state', () => {
  it('creates a run with the help card as a tier 3 card', () => {
    const state = createRun({
      runId: 'r',
      userId: 'u',
      seedHex,
      team: [...team],
      mode: 'full',
      levels: {},
      resurrectionReserved: true,
      helpCard: 'knight_01',
    });
    expect(state.taken).toEqual([{ id: 'knight_01', tier: 3 }]);
    expect(state.config.resurrectionReserved).toBe(true);
  });

  it('simulates a battle and returns only battle events', () => {
    const state = createRun({ runId: 'r', userId: 'u', seedHex, team: [...team], mode: 'full', levels: {}, resurrectionReserved: false, helpCard: null });
    const step = simulateBattle(state);
    expect(step.events.length).toBeGreaterThan(0);
    expect(step.events.every((e) => e.ms >= 0)).toBe(true);
    expect(step.state.phase === 'cards' || step.state.phase === 'field' || step.state.phase === 'finished').toBe(true);
  });
});
