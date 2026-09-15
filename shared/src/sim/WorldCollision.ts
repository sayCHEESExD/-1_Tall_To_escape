import {
  COURSE_END_Z,
  COURSE_SOLIDS,
  HUB,
  foodPadAt,
  halfWidthAt,
  inHatchZone,
  type CourseSolid,
} from '../config/course.js';
import { diningSeatAt } from '../config/dining.js';
import { MOVEMENT } from '../config/movement.js';
import { BODY_HEIGHT, BODY_RADIUS, OUT_OF_WORLD_Y, WALL_CLEARANCE } from '../constants/world.js';

/**
 * The gameplay shape of the world: what you can stand on, what stops you, and
 * where the triggers are.
 *
 * Lives in `shared` because BOTH sides collide against it - the server
 * simulates movement against this object and the client predicts against an
 * identical one. Solids are bucketed by Z so a substep tests a handful of
 * boxes rather than the whole world.
 *
 * Two kinds of solid:
 *  - ordinary solids (floors, walls, counters, tables, pads) collide with the
 *    player as a whole, feet included;
 *  - STEPS collide with the player's BODY only. The body sits on top of the
 *    long legs, at `bodyBaseY` above the floor, so a step's vertical front face
 *    stops the body until the legs carry it above that step's top - and the
 *    legs below it pass through the stairs. Steps are never stood on and never
 *    raise the feet.
 */

const BUCKET_SIZE = 24;

/**
 * How far below a surface the player may be and still land on it. The SAME
 * number as `MOVEMENT.stepHeight`: `surfaceYAt` offers surfaces within a step
 * of the feet and `canLandOn` must accept exactly those, or a pad a hair above
 * the floor becomes something the player falls straight through.
 */
const LANDING_TOLERANCE = MOVEMENT.stepHeight;

const CEILING_TOLERANCE = 0.05;

/**
 * How much two boxes may overlap and still count as merely TOUCHING in
 * `resolveAxis`.
 *
 * Positions reach the client as float32 (the replicated schema), so a player
 * the server stopped exactly against a face arrives a few millionths INSIDE it.
 * Without this, replaying from that position made the OTHER axis's resolve see
 * an overlap and shove the player to the far end of the box - several units
 * sideways, every server patch: the stuck-and-shaking at the shop counter.
 * A millimetre is far above float32 error at this course's coordinates and far
 * below anything a player could see.
 */
const CONTACT_EPSILON = 1e-3;

export interface CourseTriggers {
  outOfWorld: boolean;
  dining: number;
  foodPad: number;
  inHatchery: boolean;
}

type Buckets = Map<number, CourseSolid[]>;

export class WorldCollision {
  /** Ordinary solids: collide with the whole player. */
  private readonly buckets: Buckets = new Map();
  /** Steps: collide with the body only. */
  private readonly stepBuckets: Buckets = new Map();
  private readonly minBucket: number;
  private readonly maxBucket: number;

  constructor() {
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (const solid of COURSE_SOLIDS) {
      const from = bucketOf(solid.minZ);
      const to = bucketOf(solid.maxZ);
      lowest = Math.min(lowest, from);
      highest = Math.max(highest, to);
      const into = solid.kind === 'step' ? this.stepBuckets : this.buckets;
      for (let b = from; b <= to; b += 1) {
        let list = into.get(b);
        if (!list) {
          list = [];
          into.set(b, list);
        }
        list.push(solid);
      }
    }
    this.minBucket = lowest;
    this.maxBucket = highest;
  }

  private near(z: number, buckets: Buckets = this.buckets): readonly CourseSolid[] {
    const bucket = bucketOf(z);
    if (bucket < this.minBucket - 1 || bucket > this.maxBucket + 1) return EMPTY;
    SCRATCH.length = 0;
    for (let b = bucket - 1; b <= bucket + 1; b += 1) {
      const list = buckets.get(b);
      if (list) for (const solid of list) SCRATCH.push(solid);
    }
    return SCRATCH;
  }

  /** Height of the walkable surface under the feet, or null over a gap. Steps are never stood on. */
  surfaceYAt(x: number, z: number, feetY: number): number | null {
    const ceiling = feetY + MOVEMENT.stepHeight;
    let best: number | null = null;
    for (const solid of this.near(z)) {
      if (x < solid.minX - BODY_RADIUS || x > solid.maxX + BODY_RADIUS) continue;
      if (z < solid.minZ - BODY_RADIUS || z > solid.maxZ + BODY_RADIUS) continue;
      if (solid.maxY > ceiling) continue;
      if (best === null || solid.maxY > best) best = solid.maxY;
    }
    return best;
  }

