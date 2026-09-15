import { foodBySlot, foodPadAt, inHatchZone, isFoodOwned, winPadAt, type WorldCollision } from '@highjump/shared';
import type { LocalPlayer } from '../player/LocalPlayer.js';

const REQUEST_COOLDOWN = 0.4;

export interface RunActions {
  claimWin(step: number): void;
  buyFood(slot: number): void;
  enterHatchery(): void;
  leaveHatchery(): void;
}

/**
 * Turns the player's position into REQUESTS.
 *
 * It notices a win pad, a food pedestal or the Egg Shop zone underfoot and
 * asks the server, which re-checks everything against the position IT
 * simulated. A pad already claimed this attempt is not asked about again; the
 * server enforces the same rule regardless.
 */
export class RunController {
  private winCooldown = 0;
  private foodCooldown = 0;
  private ownedFoods = 1;
  private wins = 0;
  private inHatchery = false;
  /** Steps claimed since the last placement at spawn. */
  private readonly claimed = new Set<number>();

  constructor(private readonly collision: WorldCollision, private readonly actions: RunActions) {}

  setInventory(ownedFoods: number, wins: number): void {
    this.ownedFoods = ownedFoods;
    this.wins = wins;
  }

  /** A placement at spawn starts a new attempt. */
  startAttempt(): void {
    this.claimed.clear();
  }

  update(delta: number, player: LocalPlayer): void {
    this.winCooldown = Math.max(0, this.winCooldown - delta);
    this.foodCooldown = Math.max(0, this.foodCooldown - delta);
    if (player.isReturning) return;

    const { x, y, z } = player.position;
    // Missing a step does nothing special: the player lands in the pit under the
    // gap and walks out. Only a glitch outside the world waits for a placement.
    if (this.collision.isOutOfWorld(y)) {
      player.beginFallReturn();
      this.setHatchery(false);
      return;
    }

    if (player.isGrounded && this.winCooldown === 0) {
      // The feet are on the floor under the stairs; the legs must reach the pad.
      const step = winPadAt(x, y, z, player.legReach);
      if (step > 0 && !this.claimed.has(step)) {
        this.winCooldown = REQUEST_COOLDOWN;
        this.claimed.add(step);
        this.actions.claimWin(step);
      }
    }

    if (this.foodCooldown === 0) {
      const slot = foodPadAt(x, y, z);
      const tier = slot > 0 ? foodBySlot(slot) : undefined;
      if (tier && !isFoodOwned(this.ownedFoods, slot) && this.wins >= tier.cost) {
        this.foodCooldown = REQUEST_COOLDOWN;
        this.actions.buyFood(slot);
      }
    }

    this.setHatchery(inHatchZone(x, y, z));
  }

  get atHatchery(): boolean {
    return this.inHatchery;
  }

  private setHatchery(inside: boolean): void {
    if (inside === this.inHatchery) return;
    this.inHatchery = inside;
    if (inside) this.actions.enterHatchery();
    else this.actions.leaveHatchery();
  }
}
