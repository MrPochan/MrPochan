// Run state machine (spec CORE-001, CORE-012..CORE-014, CORE-026, CARD-002..CARD-004, ECO-006..ECO-008).
// Pure reducer: applyAction(state, action) returns a new state and the timed events for the client.
// Replaying the same actions from the same config always gives the same state and the same log.

import { BATTLE, ECONOMY, FIELD, type HeroId } from './config.ts';
import { RuleError } from './errors.ts';
import { generateBoardTrace, dropBall, type GateType } from './board.ts';
import { simulateWave, battleLogHash, HERO_ID_ORDER, type BattleEvent, type ResurrectCommand } from './battle.ts';
import { heroStatsFor, offerFor, poolFor, cardById, type TakenCard } from './cards.ts';
import {
  ballsForGate,
  coinsForWin,
  rerollCost,
  upgradeCost,
  type LedgerEntry,
  type RunMode,
  LedgerKeys,
} from './economy.ts';
import { SEED_BYTES } from './prng.ts';

export type RunPhase = 'battle' | 'cards' | 'field' | 'finished';
export type RunResult = 'win' | 'loss' | 'abandon' | 'timeout';

/** Input of a run start (CORE-001, CORE-002). `seed` is S; the server supplies it (RNG-006). */
export interface RunConfig {
  readonly runId: string;
  readonly userId: string;
  readonly seed: Uint8Array;
  readonly team: readonly HeroId[];
  readonly mode?: RunMode;
  readonly levels?: Readonly<Partial<Record<HeroId, number>>>;
  /** True when the server reserved 10 gems for one resurrection at /runs/start (CORE-026). */
  readonly resurrectionReserved?: boolean;
  /** Free cards given at the start (for example the help card, CARD-007), tier 3. */
  readonly initialCards?: readonly TakenCard[];
}

/** Per-wave bookkeeping, used to build the ledger on submit (ECO-001). */
export interface WaveRecord {
  readonly wave: number;
  coins: number;
  ballsGained: number;
  ballsSpent: number;
  gate: GateType | null;
  column: number | null;
}

/** Action sent by the client. `battle` carries resurrection inputs (CORE-027). */
export type RunAction =
  | { readonly k: 'battle'; readonly commands?: readonly ResurrectCommand[] }
  | { readonly k: 'pick'; readonly card: string }
  | { readonly k: 'reroll' }
  | { readonly k: 'upgrade'; readonly card: string }
  | { readonly k: 'auto_pick' }
  | { readonly k: 'drop'; readonly c: number; readonly auto?: boolean }
  | { readonly k: 'end'; readonly result: 'abandon' | 'timeout' };

/** Client-facing event of step 3 (drop animation). `ms` is relative to the start of the step. */
export type FieldEvent =
  | { readonly ms: number; readonly e: 'drop'; readonly col: number; readonly auto: boolean; readonly path: readonly number[] }
  | { readonly ms: number; readonly e: 'gate'; readonly col: number; readonly gate: GateType; readonly balls: number };

export type RunEvent = BattleEvent | FieldEvent;

/** Full state of a run. Immutable: every action returns a new object. */
export interface RunState {
  readonly config: RunConfig & { readonly mode: RunMode; readonly levels: Readonly<Partial<Record<HeroId, number>>>; readonly resurrectionReserved: boolean };
  readonly wave: number;
  readonly lastWave: number;
  readonly phase: RunPhase;
  readonly balls: number;
  readonly coins: number;
  readonly taken: readonly TakenCard[];
  readonly reroll: number;
  readonly offer: readonly string[];
  readonly resurrectionUsed: boolean;
  readonly records: readonly WaveRecord[];
  readonly burned: number;
  readonly result: RunResult | null;
  /** Canonical run log records (CORE-027, RNG-007): seed-free decisions and tick inputs. */
  readonly log: readonly unknown[];
}

export interface StepResult {
  readonly state: RunState;
  readonly events: readonly RunEvent[];
}

const TEAM_SIZE = 3;

function validateConfig(config: RunConfig): void {
  if (config.seed.length !== SEED_BYTES) throw new RangeError('seed must be 16 bytes');
  if (config.team.length !== TEAM_SIZE) throw new RuleError('team.size', 'a team has exactly 3 heroes');
  if (new Set(config.team).size !== TEAM_SIZE) throw new RuleError('team.duplicate', 'team heroes must be unique');
  for (const h of config.team) {
    if (!HERO_ID_ORDER.includes(h)) throw new RuleError('team.unknown_hero', `unknown hero ${String(h)}`);
  }
  for (const [h, lvl] of Object.entries(config.levels ?? {})) {
    if (!Number.isInteger(lvl) || (lvl as number) < 1 || (lvl as number) > ECONOMY.levelMax) {
      throw new RangeError(`level of ${h} out of range`);
    }
  }
  for (const c of config.initialCards ?? []) {
    const card = cardById(c.id);
    if (card.hero !== 'common' && !config.team.includes(card.hero as HeroId)) {
      throw new RuleError('card.not_in_team', `card ${c.id} belongs to a hero outside the team`);
    }
    if (!Number.isInteger(c.tier) || c.tier < 0 || c.tier > ECONOMY.maxTier) throw new RangeError('bad card tier');
  }
}

