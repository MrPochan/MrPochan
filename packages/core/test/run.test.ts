import { describe, expect, it } from 'vitest';
import { applyAction, startRun, ledgerForRun, type RunConfig, type RunState, type RunAction } from '../src/run.ts';
import { poolFor, offerFor, helpCard, heroStatsFor, drawOffer, type TakenCard } from '../src/cards.ts';
import { ballsForGate, balanceOf } from '../src/economy.ts';
import { generateBoard, dropBall } from '../src/board.ts';
import { kdf, Xoshiro128ss, SEED_BYTES } from '../src/prng.ts';
import { sha256, utf8, fromHex } from '../src/sha256.ts';
import { RuleError } from '../src/errors.ts';
import { BATTLE, CARDS, FIELD, type HeroId } from '../src/config.ts';

const S = fromHex('00112233445566778899aabbccddeeff');
const TEAM: HeroId[] = ['knight', 'archer', 'mage'];

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return { runId: 'run-1', userId: 'user-1', seed: S, team: TEAM, ...overrides };
}

/** Plays a battle and returns the state at the card or field step. */
function winBattle(state: RunState): RunState {
  return applyAction(state, { k: 'battle' }).state;
}

/** Automatic policy: take offer[0] when offered, drop from column 0. Returns the finished state. */
function autoRun(cfg: RunConfig): RunState {
  let state = startRun(cfg);
  let guard = 0;
  while (state.phase !== 'finished') {
    if (++guard > 100) throw new Error('run did not finish');
    if (state.phase === 'battle') state = winBattle(state);
    else if (state.phase === 'cards') state = applyAction(state, { k: 'auto_pick' }).state;
    else if (state.phase === 'field') state = applyAction(state, { k: 'drop', c: 0, auto: true }).state;
  }
  return state;
}

describe('card pool and offers (CARD-001, CARD-002)', () => {
  it('the pool has 24 cards for any team: 6 per team hero and 6 common', () => {
    expect(CARDS.length).toBe(30);
    for (const team of [['knight', 'archer', 'mage'], ['knight', 'archer', 'druid'], ['knight', 'mage', 'druid'], ['archer', 'mage', 'druid']] as HeroId[][]) {
      const pool = poolFor(team, []);
      expect(pool.length).toBe(24);
      expect(pool.every((c) => c.hero === 'common' || team.includes(c.hero as HeroId))).toBe(true);
      const ids = pool.map((c) => c.id);
      expect(ids).toEqual([...ids].sort());
    }
  });

  it('druid cards are absent when the druid is not in the team', () => {
    const pool = poolFor(['knight', 'archer', 'mage'], []);
    expect(pool.some((c) => c.hero === 'druid')).toBe(false);
  });

  it('an offer has three different cards, is repeatable, and excludes cards already in the team', () => {
    const taken: TakenCard[] = [{ id: 'common_01', tier: 0 }];
    const a = offerFor(S, 4, 0, TEAM, taken);
    const b = offerFor(S, 4, 0, TEAM, taken);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    expect(a).not.toContain('common_01');
  });

  it('for 10 000 random S every offer has three different cards (acceptance 4.2)', () => {
    const root = sha256(utf8('cupquest-test-cards-v1'));
    for (let k = 0; k < 10000; k++) {
      const seed = sha256(new Uint8Array([...root, (k >>> 8) & 0xff, k & 0xff])).slice(0, SEED_BYTES);
      const w = 1 + (k % 14);
      const offer = offerFor(seed, w, k % 3, TEAM, []);
      expect(offer.length).toBe(3);
      expect(new Set(offer).size).toBe(3);
    }
  });

  it('with fewer than three cards the whole pool is offered in id order without PRNG use', () => {
    const throwing = () => {
      throw new Error('rng must not be used');
    };
    const pool = ['common_01', 'common_02'];
    expect(drawOffer(pool, throwing)).toEqual(pool);
    expect(drawOffer([], throwing)).toEqual([]);
  });

  it('draws with the partial Fisher-Yates of CARD-002 (j = i + bounded(n - i))', () => {
    const seq = [0, 1, 0];
    let k = 0;
    const rng = (n: number) => {
      const v = seq[k++] as number;
      expect(n).toBeGreaterThan(v - 1);
      return v;
    };
    // n = 4: i=0 j=0; i=1 j=2; i=2 j=2 -> pool [a,b,c,d] becomes [a,c,b,d]; offer = [a,c,b].
    expect(drawOffer(['a', 'b', 'c', 'd'], rng)).toEqual(['a', 'c', 'b']);
  });

  it('the help card is the first card of the help stream and is repeatable', () => {
    const a = helpCard(S, TEAM);
    expect(a).not.toBeNull();
    expect(helpCard(S, TEAM)).toBe(a);
  });
});

