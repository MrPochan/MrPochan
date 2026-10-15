import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { kdf, Xoshiro128ss, SEED_BYTES } from '../src/prng.ts';
import { sha256, toHex, fromHex, utf8 } from '../src/sha256.ts';

const S_GOLD = fromHex('00112233445566778899aabbccddeeff');

describe('SHA-256 (RNG-004 vectors)', () => {
  it('matches the FIPS vectors from the spec', () => {
    expect(toHex(sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('agrees with an independent implementation for all lengths 0..600 (test oracle only)', () => {
    for (let len = 0; len <= 600; len++) {
      const d = new Uint8Array(len);
      for (let i = 0; i < len; i++) d[i] = (i * 131 + len * 7) & 0xff;
      expect(toHex(sha256(d))).toBe(createHash('sha256').update(d).digest('hex'));
    }
  });
});

describe('KDF (RNG-004)', () => {
  it('builds the 33-byte message of the golden vector and derives the spec subseed', () => {
    const m = new Uint8Array([...utf8('CQ1'), ...S_GOLD, 5, ...utf8('field'), 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(m.length).toBe(33);
    expect(toHex(m)).toBe('43513100112233445566778899aabbccddeeff056669656c640000000100000000');
    expect(toHex(kdf(S_GOLD, 'field', 1, 0))).toBe('a53359c912f02f801a88b4d98c7f14f3');
  });

  it('matches an independent derivation for many (label, i1, i2) records', () => {
    const labels = ['field', 'fallback', 'cards', 'help', 'battle', 'sim', 'test'];
    const records: { s: Uint8Array; label: string; i1: number; i2: number }[] = [];
    for (let k = 0; k < 40; k++) {
      const s = sha256(utf8(`seed-${k}`)).slice(0, SEED_BYTES);
      const label = labels[k % labels.length] as string;
      records.push({ s, label, i1: (k * 7919) % 16, i2: (k * 104729) % 10 });
    }
    records.push({ s: S_GOLD, label: 'cards', i1: 4294967295, i2: 0 });
    for (const r of records) {
      const lb = utf8(r.label);
      const m = Buffer.concat([
        Buffer.from('CQ1'),
        Buffer.from(r.s),
        Buffer.from([lb.length]),
        Buffer.from(lb),
        Buffer.from([(r.i1 >>> 24) & 0xff, (r.i1 >>> 16) & 0xff, (r.i1 >>> 8) & 0xff, r.i1 & 0xff]),
        Buffer.from([(r.i2 >>> 24) & 0xff, (r.i2 >>> 16) & 0xff, (r.i2 >>> 8) & 0xff, r.i2 & 0xff]),
      ]);
      const expected = createHash('sha256').update(m).digest().subarray(0, 16);
      expect(toHex(kdf(r.s, r.label, r.i1, r.i2))).toBe(toHex(new Uint8Array(expected)));
    }
  });

  it('rejects malformed input', () => {
    expect(() => kdf(new Uint8Array(15), 'field', 0, 0)).toThrow();
    expect(() => kdf(S_GOLD, 'field', -1, 0)).toThrow();
    expect(() => kdf(S_GOLD, 'field', 0, 2 ** 32)).toThrow();
  });
});

describe('xoshiro128** (RNG-001, RNG-002)', () => {
  it('reproduces the 16 golden outputs of the spec subseed', () => {
    const rng = new Xoshiro128ss(kdf(S_GOLD, 'field', 1, 0));
    const got = Array.from({ length: 16 }, () => rng.next());
    expect(got).toEqual([
      916035392, 329693233, 3181879022, 208060134, 2583385184, 3212566942, 3927145149, 1180223138,
      413754522, 2378031353, 1910296222, 1083859686, 758248594, 1549223787, 954838437, 1456655313,
    ]);
  });

  it('reads the seed as little-endian words', () => {
    const seed = new Uint8Array(16);
    seed[0] = 0x01;
    seed[4] = 0x02;
    seed[8] = 0x03;
    seed[12] = 0x04;
    const rng = new Xoshiro128ss(seed);
    // s0 = 1, s1 = 2: result = rotl(2*5, 7) * 9 = 1280 * 9.
    expect(rng.next()).toBe(1280 * 9);
  });

  it('replaces an all-zero state with s0 = 1 (RNG-002)', () => {
    const zero = new Xoshiro128ss(new Uint8Array(16));
    const one = new Xoshiro128ss(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    for (let i = 0; i < 32; i++) expect(zero.next()).toBe(one.next());
  });

  it('keeps every output an unsigned 32-bit integer', () => {
    const rng = new Xoshiro128ss(S_GOLD);
    for (let i = 0; i < 10000; i++) {
      const x = rng.next();
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('bounded() (RNG-003)', () => {
  it('bounded(1) consumes exactly one value and returns 0', () => {
    const a = new Xoshiro128ss(S_GOLD);
    const b = new Xoshiro128ss(S_GOLD);
    expect(a.bounded(1)).toBe(0);
    b.next();
    expect(a.next()).toBe(b.next());
  });

  it('is uniform on many draws (chi-square sanity, n = 7 and n = 100)', () => {
    for (const n of [7, 100]) {
      const rng = new Xoshiro128ss(kdf(S_GOLD, 'test', n, 0));
      const counts = new Array<number>(n).fill(0);
      const draws = 700000;
      for (let i = 0; i < draws; i++) counts[rng.bounded(n)]! += 1;
      const expected = draws / n;
      let chi2 = 0;
      for (const c of counts) chi2 += ((c - expected) ** 2) / expected;
      // Degrees of freedom n-1; the 99.9 % quantile is well below 2n for these sizes.
      expect(chi2).toBeLessThan(2 * n);
      // Every bin within 5 standard deviations of the expected count.
      for (const c of counts) expect(Math.abs(c - expected)).toBeLessThan(5 * Math.sqrt(expected));
    }
  });

  it('only returns values in range, including the rejection boundary', () => {
    const rng = new Xoshiro128ss(S_GOLD);
    for (const n of [2, 3, 5, 9, 100, 1000003]) {
      for (let i = 0; i < 2000; i++) {
        const v = rng.bounded(n);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(n);
      }
    }
  });

  it('rejects n < 1', () => {
    const rng = new Xoshiro128ss(S_GOLD);
    expect(() => rng.bounded(0)).toThrow();
    expect(() => rng.bounded(1.5)).toThrow();
  });
});
