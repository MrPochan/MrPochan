// Seeds: run seeds S and the daily seed D (RNG-006, DB-009). Only the server creates them.

import { randomBytes } from 'node:crypto';
import type { Repository } from './store/repository.ts';

/** Seed size in bytes (RNG-001, SEED_BYTES in core). */
export const SEED_BYTES = 16;

export type RandomSource = (size: number) => Uint8Array;

/** A new 16-byte seed from the server CSPRNG, as 32 hex characters. */
export function newSeedHex(random: RandomSource = randomBytes): string {
  const bytes = random(SEED_BYTES);
  if (bytes.length !== SEED_BYTES) throw new Error(`seed source returned ${bytes.length} bytes`);
  return Buffer.from(bytes).toString('hex');
}

/**
 * Daily seed D of a UTC day (RNG-006, DB-009). Created once per day; the first stored value wins.
 * Concurrent creators both call insertIfAbsent and receive the same stored row.
 */
export async function dailySeedFor(repo: Repository, day: string, random: RandomSource): Promise<string> {
  const existing = await repo.dailySeeds.get(day);
  if (existing !== null) return existing.seed;
  const stored = await repo.dailySeeds.insertIfAbsent({ day, seed: newSeedHex(random) });
  return stored.seed;
}
