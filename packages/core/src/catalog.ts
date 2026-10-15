// Read-only catalogues for UI and the release check. Values come from the JSON data files.

import { BATTLE, CARDS, ECONOMY, type HeroId } from './config.ts';

export { openBalanceEntries } from './config.ts';

export interface HeroCatalogItem {
  readonly id: HeroId;
  readonly name: string;
  readonly hp: number;
  readonly dmg: number;
  readonly period: number;
}

/** The four heroes of the MVP with their base stats, in id order. */
export const HERO_CATALOG: readonly HeroCatalogItem[] = (['archer', 'druid', 'knight', 'mage'] as const).map((id) => {
  const h = BATTLE.heroes[id];
  return { id, name: h.name, hp: h.hp, dmg: h.dmg, period: h.period };
});

export interface CardCatalogItem {
  readonly id: string;
  readonly hero: HeroId | 'common';
  readonly stat: 'dmg' | 'hp' | 'speed';
  readonly tiers: readonly [number, number, number, number];
}

/** The 30 cards of the MVP pool (CARD-001). Texts are open; the client shows ids until they are supplied. */
export const CARD_CATALOG: readonly CardCatalogItem[] = CARDS.map((c) => ({
  id: c.id,
  hero: c.hero,
  stat: c.stat,
  tiers: c.tiers,
}));

/** Constants the UI shows next to prices and timers. */
export const ECONOMY_VIEW = {
  energyMax: ECONOMY.energyMax,
  energyPeriodS: ECONOMY.energyPeriodS,
  rerollCost: ECONOMY.rerollCost,
  tierCost: ECONOMY.tierCost,
  resurrectGems: ECONOMY.resurrectGems,
  druidGems: ECONOMY.druidGems,
  druidCoins: ECONOMY.druidCoins,
  tickMs: BATTLE.tickMs,
} as const;
