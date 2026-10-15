import { describe, expect, it } from 'vitest';
import { cardText, maxTierOf, catalogEntry } from '../src/run/cardText.ts';

describe('card text (CARD-001..CARD-006)', () => {
  it('shows the placeholder title, the stat and the tier from the catalogue', () => {
    const entry = catalogEntry('knight_01');
    expect(entry).toBeDefined();
    const text = cardText('knight_01', 0);
    expect(text.title).toBe('Карта: Рыцарь');
    expect(text.title).not.toContain('knight_01');
    expect(text.heroLabel).toBe('Рыцарь');
    expect(text.effect.startsWith('урон +')).toBe(entry?.stat === 'dmg');
    expect(text.tierLabel).toBe('Тир 1');
    expect(text.maxTier).toBe(3);
  });

  it('labels common cards and falls back for unknown ids', () => {
    const common = cardText('common_01', 0);
    expect(common.heroLabel).toBe('Общая');
    const unknown = cardText('nope', 0);
    expect(unknown.title).toBe('Карта: Общая');
    expect(unknown.title).not.toContain('nope');
    expect(unknown.maxTier).toBe(0);
  });

  it('reads the top tier from the catalogue track', () => {
    const entry = catalogEntry('mage_01');
    if (entry) expect(maxTierOf(entry)).toBe(3);
  });
});
