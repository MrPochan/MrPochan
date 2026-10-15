// Business flows of the API: login, profile, energy, runs, weekly board, shop.
// Every write runs inside a repository transaction. Game rules come from @cupquest/core;
// submit checks come from validation.ts (ТЗ 5.5).

import { randomInt, randomUUID } from 'node:crypto';
import {
  ECONOMY_VIEW,
  energyRead,
  energySpendOne,
  fromHex,
  helpCard,
  HERO_ID_ORDER,
} from '@cupquest/core';
import { isHeroId, type GuestLoginBody, type HeroId, type StartRunBody, type SubmitRunBody, type TelegramLoginBody } from './contract.ts';
import { verifyInitData, hashDeviceToken, hashInstallId, issueDeviceToken } from './auth.ts';
import {
  BOARD_LIMIT,
  FEATURES,
  FIELD_VERSION,
  HELP_COOLDOWN_S,
  HELP_FAILS_THRESHOLD,
  PACKS,
  PAYMENTS_FLAG,
  PAYMENTS_IMPLEMENTED,
  RESURRECT_GEMS,
  RUN_TIMEOUT_S,
  STARTER_HEROES,
} from './catalog.ts';
import { compareBoardRows, isBetterResult } from './board.ts';
import { utcDay, isoWeek } from './calendar.ts';
import { ApiError, ERROR_STATUS } from './errors.ts';
import type { FriendsProvider } from './friends.ts';
import { runIdempotent, type StoredReply } from './idempotency.ts';
import { settleRun } from './settlement.ts';
import { dailySeedFor, newSeedHex, type RandomSource } from './seed.ts';
import type { Repository, UserRecord } from './store/repository.ts';
import {
  assertStructure,
  FULL_LAST_WAVE,
  verdictReasons,
  type RunReport,
  type VerdictReason,
} from './validation.ts';

export interface ServiceDeps {
  readonly repo: Repository;
  /** Null disables Telegram auth (development without BOT_TOKEN). */
  readonly botToken: string | null;
  /** Current unix time in seconds. */
  readonly clock: () => number;
  readonly random: RandomSource;
  readonly friends: FriendsProvider;
}

const REFERRAL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REFERRAL_LENGTH = 8;

export interface PublicUser {
  readonly id: string;
  readonly is_guest: boolean;
  readonly referral_code: string;
  readonly display_name?: string;
}

export function publicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    is_guest: user.isGuest,
    referral_code: user.referralCode,
    ...(user.displayName !== null ? { display_name: user.displayName } : {}),
  };
}

export class GameService {
  constructor(private readonly deps: ServiceDeps) {}

  private get repo(): Repository {
    return this.deps.repo;
  }

  /** API-001: Telegram Mini App login. Re-entry issues a new token and revokes the previous one (AUTH-002). */
  async telegramLogin(body: TelegramLoginBody): Promise<{ deviceToken: string; created: boolean; user: PublicUser }> {
    if (this.deps.botToken === null) {
      throw new ApiError('auth.invalid', 'Telegram auth is disabled: BOT_TOKEN is not set');
    }
    const now = this.deps.clock();
    const verified = verifyInitData(body.init_data, this.deps.botToken, now);
    const deviceHash = hashInstallId(body.install_id);
    return this.repo.transaction(async (tx) => {
      let user = await tx.users.findByTelegramId(verified.telegramId);
      const created = user === null;
      if (user === null) user = await this.createUser(tx, { telegramId: verified.telegramId, isGuest: false }, now);
      await tx.devices.revokeTelegramByDeviceHash(deviceHash, now);
      const deviceToken = issueDeviceToken();
      await tx.devices.insert({
        tokenHash: hashDeviceToken(deviceToken),
        userId: user.id,
        kind: 'telegram',
        deviceHash,
        createdAt: now,
        revokedAt: null,
      });
      return { deviceToken, created, user: publicUser(user) };
    });
  }

  /** API-002: guest account and a `web` token. */
  async guestLogin(body: GuestLoginBody): Promise<{ deviceToken: string; user: PublicUser }> {
    const now = this.deps.clock();
    const deviceHash = hashInstallId(body.install_id);
    return this.repo.transaction(async (tx) => {
      const user = await this.createUser(tx, { telegramId: null, isGuest: true }, now);
      const deviceToken = issueDeviceToken();
      await tx.devices.insert({
        tokenHash: hashDeviceToken(deviceToken),
        userId: user.id,
        kind: 'web',
        deviceHash,
        createdAt: now,
        revokedAt: null,
      });
      return { deviceToken, user: publicUser(user) };
    });
  }

