import { afterEach, describe, expect, it } from 'vitest';
import { call, guestSession, makeHarness, nextKey, startRun, submitRun, submitBody, threeWaveLoss, telegramSession, updateUser, type Harness } from './helpers.ts';

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.app.close();
  harness = undefined;
});

async function openRun(h: Harness, token: string): Promise<string> {
  const started = await startRun(h, token);
  if (started.status !== 200) throw new Error(`start failed: ${started.status} ${JSON.stringify(started.json)}`);
  return started.json.run_id as string;
}

describe('POST /runs/start (API-009, ECO-011)', () => {
  it('returns the run with a seed, energy after the spend and no help card', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const reply = await startRun(harness, session.token);
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      daily: false,
      energy: { e: 4, t: harness.clock.now },
      field_version: 1,
      reserved_gems: 0,
      help_card: null,
      started_at: harness.clock.now,
    });
    expect(reply.json.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(reply.json.day).toBeUndefined();
  });

  it('uses the daily seed and the UTC day for a daily run', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const daily = await call(harness, 'GET', '/seeds/daily', { token: session.token });
    const started = await startRun(harness, session.token, { daily: true });
    expect(started.json).toMatchObject({ daily: true, day: '2026-10-15', seed: daily.json.seed });
  });

  it('rejects a team with a hero that is not open (hero.locked) and a duplicated hero (run.invalid)', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const locked = await startRun(harness, session.token, { team: ['druid', 'archer', 'mage'] });
    expect(locked.status).toBe(422);
    expect(locked.json).toEqual({ code: 'hero.locked' });

    const duplicate = await startRun(harness, session.token, { team: ['knight', 'knight', 'mage'] });
    expect(duplicate.status).toBe(422);
    expect(duplicate.json).toEqual({ code: 'run.invalid' });
  });

  it('requires Idempotency-Key and replays the stored answer for the same key and body', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const noKey = await call(harness, 'POST', '/runs/start', { token: session.token, body: { mode: 'full', speed: 1, team: ['knight', 'archer', 'mage'], daily: false } });
    expect(noKey.status).toBe(400);
    expect(noKey.json.code).toBe('validation.failed');

    const key = nextKey();
    const first = await startRun(harness, session.token, {}, key);
    const replay = await startRun(harness, session.token, {}, key);
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual(first.json);

    const energy = await call(harness, 'GET', '/energy', { token: session.token });
    expect(energy.json.e).toBe(4); // spent once

    const conflict = await startRun(harness, session.token, { speed: 2 }, key);
    expect(conflict.status).toBe(409);
    expect(conflict.json).toEqual({ code: 'idempotency.conflict' });
  });

  it('allows one open run per account (run.active)', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    await openRun(harness, session.token);
    const second = await startRun(harness, session.token);
    expect(second.status).toBe(409);
    expect(second.json).toEqual({ code: 'run.active' });
  });

  it('answers energy.empty when no energy is left and regenerates one unit per 1 200 s', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    for (let i = 0; i < 5; i += 1) {
      const id = await openRun(harness, session.token);
      const done = await submitRun(harness, session.token, submitBody(id));
      expect(done.json.run.state).toBe('verified');
    }
    const empty = await startRun(harness, session.token);
    expect(empty.status).toBe(422);
    expect(empty.json).toEqual({ code: 'energy.empty' });

    const energy = await call(harness, 'GET', '/energy', { token: session.token });
    expect(energy.json).toMatchObject({ e: 0, max: 5, period_s: 1200, next_in_s: 1200 });

    harness.clock.now += 1200;
    const again = await startRun(harness, session.token);
    expect(again.status).toBe(200);
  });

  it('closes a run open for more than 30 min as timeout, keeps that state and allows a new start', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const id = await openRun(harness, session.token);

    harness.clock.now += 30 * 60 + 1;
    const late = await submitRun(harness, session.token, submitBody(id));
    expect(late.status).toBe(409);
    expect(late.json).toEqual({ code: 'run.timeout' });
    // ERR-006: the close is stored although the submit was refused (a throw would roll it back).
    expect((await harness.repo.runs.get(id))?.state).toBe('timeout');
    const again = await submitRun(harness, session.token, submitBody(id));
    expect(again.status).toBe(409);
    expect(again.json).toEqual({ code: 'run.timeout' });

    const next = await startRun(harness, session.token);
    expect(next.status).toBe(200);
  });

  it('the ERR-006 sweep closes started runs older than 30 min, even without a submit', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const id = await openRun(harness, session.token);

    harness.clock.now += 30 * 60;
    expect(await harness.app.closeExpiredRuns()).toBe(0);
    harness.clock.now += 1;
    expect(await harness.app.closeExpiredRuns()).toBe(1);
    expect((await harness.repo.runs.get(id))?.state).toBe('timeout');
    expect(await harness.app.closeExpiredRuns()).toBe(0);
    expect((await startRun(harness, session.token)).status).toBe(200);
  });

  it('reserves 10 gems when the balance covers a resurrection, and does not spend them', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    await harness.repo.ledger.append({ key: 'test:gems', userId: session.userId, currency: 'gem', delta: 10, reason: 'test', runId: null, at: harness.clock.now });
    const started = await startRun(harness, session.token);
    expect(started.json.reserved_gems).toBe(10);
    const balance = await call(harness, 'GET', '/me', { token: session.token });
    expect(balance.json.balances.gem).toBe(10);
  });

  it('grants the help card after three losses at the boss, once per 24 h', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    await updateUser(harness, session.userId, { helpFails: 3 });

    const granted = await startRun(harness, session.token);
    expect(granted.json.help_card).toMatch(/^[a-z]+_[0-9a-z_]+$/);
    expect((await harness.repo.users.findById(session.userId))?.helpFails).toBe(0);

    await submitRun(harness, session.token, submitBody(granted.json.run_id as string));
    await updateUser(harness, session.userId, { helpFails: 3 });
    const cooldown = await startRun(harness, session.token);
    expect(cooldown.json.help_card).toBeNull();
    expect((await harness.repo.users.findById(session.userId))?.helpFails).toBe(3);
  });
});

