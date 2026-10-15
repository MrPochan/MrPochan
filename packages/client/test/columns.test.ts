import { describe, expect, it } from 'vitest';
import { clampColumn, columnForGridX, columnForPixel, shiftColumn } from '../src/lib/columns.ts';

describe('column bounds (UI-005)', () => {
  it('keeps the cup on the five columns', () => {
    expect(clampColumn(-3)).toBe(0);
    expect(clampColumn(9)).toBe(4);
    expect(clampColumn(Number.NaN)).toBe(0);
  });

  it('moves one column at a time and stops at the edges', () => {
    expect(shiftColumn(0, -1)).toBe(0);
    expect(shiftColumn(4, 1)).toBe(4);
    expect(shiftColumn(2, 1)).toBe(3);
    expect(shiftColumn(2, -2)).toBe(0);
  });

  it('maps grid positions to the nearest column (columns sit on even cells)', () => {
    expect(columnForGridX(0)).toBe(0);
    expect(columnForGridX(4)).toBe(2);
    expect(columnForGridX(8)).toBe(4);
    expect(columnForGridX(9)).toBe(4);
    expect(columnForGridX(-2)).toBe(0);
  });

  it('maps a pixel position on the board', () => {
    // 9 cells of 36 px starting at x = 18; the centre of cell 4 (column 2) is 18 + 4.5 * 36.
    expect(columnForPixel(18 + 4.5 * 36, 18, 36)).toBe(2);
    expect(columnForPixel(18 + 0.5 * 36, 18, 36)).toBe(0);
    expect(columnForPixel(10, 18, 0)).toBe(0);
  });
});
