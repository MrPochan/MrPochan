// Response shapes of spec 5.3 used by the client. Hand-written; contract tests live on the server side.
import { HERO_CATALOG } from '@cupquest/core';

export type HeroId = (typeof HERO_CATALOG)[number]['id'];

export interface AuthUser {
  readonly id: string;
  readonly is_guest: boolean;
  readonly display_name?: string;
  readonly referral_code: string;
}

export interface AuthResponse {
  readonly device_token: string;
  readonly created?: boolean;
  readonly user: AuthUser;
}

export interface Me {
  readonly user: AuthUser;
  readonly balances: { readonly coin: number; readonly gem: number };
  readonly heroes: readonly { readonly id: HeroId; readonly level: number }[];
  readonly quests: readonly { readonly id: string; readonly progress: number; readonly target: number; readonly claimed: boolean }[];
  readonly streak: { readonly day_no: number; readonly claimed_today: boolean };
  readonly starter_bought: boolean;
  readonly referral_week?: { readonly used: number; readonly limit: number };
}

export interface Energy {
  readonly e: number;
  readonly max: number;
  readonly period_s: number;
  readonly next_in_s: number | null;
  readonly server_time: number;
}

export interface ClientConfig {
  readonly min_client_version: string;
  readonly server_time: number;
  readonly flags: {
    readonly payments_enabled: boolean;
    readonly features: {
      readonly short_run: boolean;
      readonly daily_seed: boolean;
      readonly referrals: boolean;
      readonly help_after_defeats: boolean;
    };
  };
  readonly packs: readonly { readonly id: string; readonly stars: number; readonly gems: number; readonly name_key: string }[];
}

export interface RunStartResponse {
  readonly run_id: string;
  readonly seed: string;
  readonly daily: boolean;
  readonly day?: string;
  readonly energy: { readonly e: number; readonly t: number };
  readonly field_version: number;
  readonly reserved_gems: 0 | 10;
  readonly help_card: string | null;
  readonly started_at: number;
}

export interface SubmitResponse {
  readonly run: { readonly id: string; readonly state: 'verified' | 'flagged' | 'started' | 'timeout'; readonly result: string; readonly last_wave: number; readonly score: number };
  readonly verdict_reason?: readonly string[];
  readonly rewards: { readonly coins: number; readonly gems: number; readonly balls_burned: number };
  readonly balances: { readonly coin: number; readonly gem: number };
  readonly next_unlock?: { readonly id?: string } | null;
}

export interface BoardEntry {
  readonly rank: number;
  readonly name: string;
  readonly wave: number;
  readonly score: number;
  readonly is_me: boolean;
}

export interface BoardResponse {
  readonly week?: string;
  readonly day?: string;
  readonly entries: readonly BoardEntry[];
  readonly me: { readonly rank: number; readonly wave: number; readonly score: number } | null;
}

/** Body of POST /runs/submit (API-010). */
export interface SubmitBody {
  readonly run_id: string;
  readonly result: 'win' | 'loss' | 'abandon';
  readonly last_wave: number;
  readonly waves: readonly { readonly w: number; readonly coins: number; readonly balls: number; readonly spend: number }[];
  readonly gates: { readonly x0: number; readonly x1: number; readonly x2: number; readonly x3: number; readonly x5: number };
  readonly score: number;
  readonly duration_ticks: number;
  readonly resurrections: 0 | 1;
  readonly cards: readonly { readonly card_id: string; readonly tier: number }[];
  readonly log: string;
  readonly log_sha256: string;
}
