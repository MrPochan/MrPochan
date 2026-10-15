// Request bodies of the API (ТЗ 5.3, snake_case field names as in the specification).

import { HERO_ID_ORDER, type GateType, type RunMode } from '@cupquest/core';

export type HeroId = (typeof HERO_ID_ORDER)[number];

export function isHeroId(value: string): value is HeroId {
  return (HERO_ID_ORDER as readonly string[]).includes(value);
}

export type SubmitResult = 'win' | 'loss' | 'abandon';
export type GateCounts = Record<GateType, number>;

export interface WaveBody {
  readonly w: number;
  readonly coins: number;
  readonly balls: number;
  readonly spend: number;
}

export interface CardBody {
  readonly card_id: string;
  readonly tier: number;
}

export interface TelegramLoginBody {
  readonly init_data: string;
  readonly install_id: string;
}

export interface GuestLoginBody {
  readonly install_id: string;
}

export interface StartRunBody {
  readonly mode: RunMode;
  readonly speed: 1 | 2;
  readonly team: readonly string[];
  readonly daily: boolean;
}

export interface SubmitRunBody {
  readonly run_id: string;
  readonly result: SubmitResult;
  readonly last_wave: number;
  readonly waves: readonly WaveBody[];
  readonly gates: GateCounts;
  readonly score: number;
  readonly duration_ticks: number;
  readonly resurrections: 0 | 1;
  readonly cards: readonly CardBody[];
  readonly log: string;
  readonly log_sha256: string;
}
