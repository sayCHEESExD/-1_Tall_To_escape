import {
  MAX_SIM_DELTA,
  WorldCollision,
  createMotion,
  createSimEvents,
  horizontalSpeed,
  resetMotion,
  sanitiseInput,
  stepPlayer,
  type MoveMessage,
  type PlayerMotion,
  type SimEvents,
} from '@highjump/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/**
 * Simulated seconds a client may bank per real second. Inputs carry their own
 * delta so a laggy client can catch up, but the total stays near real time.
 */
const MAX_TIME_BUDGET_RATIO = 1.5;
const INITIAL_BUDGET = 0.5;

/** Largest jump in sequence number the server will follow. */
const MAX_SEQ_JUMP = 600;

interface Sim {
  motion: PlayerMotion;
  events: SimEvents;
  lastSeq: number;
  budget: number;
  lastRefill: number;
}

/**
 * Server-authoritative movement.
 *
 * The client sends INPUT only; this runs the shared simulation and the result
 * becomes the player's transform. Gravity, jump speed and the leg reach (where
 * the body meets the stair faces) come from the player's replicated
 * progression, which only the server writes.
 */
export class MovementService {
  private readonly sims = new Map<string, Sim>();
  readonly collision = new WorldCollision();

  private lastStepSeconds = 0;

  initialise(player: PlayerState): void {
    const sim: Sim = {
      motion: createMotion(),
      events: createSimEvents(),
      lastSeq: 0,
      budget: INITIAL_BUDGET,
      lastRefill: Date.now(),
    };
    this.sims.set(player.sessionId, sim);
    this.publish(player, sim);
  }

  forget(sessionId: string): void {
    this.sims.delete(sessionId);
  }

  /** Seconds the last accepted input advanced the simulation. */
  get lastStep(): number {
    return this.lastStepSeconds;
  }

  teleport(sessionId: string, player: PlayerState, x: number, y: number, z: number, yaw: number): void {
    const sim = this.sims.get(sessionId);
    if (!sim) return;
    resetMotion(sim.motion, x, y, z, yaw);
    this.publish(player, sim);
  }

  /** Consume one input. Returns true when it was simulated. */
  applyInput(sessionId: string, player: PlayerState, message: MoveMessage): boolean {
    const sim = this.sims.get(sessionId);
    if (!sim) return false;

    const seq = message?.seq;
    const dt = message?.dt;
    if (typeof seq !== 'number' || !Number.isFinite(seq)) return false;
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) return false;
    if (seq <= sim.lastSeq) return false;
    if (seq > sim.lastSeq + MAX_SEQ_JUMP) return false;

    const step = Math.min(dt, MAX_SIM_DELTA);
    this.refill(sim);
    // Not acknowledged when over budget: the client replays it later.
    if (step > sim.budget) return false;
    sim.budget -= step;
    sim.lastSeq = seq;
    this.lastStepSeconds = step;

    stepPlayer(
      sim.motion,
      sanitiseInput(message),
      {
        jumpVelocity: player.jumpVelocity,
        gravity: player.gravity,
        legReach: player.legReach,
      },
      step,
      this.collision,
      sim.events,
    );

    this.publish(player, sim);
    return true;
  }

  private publish(player: PlayerState, sim: Sim): void {
    const m = sim.motion;
    player.x = m.x;
    player.y = m.y;
    player.z = m.z;
    player.rotationY = m.yaw;
    player.velocityX = m.vx;
    player.velocityY = m.vy;
    player.velocityZ = m.vz;
    player.verticalVelocity = m.vy;
    player.speed = horizontalSpeed(m);
    player.grounded = m.grounded;
    player.jumpCount = m.jumpCount;
    player.jumpLatched = m.jumpLatched;
    player.coyote = m.coyote;
    player.dining = m.dining;
    player.lastInputSeq = sim.lastSeq;
    player.ready = true;
  }

  private refill(sim: Sim): void {
    const now = Date.now();
    const elapsed = Math.max(0, (now - sim.lastRefill) / 1000);
    sim.lastRefill = now;
    sim.budget = Math.min(sim.budget + elapsed * MAX_TIME_BUDGET_RATIO, MAX_SIM_DELTA * 20);
  }
}