/** Starts a run (CORE-001): wave 1, battle phase, no balls (ECO-006: no starting balls). */
export function startRun(config: RunConfig): RunState {
  validateConfig(config);
  const mode: RunMode = config.mode ?? 'full';
  const lastWave = mode === 'short5' ? ECONOMY.shortModeWaves : BATTLE.waves.length;
  const fullConfig = {
    ...config,
    mode,
    levels: config.levels ?? {},
    resurrectionReserved: config.resurrectionReserved ?? false,
  };
  const state: RunState = {
    config: fullConfig,
    wave: 1,
    lastWave,
    phase: 'battle',
    balls: 0,
    coins: 0,
    taken: [...(config.initialCards ?? [])],
    reroll: 0,
    offer: [],
    resurrectionUsed: false,
    records: [],
    burned: 0,
    result: null,
    log: [],
  };
  return state;
}

function emptyRecord(wave: number): WaveRecord {
  return { wave, coins: 0, ballsGained: 0, ballsSpent: 0, gate: null, column: null };
}

/** Records the spend of `cost` balls for `wave` in the per-wave table (ECO-001 spend key). */
function withSpend(records: readonly WaveRecord[], wave: number, cost: number): WaveRecord[] {
  const out = records.map((r) => ({ ...r }));
  const rec = out.find((r) => r.wave === wave);
  if (rec) rec.ballsSpent += cost;
  else out.push({ ...emptyRecord(wave), ballsSpent: cost });
  return out;
}

function offerNow(state: RunState): string[] {
  return offerFor(state.config.seed, state.wave, state.reroll, state.config.team, state.taken);
}

/** Enters the card step of the current wave, or skips it when there is nothing to offer (CARD-002). */
function enterCardsOrField(state: RunState): RunState {
  const hasCardStep = state.wave < state.lastWave;
  if (!hasCardStep) return { ...state, phase: 'field', offer: [] };
  const offer = offerNow({ ...state, reroll: 0 } as RunState);
  if (offer.length === 0) return { ...state, phase: 'field', offer: [], reroll: 0 };
  return { ...state, phase: 'cards', reroll: 0, offer };
}

function finishRun(state: RunState, result: RunResult): RunState {
  const burned = state.balls;
  return {
    ...state,
    phase: 'finished',
    result,
    balls: 0,
    burned: state.burned + burned,
    log: [...state.log, { w: state.wave, e: 'end', r: result, burn: burned }],
  };
}

/** Advances the run by one action (CORE-012, CORE-013, CARD-002..CARD-004). Throws RuleError when not allowed. */
export function applyAction(state: RunState, action: RunAction): StepResult {
  if (state.phase === 'finished') throw new RuleError('run.finished', 'the run is already finished');
  switch (action.k) {
    case 'battle':
      return doBattle(state, action.commands ?? []);
    case 'pick':
      return doPick(state, action.card);
    case 'reroll':
      return doReroll(state);
    case 'upgrade':
      return doUpgrade(state, action.card);
    case 'auto_pick':
      return doAutoPick(state);
    case 'drop':
      return doDrop(state, action.c, action.auto === true);
    case 'end':
      return { state: finishRun(state, action.result), events: [] };
    default:
      throw new RuleError('action.unknown', 'unknown action');
  }
}

function requirePhase(state: RunState, phase: RunPhase): void {
  if (state.phase !== phase) throw new RuleError('run.wrong_phase', `expected phase ${phase}, got ${state.phase}`);
}

function doBattle(state: RunState, commands: readonly ResurrectCommand[]): StepResult {
  requirePhase(state, 'battle');
  const stats = heroStatsFor(state.config.team, state.config.levels, state.taken);
  const resAvailable = state.config.resurrectionReserved && !state.resurrectionUsed;
  const battle = simulateWave({
    wave: state.wave,
    team: stats,
    resurrectionAvailable: resAvailable,
    commands,
  });
  const usedNow = battle.resurrectionUsed;
  let next: RunState = {
    ...state,
    resurrectionUsed: state.resurrectionUsed || usedNow,
    log: [
      ...state.log,
      { w: state.wave, e: 'battle', r: battle.outcome, why: battle.reason, ticks: battle.durationTicks, h: battleLogHash(battle.events) },
    ],
  };
  if (battle.outcome === 'lose') {
    next = finishRun(next, 'loss');
    return { state: next, events: battle.events };
  }
  const coins = coinsForWin(state.wave, state.config.mode);
  const records = [...state.records, { ...emptyRecord(state.wave), coins }];
  next = { ...next, coins: next.coins + coins, records };
  next = enterCardsOrField(next);
  return { state: next, events: battle.events };
}

function doPick(state: RunState, card: string): StepResult {
  requirePhase(state, 'cards');
  if (!state.offer.includes(card)) throw new RuleError('card.not_offered', `card ${card} is not in the offer`);
  const taken = [...state.taken, { id: card, tier: 0 }];
  const next: RunState = {
    ...state,
    taken,
    phase: 'field',
    offer: [],
    log: [...state.log, { w: state.wave, e: 'pick', card }],
  };
  return { state: next, events: [] };
}

