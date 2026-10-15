// Test harness: an app with an in-memory repository, a manual clock and helpers for signed initData.

import { createHash, createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { ServerConfig } from '../src/config.ts';
import type { FriendsProvider } from '../src/friends.ts';
import type { RandomSource } from '../src/seed.ts';
import { MemoryRepository } from '../src/store/memory.ts';
import type { UserRecord } from '../src/store/repository.ts';

export const BOT_TOKEN = '1000001:TEST_TOKEN_FOR_UNIT_TESTS';
export const CLIENT_VERSION = '0.1.0';
/** 2026-10-15 10:00:00 UTC in unix seconds. */
export const T0 = Date.UTC(2026, 9, 15, 10, 0, 0) / 1000;

export interface Harness {
  readonly app: FastifyInstance;
  readonly repo: MemoryRepository;
  /** Unix seconds; tests move it forward directly. */
  readonly clock: { now: number };
}

export interface HarnessOptions {
  readonly botToken?: string | null;
  readonly friends?: FriendsProvider;
  readonly random?: RandomSource;
  readonly corsOrigins?: readonly string[];
}

export async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  const repo = new MemoryRepository();
  const clock = { now: T0 };
  const config: ServerConfig = {
    port: 0,
    nodeEnv: 'test',
    botToken: options.botToken === undefined ? BOT_TOKEN : options.botToken,
    minClientVersion: CLIENT_VERSION,
    corsOrigins: options.corsOrigins ?? [],
  };
  const app = buildApp({
    config,
    repo,
    clock: () => clock.now,
    random: options.random,
    friends: options.friends,
  });
  await app.ready();
  return { app, repo, clock };
}

export interface CallOptions {
  readonly body?: unknown;
  readonly token?: string;
  readonly key?: string;
  /** undefined sends CLIENT_VERSION; null omits the header. */
  readonly version?: string | null;
}

export interface Reply {
  readonly status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly json: any;
  readonly headers: Record<string, unknown>;
}

export async function call(h: Harness, method: 'GET' | 'POST', path: string, options: CallOptions = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (options.version !== null) headers['x-client-version'] = options.version ?? CLIENT_VERSION;
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.key !== undefined) headers['idempotency-key'] = options.key;
  const url = path === '/health' ? path : `/api/v1${path}`;
  const res = await h.app.inject({ method, url, headers, payload: options.body as object | undefined });
  return { status: res.statusCode, json: res.body.length > 0 ? res.json() : undefined, headers: res.headers };
}

/** Builds initData signed with the given bot token, as Telegram does (AUTH-001). */
export function signInitData(fields: Record<string, string>, authDate: number, botToken: string = BOT_TOKEN): string {
  const pairs: Record<string, string> = { ...fields, auth_date: String(authDate) };
  const dataCheckString = Object.keys(pairs)
    .sort()
    .map((key) => `${key}=${pairs[key] ?? ''}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...pairs, hash }).toString();
}

export function telegramInitData(telegramId: number, authDate: number, botToken: string = BOT_TOKEN): string {
  return signInitData({ user: JSON.stringify({ id: telegramId, first_name: 'Test' }), query_id: 'AAEtest' }, authDate, botToken);
}

let keySequence = 0;
/** A fresh Idempotency-Key for each call. */
export function nextKey(): string {
  keySequence += 1;
  return `key-${keySequence}`;
}

let installSequence = 0;
export function nextInstallId(): string {
  installSequence += 1;
  return `install-${installSequence}-abcdef`;
}

export async function guestSession(h: Harness): Promise<{ token: string; userId: string }> {
  const reply = await call(h, 'POST', '/auth/guest', { body: { install_id: nextInstallId() } });
  if (reply.status !== 200) throw new Error(`guest login failed: ${reply.status} ${JSON.stringify(reply.json)}`);
  return { token: reply.json.device_token as string, userId: reply.json.user.id as string };
}

export async function telegramSession(h: Harness, telegramId: number): Promise<{ token: string; userId: string }> {
  const reply = await call(h, 'POST', '/auth/telegram', {
    body: { init_data: telegramInitData(telegramId, h.clock.now), install_id: nextInstallId() },
  });
  if (reply.status !== 200) throw new Error(`telegram login failed: ${reply.status} ${JSON.stringify(reply.json)}`);
  return { token: reply.json.device_token as string, userId: reply.json.user.id as string };
}

export function startBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { mode: 'full', speed: 1, team: ['knight', 'archer', 'mage'], daily: false, ...overrides };
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const NO_GATES = { x0: 0, x1: 0, x2: 0, x3: 0, x5: 0 };

/** A valid submit body for a loss at wave 1 with no completed waves (verifies unless patched). */
export function submitBody(runId: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  const log = `battle-log-${runId}`;
  return {
    run_id: runId,
    result: 'loss',
    last_wave: 1,
    waves: [],
    gates: { ...NO_GATES },
    score: 0,
    duration_ticks: 100,
    resurrections: 0,
    cards: [],
    log,
    log_sha256: sha256Hex(log),
    ...patch,
  };
}

/** A loss at wave 3 with two completed waves: w1 gives 25 coins and 10 balls, w2 gives 30 coins. */
export function threeWaveLoss(runId: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return submitBody(runId, {
    last_wave: 3,
    waves: [
      { w: 1, coins: 25, balls: 10, spend: 0 },
      { w: 2, coins: 30, balls: 0, spend: 0 },
    ],
    gates: { x0: 1, x1: 1, x2: 0, x3: 0, x5: 0 },
    score: 65,
    duration_ticks: 1000,
    ...patch,
  });
}

export async function startRun(h: Harness, token: string, overrides: Record<string, unknown> = {}, key = nextKey()): Promise<Reply> {
  return call(h, 'POST', '/runs/start', { token, key, body: startBody(overrides) });
}

export async function submitRun(h: Harness, token: string, body: Record<string, unknown>, key = nextKey()): Promise<Reply> {
  return call(h, 'POST', '/runs/submit', { token, key, body });
}

/** Writes account fields directly, as the store would (for states that the API does not reach yet). */
export async function updateUser(h: Harness, userId: string, patch: Partial<UserRecord>): Promise<void> {
  await h.repo.transaction(async (tx) => {
    const user = await tx.users.findById(userId);
    if (user === null) throw new Error(`no user ${userId}`);
    await tx.users.update({ ...user, ...patch });
  });
}
