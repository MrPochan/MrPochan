// Glue between the screens and the core: run creation, battle simulation and the resurrection decision (CORE-026, CORE-027).
import {
  applyAction,
  startRun,
  fromHex,
  waveLimitTicks,
  HERO_CATALOG,
  type BattleEvent,
  type ResurrectCommand,
  type RunMode,
  type RunState,
  type StepResult,
} from '@cupquest/core';

export type HeroId = (typeof HERO_CATALOG)[number]['id'];

/** Result of simulating one battle step: the new state and the battle events only (for the arena). */
export interface BattleStep {
  readonly state: RunState;
  readonly events: BattleEvent[];
}

/** Keeps the battle events of a step (drop and gate events belong to the drop step). */
export function battleEventsOf(step: StepResult): BattleEvent[] {
  return step.events.filter((e): e is BattleEvent => e.e !== 'drop' && e.e !== 'gate');
}

export interface NewRunParams {
  readonly runId: string;
  readonly userId: string;
  readonly seedHex: string;
  readonly team: readonly HeroId[];
  readonly mode: RunMode;
  readonly levels: Readonly<Partial<Record<HeroId, number>>>;
  /** True when the server reserved gems for one resurrection (reserved_gems = 10). */
  readonly resurrectionReserved: boolean;
  /** Help card from the server, given as a tier 3 card (CARD-007). */
  readonly helpCard: string | null;
}

export function createRun(p: NewRunParams): RunState {
  return startRun({
    runId: p.runId,
    userId: p.userId,
    seed: fromHex(p.seedHex),
    team: [...p.team],
    mode: p.mode,
    levels: p.levels,
    resurrectionReserved: p.resurrectionReserved,
    initialCards: p.helpCard ? [{ id: p.helpCard, tier: 3 }] : [],
  });
}

/** Simulates the current wave. Commands are resurrection inputs; the state before the call is not changed. */
export function simulateBattle(pre: RunState, commands: readonly ResurrectCommand[] = []): BattleStep {
  const step = applyAction(pre, commands.length > 0 ? { k: 'battle', commands } : { k: 'battle' });
  return { state: step.state, events: battleEventsOf(step) };
}

/** A death the player may answer with a resurrection. `index` is the event's position in the battle events. */
export interface ResurrectOffer {
  readonly slot: number;
  readonly tick: number;
  readonly index: number;
}

/**
 * Offer for a hero death event, or null when no resurrection is possible (CORE-026).
 * `spentThisWave` covers a resurrection already chosen during the current battle replay.
 */
export function offerForEvent(state: RunState, event: BattleEvent, index: number, spentThisWave: boolean): ResurrectOffer | null {
  if (event.e !== 'death' || !event.u.startsWith('h')) return null;
  const reserved = state.config.resurrectionReserved && !state.resurrectionUsed && !spentThisWave;
  if (!reserved) return null;
  const slot = Number(event.u.slice(1));
  if (!Number.isInteger(slot)) return null;
  // The input applies at the start of the next tick; a limit at the next tick leaves no room for it.
  if (event.t + 1 >= waveLimitTicks(state.wave)) return null;
  return { slot, tick: event.t, index };
}

export function resurrectCommand(offer: ResurrectOffer): ResurrectCommand {
  return { t: offer.tick + 1, k: 'res', h: offer.slot };
}

/**
 * Re-simulates the wave with the chosen resurrection. Returns null when the new run does not revive the hero
 * or when its events differ from the old ones before the decision point (should not happen; checked anyway).
 */
export function replayWithResurrection(
  pre: RunState,
  offer: ResurrectOffer,
  oldEvents: readonly BattleEvent[],
): BattleStep | null {
  let next: BattleStep;
  try {
    next = simulateBattle(pre, [resurrectCommand(offer)]);
  } catch {
    // The core refuses a command for a living hero or a spent resurrection; no replay then.
    return null;
  }
  const revived = next.events.some((e) => e.e === 'res' && e.h === offer.slot && e.t === offer.tick + 1);
  if (!revived) return null;
  for (let i = 0; i <= offer.index; i++) {
    if (JSON.stringify(next.events[i]) !== JSON.stringify(oldEvents[i])) return null;
  }
  return next;
}