describe('hero stats (ECO-004 level bonus, CARD-006 modifiers)', () => {
  it('base stats with no level and no cards equal battle.json', () => {
    const stats = heroStatsFor(TEAM, {}, []);
    for (const s of stats) {
      expect(s.hp).toBe(BATTLE.heroes[s.id].hp);
      expect(s.dmg).toBe(BATTLE.heroes[s.id].dmg);
      expect(s.period).toBe(BATTLE.heroes[s.id].period);
    }
  });

  it('a level 3 hero has +10 % hp and damage with integer floor', () => {
    const [k] = heroStatsFor(['knight'], { knight: 3 }, []);
    expect(k?.hp).toBe(Math.floor((BATTLE.heroes.knight.hp * 110) / 100));
    expect(k?.dmg).toBe(Math.floor((BATTLE.heroes.knight.dmg * 110) / 100));
  });

  it('a common card applies to every team hero, a hero card only to its hero', () => {
    const common = CARDS.find((c) => c.hero === 'common' && c.stat === 'hp')!;
    const knightCard = CARDS.find((c) => c.hero === 'knight' && c.stat === 'dmg')!;
    const stats = heroStatsFor(TEAM, {}, [
      { id: common.id, tier: 0 },
      { id: knightCard.id, tier: 3 },
    ]);
    const byId = new Map(stats.map((s) => [s.id, s]));
    expect(byId.get('archer')?.hp).toBe(Math.floor((BATTLE.heroes.archer.hp * (100 + (common.tiers[0] as number))) / 100));
    const knightDmg = Math.floor((BATTLE.heroes.knight.dmg * (100 + (knightCard.tiers[3] as number))) / 100);
    expect(byId.get('knight')?.dmg).toBe(knightDmg);
    expect(byId.get('archer')?.dmg).toBe(BATTLE.heroes.archer.dmg);
  });
});

