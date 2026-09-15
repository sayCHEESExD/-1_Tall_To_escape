import { bodyBaseAt, canJumpAt } from '../config/course.js';
import { diningSeatAt } from '../config/dining.js';
import { MOVEMENT } from '../config/movement.js';
import { BODY_HEIGHT, SPAWN_POSITION, SPAWN_ROTATION_Y } from '../constants/world.js';
import { rotateTowards } from '../types/math.js';
import type { WorldCollision } from './WorldCollision.js';

/**
 * The authoritative physics step, shared by the server and client prediction.
 *
 * THE movement simulation. The server runs it to own the result and the client
 * runs the identical function to predict, so the two can only disagree through
 * inputs, never through different maths. Allocation-free.
 *
 * Tall legs never move the feet: the feet stay on the floor under the stairs.
 * What the legs change is where the BODY is - on top of them - and the steps
 * collide with the body only, so a step's front face stops the player until
 * the legs lift the body over that step, while the legs pass through the
 * stairs. There is exactly ONE jump - no air jumps - and only in the spawn
 * area (`canJumpAt`); on the map there is no jumping.
 */

export interface PlayerMotion {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  grounded: boolean;
  /** Edge-detect for the jump control, so holding it does not re-fire. */
  jumpLatched: boolean;
  /** Monotonic count of jumps started, so remotes can play the jump. */
  jumpCount: number;
  /** Dining table the player is seated at, derived from position every step. */
  dining: number;
  /** Seconds of coyote time left. */
  coyote: number;
}

export interface MovementInput {
  moveX: number;
  moveZ: number;
  jump: boolean;
  cameraYaw: number;
}

/** Server-owned tuning the step reads but never changes. */
export interface SimParams {
  jumpVelocity: number;
  gravity: number;
  /** Leg reach in world units: where the body sits past the tall line, for stair collision. */
  legReach: number;
}

export interface SimEvents {
  jumpStarted: boolean;
  landed: boolean;
}

export const MAX_SIM_DELTA = 0.1;

export const createMotion = (): PlayerMotion => ({
  x: SPAWN_POSITION.x,
  y: SPAWN_POSITION.y,
  z: SPAWN_POSITION.z,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: SPAWN_ROTATION_Y,
  grounded: true,
  jumpLatched: false,
  jumpCount: 0,
  dining: 0,
  coyote: 0,
});

export const createSimEvents = (): SimEvents => ({
  jumpStarted: false,
  landed: false,
});

export const createMovementInput = (): MovementInput => ({
  moveX: 0,
  moveZ: 0,
  jump: false,
  cameraYaw: 0,
});

export const copyMotion = (from: PlayerMotion, to: PlayerMotion): void => {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.yaw = from.yaw;
  to.grounded = from.grounded;
  to.jumpLatched = from.jumpLatched;
  to.jumpCount = from.jumpCount;
  to.dining = from.dining;
  to.coyote = from.coyote;
};

export const resetMotion = (
  motion: PlayerMotion,
  x = SPAWN_POSITION.x,
  y = SPAWN_POSITION.y,
  z = SPAWN_POSITION.z,
  yaw = SPAWN_ROTATION_Y,
): void => {
  motion.x = x;
  motion.y = y;
  motion.z = z;
  motion.vx = 0;
  motion.vy = 0;
  motion.vz = 0;
  motion.yaw = yaw;
  motion.grounded = true;
  motion.jumpLatched = false;
  motion.dining = 0;
  motion.coyote = 0;
};

export const horizontalSpeed = (motion: PlayerMotion): number => Math.hypot(motion.vx, motion.vz);

/** Clamp an arriving input to sane, finite values. Applied by the server. */
export const sanitiseInput = (input: Partial<MovementInput> | undefined): MovementInput => {
  const finite = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  let moveX = finite(input?.moveX);
  let moveZ = finite(input?.moveZ);
  const magnitude = Math.hypot(moveX, moveZ);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveZ /= magnitude;
  }
  return {
    moveX,
    moveZ,
    jump: input?.jump === true,
    cameraYaw: finite(input?.cameraYaw),
  };
};

const BOUNDS = { x: 0, z: 0 };

/** Advance one player by one step. */
export const stepPlayer = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  delta: number,
  collision: WorldCollision,
  events: SimEvents,
): void => {
  events.jumpStarted = false;
  events.landed = false;

  const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), MAX_SIM_DELTA) : 0;
  if (dt === 0) return;

  const wasGrounded = motion.grounded;

  applyJump(motion, input, params, events);
  applyHorizontal(motion, input, dt);

  motion.vy -= safe(params.gravity, 60) * dt;
  const terminal = Math.max(MOVEMENT.minTerminal, safe(params.jumpVelocity, 40) * MOVEMENT.terminalFactor);
  if (motion.vy < -terminal) motion.vy = -terminal;

  // Substep until no substep travels further than `maxSubstepDistance`, so a
  // fast fall collides as reliably as a first hop.
  const travel = Math.hypot(motion.vx, motion.vy, motion.vz) * dt;
  const substeps = Math.max(
    1,
    Math.min(Math.ceil(travel / MOVEMENT.maxSubstepDistance), MOVEMENT.maxSubsteps),
  );
  const sub = dt / substeps;
  for (let i = 0; i < substeps; i += 1) integrate(motion, sub, collision, params.legReach);

  if (motion.grounded) motion.coyote = MOVEMENT.coyoteTime;
  else motion.coyote = Math.max(0, motion.coyote - dt);

  motion.dining = motion.grounded ? diningSeatAt(motion.x, motion.y, motion.z) : 0;

  if (!wasGrounded && motion.grounded) events.landed = true;
};

