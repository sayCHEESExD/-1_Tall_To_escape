import {
  DINING,
  FOOD,
  JUMP_HEIGHT,
  MAX_SIM_DELTA,
  MOVEMENT,
  describeFoodRate,
  diningRate,
  legReach,
  resolveFoodRate,
  resolveHeight,
  resolveJumpPhysics,
  spendFood,
} from '@highjump/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { logger } from '../util/logger.js';

const SCOPE = 'FoodService';

interface Tracker {
  x: number;
  z: number;
  /** True until the first credit, so spawning pays nothing. */
  fresh: boolean;
}

/**
 * Server authority over food, levels and everything derived from them.
 *
 * Food is DERIVED from what the server observes - the distance between
 * consecutive authoritative positions while walking, or the time spent seated
 * at an unlocked dining table - and a single step is capped at a plausible
 * distance, so a teleport pays nothing. Standing still pays nothing. There is
 * no food message.
 *
 * The per-step rate is `resolveFoodRate` - the held food's stated value, times
 * the worn trail, times the equipped pets - and nothing else; a table then
 * multiplies a second of eating by its Height Power. Level, height and
 * rebirths never multiply food.
 *
 * `syncDerived` is THE evaluator for height, leg reach, jump physics and the
 * per-step rate. Every service that changes an input to those (a level, a
 * rebirth, a food, a trail, an equipped pet) calls it instead of computing its
 * own, and a changed rate is logged with its full breakdown.
 */
export class FoodService {
  private readonly trackers = new Map<string, Tracker>();

  initialise(player: PlayerState): void {
    this.syncDerived(player);
    this.reset(player.sessionId, player);
  }

  forget(sessionId: string): void {
    this.trackers.delete(sessionId);
  }

  /** Drop the movement baseline. Called on every placement. */
  reset(sessionId: string, player: PlayerState): void {
    this.trackers.set(sessionId, { x: player.x, z: player.z, fresh: true });
  }

  /** Food per step: the held food times the worn trail times the equipped pets. */
  rate(player: PlayerState): number {
    return resolveFoodRate(player.ownedFoods, player.trailSlot, player.ownedTrails, player.pets).perStep;
  }

  /** Credit one simulated step. Call AFTER the transform was updated. */
  credit(sessionId: string, player: PlayerState, stepSeconds: number): number {
    const tracker = this.trackers.get(sessionId);
    if (!tracker) {
      this.reset(sessionId, player);
      return 0;
    }

    const step = Number.isFinite(stepSeconds) ? Math.max(0, Math.min(stepSeconds, MAX_SIM_DELTA)) : 0;
    const perStep = this.rate(player);
    let gained = 0;

    if (!tracker.fresh) {
      if (player.dining > 0) {
        // Seated: eating on the spot. A locked table pays nothing.
        gained += DINING.eatStepsPerSecond * step * perStep * diningRate(player.dining, player.rebirths);
      } else {
        const distance = Math.hypot(player.x - tracker.x, player.z - tracker.z);
        const cap = MOVEMENT.moveSpeed * step * FOOD.creditSlack + 0.5;
        if (distance <= cap) gained += (distance / FOOD.strideDistance) * perStep;
      }
    }

    tracker.x = player.x;
    tracker.z = player.z;
    tracker.fresh = false;

    if (gained > 0) this.grant(player, gained);
    return gained;
  }

  /** Add food and spend it on levels. The only path that raises a level. */
  grant(player: PlayerState, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    player.food += amount;
    player.lifetimeFood += amount;
    const result = spendFood(player.level, player.food, player.rebirths);
    player.food = result.food;
    if (result.levelsGained > 0) {
      player.level = result.level;
      this.syncDerived(player);
    }
  }

  /** Re-derive height, leg reach, jump physics and the per-step rate. */
  syncDerived(player: PlayerState): void {
    player.level = Math.max(1, Math.floor(player.level));
    const rate = resolveFoodRate(player.ownedFoods, player.trailSlot, player.ownedTrails, player.pets);
    if (rate.perStep !== player.foodPerStep) {
      logger.info(SCOPE, `food rate ${player.sessionId || '(new)'}: ${describeFoodRate(rate)}`);
    }
    player.foodPerStep = rate.perStep;
    player.height = resolveHeight(player.level, player.rebirths);
    player.legReach = legReach(player.level, player.rebirths);
    const physics = resolveJumpPhysics(JUMP_HEIGHT);
    player.jumpVelocity = physics.velocity;
    player.gravity = physics.gravity;
  }
}
