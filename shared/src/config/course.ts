import { BODY_RADIUS, WALL_CLEARANCE } from '../constants/world.js';
import { DINING, CHAIR_OFFSETS } from './dining.js';
import { FOOD_TIERS } from './foods.js';
import { legReach } from './progression.js';
import type { Aabb } from '../types/math.js';

/**
 * The world: a walled hub, then one clean staircase climbing along +Z.
 *
 * PURE DATA. The renderer draws exactly what is here and the collision model
 * collides against exactly `COURSE_SOLIDS`, so a platform the client draws but
 * the server does not know about is structurally impossible.
 *
 * The staircase is NOT climbed. The feet stay on the floor under it and the
 * long legs lift the body up to the step heights. The steps collide with the
 * BODY only: the body - which sits on top of the legs - is stopped by a step's
 * vertical front face until the legs are tall enough to carry it over that
 * step's top, while the legs themselves pass through the stairs. Nothing
 * checks a player's level; a step's level is a recommendation of how tall the
 * legs need to be to get the body past it.
 *
 * Orientation: the staircase climbs along +Z. At spawn the player faces +Z, so
 * their LEFT is +X and their RIGHT is -X (the camera's right is -X at yaw 0).
 */

/**
 * `step` solids are special: they collide with the player's BODY only (see
 * `WorldCollision.resolveAxis`), never with the feet or legs.
 */
export type SolidKind = 'hubFloor' | 'hubWall' | 'stairFloor' | 'step' | 'foodPad' | 'diningTable' | 'stall';

export interface CourseSolid extends Aabb {
  readonly kind: SolidKind;
}

// ---------------------------------------------------------------- stairs

export const STAIRS = {
  /** How many steps, bottom to top. */
  count: 48,
  /** Step length along Z. */
  depth: 22,
  /** Step width along X; also the width of the walkway under the stairs. */
  width: 60,
  /**
   * A step's top sits at this fraction of the leg reach at its recommended
   * level, so a player at that level stands just tall enough to reach it.
   */
  reachFraction: 0.95,
  /** Height of the walkway's side walls and far end wall (visual; the sides are a clamp). */
  wallHeight: 24,
} as const;

/** Recommended level for a step: 5, then 25, 50, 75, ... (25 per step). Informational only. */
export const STEP_LEVELS = { first: 5, perStep: 25 } as const;

/** Level recommended for a 1-based step number. Never a requirement. */
export const stepRecommendedLevel = (step: number): number => {
  const n = Math.max(1, Math.floor(step));
  return n === 1 ? STEP_LEVELS.first : STEP_LEVELS.perStep * (n - 1);
};

/**
 * Wins each step's pad pays, before the pets' multiplier: one entry per step,
 * bottom to top. Roughly x2.5 a step at first, easing to x1.45 at the top so
 * the upper steps pay for the Jungle, Desert and Ocean eggs.
 */
export const STEP_WINS: readonly number[] = [
  1, 3, 8, 20, 50, 120, 200, 400,
  800, 1_500, 2_500, 4_000, 6_500, 10_000, 15_000, 25_000,
  40_000, 60_000, 90_000, 140_000, 200_000, 300_000, 450_000, 700_000,
  1_000_000, 1_500_000, 2_200_000, 3_200_000, 4_500_000, 6_500_000, 9_000_000, 13_000_000,
  18_000_000, 25_000_000, 35_000_000, 50_000_000, 70_000_000, 100_000_000, 140_000_000, 200_000_000,
  300_000_000, 450_000_000, 650_000_000, 1_000_000_000, 1_500_000_000, 2_200_000_000, 3_200_000_000, 5_000_000_000,
];

/** Win pad footprint and its inset from the step's left (+X) edge. */
export const WIN_PAD = { width: 12, depth: 10, inset: 2, thickness: 0.3 } as const;

// -------------------------------------------------------------------- hub

export const HUB = {
  halfWidth: 72,
  minZ: -84,
  /** The hub's front edge, where the staircase begins. */
  maxZ: 44,
  floorY: 0,
  /** Height of the hub's walls (the side and back are a clamp; see `WALL_CLEARANCE`). */
  wallHeight: 26,
} as const;

export const STAIR_START_Z = HUB.maxZ;

/**
 * THE tall line: across the stair mouth, a few units in front of the first
 * step's face. Past it the legs grow to the player's leg reach; back behind
 * it, toward the base, they shrink to normal. It sits in front of the face so
 * a body stopped against the first step already stands on its long legs.
 */
export const TALL_LINE_Z = STAIR_START_Z - 3;

/**
 * The spawn area, the only place jumping works: the hub, behind the tall
 * line. On the staircase side of the line there is no jumping at all.
 */
export const canJumpAt = (z: number): boolean => z < TALL_LINE_Z;

/**
 * True where the legs are long: past the tall line, in line with the
 * staircase. Beside the mouth (still in the hub) the legs stay normal, so a
 * long-legged body only ever stands between the staircase walls.
 */
