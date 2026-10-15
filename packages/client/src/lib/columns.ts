// Column selection for the cup on the board (UI-005). Board grid is 9 cells wide; columns sit on even cells.
// DOM-free so the bounds can be tested.

export const COLUMN_COUNT = 5;
/** Grid cell index of column c is 2c (drop_x in field.json). */
export const GRID_STEP = 2;

/** Clamps a column index into 0..4. */
export function clampColumn(c: number): number {
  if (!Number.isFinite(c)) return 0;
  return Math.min(COLUMN_COUNT - 1, Math.max(0, Math.round(c)));
}

/** Moves the cup by `delta` columns, never past the edges. */
export function shiftColumn(c: number, delta: number): number {
  return clampColumn(clampColumn(c) + delta);
}

/** Nearest column for a horizontal position measured in grid cells (cell centres at integer + 0.5). */
export function columnForGridX(gridX: number): number {
  if (!Number.isFinite(gridX)) return 0;
  return clampColumn(Math.round(gridX / GRID_STEP));
}

/** Nearest column for a pixel x, given the board's left edge and cell width in pixels. */
export function columnForPixel(px: number, boardLeft: number, cellPx: number): number {
  if (cellPx <= 0) return 0;
  return columnForGridX((px - boardLeft) / cellPx - 0.5);
}
