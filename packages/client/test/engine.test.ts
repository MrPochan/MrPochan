import { describe, expect, it } from 'vitest';
import { heroStatsFor, simulateWave, type BattleEvent, applyAction, startRun, fromHex } from '@cupquest/core';
import { buildSubmitBody, bestGate, summarizeRun, emptyGateCounts } from '../src/run/summary.ts';
import { createRun, offerForEvent, replayWithResurrection, resurrectCommand, simulateBattle } from '../src/run/engine.ts';

const seedHex = '00112233445566778899aabbccddeeff';
const team = ['knight', 'archer', 'mage'] as const;

/** Enemy line that kills the whole team quickly, so deaths and resurrection offers occur (test-only override). */
const strongEnemies = [
  { type: 'boss' as const, slot: 0 },
  { type: 'boss' as const, slot: 1 },
];

function firstDeath(events: readonly BattleEvent[]): { event: BattleEvent; index: number } | null {
  const index = events.findIndex((e) => e.e === 'death' && e.u.startsWith('h'));
  return index < 0 ? null : { event: events[index] as BattleEvent, index };
}

describe('resurrection replay (CORE-026, CORE-027)', () => {
  it('a command at tick t+1 keeps every event up to the death identical', () => {
    const stats = heroStatsFor([...team], {}, []);
    const base = simulateWave({ wave: 1, team: stats, resurrectionAvailable: true, enemies: strongEnemies });
    const death = firstDeath(base.events);
    expect(death).not.toBeNull();
    if (!death) return;
    const deathTick = death.event.t;
    const slot = Number((death.event as { u: string }).u.slice(1));
    const replay = simulateWave({
      wave: 1,
      team: stats,
      resurrectionAvailable: true,
      enemies: strongEnemies,
      commands: [{ t: deathTick + 1, k: 'res', h: slot }],
    });
    for (let i = 0; i <= death.index; i++) {
      expect(JSON.stringify(replay.events[i])).toBe(JSON.stringify(base.events[i]));
    }
    expect(replay.events.some((e) => e.e === 'res' && e.h === slot && e.t === deathTick + 1)).toBe(true);
  });

  it('offers a resurrection only when one is reserved and not spent, and not at the limit', () => {
    const state = createRun({ runId: 'r', userId: 'u', seedHex, team: [...team], mode: 'full', levels: {}, resurrectionReserved: true, helpCard: null });
    const ev: BattleEvent = { t: 40, ms: 2000, e: 'death', u: 'h1' };
    expect(offerForEvent(state, ev, 7, false)).toEqual({ slot: 1, tick: 40, index: 7 });
    expect(offerForEvent(state, ev, 7, true)).toBeNull();
    const none = createRun({ runId: 'r', userId: 'u', seedHex, team: [...team], mode: 'full', levels: {}, resurrectionReserved: false, helpCard: null });
    expect(offerForEvent(none, ev, 7, false)).toBeNull();
    expect(offerForEvent(state, { t: 0, ms: 0, e: 'death', u: 'e0' }, 0, false)).toBeNull();
  });

  it('builds the command for the tick after the death', () => {
    expect(resurrectCommand({ slot: 2, tick: 33, index: 5 })).toEqual({ t: 34, k: 'res', h: 2 });
  });

  it('returns null when the replay does not revive the hero', () => {
    const state = createRun({ runId: 'r', userId: 'u', seedHex, team: [...team], mode: 'full', levels: {}, resurrectionReserved: true, helpCard: null });
    const step = simulateBattle(state);
    const offer = { slot: 0, tick: 1, index: 0 };
    expect(replayWithResurrection(state, offer, step.events)).toBeNull();
  });
});

describe('submit body (API-010, SEC-003)', () => {
  it('describes a finished run with the core records', () => {
    const seed = fromHex(seedHex);
    let state = startRun({ runId: 'r9', userId: 'u', seed, team: [...team] });
    state = applyAction(state, { k: 'battle' }).state;
    if (state.phase === 'cards') state = applyAction(state, { k: 'auto_pick' }).state;
    if (state.phase === 'field') state = applyAction(state, { k: 'drop', c: 2 }).state;
    state = applyAction(state, { k: 'end', result: 'abandon' }).state;

    const body = buildSubmitBody(state, 'r9');
    const summary = summarizeRun(state);
    expect(body.result).toBe('abandon');
    expect(body.score).toBe(summary.coins + summary.balls);
    expect(body.log_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(body.log)).toEqual(state.log);
    expect(body.resurrections).toBe(0);
    expect(Object.values(body.gates).reduce((a, b) => a + b, 0)).toBe(state.records.filter((r) => r.gate !== null).length);
  });

  it('lists the current wave after a battle win in the card and field steps, with no drop yet (API-010, ОВ-2)', () => {
    const seed = fromHex(seedHex);
    const won = applyAction(startRun({ runId: 'r10', userId: 'u', seed, team: [...team] }), { k: 'battle' }).state;
    expect(['cards', 'field']).toContain(won.phase);

    // Card step: the current wave has its coins record but no gate.
    const cardStep = applyAction(won, { k: 'end', result: 'abandon' }).state;
    const cardBody = buildSubmitBody(cardStep, 'r10');
    expect(cardBody.last_wave).toBe(1);
    expect(cardBody.waves.map((w) => w.w)).toEqual([1]);
    expect(Object.values(cardBody.gates).reduce((a, b) => a + b, 0)).toBe(0);

    // Field step: the card is picked, the wave still has no drop.
    const fieldBase = won.phase === 'cards' ? applyAction(won, { k: 'auto_pick' }).state : won;
    const fieldStep = applyAction(fieldBase, { k: 'end', result: 'abandon' }).state;
    const fieldBody = buildSubmitBody(fieldStep, 'r10');
    expect(fieldBody.last_wave).toBe(1);
    expect(fieldBody.waves.length).toBe(1);
    expect(Object.values(fieldBody.gates).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('refuses a run that has no result yet', () => {
    const state = startRun({ runId: 'r', userId: 'u', seed: fromHex(seedHex), team: [...team] });
    expect(() => buildSubmitBody(state, 'r')).toThrow(RangeError);
  });

  it('picks the best gate by the order x5 > x3 > x2 > x1 > x0 (TG-003)', () => {
    expect(bestGate(emptyGateCounts())).toBeNull();
    expect(bestGate({ x0: 3, x1: 0, x2: 1, x3: 0, x5: 0 })).toBe('x2');
    expect(bestGate({ x0: 1, x1: 1, x2: 1, x3: 0, x5: 2 })).toBe('x5');
  });
});
