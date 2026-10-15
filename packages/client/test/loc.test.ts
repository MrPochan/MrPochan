import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { t, errorText, heroName, count } from '../src/i18n.ts';
import { STRINGS } from '../src/strings.ru.ts';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map((name) => join(dir, String(name)))
    .filter((p) => (p.endsWith('.ts') || p.endsWith('.tsx')) && !p.endsWith('strings.ru.ts'));
}

describe('localisation (LOC-001, LOC-002)', () => {
  it('has no Cyrillic text in TypeScript outside strings.ru.ts', () => {
    const offenders = tsFiles(srcDir).filter((file) => /\p{Script=Cyrillic}/u.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => relative(srcDir, f))).toEqual([]);
  });

  it('substitutes placeholders and keeps unknown ones visible', () => {
    expect(t('battle.wave', { n: 3, total: 15 })).toBe('Волна 3 из 15');
    expect(t('battle.wave', { n: 3 })).toBe('Волна 3 из {total}');
  });

  it('uses the plural forms for counted nouns', () => {
    expect(count('unit.ball', 5)).toBe('5 шаров');
    expect(count('unit.gem', 2)).toBe('2 гема');
  });

  it('resolves hero names and API error texts', () => {
    expect(heroName('knight')).toBe('Рыцарь');
    expect(errorText('energy.empty')).toBe(STRINGS['err.energy.empty']);
    expect(errorText('not.a.code')).toBe(STRINGS['err.server.error']);
  });
});
