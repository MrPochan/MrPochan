// Weekly board ordering (ТЗ 9.2, DB-013). The order is the index weekly_best(week, wave DESC,
// score DESC, created_at ASC); user id only breaks a tie that the index cannot break.

export interface BoardRow {
  readonly userId: string;
  readonly wave: number;
  readonly score: number;
  readonly createdAt: number;
}

export function compareBoardRows(a: BoardRow, b: BoardRow): number {
  if (a.wave !== b.wave) return b.wave - a.wave;
  if (a.score !== b.score) return b.score - a.score;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

/** A new result replaces the stored best only when it is better in the board order (DB-013). */
export function isBetterResult(
  candidate: { readonly wave: number; readonly score: number },
  current: { readonly wave: number; readonly score: number },
): boolean {
  return candidate.wave > current.wave || (candidate.wave === current.wave && candidate.score > current.score);
}