function doReroll(state: RunState): StepResult {
  requirePhase(state, 'cards');
  const cost = rerollCost();
  if (state.balls < cost) throw new RuleError('balls.insufficient', `reroll costs ${cost} balls`);
  const reroll = state.reroll + 1;
  const withRoll: RunState = {
    ...state,
    balls: state.balls - cost,
    reroll,
    records: withSpend(state.records, state.wave, cost),
    log: [...state.log, { w: state.wave, e: 'reroll', r: reroll }],
  };
  const offer = offerNow(withRoll);
  return { state: { ...withRoll, offer }, events: [] };
}

function doUpgrade(state: RunState, card: string): StepResult {
  requirePhase(state, 'cards');
  const idx = state.taken.findIndex((t) => t.id === card);
  if (idx < 0) throw new RuleError('card.not_in_team', `card ${card} is not in the team`);
  const current = state.taken[idx] as TakenCard;
  if (current.tier >= ECONOMY.maxTier) throw new RuleError('card.max_tier', 'card is already at the maximum tier');
  const toTier = current.tier + 1;
  const cost = upgradeCost(toTier);
  if (state.balls < cost) throw new RuleError('balls.insufficient', `upgrade costs ${cost} balls`);
  const taken = state.taken.map((t, i) => (i === idx ? { id: t.id, tier: toTier } : t));
  const next: RunState = {
    ...state,
    balls: state.balls - cost,
    taken,
    records: withSpend(state.records, state.wave, cost),
    log: [...state.log, { w: state.wave, e: 'upgrade', card, tier: toTier }],
  };
  return { state: next, events: [] };
}

function doAutoPick(state: RunState): StepResult {
  requirePhase(state, 'cards');
  const card = state.offer[0];
  if (card === undefined) throw new RuleError('card.no_offer', 'there is no offer');
  const next: RunState = {
    ...state,
    taken: [...state.taken, { id: card, tier: 0 }],
    phase: 'field',
    offer: [],
    log: [...state.log, { e: 'auto_pick', w: state.wave }],
  };
  return { state: next, events: [] };
}

function doDrop(state: RunState, column: number, auto: boolean): StepResult {
  requirePhase(state, 'field');
  if (!Number.isInteger(column) || column < 0 || column >= FIELD.slotCount) {
    throw new RangeError(`column must be 0..${FIELD.slotCount - 1}, got ${column}`);
  }
  const board = generateBoardTrace(state.config.seed, state.wave).board;
  const { path, gate } = dropBall(board, column);
  const gained = ballsForGate(gate);
  const records = state.records.map((r) => ({ ...r }));
  let rec = records.find((r) => r.wave === state.wave);
  if (!rec) {
    rec = emptyRecord(state.wave);
    records.push(rec);
  }
  rec.ballsGained += gained;
  rec.gate = gate;
  rec.column = column;
  const tanim = BATTLE.tminField;
  const tickMs = BATTLE.tickMs;
  const events: FieldEvent[] = [
    { ms: 0, e: 'drop', col: column, auto, path: [...path] },
    { ms: tanim * tickMs, e: 'gate', col: column, gate, balls: gained },
  ];
  let next: RunState = {
    ...state,
    balls: state.balls + gained,
    records,
    log: [...state.log, auto ? { k: 'drop', c: column, auto: true } : { k: 'drop', c: column }],
  };
  if (state.wave >= state.lastWave) {
    next = finishRun(next, 'win');
    return { state: next, events };
  }
  next = { ...next, wave: state.wave + 1, phase: 'battle', offer: [] };
  return { state: next, events };
}

/** Ledger entries for a finished run, in the order of ECO-001 (submit transaction). */
export function ledgerForRun(state: RunState, at: number): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const base = { userId: state.config.userId, runId: state.config.runId, at };
  for (const r of state.records) {
    if (r.coins > 0) {
      entries.push({ ...base, key: LedgerKeys.coin(state.config.runId, r.wave), currency: 'coin', delta: r.coins, reason: 'win_wave' });
    }
    if (r.ballsGained > 0) {
      entries.push({ ...base, key: LedgerKeys.ball(state.config.runId, r.wave), currency: 'ball', delta: r.ballsGained, reason: 'field' });
    }
    if (r.ballsSpent > 0) {
      entries.push({ ...base, key: LedgerKeys.spend(state.config.runId, r.wave), currency: 'ball', delta: -r.ballsSpent, reason: 'spend' });
    }
  }
  if (state.burned > 0) {
    entries.push({ ...base, key: LedgerKeys.burn(state.config.runId), currency: 'ball', delta: -state.burned, reason: 'burn' });
  }
  if (state.resurrectionUsed) {
    entries.push({ ...base, key: LedgerKeys.resurrect(state.config.runId), currency: 'gem', delta: -ECONOMY.resurrectGems, reason: 'resurrect' });
  }
  return entries;
}

/** Card pool size for the current team, used by tests and the client (CARD-001). */
export function poolSize(state: RunState): number {
  return poolFor(state.config.team, state.taken).length;
}