export const isPastTallLine = (x: number, z: number): boolean =>
  z >= TALL_LINE_Z && Math.abs(x) <= STAIRS.width / 2;

/**
 * Height of the bottom of the player's BODY above the walkway floor, for stair
 * collision: the top of the long legs past the tall line, the floor itself
 * behind it. Deliberately independent of jumping, so a hop never lifts the
 * body over a step face it could not otherwise pass.
 */
export const bodyBaseAt = (x: number, z: number, reach: number): number =>
  isPastTallLine(x, z) && Number.isFinite(reach) ? Math.max(0, reach) : 0;

/** Food pedestals: three rows of five down the player's LEFT (+X). */
export const FOOD_SHOP = {
  rowXs: [36, 48, 60] as readonly number[],
  firstZ: -54,
  spacingZ: 13,
  padSize: 7,
  padTop: 0.35,
  perRow: 5,
} as const;

/** The Egg Shop, just before the staircase on the player's RIGHT. */
export const EGG_SHOP = {
  x: -34,
  z: 34,
  /** Counter footprint (solid). */
  width: 12,
  depth: 3,
  height: 2.6,
  /** Standing in this rectangle opens the shop and allows hatching. */
  zone: { minX: -44, maxX: -24, minZ: 20, maxZ: 32.5 },
} as const;

/** The scoreboards stand against the RIGHT (-X) wall. */
export const SCOREBOARD = {
  x: -HUB.halfWidth + 1,
  zs: [-58, -26, 6] as readonly number[],
} as const;

export const foodPadCentre = (slot: number): { x: number; z: number } => {
  const index = Math.max(0, Math.floor(slot) - 1);
  const row = Math.floor(index / FOOD_SHOP.perRow);
  const column = index % FOOD_SHOP.perRow;
  return {
    x: FOOD_SHOP.rowXs[row] ?? FOOD_SHOP.rowXs[0] ?? 0,
    z: FOOD_SHOP.firstZ + column * FOOD_SHOP.spacingZ,
  };
};

// ------------------------------------------------------------- generation

export interface StepDefinition {
  /** 0-based across the whole staircase. */
  readonly index: number;
  /** 1-based: what the level sign and the pad say. */
  readonly number: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Height of the step's top above the walkway floor. */
  readonly top: number;
  /** Informational: the level whose legs reach this step's top. */
  readonly recommendedLevel: number;
  readonly wins: number;
}

export interface WinPadDefinition extends Aabb {
  /** 1-based step number the pad sits on. */
  readonly step: number;
  readonly wins: number;
}

const buildSteps = (): StepDefinition[] => {
  const steps: StepDefinition[] = [];
  for (let i = 0; i < STAIRS.count; i += 1) {
    const number = i + 1;
    const recommendedLevel = stepRecommendedLevel(number);
    const minZ = STAIR_START_Z + i * STAIRS.depth;
    steps.push({
      index: i,
      number,
      minX: -STAIRS.width / 2,
      maxX: STAIRS.width / 2,
      minZ,
      maxZ: minZ + STAIRS.depth,
      top: Math.round(legReach(recommendedLevel) * STAIRS.reachFraction * 10) / 10,
      recommendedLevel,
      wins: STEP_WINS[i] ?? STEP_WINS[STEP_WINS.length - 1] ?? 1,
    });
  }
  return steps;
};

export const STEPS: readonly StepDefinition[] = buildSteps();

const lastStep = STEPS[STEPS.length - 1] as StepDefinition;

/** The far end of the world. */
export const COURSE_END_Z = lastStep.maxZ;

/** Top of the highest step. */
export const COURSE_TOP_Y = lastStep.top;
/** ONE win pad on EVERY step's top, on the player's left (+X). */
export const WIN_PADS: readonly WinPadDefinition[] = STEPS.map((step) => {
  const centreZ = (step.minZ + step.maxZ) / 2;
  return {
    step: step.number,
    wins: step.wins,
    maxX: step.maxX - WIN_PAD.inset,
    minX: step.maxX - WIN_PAD.inset - WIN_PAD.width,
    minZ: centreZ - WIN_PAD.depth / 2,
    maxZ: centreZ + WIN_PAD.depth / 2,
    minY: step.top,
    maxY: step.top + WIN_PAD.thickness,
  };
});

export const stepByNumber = (number: number): StepDefinition | undefined =>
  Number.isInteger(number) ? STEPS[number - 1] : undefined;

const box = (
  kind: SolidKind,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
): CourseSolid => ({ kind, minX, maxX, minY, maxY, minZ, maxZ });

