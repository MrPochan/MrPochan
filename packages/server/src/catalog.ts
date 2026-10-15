// Server constants that are not game rules: timers, flags, shop catalogue.
// Game rules and balance numbers come from @cupquest/core.

import { ECONOMY_VIEW } from '@cupquest/core';

/** A started run that is not submitted within this time is closed as `timeout` (ERR-006), seconds. */
export const RUN_TIMEOUT_S = 30 * 60;

/** Field version of the seed format (TV-004). */
export const FIELD_VERSION = 1;

/** Gems reserved at start for one resurrection (CORE-026). */
export const RESURRECT_GEMS = ECONOMY_VIEW.resurrectGems;

/** Help card after this many consecutive losses at the boss (CARD-007). */
export const HELP_FAILS_THRESHOLD = 3;
/** Help card is granted at most once in this period, seconds (CARD-007). */
export const HELP_COOLDOWN_S = 24 * 60 * 60;

/** Heroes every account starts with (ECO-005, decision C15). Druid is bought, not in this iteration. */
export const STARTER_HEROES: readonly string[] = ['knight', 'archer', 'mage'];

/** Stars payments are not implemented in this iteration. Keep false until PAY-001..PAY-007 exist. */
export const PAYMENTS_IMPLEMENTED = false;

/** Feature flag key of the sales kill switch (FF-001, DB-017). */
export const PAYMENTS_FLAG = 'payments.enabled';

/** Shop catalogue (PAY-008). `test_1` exists only in staging and is absent here. */
export const PACKS = [
  { id: 'gems_a', stars: 50, gems: 60, name_key: 'shop.pack_a.name' },
  { id: 'gems_b', stars: 150, gems: 200, name_key: 'shop.pack_b.name' },
  { id: 'starter', stars: 100, gems: 100, name_key: 'shop.starter.name' },
] as const;

/** Feature flags of API-005. referrals stays off: referrals are not in this iteration. */
export const FEATURES = {
  short_run: true,
  // The daily board (API-015) is not in this iteration; the client hides the day tab while this is false.
  daily_seed: false,
  referrals: false,
  help_after_defeats: true,
} as const;

/** Rows of the weekly board returned to the client (API-016: up to 50). */
export const BOARD_LIMIT = 50;
