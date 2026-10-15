import { describe, expect, it } from 'vitest';
import { isVersionBelow, parseVersion } from '../src/lib/semver.ts';

describe('parseVersion', () => {
  it('reads dotted versions and ignores a leading v and pre-release suffix', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('v2.0')).toEqual([2, 0, 0]);
    expect(parseVersion('1.4.0-rc.1')).toEqual([1, 4, 0]);
    expect(parseVersion('abc')).toBeNull();
  });
});

describe('isVersionBelow', () => {
  it('compares numerically, not as text', () => {
    expect(isVersionBelow('0.9.0', '0.10.0')).toBe(true);
    expect(isVersionBelow('0.10.0', '0.9.0')).toBe(false);
    expect(isVersionBelow('1.0.0', '1.0.0')).toBe(false);
    expect(isVersionBelow('1.0.0', '1.0.1')).toBe(true);
  });

  it('never blocks the game on malformed input', () => {
    expect(isVersionBelow('dev', '1.0.0')).toBe(false);
    expect(isVersionBelow('0.1.0', 'latest')).toBe(false);
  });
});