const buildSolids = (): CourseSolid[] => {
  const solids: CourseSolid[] = [];
  const half = STAIRS.width / 2;

  solids.push(box('hubFloor', -HUB.halfWidth, HUB.halfWidth, HUB.floorY - 4, HUB.floorY, HUB.minZ, HUB.maxZ));

  // The hub's front wall either side of the stair mouth. SOLID, so a player
  // walking along the front of the hub is stopped rather than clamped sideways.
  // Its inner edges sit `WALL_CLEARANCE - BODY_RADIUS` inside the mouth, so a
  // body stopped against them is exactly where the walkway clamp puts it.
  const wallTop = HUB.floorY + 400;
  const mouth = half - (WALL_CLEARANCE - BODY_RADIUS);
  solids.push(
    box('hubWall', mouth, HUB.halfWidth + 2, HUB.floorY - 4, wallTop, HUB.maxZ, HUB.maxZ + 2),
    box('hubWall', -HUB.halfWidth - 2, -mouth, HUB.floorY - 4, wallTop, HUB.maxZ, HUB.maxZ + 2),
  );

  // The walkway under the whole staircase: the feet stay on this floor.
  solids.push(box('stairFloor', -half, half, HUB.floorY - 4, HUB.floorY, STAIR_START_Z, COURSE_END_Z));

  // The steps, from the floor to their tops. BODY-only solids: their front
  // faces stop the body while the legs pass through (see `WorldCollision`).
  for (const step of STEPS) {
    solids.push(box('step', step.minX, step.maxX, HUB.floorY, step.top, step.minZ, step.maxZ));
  }

  const padHalf = FOOD_SHOP.padSize / 2;
  for (const tier of FOOD_TIERS) {
    const c = foodPadCentre(tier.slot);
    solids.push(
      box('foodPad', c.x - padHalf, c.x + padHalf, HUB.floorY, HUB.floorY + FOOD_SHOP.padTop, c.z - padHalf, c.z + padHalf),
    );
  }

  for (const x of DINING.xs) {
    solids.push(
      box(
        'diningTable',
        x - DINING.tableWidth / 2,
        x + DINING.tableWidth / 2,
        HUB.floorY,
        HUB.floorY + DINING.tableHeight,
        DINING.centerZ - DINING.tableDepth / 2,
        DINING.centerZ + DINING.tableDepth / 2,
      ),
    );
  }

  const stall = EGG_SHOP;
  solids.push(
    box(
      'stall',
      stall.x - stall.width / 2,
      stall.x + stall.width / 2,
      HUB.floorY,
      HUB.floorY + stall.height,
      stall.z - stall.depth / 2,
      stall.z + stall.depth / 2,
    ),
  );

  return solids;
};

export const COURSE_SOLIDS: readonly CourseSolid[] = buildSolids();

/** Chair centres in world space, for the renderer. */
export const DINING_CHAIRS: readonly { readonly table: number; readonly x: number; readonly z: number }[] =
  DINING.xs.flatMap((x, table) =>
    CHAIR_OFFSETS.map((chair) => ({ table: table + 1, x: x + chair.x, z: DINING.centerZ + chair.z })),
  );

// ---------------------------------------------------------------- queries

/** The step whose footprint `z` is in, or null outside the staircase. */
export const stepBehind = (z: number): StepDefinition | null => {
  if (z < STAIR_START_Z || z >= COURSE_END_Z) return null;
  return STEPS[Math.min(STEPS.length - 1, Math.floor((z - STAIR_START_Z) / STAIRS.depth))] ?? null;
};

/** Half the walkable width at `z`. */
export const halfWidthAt = (z: number): number => (z >= STAIR_START_Z ? STAIRS.width / 2 : HUB.halfWidth);

/** How far below a pad's top the top of the legs may be and still count as reaching it. */
const REACH_TOLERANCE = 0.05;

/**
 * The 1-based number of the step whose win pad this player REACHES, or 0.
 *
 * The feet are on the walkway under the stairs; the player reaches a pad when
 * they stand inside its footprint and the top of their legs (`feetY + legReach`)
 * is at or above the pad. Taller is fine - a pad is reached, or passed.
 */
export const winPadAt = (x: number, feetY: number, z: number, reach: number): number => {
  const step = stepBehind(z);
  if (!step) return 0;
  const pad = WIN_PADS[step.index];
  if (!pad) return 0;
  if (x < pad.minX || x > pad.maxX || z < pad.minZ || z > pad.maxZ) return 0;
  const top = feetY + (Number.isFinite(reach) ? Math.max(0, reach) : 0);
  return top >= pad.minY - REACH_TOLERANCE ? pad.step : 0;
};

/** The food pedestal the feet are on, or 0. */
export const foodPadAt = (x: number, y: number, z: number): number => {
  if (y > HUB.floorY + FOOD_SHOP.padTop + 1 || z > STAIR_START_Z) return 0;
  const half = FOOD_SHOP.padSize / 2 - 0.3;
  for (const tier of FOOD_TIERS) {
    const c = foodPadCentre(tier.slot);
    if (Math.abs(x - c.x) <= half && Math.abs(z - c.z) <= half) return tier.slot;
  }
  return 0;
};

/** True while standing at the Egg Shop. */
export const inHatchZone = (x: number, y: number, z: number): boolean => {
  const zone = EGG_SHOP.zone;
  return y < HUB.floorY + 2 && x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ;
};
