// Number, plural and time formatting (LOC-004). DOM-free and locale-fixed to ru-RU.

const intFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pluralRules = new Intl.PluralRules('ru');

export interface PluralForms {
  readonly one: string;
  readonly few: string;
  readonly many: string;
}

/** Integer with ru-RU group separators, e.g. 1 234. */
export function formatInt(n: number): string {
  return intFormat.format(Math.round(n));
}

/** One decimal place with a comma, e.g. 8,2. */
export function formatDecimal(n: number): string {
  return decimalFormat.format(n);
}

/** Picks the Russian plural form for n (LOC-004): one, few or many. */
export function pluralForm(n: number, forms: PluralForms): string {
  const category = pluralRules.select(n);
  if (category === 'one') return forms.one;
  if (category === 'few') return forms.few;
  return forms.many;
}

/** Number and noun together, the noun in the plural form for n. */
export function counted(n: number, forms: PluralForms): string {
  return `${formatInt(n)} ${pluralForm(n, forms)}`;
}

/** Countdown m:ss, clamped at zero. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest}`;
}

/** Percent with one decimal and a comma, for gate odds: 8,2 %. */
export function formatPercent(tenths: number): string {
  return `${formatDecimal(tenths / 10)} %`;
}
