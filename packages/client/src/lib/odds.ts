// Gate odds shown next to the board (UI-004, BAL-009).
// The core does not export its chance table, so the counts below are copied from
// packages/core/src/data/gates.json (total.slot_counts over total fields * 5 columns). A test compares them with that file.
import { GATE_TYPES, type GateType } from '@cupquest/core';

/** 150 000 fields times 5 columns (gates.json total.fields * slotCount). */
export const GATE_SLOT_TOTAL = 750000;

export const GATE_SLOT_COUNTS: Readonly<Record<GateType, number>> = {
  x0: 61270,
  x1: 126036,
  x2: 224831,
  x3: 187477,
  x5: 150386,
};

/** Chance of a gate in tenths of a percent, rounded (8.2 % is 82). */
export function oddsTenths(gate: GateType): number {
  return Math.round((GATE_SLOT_COUNTS[gate] * 1000) / GATE_SLOT_TOTAL);
}

/** Rows for the odds panel, from the lowest gate to the highest. */
export function oddsRows(): { gate: GateType; tenths: number }[] {
  return GATE_TYPES.map((gate) => ({ gate, tenths: oddsTenths(gate) }));
}