describe('run flow (CORE-001, CORE-012, CORE-013, CARD-003, ECO-006, ECO-008)', () => {
  it('a full run with the automatic policy ends in a win with 1 500 coins and no balls left', () => {
    const state = autoRun(config());
    expect(state.result).toBe('win');
    expect(state.coins).toBe(1500);
    expect(state.balls).toBe(0);
    expect(state.burned).toBeGreaterThanOrEqual(0);
  });

  it('the ledger of a finished run sums to zero balls (earned, spent and burned)', () => {
    const state = autoRun(config());
    const entries = ledgerForRun(state, 1);
    expect(balanceOf(entries, 'user-1', 'ball')).toBe(0);
    expect(balanceOf(entries, 'user-1', 'coin')).toBe(1500);
    expect(entries.some((e) => e.key === 'run:run-1:res')).toBe(false);
  });

  it('short5 ends after the drop of wave 5 and pays 175 coins', () => {
    const state = autoRun(config({ mode: 'short5' }));
    expect(state.result).toBe('win');
    expect(state.coins).toBe(175);
    expect(state.wave).toBe(5);
  });

  it('a run is deterministic: the same config and actions give the same state and log', () => {
    const a = autoRun(config());
    const b = autoRun(config());
    expect(a.log).toEqual(b.log);
    expect(a.coins).toBe(b.coins);
    expect(a.balls).toBe(b.balls);
  });

  it('the field gain matches the gate of the chosen column (CORE-013, GEN-014)', () => {
    let state = startRun(config());
    state = winBattle(state);
    state = applyAction(state, { k: 'auto_pick' }).state;
    const board = generateBoard(S, 1);
    const { gate } = dropBall(board, 2);
    const res = applyAction(state, { k: 'drop', c: 2 });
    expect(res.state.balls).toBe(ballsForGate(gate));
    const gateEvent = res.events.find((e) => 'e' in e && e.e === 'gate');
    expect(gateEvent && 'gate' in gateEvent && gateEvent.gate).toBe(gate);
    const drop = res.events.find((e) => 'e' in e && e.e === 'drop');
    expect(drop && 'path' in drop && drop.path.length).toBe(9);
  });

  it('reroll costs 5 balls and needs them (balls.insufficient); the reroll changes the offer counter', () => {
    let state = startRun(config());
    state = winBattle(state);
    state = applyAction(state, { k: 'auto_pick' }).state;
    // Wave 1 has no balls, so the reroll must fail.
    try {
      applyAction(startRunAtCards(), { k: 'reroll' });
      throw new Error('expected balls.insufficient');
    } catch (err) {
      expect((err as RuleError).code).toBe('balls.insufficient');
    }
    // Wave 2: pick the first card of wave 1, then drop a gate with at least 10 balls where possible.
    const lucky = findColumnWithBalls(state, 10);
    expect(lucky).not.toBeNull();
    state = applyAction(state, { k: 'drop', c: lucky as number }).state;
    state = winBattle(state);
    expect(state.phase).toBe('cards');
    const before = state.balls;
    const after = applyAction(state, { k: 'reroll' }).state;
    expect(after.balls).toBe(before - 5);
    expect(after.reroll).toBe(1);
    expect(after.phase).toBe('cards');
  });

  it('a card must be in the offer to be picked (card.not_offered)', () => {
    const state = winBattle(startRun(config()));
    expect(state.phase).toBe('cards');
    expect(() => applyAction(state, { k: 'pick', card: 'not_a_card' })).toThrow(RuleError);
  });

  it('resurrection is reserved but unused on a clean run: no res entry in the ledger', () => {
    const state = autoRun(config({ resurrectionReserved: true }));
    expect(state.resurrectionUsed).toBe(false);
    expect(ledgerForRun(state, 1).some((e) => e.currency === 'gem')).toBe(false);
  });

  it('a used resurrection creates the gem entry of -10 (CORE-026)', () => {
    const state = autoRun(config({ resurrectionReserved: true }));
    const used = { ...state, resurrectionUsed: true };
    const gem = ledgerForRun(used, 1).find((e) => e.currency === 'gem');
    expect(gem?.delta).toBe(-10);
    expect(gem?.key).toBe('run:run-1:res');
  });

  it('abandon burns the balls of the run (ECO-008)', () => {
    let state = startRun(config());
    state = winBattle(state);
    state = applyAction(state, { k: 'auto_pick' }).state;
    state = applyAction(state, { k: 'drop', c: 4 }).state;
    const balls = state.balls;
    const ended = applyAction(state, { k: 'end', result: 'abandon' }).state;
    expect(ended.result).toBe('abandon');
    expect(ended.balls).toBe(0);
    expect(ended.burned).toBe(balls);
  });

  it('a run with help card starts with the given card and rejects a card outside the team', () => {
    const card = CARDS.find((c) => c.hero === 'common')!;
    const state = startRun(config({ initialCards: [{ id: card.id, tier: 3 }] }));
    expect(state.taken).toEqual([{ id: card.id, tier: 3 }]);
    const druid = CARDS.find((c) => c.hero === 'druid')!;
    expect(() => startRun(config({ initialCards: [{ id: druid.id, tier: 0 }] }))).toThrow(RuleError);
  });

  it('rejects a team with a duplicate or unknown hero and a seed of the wrong size', () => {
    expect(() => startRun(config({ team: ['knight', 'knight', 'mage'] }))).toThrow(RuleError);
    expect(() => startRun(config({ seed: new Uint8Array(15) }))).toThrow(RangeError);
  });

  it('a finished run accepts no more actions', () => {
    const state = applyAction(startRun(config()), { k: 'end', result: 'timeout' }).state;
    expect(() => applyAction(state, { k: 'battle' } as RunAction)).toThrow(/finished/);
  });
});