  /** Resolves a bearer token to its account; unknown or revoked tokens are `auth.invalid`. */
  async authenticate(token: string): Promise<UserRecord> {
    const device = await this.repo.devices.findByTokenHash(hashDeviceToken(token));
    if (device === null || device.revokedAt !== null) throw new ApiError('auth.invalid', 'unknown or revoked token');
    const user = await this.repo.users.findById(device.userId);
    if (user === null || user.deletedAt !== null) throw new ApiError('auth.invalid', 'account is deleted');
    return user;
  }

  /**
   * API-006: profile and balances. Quests, streak and the starter pack are not in this iteration,
   * so they return their empty values.
   */
  async profile(user: UserRecord): Promise<Record<string, unknown>> {
    const heroes = (await this.repo.heroes.list(user.id))
      .sort((a, b) => HERO_ID_ORDER.indexOf(a.heroId) - HERO_ID_ORDER.indexOf(b.heroId))
      .map((hero) => ({ id: hero.heroId, level: hero.level }));
    return {
      user: publicUser(user),
      balances: await this.balances(this.repo, user.id),
      heroes,
      quests: [],
      streak: { day_no: 1, claimed_today: false },
      starter_bought: false,
    };
  }

  /** API-007: energy with the regeneration timer (ECO-011, ECO-012). */
  async energy(userId: string): Promise<Record<string, unknown>> {
    const now = this.deps.clock();
    const record = await energyOf(this.repo, userId, now);
    const read = energyRead({ e: record.e, t: record.t }, now);
    const max = ECONOMY_VIEW.energyMax;
    return {
      e: read.e,
      max,
      period_s: ECONOMY_VIEW.energyPeriodS,
      next_in_s: read.e >= max ? null : read.t + ECONOMY_VIEW.energyPeriodS - now,
      server_time: now,
    };
  }

  /** API-008: the daily seed of the current UTC day (RNG-006). */
  async dailySeed(): Promise<{ day: string; seed: string; field_version: number }> {
    const day = utcDay(this.deps.clock());
    const seed = await dailySeedFor(this.repo, day, this.deps.random);
    return { day, seed, field_version: FIELD_VERSION };
  }

  /** API-009: starts a run. Spends one energy, reserves gems for a resurrection, may grant a help card. */
  async startRun(userId: string, body: StartRunBody, key: string): Promise<StoredReply> {
    const now = this.deps.clock();
    return runIdempotent(this.repo, { userId, key, endpoint: 'POST /runs/start', body, now }, async (tx) => {
      const user = await tx.users.findById(userId);
      if (user === null) throw new ApiError('auth.invalid', 'account does not exist');

      // One open run per account (DB-007). An open run older than 30 min is closed as timeout (ERR-006).
      const open = await tx.runs.findStarted(userId);
      if (open !== null) {
        if (now - open.startedAt <= RUN_TIMEOUT_S) throw new ApiError('run.active', 'a run is already open');
        await tx.runs.update({ ...open, state: 'timeout', result: 'timeout' });
      }

      if (new Set(body.team).size !== body.team.length) {
        throw new ApiError('run.invalid', 'team must list three different heroes');
      }
      const team = body.team.map(toHeroId);
      const opened = new Set((await tx.heroes.list(userId)).map((hero) => hero.heroId));
      if (team.some((heroId) => !opened.has(heroId))) throw new ApiError('hero.locked', 'a team hero is not open');

      // ECO-011: energy is spent in the same transaction. Core throws energy.empty when none is left.
      const energy = await energyOf(tx, userId, now);
      const spent = energySpendOne({ e: energy.e, t: energy.t }, now);
      await tx.energy.put({ userId, e: spent.e, t: spent.t, updatedAt: now });

      const day = body.daily ? utcDay(now) : null;
      const seed = day === null ? newSeedHex(this.deps.random) : await dailySeedFor(tx, day, this.deps.random);

      // CORE-026: the reserve is taken only when the balance covers it. Reserving does not spend gems.
      const gems = await tx.ledger.balance(userId, 'gem');
      const reservedGems = gems >= RESURRECT_GEMS ? RESURRECT_GEMS : 0;

      const helpCardId = await grantHelpCard(tx, user, seed, team, now);

      const runId = randomUUID();
      await tx.runs.insert({
        id: runId,
        userId,
        seed,
        daily: body.daily,
        day,
        mode: body.mode,
        speed: body.speed,
        team: body.team,
        fieldVersion: FIELD_VERSION,
        reservedGems,
        state: 'started',
        result: null,
        lastWave: null,
        score: null,
        durationTicks: null,
        gates: null,
        resurrections: 0,
        cards: null,
        logSha256: null,
        verdictReason: [],
        startedAt: now,
        submittedAt: null,
      });

      return {
        status: 200,
        body: {
          run_id: runId,
          seed,
          daily: body.daily,
          ...(day !== null ? { day } : {}),
          energy: { e: spent.e, t: spent.t },
          field_version: FIELD_VERSION,
          reserved_gems: reservedGems,
          help_card: helpCardId,
          started_at: now,
        },
      };
    });
  }

