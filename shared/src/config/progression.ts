import { rebirthCostMultiplier, rebirthHeightMultiplier } from './rebirth.js';

/**
 * Food, levels, height and legs.
 *
 * FOOD is eaten by walking while holding food (distance the SERVER observes)
 * or by sitting at an unlocked dining table, and is SPENT to level up: whenever
 * the banked food covers the next level's cost, the server takes it and grants
 * the level. The level sets the player's HEIGHT (the progression figure) and
 * their LEG REACH (how tall a step their legs can walk up once they cross the
 * tall line onto the staircase).
 *
 * Everything the client shows here is replicated server state. The client
 * never awards food or levels.
 */
export const FOOD = {
  /**
   * World units of travel that count as one step of eating. At the walk speed
   * (24/s) this is a little over one step a second, which is what paces the
   * per-step food figures and the level costs.
   */
  strideDistance: 20,
  /** Anti-teleport slack on the per-step distance the server will credit. */
  creditSlack: 1.6,
  /**
   * Level cost is
   * `(costPerLevel * L + costPivotFood * (L / costPivotLevel) ^ costExponent) * rebirthCostMultiplier`.
   *
   * The linear term keeps the first levels quick; the power term takes over in
   * the 70s and makes the upper staircase a real grind. Tuned to the
   * reference: level 73 = 210, level 74 = 222 at rebirth 0.
   */
  costPerLevel: 1,
  costPivotLevel: 73,
  costPivotFood: 137,
  costExponent: 5.676,
  /** Multiplier on every food's per-step figure. */
  baseFoodPerStep: 1,
} as const;

/**
 * Height tuning: `base + linear * (L - 1) + quadratic * (L - 1)^2`, rounded.
 * Level 73 = 3.6K, level 74 = 3.7K.
 */
export const HEIGHT = {
  base: 10,
  linear: 0.409,
  quadratic: 0.6868,
} as const;

/**
 * Leg reach in WORLD UNITS: `base + perLevel * L + quadratic * L^2`.
 *
 * This is how tall a riser the legs step straight up once past the tall line,
 * and exactly how long the legs are drawn. Tuned so the level each step asks
 * for always reaches its rise (plus a pit's depth), with room to spare:
 * `verify-course` proves it by simulation.
 */
export const LEGS = {
  base: 8,
  perLevel: 0.14,
  quadratic: 0.00072,
} as const;

/** The jump. Not a progression axis in this game: every player jumps this high. */
export const JUMP_HEIGHT = 9;

/**
 * The largest Wins figure the server will hold.
 *
 * Wins are a `float64` on the wire - egg and trail prices run into the
 * billions, far past a uint32 - so the ceiling is the largest integer a double
 * represents exactly. Every addition saturates at it.
 */
export const MAX_WINS = Number.MAX_SAFE_INTEGER;

/** Hard ceiling on levels processed by one credit, so a bug cannot hang a tick. */
const MAX_LEVELS_PER_CREDIT = 5000;

const levelOf = (level: number): number => (Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1);

/** The height figure for a level, times the rebirth height multiplier. */
export const resolveHeight = (level: number, rebirths = 0): number => {
  const past = levelOf(level) - 1;
  return Math.round(
    (HEIGHT.base + HEIGHT.linear * past + HEIGHT.quadratic * past * past) * rebirthHeightMultiplier(rebirths),
  );
};

/** How long the legs are past the tall line, in world units, times the rebirth height multiplier. */
export const legReach = (level: number, rebirths = 0): number => {
  const at = levelOf(level);
  return (LEGS.base + LEGS.perLevel * at + LEGS.quadratic * at * at) * rebirthHeightMultiplier(rebirths);
};

/** Food needed to go from `level` to the next one. */
export const foodForNextLevel = (level: number, rebirths: number): number => {
  const at = levelOf(level);
  const base = FOOD.costPerLevel * at + FOOD.costPivotFood * (at / FOOD.costPivotLevel) ** FOOD.costExponent;
  return Math.max(1, Math.round(base * rebirthCostMultiplier(rebirths)));
};

export interface LevelState {
  readonly level: number;
  readonly food: number;
  readonly levelsGained: number;
}

/**
 * Spend banked food on as many levels as it covers.
 *
 * THE single place levels are bought. The server calls it after every credit;
 * nothing else changes a level except a rebirth resetting it.
 */
export const spendFood = (level: number, food: number, rebirths: number): LevelState => {
  let at = levelOf(level);
  let banked = Number.isFinite(food) ? Math.max(0, food) : 0;
  let gained = 0;
  while (gained < MAX_LEVELS_PER_CREDIT) {
    const cost = foodForNextLevel(at, rebirths);
    if (banked < cost) break;
    banked -= cost;
    at += 1;
    gained += 1;
  }
  return { level: at, food: banked, levelsGained: gained };
};

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'] as const;

/** Compact display form: 940, 1.5K, 3.6K, 3.1M, 800B, 1T. */
export const formatNumber = (value: number): string => {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (amount < 1000) return Math.floor(amount).toString();
  let tier = 0;
  let scaled = amount;
  while (scaled >= 1000 && tier < SUFFIXES.length - 1) {
    scaled /= 1000;
    tier += 1;
  }
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const text = scaled.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  return `${text}${SUFFIXES[tier] ?? ''}`;
};

/** "157H 42M" for the Time board. */
export const formatDuration = (seconds: number): string => {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours}H ${minutes}M` : `${minutes}M`;
};