describe('random action sequences (acceptance 4.2, ECO-007)', () => {
  it('10 000 sequences never make the ball balance negative and end with zero balls', () => {
    const SIM = sha256(utf8('cupquest-sim-v1')).slice(0, SEED_BYTES);
    let steps = 0;
    for (let k = 0; k < 10000; k++) {
      const sk = kdf(SIM, 'sim', 0, k);
      const rng = new Xoshiro128ss(kdf(sk, 'test', 0, 0));
      let state = startRun(config({ seed: sk }));
      let guard = 0;
      while (state.phase !== 'finished' && guard++ < 500) {
        steps++;
        if (state.phase === 'battle') {
          state = winBattle(state);
        } else if (state.phase === 'cards') {
          const r = rng.bounded(3);
          const pick = rng.bounded(3);
          let action: RunAction;
          if (r === 0) action = { k: 'reroll' };
          else if (r === 1 && state.taken.length > 0) action = { k: 'upgrade', card: state.taken[rng.bounded(state.taken.length)]!.id };
          else action = { k: 'pick', card: state.offer[pick] ?? state.offer[0]! };
          try {
            state = applyAction(state, action).state;
          } catch (err) {
            expect((err as RuleError).code).toMatch(/balls\.insufficient|card\.max_tier|card\.not_offered|card\.not_in_team/);
            state = applyAction(state, { k: 'auto_pick' }).state;
          }
        } else {
          state = applyAction(state, { k: 'drop', c: rng.bounded(5) }).state;
        }
        expect(state.balls).toBeGreaterThanOrEqual(0);
      }
      expect(state.phase).toBe('finished');
      expect(state.balls).toBe(0);
    }
    expect(steps).toBeGreaterThan(10000);
  }, 120000);
});

describe('wave records by step (SEC-001 abandon rule, ОВ-2)', () => {
  // The server accepts an abandon with as many wave records as drops, or one more. This pins the core side of that rule.
  it('lists the current wave with coins and no gate in the card and field steps, and one gate per finished wave in the battle step', () => {
    let state = startRunAtCards();
    expect(['cards', 'field']).toContain(state.phase);
    expect(state.records.map((r) => r.wave)).toEqual([1]);
    expect(state.records.filter((r) => r.gate !== null)).toEqual([]);

    if (state.phase === 'cards') state = applyAction(state, { k: 'auto_pick' }).state;
    state = applyAction(state, { k: 'drop', c: 0 }).state;
    expect(state.wave).toBe(2);
    expect(state.phase).toBe('battle');
    expect(state.records.filter((r) => r.gate !== null).length).toBe(1);
  });
});

/** Starts a run and plays wave 1 up to the card step. */
function startRunAtCards(): RunState {
  return winBattle(startRun(config()));
}

/** Column whose gate gives at least `minBalls` for the current field of the state's wave. */
function findColumnWithBalls(state: RunState, minBalls: number): number | null {
  const board = generateBoard(state.config.seed, state.wave);
  for (let c = 0; c < FIELD.slotCount; c++) {
    if (ballsForGate(dropBall(board, c).gate) >= minBalls) return c;
  }
  return null;
}