  /** Underside of the lowest solid the head is about to hit, or null. */
  ceilingYAt(x: number, z: number, previousHeadY: number): number | null {
    let best: number | null = null;
    for (const solid of this.near(z)) {
      if (x < solid.minX || x > solid.maxX) continue;
      if (z < solid.minZ || z > solid.maxZ) continue;
      if (previousHeadY > solid.minY + CEILING_TOLERANCE) continue;
      if (best === null || solid.minY < best) best = solid.minY;
    }
    return best;
  }

  canLandOn(previousY: number, surfaceY: number): boolean {
    return previousY >= surfaceY - LANDING_TOLERANCE;
  }

  /**
   * Push the player out of anything it walked into along ONE axis.
   *
   * @param bodyBaseY height of the bottom of the BODY above the walkway floor
   *                  (the top of the long legs), for step collision. A step
   *                  stops the body while its top is above this; the legs
   *                  below never collide with steps. Infinity ignores steps.
   */
  resolveAxis(
    axis: 0 | 2,
    value: number,
    other: number,
    feetY: number,
    bodyBaseY: number = Number.POSITIVE_INFINITY,
  ): number {
    const headY = feetY + BODY_HEIGHT;
    const stepTop = feetY + MOVEMENT.stepHeight;
    let out = value;

    for (const solid of this.near(axis === 2 ? value : other)) {
      if (solid.maxY <= stepTop) continue;
      if (solid.minY >= headY) continue;
      out = pushOut(solid, axis, out, other);
    }

    // Steps: only the body. The body passes a step whose top is at or below
    // its base (the legs carried it over); any taller step's face stops it.
    for (const solid of this.near(axis === 2 ? out : other, this.stepBuckets)) {
      if (solid.maxY <= bodyBaseY) continue;
      out = pushOut(solid, axis, out, other);
    }
    return out;
  }

  /**
   * The boundary walls: the hub's sides and back, the walkway's sides, and the
   * far end. A CLAMP applied after every integration substep, by the server
   * and by prediction alike, so no speed, jump or leg length can tunnel it.
   *
   * The clamp keeps the player `WALL_CLEARANCE` from each wall's inner face -
   * the half-width of the whole drawn body and legs - so the model stops AT
   * the wall rather than sinking into it. The hub's FRONT wall is a real solid
   * (see `course.ts`) aligned to the same clearance, which is what lets this
   * clamp switch width at the stair mouth without shoving anyone.
   */
  clampToBounds(x: number, z: number, out: { x: number; z: number }): void {
    const minZ = HUB.minZ + WALL_CLEARANCE;
    const maxZ = COURSE_END_Z - WALL_CLEARANCE;
    out.z = z < minZ ? minZ : z > maxZ ? maxZ : z;
    const limit = halfWidthAt(out.z) - WALL_CLEARANCE;
    out.x = x < -limit ? -limit : x > limit ? limit : x;
  }

  /**
   * True only if the player is outside the world altogether - a glitch safety
   * net; normal play cannot reach it.
   */
  isOutOfWorld(y: number): boolean {
    return y <= OUT_OF_WORLD_Y;
  }

  sampleTriggers(x: number, y: number, z: number): CourseTriggers {
    return {
      outOfWorld: this.isOutOfWorld(y),
      dining: diningSeatAt(x, y, z),
      foodPad: foodPadAt(x, y, z),
      inHatchery: inHatchZone(x, y, z),
    };
  }
}

/** Push a body of `BODY_RADIUS` out of one box along one axis, if it overlaps it. */
const pushOut = (solid: CourseSolid, axis: 0 | 2, value: number, other: number): number => {
  const minA = axis === 0 ? solid.minX : solid.minZ;
  const maxA = axis === 0 ? solid.maxX : solid.maxZ;
  const minB = axis === 0 ? solid.minZ : solid.minX;
  const maxB = axis === 0 ? solid.maxZ : solid.maxX;

  // Touching a face (within float32 error) is not overlapping it.
  if (other + BODY_RADIUS <= minB + CONTACT_EPSILON || other - BODY_RADIUS >= maxB - CONTACT_EPSILON) return value;
  if (value + BODY_RADIUS <= minA + CONTACT_EPSILON || value - BODY_RADIUS >= maxA - CONTACT_EPSILON) return value;

  const pushLow = minA - BODY_RADIUS;
  const pushHigh = maxA + BODY_RADIUS;
  return value - pushLow < pushHigh - value ? pushLow : pushHigh;
};

const SCRATCH: CourseSolid[] = [];
const EMPTY: readonly CourseSolid[] = [];

const bucketOf = (z: number): number => Math.floor(z / BUCKET_SIZE);