  /**
   * API-010: submits a run. Structural errors are rejected with run.invalid and change nothing.
   * Suspicious values make the run `flagged`: nothing is credited, and no error is returned (SEC-006).
   */
  async submitRun(userId: string, body: SubmitRunBody, key: string): Promise<StoredReply> {
    const now = this.deps.clock();
    return runIdempotent(this.repo, { userId, key, endpoint: 'POST /runs/submit', body, now }, async (tx) => {
      const run = await tx.runs.get(body.run_id);
      if (run === null || run.userId !== userId) throw new ApiError('run.not_found', 'no such run');

      // ERR-006, SEC-001: a run not submitted within RUN_TIMEOUT_S of its start is closed as timeout.
      // The close is stored and the late submit is answered with 409 without throwing: a throw would roll the close back.
      if (run.state === 'timeout' || (run.state === 'started' && now - run.startedAt > RUN_TIMEOUT_S)) {
        if (run.state === 'started') await tx.runs.update({ ...run, state: 'timeout', result: 'timeout' });
        return { status: ERROR_STATUS['run.timeout'], body: { code: 'run.timeout' } };
      }
      if (run.state !== 'started') throw new ApiError('run.already_submitted', 'the run is already closed');

      const user = await tx.users.findById(userId);
      if (user === null) throw new ApiError('auth.invalid', 'account does not exist');

      const report: RunReport = {
        mode: run.mode,
        result: body.result,
        lastWave: body.last_wave,
        waves: body.waves,
        gates: body.gates,
        score: body.score,
        durationTicks: body.duration_ticks,
        resurrections: body.resurrections,
        reservedGems: run.reservedGems,
        gemBalance: await tx.ledger.balance(userId, 'gem'),
        cards: body.cards.map((card) => ({ cardId: card.card_id, tier: card.tier })),
        log: body.log,
        logSha256: body.log_sha256,
      };
      assertStructure(report);

      const reasons: VerdictReason[] = verdictReasons(report);
      const verified = reasons.length === 0;

      let rewards = { coins: 0, gems: 0, balls_burned: 0 };
      if (verified) {
        const settlement = settleRun({
          runId: run.id,
          userId,
          at: now,
          waves: body.waves,
          resurrected: body.resurrections === 1,
        });
        for (const entry of settlement.entries) await tx.ledger.append(entry);
        rewards = { coins: settlement.coins, gems: 0, balls_burned: settlement.burnedBalls };
        await recordWeeklyBest(tx, userId, body.last_wave, body.score, now);
        await updateHelpCounter(tx, user, body.result, body.last_wave);
      }

      await tx.runLogs.put(run.id, body.log);
      await tx.runs.update({
        ...run,
        state: verified ? 'verified' : 'flagged',
        result: body.result,
        lastWave: body.last_wave,
        score: body.score,
        durationTicks: body.duration_ticks,
        gates: body.gates,
        resurrections: body.resurrections,
        cards: body.cards,
        logSha256: body.log_sha256.toLowerCase(),
        verdictReason: reasons,
        submittedAt: now,
      });

      return {
        status: 200,
        body: {
          run: {
            id: run.id,
            state: verified ? 'verified' : 'flagged',
            result: body.result,
            last_wave: body.last_wave,
            score: body.score,
          },
          ...(verified ? {} : { verdict_reason: reasons }),
          rewards,
          balances: await this.balances(tx, userId),
        },
      };
    });
  }

  /**
   * ERR-006: closes every started run older than RUN_TIMEOUT_S as `timeout` (energy is not returned, ERR-005).
   * Called by the periodic sweep of the server and by tests. Returns how many runs were closed.
   */
  async closeExpiredRuns(): Promise<number> {
    const now = this.deps.clock();
    return this.repo.transaction(async (tx) => {
      const expired = await tx.runs.findStartedBefore(now - RUN_TIMEOUT_S);
      for (const run of expired) await tx.runs.update({ ...run, state: 'timeout', result: 'timeout' });
      return expired.length;
    });
  }

  /** API-016: the current ISO week, only the player and friends (DB-013). */
  async weeklyBoard(userId: string): Promise<Record<string, unknown>> {
    const now = this.deps.clock();
    const week = isoWeek(now);
    const friends = await this.deps.friends.friendIds(userId);
    const ids = [...new Set([userId, ...friends])];
    const rows = (await this.repo.weeklyBest.forUsers(week, ids)).sort(compareBoardRows);

    const entries: Array<{ rank: number; name: string; wave: number; score: number; is_me: boolean }> = [];
    for (const [index, row] of rows.slice(0, BOARD_LIMIT).entries()) {
      const owner = await this.repo.users.findById(row.userId);
      entries.push({
        rank: index + 1,
        name: owner?.displayName ?? 'Игрок',
        wave: row.wave,
        score: row.score,
        is_me: row.userId === userId,
      });
    }

    let me: { rank: number; wave: number; score: number } | null = null;
    for (const [index, row] of rows.entries()) {
      if (row.userId === userId) me = { rank: index + 1, wave: row.wave, score: row.score };
    }
    return { week, entries, me };
  }