const safe = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const integrate = (motion: PlayerMotion, dt: number, collision: WorldCollision, legReach: number): void => {
  const previousY = motion.y;
  // Where the body sits for stair collision, measured where this substep starts.
  const bodyBase = bodyBaseAt(motion.x, motion.z, legReach);

  motion.x += motion.vx * dt;
  const correctedX = collision.resolveAxis(0, motion.x, motion.z, motion.y, bodyBase);
  if (correctedX !== motion.x) {
    motion.x = correctedX;
    motion.vx = 0;
  }

  motion.z += motion.vz * dt;
  const correctedZ = collision.resolveAxis(2, motion.z, motion.x, motion.y, bodyBase);
  if (correctedZ !== motion.z) {
    motion.z = correctedZ;
    motion.vz = 0;
  }

  motion.y += motion.vy * dt;

  collision.clampToBounds(motion.x, motion.z, BOUNDS);
  motion.x = BOUNDS.x;
  motion.z = BOUNDS.z;

  resolveCeiling(motion, previousY, collision);
  resolveGround(motion, previousY, collision);
};

/**
 * THE jump: one, from the ground (or within coyote time), in the spawn area.
 * A press while airborne does nothing - there are no air jumps.
 *
 * Decided from the simulation's own state, so a client cannot conjure a jump
 * whatever it sends - the most it can do is predict one the server refuses.
 */
const applyJump = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  events: SimEvents,
): void => {
  const pressed = input.jump && !motion.jumpLatched;
  motion.jumpLatched = input.jump;
  if (!pressed) return;
  // Jumping only exists in the spawn area; on the map a press does nothing.
  if (!canJumpAt(motion.z)) return;
  if (!motion.grounded && motion.coyote <= 0) return;

  motion.vy = safe(params.jumpVelocity, 40);
  motion.grounded = false;
  motion.coyote = 0;
  motion.jumpCount += 1;
  events.jumpStarted = true;
};

const applyHorizontal = (motion: PlayerMotion, input: MovementInput, dt: number): void => {
  const hasInput = input.moveX !== 0 || input.moveZ !== 0;

  // The camera looks along (sin, cos); its RIGHT is (-cos, sin).
  const sin = Math.sin(input.cameraYaw);
  const cos = Math.cos(input.cameraYaw);
  const dirX = input.moveZ * sin - input.moveX * cos;
  const dirZ = input.moveZ * cos + input.moveX * sin;

  const targetSpeed = MOVEMENT.moveSpeed;
  const control = motion.grounded ? 1 : MOVEMENT.airControl;

  if (hasInput) {
    const accel = MOVEMENT.acceleration * control * dt;
    const rate = Math.min(accel / targetSpeed, 1);
    motion.vx += (dirX * targetSpeed - motion.vx) * rate;
    motion.vz += (dirZ * targetSpeed - motion.vz) * rate;
    motion.yaw = rotateTowards(motion.yaw, Math.atan2(dirX, dirZ), MOVEMENT.turnSpeed * dt);
  } else {
    // Braking on the ground, and a lighter brake in the air, so releasing the
    // stick mid-jump lands where the player meant rather than sailing on.
    const drop = MOVEMENT.deceleration * (motion.grounded ? 1 : 0.35) * dt;
    const speed = horizontalSpeed(motion);
    if (speed <= drop || speed < 1e-6) {
      motion.vx = 0;
      motion.vz = 0;
    } else {
      const scale = (speed - drop) / speed;
      motion.vx *= scale;
      motion.vz *= scale;
    }
  }
};

const resolveCeiling = (motion: PlayerMotion, previousY: number, collision: WorldCollision): void => {
  if (motion.vy <= 0) return;
  const ceiling = collision.ceilingYAt(motion.x, motion.z, previousY + BODY_HEIGHT);
  if (ceiling === null || motion.y + BODY_HEIGHT <= ceiling) return;
  motion.y = ceiling - BODY_HEIGHT;
  motion.vy = 0;
};

const resolveGround = (motion: PlayerMotion, previousY: number, collision: WorldCollision): void => {
  const surfaceY = collision.surfaceYAt(motion.x, motion.z, previousY);
  if (surfaceY === null || motion.vy > 0 || motion.y > surfaceY) {
    motion.grounded = false;
    return;
  }
  if (!collision.canLandOn(previousY, surfaceY)) {
    motion.grounded = false;
    return;
  }
  motion.y = surfaceY;
  motion.vy = 0;
  motion.grounded = true;
};
