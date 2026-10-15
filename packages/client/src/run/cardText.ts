// Card titles and effects for the offer and upgrade screens (CARD-001..CARD-006). DOM-free.
// Card texts are open in the spec, so titles are placeholders built from the hero; effects come from the core catalogue.
// Raw card ids never reach the UI (LOC-001: Russian text only).
import { CARD_CATALOG } from '@cupquest/core';
import { t } from '../i18n.ts';
import type { TextKey } from '../strings.ru.ts';
import { formatInt } from '../lib/format.ts';

export interface CardText {
  readonly id: string;
  readonly title: string;
  readonly heroLabel: string;
  readonly effect: string;
  readonly tierLabel: string;
  readonly maxTier: number;
}

export type CardItem = (typeof CARD_CATALOG)[number];

export function catalogEntry(id: string): CardItem | undefined {
  return CARD_CATALOG.find((c) => c.id === id);
}

/** Highest tier index of the card track (CARD-006: tiers 0..3). */
export function maxTierOf(item: CardItem): number {
  return item.tiers.length - 1;
}

/** Text for a card at a tier. Unknown ids fall back to the id itself so the screen still works. */
export function cardText(id: string, tier: number): CardText {
  const item = catalogEntry(id);
  const statKey = (item ? `cards.stat.${item.stat}` : 'cards.stat.dmg') as TextKey;
  const value = item?.tiers[Math.min(Math.max(tier, 0), item.tiers.length - 1)] ?? 0;
  const heroLabel = !item || item.hero === 'common' ? t('cards.common') : t(`hero.${item.hero}` as TextKey);
  return {
    id,
    title: t('card.placeholder', { hero: heroLabel }),
    heroLabel,
    effect: t('cards.effect', { stat: t(statKey), value: formatInt(value) }),
    tierLabel: t('cards.tier', { tier: tier + 1 }),
    maxTier: item ? maxTierOf(item) : 0,
  };
}
