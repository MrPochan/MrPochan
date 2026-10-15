// Typed view of the balance data in ./data/*.json (BAL-001, BAL-002).
// Every tunable number is stored as {"value": int | null, "source": "concept:<section>" | "assumption" | "open"}.
// This module unwraps them once at load time, so runtime code only sees plain integers.

import fieldJson from './data/field.json' with { type: 'json' };

/** A balance number as stored in JSON (BAL-002). */
export interface Num {
  value: number | null;
  source: string;
}

/** Unwraps a balance number. Throws if the value is missing (null). */
export function num(n: Num, where: string): number {
  if (n.value === null || !Number.isInteger(n.value)) {
    throw new Error(`balance value at ${where} is not an integer (source: ${n.source})`);
  }
  return n.value;
}

export interface FieldConfig {
  readonly width: number;
  readonly routeRows: number;
  readonly dropX: readonly number[];
  readonly slotCount: number;
  readonly templates: readonly (readonly number[])[];
  /** Weights for x0, x1, x2, x3, x5 in that order (GEN-013). */
  readonly weights: readonly number[];
  /** Cumulative thresholds p0..p4 (GEN-013); last element is 100. */
  readonly thresholds: readonly number[];
  readonly maxX0PerField: number;
  readonly attempts: number;
}

function loadField(raw: typeof fieldJson): FieldConfig {
  const w = raw.weights;
  const weights = [
    num(w.x0, 'field.weights.x0'),
    num(w.x1, 'field.weights.x1'),
    num(w.x2, 'field.weights.x2'),
    num(w.x3, 'field.weights.x3'),
    num(w.x5, 'field.weights.x5'),
  ];
  const thresholds: number[] = [];
  let acc = 0;
  for (const v of weights) {
    acc += v;
    thresholds.push(acc);
  }
  if (acc !== 100) throw new Error(`field weights must sum to 100, got ${acc}`);
  const cfg: FieldConfig = {
    width: raw.geometry.width,
    routeRows: raw.geometry.route_rows,
    dropX: raw.geometry.drop_x,
    slotCount: raw.geometry.slot_count,
    templates: raw.templates,
    weights,
    thresholds,
    maxX0PerField: raw.max_x0_per_field,
    attempts: num(raw.attempts, 'field.attempts'),
  };
  if (cfg.slotCount !== 5) throw new Error('field must have exactly 5 gate slots');
  for (const t of cfg.templates) {
    if (t.length !== cfg.slotCount) throw new Error('every template must have 5 slots');
  }
  return cfg;
}

export const FIELD: FieldConfig = loadField(fieldJson);

/**
 * Lists every balance value that is still open (source "open" or value null),
 * and every wave entry whose status is "open". A release build must fail if this list is not empty (BAL-002, CORE-009).
 */
export function openBalanceEntries(root: unknown, rootName: string): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if ('value' in obj && typeof obj.source === 'string') {
      if (obj.source === 'open' || obj.value === null) out.push(path);
      return;
    }
    if (obj.status === 'open') out.push(path);
    for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`);
  };
  walk(root, rootName);
  return out;
}
