import { describe, expect, it } from 'vitest';
import { counted, formatCountdown, formatInt, formatPercent, pluralForm } from '../src/lib/format.ts';

const BALL = { one: 'шар', few: 'шара', many: 'шаров' };
const GEM = { one: 'гем', few: 'гема', many: 'гемов' };
const WAVE = { one: 'волна', few: 'волны', many: 'волн' };

describe('pluralForm (LOC-004)', () => {
  it('picks the Russian form for the required sample values', () => {
    expect(pluralForm(1, BALL)).toBe('шар');
    expect(pluralForm(2, BALL)).toBe('шара');
    expect(pluralForm(5, BALL)).toBe('шаров');
    expect(pluralForm(11, BALL)).toBe('шаров');
    expect(pluralForm(21, BALL)).toBe('шар');
    expect(pluralForm(22, BALL)).toBe('шара');
    expect(pluralForm(101, BALL)).toBe('шар');
    expect(pluralForm(1, GEM)).toBe('гем');
    expect(pluralForm(2, GEM)).toBe('гема');
    expect(pluralForm(5, WAVE)).toBe('волн');
    expect(pluralForm(3, WAVE)).toBe('волны');
  });

  it('joins the number and the noun', () => {
    expect(counted(22, BALL)).toBe(`${formatInt(22)} шара`);
  });
});

describe('number and time formatting', () => {
  it('groups thousands with a no-break space (ru-RU)', () => {
    expect(formatInt(1234)).toBe('1 234');
    expect(formatInt(7)).toBe('7');
  });

  it('formats a countdown as m:ss and never goes below zero', () => {
    expect(formatCountdown(125)).toBe('2:05');
    expect(formatCountdown(4.2)).toBe('0:05');
    expect(formatCountdown(-3)).toBe('0:00');
  });

  it('formats tenths of a percent with a decimal comma', () => {
    expect(formatPercent(82)).toBe('8,2 %');
    expect(formatPercent(300)).toBe('30,0 %');
  });
});
