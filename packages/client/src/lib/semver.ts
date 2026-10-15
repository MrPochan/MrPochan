// Minimal dotted-version helpers for min_client_version checks (ERR-010). DOM-free.

/** Parses "1.2.3" (optionally with a leading "v" or a "-suffix") into numbers; null when malformed. */
export function parseVersion(raw: string): [number, number, number] | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-.*)?$/.exec(raw.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** True when `current` is strictly lower than `minimum`. Malformed input never blocks the game. */
export function isVersionBelow(current: string, minimum: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
