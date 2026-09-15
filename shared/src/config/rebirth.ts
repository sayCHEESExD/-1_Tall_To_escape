/**
 * Rebirth: the prestige ladder.
 *
 * A rebirth resets the level (and the food banked toward the next one) and in
 * exchange raises the HEIGHT multiplier (taller legs at every level) and
 * unlocks the better dining tables. It also raises the FOOD COST multiplier -
 * each level after a rebirth costs more food. It never grants jumps: every
 * player has exactly one.
 *
 * Wins, foods, trails and pets are permanent and survive.
 *
 * Every number is here so the ladder is re-tuned by editing a table.
 */
export const REBIRTH = {
  /** Added to the HEIGHT multiplier per rebirth: x1, x1.5, x2, x2.5 ... */
  heightMultiplierPerRebirth: 0.5,
  /** Food cost multiplier at rebirth 0. */
  baseCostMultiplier: 1,
  /** Added to the food cost multiplier per rebirth: x1, x1.5, x2, x2.5 ... */
  costMultiplierPerRebirth: 0.5,
  /** Level the first rebirth needs. */
  baseRequiredLevel: 25,
  /**
   * Extra levels every rebirth after that: 25, 50, 75, 100 ... - the same 25
   * levels per step the staircase's recommended levels climb by.
   */
  levelsPerRebirth: 25,
} as const;

const count = (rebirths: number): number =>
  Number.isFinite(rebirths) ? Math.max(0, Math.floor(rebirths)) : 0;

/**
 * Height multiplier a rebirth count gives - the "1.5x Height" on the rebirth
 * screen. Multiplies both the height figure and the leg reach.
 */
export const rebirthHeightMultiplier = (rebirths: number): number =>
  1 + count(rebirths) * REBIRTH.heightMultiplierPerRebirth;

/** Food cost multiplier for levelling at this rebirth count. */
export const rebirthCostMultiplier = (rebirths: number): number =>
  REBIRTH.baseCostMultiplier + count(rebirths) * REBIRTH.costMultiplierPerRebirth;

/**
 * Level a player with `rebirths` must reach before their NEXT rebirth:
 * 25 for the 1st, 50 for the 2nd, 75 for the 3rd, and 25 more every time.
 * Server (eligibility) and client (the rebirth screen) both read this, from the
 * replicated rebirth count, so the requirement moves on the moment one lands.
 */
export const rebirthRequiredLevel = (rebirths: number): number =>
  REBIRTH.baseRequiredLevel + count(rebirths) * REBIRTH.levelsPerRebirth;

export const canRebirth = (level: number, rebirths: number): boolean =>
  Math.floor(level) >= rebirthRequiredLevel(rebirths);