  /** Whether payments can be offered. Both the kill switch and the implementation must allow it. */
  async paymentsEnabled(): Promise<boolean> {
    if (!PAYMENTS_IMPLEMENTED) return false;
    return (await this.repo.flags.get(PAYMENTS_FLAG)) === true;
  }

  /** Feature flags and packs for API-005 and the shop. */
  async config(minClientVersion: string): Promise<Record<string, unknown>> {
    return {
      min_client_version: minClientVersion,
      server_time: this.deps.clock(),
      flags: { payments_enabled: await this.paymentsEnabled(), features: FEATURES },
      packs: PACKS,
    };
  }

  async shop(): Promise<{ payments_enabled: boolean; packs: typeof PACKS }> {
    return { payments_enabled: await this.paymentsEnabled(), packs: PACKS };
  }

  private async balances(repo: Repository, userId: string): Promise<{ coin: number; gem: number }> {
    return {
      coin: await repo.ledger.balance(userId, 'coin'),
      gem: await repo.ledger.balance(userId, 'gem'),
    };
  }

  private async createUser(
    tx: Repository,
    fields: { readonly telegramId: number | null; readonly isGuest: boolean },
    now: number,
  ): Promise<UserRecord> {
    const user: UserRecord = {
      id: randomUUID(),
      telegramId: fields.telegramId,
      isGuest: fields.isGuest,
      referralCode: await freshReferralCode(tx),
      displayName: null,
      helpFails: 0,
      helpGrantedAt: null,
      deletedAt: null,
      createdAt: now,
    };
    await tx.users.insert(user);
    await tx.energy.put({ userId: user.id, e: ECONOMY_VIEW.energyMax, t: now, updatedAt: now });
    for (const heroId of STARTER_HEROES) {
      await tx.heroes.insert({ userId: user.id, heroId: toHeroId(heroId), level: 1, openedAt: now });
    }
    return user;
  }
}

async function energyOf(repo: Repository, userId: string, now: number): Promise<{ e: number; t: number }> {
  const row = await repo.energy.get(userId);
  return row ?? { e: ECONOMY_VIEW.energyMax, t: now };
}

async function freshReferralCode(tx: Repository): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let code = '';
    for (let i = 0; i < REFERRAL_LENGTH; i += 1) {
      code += REFERRAL_ALPHABET.charAt(randomInt(REFERRAL_ALPHABET.length));
    }
    if ((await tx.users.findByReferralCode(code)) === null) return code;
  }
  throw new ApiError('server.error', 'could not allocate a referral code');
}

/** CARD-007: after three losses at the boss, the next start gets the help card, at most once per 24 h. */
async function grantHelpCard(
  tx: Repository,
  user: UserRecord,
  seed: string,
  team: readonly HeroId[],
  now: number,
): Promise<string | null> {
  if (user.helpFails < HELP_FAILS_THRESHOLD) return null;
  if (user.helpGrantedAt !== null && now - user.helpGrantedAt < HELP_COOLDOWN_S) return null;
  const card = helpCard(fromHex(seed), team);
  if (card === null) return null;
  await tx.users.update({ ...user, helpFails: 0, helpGrantedAt: now });
  return card;
}

/** CARD-007: a loss at wave 15 adds one to the streak, a win resets it. Only verified runs count. */
async function updateHelpCounter(
  tx: Repository,
  user: UserRecord,
  result: SubmitRunBody['result'],
  lastWave: number,
): Promise<void> {
  let helpFails = user.helpFails;
  if (result === 'loss' && lastWave === FULL_LAST_WAVE) helpFails += 1;
  else if (result === 'win') helpFails = 0;
  if (helpFails !== user.helpFails) await tx.users.update({ ...user, helpFails });
}

/** DB-013: one row per player and week; replaced only by a better result. */
async function recordWeeklyBest(tx: Repository, userId: string, wave: number, score: number, now: number): Promise<void> {
  const week = isoWeek(now);
  const current = await tx.weeklyBest.get(week, userId);
  if (current === null || isBetterResult({ wave, score }, current)) {
    await tx.weeklyBest.upsert({ week, userId, wave, score, createdAt: now });
  }
}

function toHeroId(value: string): HeroId {
  if (!isHeroId(value)) throw new ApiError('run.invalid', `unknown hero ${value}`);
  return value;
}
