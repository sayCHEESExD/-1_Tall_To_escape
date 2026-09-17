import { bestOwnedFood, diningRate, isPastTallLine, parseAvatarLook } from '@highjump/shared';
import { createAnimationInput, type AnimationInput } from '../animation/AnimationInput.js';
import { BloxityAvatar } from '../bloxity/BloxityAvatar.js';
import { toLegionEquipped } from '../bloxity/legionTypes.js';
import type { NetPlayerState } from '../net/netTypes.js';
import { PlayerCharacter } from './PlayerCharacter.js';

const FOLLOW_RATE = 14;
/** A tall step up is followed a little more slowly, so the body rises onto it. */
const FOLLOW_RATE_Y = 9;
/** Horizontal distance past which a remote is placed rather than walked. */
const SNAP_DISTANCE = 16;
const EATING_SPEED = 1;

const shortestAngle = (from: number, to: number): number => {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
};

/**
 * Another player, rendered from replicated state only.
 *
 * Animation is reconstructed by the same animator the local player runs. One-shot
 * edges are DERIVED from monotonic counters against a baseline taken on first
 * sight, so a stranger's lifetime of jumps is never replayed on join. Their
 * legs, held food and pets are derived from replicated level, position, foods
 * and pets, and their BLOXITY AVATAR from the look the server replicated - the
 * same look their own client is wearing, default avatar included.
 *
 * Remotes are ghosted: they never collide with anyone.
 */
export class RemotePlayer {
  readonly character = new PlayerCharacter();

  private targetX = 0;
  private targetY = 0;
  private targetZ = 0;
  private targetYaw = 0;
  private readonly input: AnimationInput = createAnimationInput();

  private lastJumpCount: number;
  private wasGrounded = true;
  private placed = false;
  /** Their Bloxity look, built on first sight of one and rebuilt when it changes. */
  private avatar: BloxityAvatar | null = null;
  private lastLook = '';

  constructor(state: NetPlayerState) {
    this.lastJumpCount = state.jumpCount;
    this.apply(state);
    this.character.setPosition(this.targetX, this.targetY, this.targetZ);
    this.character.setYaw(this.targetYaw);
    this.character.snapLegs();
    this.placed = true;
  }

  apply(state: NetPlayerState): void {
    this.targetX = state.x;
    this.targetY = state.y;
    this.targetZ = state.z;
    this.targetYaw = state.rotationY;

    const seated = state.dining > 0 && diningRate(state.dining, state.rebirths) > 0;
    this.input.grounded = state.grounded;
    this.input.horizontalSpeed = state.speed;
    this.input.verticalVelocity = state.verticalVelocity;
    this.input.seated = seated;
    this.input.eating = state.grounded && (seated || state.speed > EATING_SPEED);

    if (state.jumpCount > this.lastJumpCount) this.input.jumpStarted = true;
    this.lastJumpCount = state.jumpCount;

    if (!this.wasGrounded && state.grounded) this.input.landed = true;
    this.wasGrounded = state.grounded;

    this.character.setIdentity(state.displayName, state.avatarUrl);
    this.wearAvatar(state.avatar);
    this.character.setCosmetics(state.trailSlot);
    this.character.setFood(bestOwnedFood(state.ownedFoods).slot);
    this.character.setPets(state.pets);
    this.character.setLegTarget(isPastTallLine(state.x, state.z) ? state.legReach : 0);
  }

  update(delta: number): void {
    const dt = Math.max(0, delta);
    const position = this.character.root.position;
    const gap = Math.hypot(this.targetX - position.x, this.targetZ - position.z);

    if (!this.placed || gap > SNAP_DISTANCE) {
      position.set(this.targetX, this.targetY, this.targetZ);
      this.character.setYaw(this.targetYaw);
      if (gap > SNAP_DISTANCE) {
        this.character.trail.clear();
        this.character.snapLegs();
      }
      this.placed = true;
    } else {
      const alpha = 1 - Math.exp(-FOLLOW_RATE * dt);
      position.x += (this.targetX - position.x) * alpha;
      position.y += (this.targetY - position.y) * (1 - Math.exp(-FOLLOW_RATE_Y * dt));
      position.z += (this.targetZ - position.z) * alpha;
      const yaw = this.character.root.rotation.y;
      this.character.setYaw(yaw + shortestAngle(yaw, this.targetYaw) * alpha);
    }

    this.character.update(dt, this.input);
    this.character.updateEffects(dt, this.input.horizontalSpeed);
    this.input.jumpStarted = false;
    this.input.landed = false;
  }

  /**
   * Dress them the way Bloxity dresses them. An empty look means they have no
   * Bloxity data at all, which is the one case that keeps the bundled body.
   */
  private wearAvatar(encoded: string): void {
    if (encoded === this.lastLook) return;
    this.lastLook = encoded;
    const look = parseAvatarLook(encoded);
    if (!look) {
      this.avatar?.dispose();
      this.avatar = null;
      this.character.setModel(null);
      return;
    }
    this.avatar ??= new BloxityAvatar(this.character);
    this.avatar.apply(toLegionEquipped(look), look.proportions);
  }

  dispose(): void {
    this.avatar?.dispose();
    this.character.dispose();
  }
}
