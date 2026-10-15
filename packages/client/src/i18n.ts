// Text lookup and placeholder substitution over strings.ru.ts. DOM-free.
import { STRINGS, type PluralWord, type StringKey, type TextKey } from './strings.ru.ts';
import { counted, pluralForm } from './lib/format.ts';
import { ApiError, errorKey } from './lib/apiErrors.ts';

type Vars = Readonly<Record<string, string | number>>;

/** Keys whose value is a plural word object. */
export type PluralKey = { [K in StringKey]: (typeof STRINGS)[K] extends PluralWord ? K : never }[StringKey];

/** Plain text for a key, with {name} placeholders replaced. */
export function t(key: TextKey, vars?: Vars): string {
  const raw = STRINGS[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/** Number with the Russian noun in the right plural form (LOC-004). */
export function count(key: PluralKey, n: number): string {
  return counted(n, STRINGS[key]);
}

/** Only the noun, in the form for n. */
export function word(key: PluralKey, n: number): string {
  return pluralForm(n, STRINGS[key]);
}

/** Text for an API error code (LOC-002). */
export function errorText(code: string): string {
  const key = errorKey(code) as StringKey;
  return STRINGS[key] as string;
}

/** Hero name by id (LOC-005). */
export function heroName(id: string): string {
  return t(`hero.${id}` as TextKey);
}

/** Enemy name by type (LOC-005). */
export function enemyName(type: string): string {
  return t(`enemy.${type}` as TextKey);
}

/** Gate label by type. */
export function gateName(gate: string): string {
  return t(`gate.${gate}` as TextKey);
}

/**
 * User-facing text for any failure: API errors by code (LOC-002), core rule errors as a generic message,
 * and anything else as a server error.
 */
export function messageFor(e: unknown): string {
  if (e instanceof ApiError) return errorText(e.code);
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  if (typeof code === 'string') {
    if (code === 'balls.insufficient' || code === 'battle.resurrect_used') return errorText(code);
    return t('rule.failed');
  }
  return errorText('server.error');
}

/** True when the key exists in the Russian string table (used for server name keys). */
export function hasString(key: string): key is TextKey {
  return Object.prototype.hasOwnProperty.call(STRINGS, key);
}
