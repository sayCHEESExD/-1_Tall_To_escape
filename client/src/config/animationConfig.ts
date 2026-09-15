import type { PoseDefinition } from '../animation/PoseBuffer.js';

const deg = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Procedural animation tuning, re-tuned for this game's run speed. All
 * rotations are in character space (see `PlayerRig`): +X pitch swings a limb
 * backward, +Y yaws, +Z rolls.
 */

/** Height of the (idle) tip pivot above the feet. */
export const TIP_PIVOT_HEIGHT = 1.1;

export const LOCOMOTION = {
  strideDistance: 7,
  minFrequency: 0.6,
  maxFrequency: 3.4,
  walkSpeed: 12,
  runSpeed: 22,
  idleSpeed: 0.6,
  hipSwing: { walk: deg(28), run: deg(42) },
  kneeBend: { walk: deg(36), run: deg(70) },
  armSwing: { walk: deg(24), run: deg(40) },
  elbowBend: { walk: deg(16), run: deg(44) },
  torsoTwist: { walk: deg(5), run: deg(9) },
  torsoLean: { walk: deg(5), run: deg(13) },
  headCounterTwist: { walk: deg(3), run: deg(5) },
  bob: { walk: 0.06, run: 0.12 },
  torsoRoll: { walk: deg(2), run: deg(4) },
} as const;

export const IDLE = {
  breathFrequency: 0.35,
  breathAmount: deg(2.2),
  breathBob: 0.018,
  basePose: {
    ArmL1: { z: deg(-5) },
    ArmR1: { z: deg(5) },
    ArmL2: { x: deg(6) },
    ArmR2: { x: deg(6) },
    Spine1: { x: deg(1.5) },
  } satisfies PoseDefinition,
} as const;

export const JUMP_START = {
  duration: 0.1,
  pose: {
    Spine1: { x: deg(14) },
    Spine2: { x: deg(6) },
    Neck1: { x: deg(-8) },
    LegL1: { x: deg(-26) },
    LegR1: { x: deg(-26) },
    LegL2: { x: deg(48) },
    LegR2: { x: deg(48) },
    ArmL1: { x: deg(-120), z: deg(-12) },
    ArmR1: { x: deg(-120), z: deg(12) },
    ArmL2: { x: deg(20) },
    ArmR2: { x: deg(20) },
  } satisfies PoseDefinition,
  bobY: -0.14,
} as const;

export const AIRBORNE = {
  velocityReference: 24,
  rise: {
    Spine1: { x: deg(-6) },
    Neck1: { x: deg(4) },
    LegL1: { x: deg(-24) },
    LegR1: { x: deg(6) },
    LegL2: { x: deg(52) },
    LegR2: { x: deg(16) },
    ArmL1: { x: deg(-150), z: deg(-18) },
    ArmR1: { x: deg(-150), z: deg(18) },
    ArmL2: { x: deg(10) },
    ArmR2: { x: deg(10) },
  } satisfies PoseDefinition,
  fall: {
    Spine1: { x: deg(7) },
    Neck1: { x: deg(-6) },
    LegL1: { x: deg(-12) },
    LegR1: { x: deg(14) },
    LegL2: { x: deg(26) },
    LegR2: { x: deg(20) },
    ArmL1: { x: deg(-92), z: deg(-30) },
    ArmR1: { x: deg(-92), z: deg(30) },
    ArmL2: { x: deg(34) },
    ArmR2: { x: deg(34) },
  } satisfies PoseDefinition,
} as const;

export const LANDING = {
  duration: 0.18,
  pose: {
    Spine1: { x: deg(20) },
    Spine2: { x: deg(8) },
    Neck1: { x: deg(-12) },
    LegL1: { x: deg(-30) },
    LegR1: { x: deg(-30) },
    LegL2: { x: deg(62) },
    LegR2: { x: deg(62) },
    ArmL1: { x: deg(30), z: deg(-22) },
    ArmR1: { x: deg(30), z: deg(22) },
    ArmL2: { x: deg(40) },
    ArmR2: { x: deg(40) },
  } satisfies PoseDefinition,
  bobY: -0.22,
} as const;

/** Sitting on a dining chair: thighs forward, knees bent, body lowered onto the seat. */
export const SIT = {
  pose: {
    Spine1: { x: deg(5) },
    LegL1: { x: deg(-86) },
    LegR1: { x: deg(-86) },
    LegL2: { x: deg(90) },
    LegR2: { x: deg(90) },
    ArmL1: { x: deg(-38), z: deg(-6) },
    ArmL2: { x: deg(34) },
    ArmR1: { x: deg(-20), z: deg(6) },
    ArmR2: { x: deg(20) },
  } satisfies PoseDefinition,
  /** How far the body drops to sit, in world units. */
  bobY: -0.82,
  /** Most movement speed that still counts as sitting. */
  maxSpeed: 1.5,
} as const;

/**
 * Eating: the right hand brings the food to the mouth once per `period`, with
 * a small nod. Layered over idle, walking and sitting.
 */
export const EAT = {
  period: 0.9,
  /** Fraction of the period spent raising and lowering the hand. */
  raise: 0.65,
  shoulder: deg(-78),
  shoulderRoll: deg(-22),
  elbow: deg(118),
  nod: deg(9),
} as const;

/**
 * Tall legs: the long legs swing through a much smaller angle (a 900-unit leg
 * swinging like a normal one would sweep the whole staircase).
 */
export const TALL_ANIM = {
  /** Leg swing is divided by (1 + extra length * this). */
  dampPerUnit: 0.08,
} as const;

export const TRANSITIONS = {
  toSit: 0.22,
  toLocomotion: 0.16,
  toJumpStart: 0.05,
  toAirborne: 0.12,
  toLanding: 0.05,
} as const;

/**
 * Playback rate of the jump animations - the crouch, the airborne poses and
 * the landing - relative to their authored speed. 0.5 plays them
 * at half speed. Purely visual: jump physics are untouched.
 */
export const JUMP_ANIMATION = {
  playbackRate: 0.5,
  /** How fast the rise/fall pose follows vertical velocity, per second, before the rate. */
  airBlendRate: 10,
} as const;
