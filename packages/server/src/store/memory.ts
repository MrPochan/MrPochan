// In-memory adapter of the repository. State lives in the process and is lost on restart.
// Transactions are serialized and roll back by restoring a snapshot, which mirrors the PostgreSQL
// behaviour the interface is written for. A PostgreSQL adapter replaces this file (next iteration).

import type { Currency, LedgerEntry } from '@cupquest/core';
import {
  ConflictError,
  type DailySeedRecord,
  type DeviceRecord,
  type DeviceRepository,
  type DailySeedRepository,
  type EnergyRecord,
  type EnergyRepository,
  type HeroRecord,
  type HeroRepository,
  type IdempotencyRecord,
  type IdempotencyRepository,
  type FlagRepository,
  type LedgerRepository,
  type Repository,
  type RunLogRepository,
  type RunRecord,
  type RunRepository,
  type UserRecord,
  type UserRepository,
  type WeeklyBestRecord,
  type WeeklyBestRepository,
} from './repository.ts';

interface MemoryState {
  users: Map<string, UserRecord>;
  /** Keyed by token hash. */
  devices: Map<string, DeviceRecord>;
  energy: Map<string, EnergyRecord>;
  /** Keyed by `${userId}|${heroId}`. */
  heroes: Map<string, HeroRecord>;
  ledger: LedgerEntry[];
  dailySeeds: Map<string, DailySeedRecord>;
  runs: Map<string, RunRecord>;
  runLogs: Map<string, string>;
  /** Keyed by `${week}|${userId}`. */
  weeklyBest: Map<string, WeeklyBestRecord>;
  /** Keyed by `${userId}|${key}`. */
  idempotency: Map<string, IdempotencyRecord>;
  flags: Map<string, unknown>;
}

function emptyState(): MemoryState {
  return {
    users: new Map(),
    devices: new Map(),
    energy: new Map(),
    heroes: new Map(),
    ledger: [],
    dailySeeds: new Map(),
    runs: new Map(),
    runLogs: new Map(),
    weeklyBest: new Map(),
    idempotency: new Map(),
    flags: new Map(),
  };
}

const copy = <T>(value: T): T => structuredClone(value);

export class MemoryRepository implements Repository {
  /** Internal state. Only the repository objects below access it. */
  state: MemoryState = emptyState();
  private chain: Promise<unknown> = Promise.resolve();

  readonly users: UserRepository = new MemoryUsers(this);
  readonly devices: DeviceRepository = new MemoryDevices(this);
  readonly energy: EnergyRepository = new MemoryEnergy(this);
  readonly heroes: HeroRepository = new MemoryHeroes(this);
  readonly ledger: LedgerRepository = new MemoryLedger(this);
  readonly dailySeeds: DailySeedRepository = new MemoryDailySeeds(this);
  readonly runs: RunRepository = new MemoryRuns(this);
  readonly runLogs: RunLogRepository = new MemoryRunLogs(this);
  readonly weeklyBest: WeeklyBestRepository = new MemoryWeeklyBest(this);
  readonly idempotency: IdempotencyRepository = new MemoryIdempotency(this);
  readonly flags: FlagRepository = new MemoryFlags(this);