describe('POST /runs/submit (API-010, SEC-001..SEC-006)', () => {
  it('rejects a log hash mismatch with run.invalid and keeps the run open for a correct retry', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const id = await openRun(harness, session.token);
    const bad = await submitRun(harness, session.token, submitBody(id, { log_sha256: '1'.repeat(64) }));
    expect(bad.status).toBe(422);
    expect(bad.json).toEqual({ code: 'run.invalid' });
    expect((await harness.repo.runs.get(id))?.state).toBe('started');

    const good = await submitRun(harness, session.token, submitBody(id));
    expect(good.json.run.state).toBe('verified');
  });

  it('flags a duration below the minimum and writes no ledger entries', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const id = await openRun(harness, session.token);
    const reply = await submitRun(harness, session.token, threeWaveLoss(id, { duration_ticks: 180 }));
    expect(reply.status).toBe(200);
    expect(reply.json.run).toMatchObject({ state: 'flagged', result: 'loss', last_wave: 3, score: 65 });
    expect(reply.json.verdict_reason).toEqual(['duration_min']);
    expect(reply.json.rewards).toEqual({ coins: 0, gems: 0, balls_burned: 0 });
    expect(await harness.repo.ledger.list(session.userId)).toEqual([]);
  });

  it('flags coins above the wave cap (score_cap) and a score that does not add up (score_mismatch)', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const capped = await submitRun(harness, session.token, threeWaveLoss(await openRun(harness, session.token), {
      waves: [
        { w: 1, coins: 26, balls: 10, spend: 0 },
        { w: 2, coins: 30, balls: 0, spend: 0 },
      ],
      score: 66,
    }));
    expect(capped.json.verdict_reason).toEqual(['score_cap']);

    const mismatch = await submitRun(harness, session.token, submitBody(await openRun(harness, session.token), { score: 5 }));
    expect(mismatch.json.verdict_reason).toEqual(['score_mismatch']);
  });

  it('flags spending more than the balls of earlier waves (spend_over)', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const id = await openRun(harness, session.token);
    const reply = await submitRun(harness, session.token, threeWaveLoss(id, {
      waves: [
        { w: 1, coins: 25, balls: 10, spend: 0 },
        { w: 2, coins: 30, balls: 0, spend: 11 },
      ],
    }));
    expect(reply.json.verdict_reason).toEqual(['spend_over']);
  });

  it('flags a resurrection without the reserve (res_unreserved)', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const id = await openRun(harness, session.token);
    const reply = await submitRun(harness, session.token, submitBody(id, { resurrections: 1 }));
    expect(reply.json.run.state).toBe('flagged');
    expect(reply.json.verdict_reason).toEqual(['res_unreserved']);
  });

  it('writes the settlement of a verified run in one pass and burns the rest of the balls', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const id = await openRun(harness, session.token);
    const reply = await submitRun(harness, session.token, threeWaveLoss(id, {
      waves: [
        { w: 1, coins: 25, balls: 10, spend: 0 },
        { w: 2, coins: 30, balls: 0, spend: 5 },
      ],
      score: 65,
    }));
    expect(reply.json.run.state).toBe('verified');
    expect(reply.json.verdict_reason).toBeUndefined();
    expect(reply.json.rewards).toEqual({ coins: 55, gems: 0, balls_burned: 5 });
    expect(reply.json.balances).toEqual({ coin: 55, gem: 0 });

    const keys = (await harness.repo.ledger.list(session.userId)).map((e) => e.key).sort();
    expect(keys).toEqual([`run:${id}:burn`, `run:${id}:w1:ball`, `run:${id}:w1:coin`, `run:${id}:w2:coin`, `run:${id}:w2:spend`].sort());
    expect(await harness.repo.ledger.balance(session.userId, 'ball')).toBe(0);
  });

  it('flags a reserved resurrection whose live gem balance was spent before the submit (gems_negative)', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    await harness.repo.ledger.append({ key: 'test:gems', userId: session.userId, currency: 'gem', delta: 10, reason: 'test', runId: null, at: harness.clock.now });
    const id = await openRun(harness, session.token);
    await harness.repo.ledger.append({ key: 'test:spend', userId: session.userId, currency: 'gem', delta: -10, reason: 'test', runId: null, at: harness.clock.now });
    const reply = await submitRun(harness, session.token, submitBody(id, { resurrections: 1 }));
    expect(reply.json.run.state).toBe('flagged');
    expect(reply.json.verdict_reason).toEqual(['gems_negative']);
    expect(await harness.repo.ledger.balance(session.userId, 'gem')).toBe(0);
  });

  it('spends exactly 10 gems for a funded resurrection', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    await harness.repo.ledger.append({ key: 'test:gems', userId: session.userId, currency: 'gem', delta: 10, reason: 'test', runId: null, at: harness.clock.now });
    const id = await openRun(harness, session.token);
    const reply = await submitRun(harness, session.token, submitBody(id, { resurrections: 1 }));
    expect(reply.json.run.state).toBe('verified');
    expect(reply.json.balances.gem).toBe(0);
    expect((await harness.repo.ledger.list(session.userId)).find((e) => e.key === `run:${id}:res`)?.delta).toBe(-10);
  });

  it('accepts an abandon in the card step and in the field step after a battle win (ОВ-2, SEC-001)', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const cardStepId = await openRun(harness, session.token);
    const cardStep = await submitRun(harness, session.token, submitBody(cardStepId, {
      result: 'abandon',
      last_wave: 1,
      waves: [{ w: 1, coins: 25, balls: 0, spend: 0 }],
      score: 25,
      duration_ticks: 500,
    }));
    expect(cardStep.status).toBe(200);
    expect(cardStep.json.run).toMatchObject({ state: 'verified', result: 'abandon', last_wave: 1 });
    expect(cardStep.json.rewards).toEqual({ coins: 25, gems: 0, balls_burned: 0 });

    const fieldStepId = await openRun(harness, session.token);
    const fieldStep = await submitRun(harness, session.token, submitBody(fieldStepId, {
      result: 'abandon',
      last_wave: 2,
      waves: [
        { w: 1, coins: 25, balls: 10, spend: 0 },
        { w: 2, coins: 30, balls: 0, spend: 0 },
      ],
      gates: { x0: 0, x1: 1, x2: 0, x3: 0, x5: 0 },
      score: 65,
      duration_ticks: 1000,
    }));
    expect(fieldStep.json.run).toMatchObject({ state: 'verified', result: 'abandon', last_wave: 2 });
    expect(fieldStep.json.rewards).toEqual({ coins: 55, gems: 0, balls_burned: 10 });
  });

  it('accepts an abandon in the battle step of wave 2, after the drop of wave 1', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const id = await openRun(harness, session.token);
    const reply = await submitRun(harness, session.token, submitBody(id, {
      result: 'abandon',
      last_wave: 2,
      waves: [{ w: 1, coins: 25, balls: 10, spend: 0 }],
      gates: { x0: 0, x1: 1, x2: 0, x3: 0, x5: 0 },
      score: 35,
      duration_ticks: 1000,
    }));
    expect(reply.json.run.state).toBe('verified');
  });

  it('rejects an abandon that lists more waves than its drops allow with run.invalid and keeps the run open', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const id = await openRun(harness, session.token);
    const bad = await submitRun(harness, session.token, submitBody(id, {
      result: 'abandon',
      last_wave: 1,
      waves: [
        { w: 1, coins: 25, balls: 0, spend: 0 },
        { w: 2, coins: 30, balls: 0, spend: 0 },
      ],
      score: 55,
      duration_ticks: 500,
    }));
    expect(bad.status).toBe(422);
    expect(bad.json).toEqual({ code: 'run.invalid' });
    expect((await harness.repo.runs.get(id))?.state).toBe('started');
  });

  it('answers run.already_submitted to a second submit of the same run, and replays the same key', async () => {
    harness = await makeHarness();
    const session = await guestSession(harness);
    const id = await openRun(harness, session.token);
    const key = nextKey();
    const first = await submitRun(harness, session.token, submitBody(id), key);
    const replay = await submitRun(harness, session.token, submitBody(id), key);
    expect(replay.json).toEqual(first.json);

    const second = await submitRun(harness, session.token, submitBody(id));
    expect(second.status).toBe(409);
    expect(second.json).toEqual({ code: 'run.already_submitted' });
  });

  it('answers run.not_found for another account run', async () => {
    harness = await makeHarness();
    const owner = await guestSession(harness);
    const other = await guestSession(harness);
    const id = await openRun(harness, owner.token);
    const reply = await submitRun(harness, other.token, submitBody(id));
    expect(reply.status).toBe(404);
    expect(reply.json).toEqual({ code: 'run.not_found' });
  });

  it('puts a verified win into the weekly board only when it is better', async () => {
    harness = await makeHarness();
    const session = await telegramSession(harness, 501);

    const wave2 = await openRun(harness, session.token);
    await submitRun(harness, session.token, threeWaveLoss(wave2, {
      last_wave: 2,
      waves: [{ w: 1, coins: 25, balls: 0, spend: 0 }],
      gates: { x0: 1, x1: 0, x2: 0, x3: 0, x5: 0 },
      score: 25,
      duration_ticks: 500,
    }));
    const first = await call(harness, 'GET', '/board/weekly', { token: session.token });
    expect(first.json.me).toEqual({ rank: 1, wave: 2, score: 25 });

    const wave1 = await openRun(harness, session.token);
    await submitRun(harness, session.token, submitBody(wave1));
    const after = await call(harness, 'GET', '/board/weekly', { token: session.token });
    expect(after.json.me).toEqual({ rank: 1, wave: 2, score: 25 });
    expect(after.json.entries).toHaveLength(1);
  });
});
