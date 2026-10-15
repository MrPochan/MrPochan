// Calendar rules of the server (DB-000): day and week are UTC; weeks are ISO weeks, Monday 00:00 UTC.

/** UTC date of a unix time in seconds, "YYYY-MM-DD". */
export function utcDay(nowSec: number): string {
  return new Date(nowSec * 1000).toISOString().slice(0, 10);
}

/** ISO week of a unix time in seconds, "YYYY-Www" (for example "2026-W42"). */
export function isoWeek(nowSec: number): string {
  const source = new Date(nowSec * 1000);
  const date = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
  const dayNumber = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNumber + 3); // Thursday of the same ISO week
  const isoYear = date.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}
