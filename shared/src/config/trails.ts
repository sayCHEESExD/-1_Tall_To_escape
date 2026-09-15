/**
 * Trails: bought with Wins, one worn at a time, and each MULTIPLIES FOOD
 * gained per step (the food figure on the trail menu).
 *
 * Applied in exactly one place - the food rate in `FoodService.rate` - and
 * never to wins, height or movement. Pure data: edit a row to re-price.
 */
export type TrailStyle = 'solid' | 'rainbow' | 'hacker' | 'heaven' | 'cosmic' | 'music' | 'void';

export interface TrailTier {
  readonly slot: number;
  readonly name: string;
  readonly cost: number;
  /** Food multiplier while worn. */
  readonly multiplier: number;
  readonly color: number;
  readonly style: TrailStyle;
}

export const TRAIL_TIERS: readonly TrailTier[] = [
  { slot: 1, name: 'Green Trail', cost: 30, multiplier: 1.5, color: 0x3ce06a, style: 'solid' },
  { slot: 2, name: 'Blue Trail', cost: 350, multiplier: 1.75, color: 0x3aa8ff, style: 'solid' },
  { slot: 3, name: 'Purple Trail', cost: 1_500, multiplier: 2, color: 0xa855f7, style: 'solid' },
  { slot: 4, name: 'White Trail', cost: 8_500, multiplier: 2.5, color: 0xffffff, style: 'solid' },
  { slot: 5, name: 'Black Trail', cost: 45_000, multiplier: 3, color: 0x14161c, style: 'void' },
  { slot: 6, name: 'Gold Trail', cost: 350_000, multiplier: 4, color: 0xffc733, style: 'solid' },
  { slot: 7, name: 'Rainbow Trail', cost: 1_500_000, multiplier: 6, color: 0xff3b6b, style: 'rainbow' },
  { slot: 8, name: 'Hacker Trail', cost: 25_000_000, multiplier: 10, color: 0x39ff6a, style: 'hacker' },
  { slot: 9, name: 'Heaven Trail', cost: 500_000_000, multiplier: 16, color: 0xfff4c2, style: 'heaven' },
  { slot: 10, name: 'Universe Trail', cost: 4_500_000_000, multiplier: 25, color: 0x7b5bff, style: 'cosmic' },
  { slot: 11, name: 'Music Trail', cost: 800_000_000_000, multiplier: 40, color: 0xff4fd0, style: 'music' },
];

export const NO_TRAIL = 0;

export const trailBySlot = (slot: number): TrailTier | undefined =>
  TRAIL_TIERS.find((tier) => tier.slot === Math.floor(slot));

export const trailMask = (slot: number): number => 1 << (Math.floor(slot) - 1);

export const isTrailOwned = (owned: number, slot: number): boolean =>
  slot >= 1 && slot <= 16 && (owned & trailMask(slot)) !== 0;

/** Food multiplier from the equipped trail; 1 for none or an unowned slot. */
export const trailMultiplier = (slot: number, owned: number): number => {
  const tier = trailBySlot(slot);
  return tier && isTrailOwned(owned, tier.slot) ? tier.multiplier : 1;
};
