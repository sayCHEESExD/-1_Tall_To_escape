import { FOOD } from './progression.js';

/**
 * Foods: the food-per-step ladder sold in the Food Shop on the player's LEFT.
 *
 * Bought by WALKING ONTO the food's pedestal while holding the Wins. Wins are
 * spent, and the best food owned is always the one held and eaten, so buying a
 * cheaper food later can never downgrade anybody. Lettuce is free and owned by
 * everyone from the start.
 *
 * Pure data. Change a price or a rate here and the pedestal sign, the server
 * and the verification script all follow.
 */
export type FoodShape =
  | 'lettuce'
  | 'bread'
  | 'apple'
  | 'lollipop'
  | 'sandwich'
  | 'hotdog'
  | 'steak'
  | 'chocolate'
  | 'cupcake'
  | 'pizza'
  | 'cake'
  | 'donut'
  | 'goldenApple'
  | 'iceCream'
  | 'burger';

export interface FoodTier {
  /** 1-based slot. Also the bit in the owned mask and the pedestal's place. */
  readonly slot: number;
  readonly name: string;
  /** Food granted per step while held. */
  readonly foodPerStep: number;
  /** Wins deducted on purchase. */
  readonly cost: number;
  /** Presentation colours. */
  readonly color: number;
  readonly accent: number;
  readonly shape: FoodShape;
}

export const FOOD_TIERS: readonly FoodTier[] = [
  { slot: 1, name: 'Lettuce', foodPerStep: 1, cost: 0, color: 0x6ad64a, accent: 0xc8f59a, shape: 'lettuce' },
  { slot: 2, name: 'Bread', foodPerStep: 3, cost: 2, color: 0xd9953f, accent: 0xf6d69a, shape: 'bread' },
  { slot: 3, name: 'Apple', foodPerStep: 10, cost: 8, color: 0xe8313a, accent: 0x5a3a1a, shape: 'apple' },
  { slot: 4, name: 'Lollipop', foodPerStep: 35, cost: 40, color: 0xff4fa3, accent: 0xffffff, shape: 'lollipop' },
  { slot: 5, name: 'Sandwich', foodPerStep: 125, cost: 125, color: 0xf2c98a, accent: 0x5cc24a, shape: 'sandwich' },
  { slot: 6, name: 'Hot Dog', foodPerStep: 400, cost: 600, color: 0xc4502a, accent: 0xffd23d, shape: 'hotdog' },
  { slot: 7, name: 'Steak', foodPerStep: 1_500, cost: 2_500, color: 0x9a3b22, accent: 0xf5efe6, shape: 'steak' },
  { slot: 8, name: 'Chocolate Bar', foodPerStep: 5_000, cost: 8_000, color: 0x5c3317, accent: 0xd63a3a, shape: 'chocolate' },
  { slot: 9, name: 'Cupcake', foodPerStep: 18_000, cost: 30_000, color: 0xff9ecf, accent: 0x8a5a2b, shape: 'cupcake' },
  { slot: 10, name: 'Pizza', foodPerStep: 60_000, cost: 100_000, color: 0xf5c542, accent: 0xd6452a, shape: 'pizza' },
  { slot: 11, name: 'Cake', foodPerStep: 200_000, cost: 400_000, color: 0xfff1f7, accent: 0xff5f9a, shape: 'cake' },
  { slot: 12, name: 'Diamond Donut', foodPerStep: 750_000, cost: 1_500_000, color: 0x9fe8ff, accent: 0xffffff, shape: 'donut' },
  { slot: 13, name: 'Golden Apple', foodPerStep: 3_000_000, cost: 6_000_000, color: 0xffc933, accent: 0xfff4b0, shape: 'goldenApple' },
  { slot: 14, name: 'Rainbow Ice Cream', foodPerStep: 12_000_000, cost: 25_000_000, color: 0xff6ad5, accent: 0x6ad5ff, shape: 'iceCream' },
  { slot: 15, name: 'Galaxy Burger', foodPerStep: 50_000_000, cost: 100_000_000, color: 0x7b5bff, accent: 0xff4fd0, shape: 'burger' },
];

/** Lettuce: owned by everyone, free. */
export const STARTER_FOOD = 1;

export const foodBySlot = (slot: number): FoodTier | undefined =>
  FOOD_TIERS.find((tier) => tier.slot === Math.floor(slot));

export const foodMask = (slot: number): number => 1 << (Math.floor(slot) - 1);

/** The starter food is always owned, whatever the mask says. */
export const isFoodOwned = (owned: number, slot: number): boolean =>
  slot >= 1 && slot <= 16 && ((owned | foodMask(STARTER_FOOD)) & foodMask(slot)) !== 0;

/** The best food in an owned mask. Never null: Lettuce is always owned. */
export const bestOwnedFood = (owned: number): FoodTier => {
  let best = FOOD_TIERS[0] as FoodTier;
  for (const tier of FOOD_TIERS) {
    if (isFoodOwned(owned, tier.slot) && tier.foodPerStep > best.foodPerStep) best = tier;
  }
  return best;
};

/** Food per step for an owned mask, before trails, pets and tables. */
export const foodPerStepFor = (owned: number): number =>
  bestOwnedFood(owned).foodPerStep * FOOD.baseFoodPerStep;
