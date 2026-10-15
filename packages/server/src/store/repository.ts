// Repository interface of the server. The in-memory adapter is in memory.ts; a PostgreSQL adapter
// implements the same interface with the constraints of DB-001..DB-016.
//
// Contract:
// - transaction(work) runs `work` with a repository that is isolated from other transactions
//   (serialized) and rolls back all its writes if `work` throws (SELECT ... FOR UPDATE in PostgreSQL).
//   Transactions must not be nested.
// - Reads and writes return and accept copies; callers never share mutable state with the store.
// - Unique constraints throw ConflictError (PostgreSQL: unique violation).
// - The ledger is append-only: there is no update and no delete (DB-006, ECO-001).

import type { Currency, LedgerEntry } from '@cupquest/core';
import type { GateCounts, HeroId, SubmitResult } from '../contract.ts';

export type RunMode = 'full' | 'short5';
export type RunState = 'started' | 'verified' | 'flagged' | 'timeout';
export type RunOutcome = SubmitResult | 'timeout';

export interface UserRecord {
  readonly id: string;
  readonly telegramId: number | null;
  readonly isGuest: boolean;
  readonly referralCode: string;
  readonly displayName: string | null;
  readonly helpFails: number;
  readonly helpGrantedAt: number | null;
  readonly deletedAt: number | null;
  readonly createdAt: number;
}

export interface DeviceRecord {
  /** SHA-256 of the token in hex; the token itself is never stored (AUTH-002). */
  readonly tokenHash: string;
  readonly userId: string;
  readonly kind: 'telegram' | 'web';
  readonly deviceHash: string | null;
  readonly createdAt: number;
  readonly revokedAt: number | null;
}

export interface EnergyRecord {
  readonly userId: string;
  readonly e: number;
  /** Anchor of regeneration, unix seconds (ECO-011). */
  readonly t: number;
  readonly updatedAt: number;
}

export interface HeroRecord {
  readonly userId: string;
  readonly heroId: HeroId;
  readonly level: number;
  readonly openedAt: number;
}

export interface RunRecord {
  readonly id: string;
  readonly userId: string;
  readonly seed: string;
  readonly daily: boolean;
  readonly day: string | null;
  readonly mode: RunMode;
  readonly speed: 1 | 2;
  readonly team: readonly string[];
  readonly fieldVersion: number;
  readonly reservedGems: number;
  readonly state: RunState;
  readonly result: RunOutcome | null;
  readonly lastWave: number | null;
  readonly score: number | null;
  readonly durationTicks: number | null;
  readonly gates: GateCounts | null;
  readonly resurrections: number;
  readonly cards: readonly { readonly card_id: string; readonly tier: number }[] | null;
  readonly logSha256: string | null;
  readonly verdictReason: readonly string[];
  readonly startedAt: number;
  readonly submittedAt: number | null;
}

export interface DailySeedRecord {
  readonly day: string;
  readonly seed: string;
}

export interface WeeklyBestRecord {
  readonly week: string;
  readonly userId: string;
  readonly wave: number;
  readonly score: number;
  readonly createdAt: number;
}

export interface IdempotencyRecord {
  readonly userId: string;
  readonly key: string;
  readonly endpoint: string;
  readonly bodyHash: string;
  readonly status: number;
  readonly body: unknown;
  readonly createdAt: number;
}

/** Thrown by a repository when a unique constraint would be violated. */
export class ConflictError extends Error {
  readonly constraint: string;

  constructor(constraint: string) {
    super(`unique constraint ${constraint}`);
    this.name = 'ConflictError';
    this.constraint = constraint;
  }
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByTelegramId(telegramId: number): Promise<UserRecord | null>;
  findByReferralCode(code: string): Promise<UserRecord | null>;
  insert(user: UserRecord): Promise<void>;
  update(user: UserRecord): Promise<void>;
}

export interface DeviceRepository {
  insert(device: DeviceRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<DeviceRecord | null>;
  listByUser(userId: string): Promise<DeviceRecord[]>;
  /** Revokes unrevoked `telegram` tokens with this device_hash; returns how many were revoked (AUTH-002). */
  revokeTelegramByDeviceHash(deviceHash: string, at: number): Promise<number>;
}

export interface EnergyRepository {
  get(userId: string): Promise<EnergyRecord | null>;
  put(energy: EnergyRecord): Promise<void>;
}

export interface HeroRepository {
  list(userId: string): Promise<HeroRecord[]>;
  insert(hero: HeroRecord): Promise<void>;
}

export interface LedgerRepository {
  /** Appends an entry. A repeated (userId, key) is ignored and reported as 'duplicate' (ECO-001). */
  append(entry: LedgerEntry): Promise<'inserted' | 'duplicate'>;
  /** Balance of one currency, the sum of the user's entries (DB-006). */
  balance(userId: string, currency: Currency): Promise<number>;
  list(userId: string): Promise<LedgerEntry[]>;
}

export interface DailySeedRepository {
  get(day: string): Promise<DailySeedRecord | null>;
  /** INSERT ... ON CONFLICT DO NOTHING, then returns the stored row (DB-009). */
  insertIfAbsent(row: DailySeedRecord): Promise<DailySeedRecord>;
}

export interface RunRepository {
  /** Throws ConflictError('runs.one_started') when the user already has a started run (DB-007). */
  insert(run: RunRecord): Promise<void>;
  get(id: string): Promise<RunRecord | null>;
  update(run: RunRecord): Promise<void>;
  findStarted(userId: string): Promise<RunRecord | null>;
  /** Started runs whose start time is before `startedBefore` (unix seconds), for the ERR-006 sweep. */
  findStartedBefore(startedBefore: number): Promise<RunRecord[]>;
}

export interface RunLogRepository {
  put(runId: string, body: string): Promise<void>;
  get(runId: string): Promise<string | null>;
}

export interface WeeklyBestRepository {
  get(week: string, userId: string): Promise<WeeklyBestRecord | null>;
  upsert(row: WeeklyBestRecord): Promise<void>;
  /** Rows of the given users for one week, unordered; ordering is done by compareBoardRows (board.ts). */
  forUsers(week: string, userIds: readonly string[]): Promise<WeeklyBestRecord[]>;
}

export interface IdempotencyRepository {
  get(userId: string, key: string): Promise<IdempotencyRecord | null>;
  put(record: IdempotencyRecord): Promise<void>;
}

export interface FlagRepository {
  /** Value of a feature flag, or undefined when the flag is not set (DB-017). */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface Repository {
  transaction<T>(work: (tx: Repository) => Promise<T>): Promise<T>;
  readonly users: UserRepository;
  readonly devices: DeviceRepository;
  readonly energy: EnergyRepository;
  readonly heroes: HeroRepository;
  readonly ledger: LedgerRepository;
  readonly dailySeeds: DailySeedRepository;
  readonly runs: RunRepository;
  readonly runLogs: RunLogRepository;
  readonly weeklyBest: WeeklyBestRepository;
  readonly idempotency: IdempotencyRepository;
  readonly flags: FlagRepository;
}