  transaction<T>(work: (tx: Repository) => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const snapshot = copy(this.state);
      try {
        return await work(this);
      } catch (error) {
        this.state = snapshot;
        throw error;
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

class MemoryUsers implements UserRepository {
  constructor(private readonly root: MemoryRepository) {}

  async findById(id: string): Promise<UserRecord | null> {
    const row = this.root.state.users.get(id);
    return row === undefined ? null : copy(row);
  }

  async findByTelegramId(telegramId: number): Promise<UserRecord | null> {
    for (const row of this.root.state.users.values()) {
      if (row.telegramId === telegramId) return copy(row);
    }
    return null;
  }

  async findByReferralCode(code: string): Promise<UserRecord | null> {
    for (const row of this.root.state.users.values()) {
      if (row.referralCode === code) return copy(row);
    }
    return null;
  }

  async insert(user: UserRecord): Promise<void> {
    const users = this.root.state.users;
    if (users.has(user.id)) throw new ConflictError('users.pk');
    for (const row of users.values()) {
      if (row.referralCode === user.referralCode) throw new ConflictError('users.referral_code');
      if (user.telegramId !== null && row.telegramId === user.telegramId) throw new ConflictError('users.telegram_id');
    }
    users.set(user.id, copy(user));
  }

  async update(user: UserRecord): Promise<void> {
    if (!this.root.state.users.has(user.id)) throw new Error(`user ${user.id} does not exist`);
    this.root.state.users.set(user.id, copy(user));
  }
}

class MemoryDevices implements DeviceRepository {
  constructor(private readonly root: MemoryRepository) {}

  async insert(device: DeviceRecord): Promise<void> {
    if (this.root.state.devices.has(device.tokenHash)) throw new ConflictError('devices.token_hash');
    this.root.state.devices.set(device.tokenHash, copy(device));
  }

  async findByTokenHash(tokenHash: string): Promise<DeviceRecord | null> {
    const row = this.root.state.devices.get(tokenHash);
    return row === undefined ? null : copy(row);
  }

  async listByUser(userId: string): Promise<DeviceRecord[]> {
    return [...this.root.state.devices.values()].filter((d) => d.userId === userId).map(copy);
  }

  async revokeTelegramByDeviceHash(deviceHash: string, at: number): Promise<number> {
    let revoked = 0;
    for (const [hash, row] of this.root.state.devices) {
      if (row.kind === 'telegram' && row.deviceHash === deviceHash && row.revokedAt === null) {
        this.root.state.devices.set(hash, { ...row, revokedAt: at });
        revoked += 1;
      }
    }
    return revoked;
  }
}

class MemoryEnergy implements EnergyRepository {
  constructor(private readonly root: MemoryRepository) {}

  async get(userId: string): Promise<EnergyRecord | null> {
    const row = this.root.state.energy.get(userId);
    return row === undefined ? null : copy(row);
  }

  async put(energy: EnergyRecord): Promise<void> {
    this.root.state.energy.set(energy.userId, copy(energy));
  }
}

class MemoryHeroes implements HeroRepository {
  constructor(private readonly root: MemoryRepository) {}

  async list(userId: string): Promise<HeroRecord[]> {
    return [...this.root.state.heroes.values()].filter((h) => h.userId === userId).map(copy);
  }

  async insert(hero: HeroRecord): Promise<void> {
    const key = `${hero.userId}|${hero.heroId}`;
    if (this.root.state.heroes.has(key)) throw new ConflictError('heroes.pk');
    this.root.state.heroes.set(key, copy(hero));
  }
}

class MemoryLedger implements LedgerRepository {
  constructor(private readonly root: MemoryRepository) {}

  async append(entry: LedgerEntry): Promise<'inserted' | 'duplicate'> {
    const ledger = this.root.state.ledger;
    if (ledger.some((e) => e.userId === entry.userId && e.key === entry.key)) return 'duplicate';
    ledger.push(copy(entry));
    return 'inserted';
  }

  async balance(userId: string, currency: Currency): Promise<number> {
    let sum = 0;
    for (const e of this.root.state.ledger) {
      if (e.userId === userId && e.currency === currency) sum += e.delta;
    }
    return sum;
  }

  async list(userId: string): Promise<LedgerEntry[]> {
    return this.root.state.ledger.filter((e) => e.userId === userId).map(copy);
  }
}

class MemoryDailySeeds implements DailySeedRepository {
  constructor(private readonly root: MemoryRepository) {}

  async get(day: string): Promise<DailySeedRecord | null> {
    const row = this.root.state.dailySeeds.get(day);
    return row === undefined ? null : copy(row);
  }

  async insertIfAbsent(row: DailySeedRecord): Promise<DailySeedRecord> {
    const existing = this.root.state.dailySeeds.get(row.day);
    if (existing !== undefined) return copy(existing);
    this.root.state.dailySeeds.set(row.day, copy(row));
    return copy(row);
  }
}

class MemoryRuns implements RunRepository {
  constructor(private readonly root: MemoryRepository) {}

  async insert(run: RunRecord): Promise<void> {
    const runs = this.root.state.runs;
    if (runs.has(run.id)) throw new ConflictError('runs.pk');
    if (run.state === 'started') {
      for (const other of runs.values()) {
        if (other.userId === run.userId && other.state === 'started') {
          throw new ConflictError('runs.one_started');
        }
      }
    }
    runs.set(run.id, copy(run));
  }

  async get(id: string): Promise<RunRecord | null> {
    const row = this.root.state.runs.get(id);
    return row === undefined ? null : copy(row);
  }

  async update(run: RunRecord): Promise<void> {
    if (!this.root.state.runs.has(run.id)) throw new Error(`run ${run.id} does not exist`);
    this.root.state.runs.set(run.id, copy(run));
  }

  async findStarted(userId: string): Promise<RunRecord | null> {
    for (const row of this.root.state.runs.values()) {
      if (row.userId === userId && row.state === 'started') return copy(row);
    }
    return null;
  }

  async findStartedBefore(startedBefore: number): Promise<RunRecord[]> {
    return [...this.root.state.runs.values()]
      .filter((row) => row.state === 'started' && row.startedAt < startedBefore)
      .map(copy);
  }
}

class MemoryRunLogs implements RunLogRepository {
  constructor(private readonly root: MemoryRepository) {}

  async put(runId: string, body: string): Promise<void> {
    this.root.state.runLogs.set(runId, body);
  }

  async get(runId: string): Promise<string | null> {
    return this.root.state.runLogs.get(runId) ?? null;
  }
}

class MemoryWeeklyBest implements WeeklyBestRepository {
  constructor(private readonly root: MemoryRepository) {}

  async get(week: string, userId: string): Promise<WeeklyBestRecord | null> {
    const row = this.root.state.weeklyBest.get(`${week}|${userId}`);
    return row === undefined ? null : copy(row);
  }

  async upsert(row: WeeklyBestRecord): Promise<void> {
    this.root.state.weeklyBest.set(`${row.week}|${row.userId}`, copy(row));
  }

  async forUsers(week: string, userIds: readonly string[]): Promise<WeeklyBestRecord[]> {
    const wanted = new Set(userIds);
    return [...this.root.state.weeklyBest.values()]
      .filter((row) => row.week === week && wanted.has(row.userId))
      .map(copy);
  }
}

class MemoryIdempotency implements IdempotencyRepository {
  constructor(private readonly root: MemoryRepository) {}

  async get(userId: string, key: string): Promise<IdempotencyRecord | null> {
    const row = this.root.state.idempotency.get(`${userId}|${key}`);
    return row === undefined ? null : copy(row);
  }

  async put(record: IdempotencyRecord): Promise<void> {
    this.root.state.idempotency.set(`${record.userId}|${record.key}`, copy(record));
  }
}

class MemoryFlags implements FlagRepository {
  constructor(private readonly root: MemoryRepository) {}

  async get(key: string): Promise<unknown> {
    return copy(this.root.state.flags.get(key));
  }

  async set(key: string, value: unknown): Promise<void> {
    this.root.state.flags.set(key, copy(value));
  }
}
