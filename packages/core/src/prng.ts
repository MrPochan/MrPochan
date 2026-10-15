// Seeded PRNG (RNG-001..RNG-005): xoshiro128** on unsigned 32-bit words.
// Integer arithmetic only: Math.imul, shifts and >>> 0. No floating point.

import { sha256, utf8 } from './sha256.ts';

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Unsigned 32-bit xoshiro128** generator (RNG-001, RNG-002). */
export class Xoshiro128ss {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  /** `seed` is 16 bytes; words are read little-endian (RNG-002). */
  constructor(seed: Uint8Array) {
    if (seed.length !== 16) {
      throw new RangeError(`PRNG seed must be 16 bytes, got ${seed.length}`);
    }
    const word = (o: number): number =>
      ((seed[o] as number) | ((seed[o + 1] as number) << 8) | ((seed[o + 2] as number) << 16) | ((seed[o + 3] as number) << 24)) >>> 0;
    this.s0 = word(0);
    this.s1 = word(4);
    this.s2 = word(8);
    this.s3 = word(12);
    if (this.s0 === 0 && this.s1 === 0 && this.s2 === 0 && this.s3 === 0) {
      this.s0 = 1;
    }
  }

  /** Next unsigned 32-bit value (RNG-001). */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3 >>> 0, 11);
    this.s0 >>>= 0;
    this.s1 >>>= 0;
    this.s2 >>>= 0;
    this.s3 >>>= 0;
    return result;
  }

  /**
   * Uniform integer in [0, n) by rejection (RNG-003).
   * t = 2^32 mod n; values below t are rejected. Consumes at least one value.
   */
  bounded(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 0xffffffff) {
      throw new RangeError(`bounded(n) needs an integer 1..2^32-1, got ${n}`);
    }
    const t = 4294967296 % n;
    for (;;) {
      const x = this.next();
      if (x >= t) return x % n;
    }
  }
}

/** Subseed length in bytes (RNG-004). */
export const SEED_BYTES = 16;

/**
 * Key derivation (RNG-004):
 * KDF(S, label, i1, i2) = first 16 bytes of SHA-256("CQ1" || S || u8(len(label)) || label || u32be(i1) || u32be(i2)).
 */
export function kdf(seed: Uint8Array, label: string, i1: number, i2: number): Uint8Array {
  if (seed.length !== SEED_BYTES) {
    throw new RangeError(`seed must be 16 bytes, got ${seed.length}`);
  }
  const labelBytes = utf8(label);
  if (labelBytes.length > 255) throw new RangeError('label too long');
  for (const v of [i1, i2]) {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) {
      throw new RangeError(`KDF index out of u32 range: ${v}`);
    }
  }
  const head = utf8('CQ1');
  const m = new Uint8Array(head.length + seed.length + 1 + labelBytes.length + 8);
  let o = 0;
  m.set(head, o);
  o += head.length;
  m.set(seed, o);
  o += seed.length;
  m[o++] = labelBytes.length;
  m.set(labelBytes, o);
  o += labelBytes.length;
  writeU32be(m, o, i1);
  writeU32be(m, o + 4, i2);
  return sha256(m).slice(0, SEED_BYTES);
}

function writeU32be(buf: Uint8Array, o: number, v: number): void {
  buf[o] = (v >>> 24) & 0xff;
  buf[o + 1] = (v >>> 16) & 0xff;
  buf[o + 2] = (v >>> 8) & 0xff;
  buf[o + 3] = v & 0xff;
}

/** Writes u32 big-endian; exported for the fallback list builder. */
export function u32be(v: number): Uint8Array {
  const out = new Uint8Array(4);
  writeU32be(out, 0, v);
  return out;
}
