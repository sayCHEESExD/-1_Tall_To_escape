import { bestOwnedFood, foodPerStepFor } from './foods.js';
import { petFoodMultiplier } from './pets.js';
import { formatNumber } from './progression.js';
import { trailMultiplier } from './trails.js';

/**
 * THE food-per-step calculation, in one place, for the server (which pays it)
 * and the HUD (which shows it), so what is shown is exactly what is paid.
 *
 *   per step = held food's stated value x worn trail x equipped pets
 *
 * Seated at an unlocked dining table, a second of eating pays
 * `DINING.eatStepsPerSecond` steps times that table's Height Power. Nothing
 * else multiplies food: not level, not height, not rebirths.
 */
export interface FoodRate {
  /** Name of the food held (the best owned). */
  readonly food: string;
  /** The food's stated food per step. */
  readonly base: number;
  /** Worn trail multiplier (1 with none). */
  readonly trail: number;
  /** Equipped pets' food multiplier (1 with none). */
  readonly pets: number;
  /** base x trail x pets. */
  readonly perStep: number;
}

export const resolveFoodRate = (ownedFoods: number, trailSlot: number, ownedTrails: number, pets: string): FoodRate => {
  const base = foodPerStepFor(ownedFoods);
  const trail = trailMultiplier(trailSlot, ownedTrails);
  const pet = petFoodMultiplier(pets);
  return { food: bestOwnedFood(ownedFoods).name, base, trail, pets: pet, perStep: base * trail * pet };
};

const times = (value: number): string => `x${Number(value.toFixed(2))}`;

/** "Lollipop 35 x trail x1.5 x pets x3.4 = 178/step", for logs. */
export const describeFoodRate = (rate: FoodRate): string =>
  `${rate.food} ${formatNumber(rate.base)} x trail ${times(rate.trail)} x pets ${times(rate.pets)} = ${formatNumber(rate.perStep)}/step`;
