import { Group, Object3D } from 'three';
import type { AnimationInput } from '../animation/AnimationInput.js';
import { PlayerAnimator, type AnimationState } from '../animation/PlayerAnimator.js';
import { PlayerRig } from '../animation/rig/PlayerRig.js';
import { HeldFood } from './HeldFood.js';
import { LegStilts } from './LegStilts.js';
import { PetCompanions } from './PetCompanions.js';
import { playerModelLoader } from './PlayerModelLoader.js';
import { TrailEffect } from './TrailEffect.js';

/** How fast the legs grow or shrink toward their target length, per second. */
const LEG_RATE = 7;

/**
 * The visual half of a player, arranged so animation can never move them.
 *
 *   root          physics transform (position + facing). Gameplay owns it.
 *     lift        raises the body onto the tall legs while they are long
 *       tipPivot  hip-height pivot
 *         visual   the bob and scale effects
 *           model  the cloned FBX (or a Bloxity body), posed by the rig;
 *                  the long legs hang off its shins, the food sits in its right hand
 *   worldRoot     the trail and the pets, which live in world space
 */
export class PlayerCharacter {
  readonly root = new Group();
  readonly worldRoot = new Group();
  readonly animator: PlayerAnimator;
  readonly trail = new TrailEffect();
  readonly pets = new PetCompanions();

  private readonly lift = new Group();
  private readonly tipPivot = new Group();
  private readonly visual = new Group();
  private readonly defaultModel: Object3D;
  private model: Object3D;
  private stilts: LegStilts;
  private heldFood: HeldFood;
  private foodSlot = 1;
  /** Extra leg length now, and where it is heading, in world units. */
  private legExtra = 0;
  private legTarget = 0;

  constructor() {
    this.defaultModel = playerModelLoader.createInstance();
    this.model = this.defaultModel;
    this.root.add(this.lift);
    this.lift.add(this.tipPivot);
    this.tipPivot.add(this.visual);
    this.visual.add(this.model);
    const rig = new PlayerRig(this.model, this.model);
    this.animator = new PlayerAnimator(rig, this.tipPivot, this.visual);
    this.stilts = new LegStilts([rig.getBone('LegL2'), rig.getBone('LegR2')]);
    this.heldFood = new HeldFood(rig.getBone('ArmR2'));
    this.heldFood.setSlot(this.foodSlot);
    this.worldRoot.add(this.trail.root, this.pets.root);
  }

  /** The body currently worn: the bundled FBX or a Bloxity body. */
  get modelRoot(): Object3D {
    return this.model;
  }

  /** Current extra leg length, in world units. The camera frames the body on top of it. */
  get currentLegExtra(): number {
    return this.legExtra;
  }

  /**
   * Wear a different body, or null for the bundled one.
   *
   * The body goes into the SAME `visual` node, so nothing above it moves, and a
   * fresh rig is bound to it by bone name - Bloxity's `player.glb` carries the
   * twelve names `player.fbx` does, so the walk, sit and jump drive it
   * unchanged. The long legs and the held food are rebuilt on the new bones,
   * from the bind pose and before the body is parented, which is how they were
   * placed originally.
   *
   * @returns the model now worn
   */
  setModel(next: Object3D | null): Object3D {
    const target = next ?? this.defaultModel;
    if (target === this.model) return target;

    const previous = this.model;
    previous.removeFromParent();
    if (previous !== this.defaultModel && previous.userData['bloxityBody'] === true) {
      // A Bloxity body owns its material; its part geometry is cached and shared.
      previous.traverse((child) => {
        const material = (child as { material?: { dispose?: () => void } }).material;
        material?.dispose?.();
      });
    }

    const rig = new PlayerRig(target, target);
    rig.resetToBindPose();
    target.updateMatrixWorld(true);
    this.stilts.dispose();
    this.stilts = new LegStilts([rig.getBone('LegL2'), rig.getBone('LegR2')]);
    this.stilts.setLength(this.legExtra);
    this.heldFood.dispose();
    this.heldFood = new HeldFood(rig.getBone('ArmR2'));
    this.heldFood.setSlot(this.foodSlot);

    this.model = target;
    this.visual.add(target);
    this.animator.setRig(rig);
    return target;
  }

  setPosition(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  setYaw(yaw: number): void {
    this.root.rotation.y = yaw;
  }

  setVisualScale(x: number, y: number, z: number): void {
    this.visual.scale.set(x, y, z);
  }

  setCosmetics(trailSlot: number): void {
    this.trail.setSlot(trailSlot);
  }

  /** Hold the given food tier. */
  setFood(slot: number): void {
    this.foodSlot = slot;
    this.heldFood.setSlot(slot);
  }

  /** Show the pets equipped in an encoded inventory. */
  setPets(encoded: string): void {
    this.pets.setPets(encoded);
  }

  /** How much longer than normal the legs should be (0 behind the tall line). */
  setLegTarget(extra: number): void {
    this.legTarget = Number.isFinite(extra) ? Math.max(0, extra) : 0;
  }

  /** Jump straight to the target leg length (a placement). */
  snapLegs(): void {
    this.legExtra = this.legTarget;
    this.applyLegs();
  }

  update(delta: number, input: AnimationInput): void {
    const dt = Math.max(0, delta);
    // Grow and shrink smoothly, proportionally, so a 900-unit change takes as
    // long to play as a 9-unit one.
    this.legExtra += (this.legTarget - this.legExtra) * (1 - Math.exp(-LEG_RATE * dt));
    if (Math.abs(this.legTarget - this.legExtra) < 0.01) this.legExtra = this.legTarget;
    this.applyLegs();
    input.legExtra = this.legExtra;
    this.animator.update(dt, input);
  }

  updateEffects(delta: number, speed: number): void {
    const p = this.root.position;
    this.trail.update(delta, p.x, p.y, p.z, speed);
    this.pets.update(delta, p.x, p.y, p.z, this.root.rotation.y, speed);
  }

  get animationState(): AnimationState {
    return this.animator.currentState;
  }

  resetAnimation(): void {
    this.animator.reset();
    this.visual.scale.set(1, 1, 1);
    this.trail.clear();
  }

  dispose(): void {
    this.stilts.dispose();
    this.heldFood.dispose();
    this.pets.dispose();
    this.trail.dispose();
    this.root.removeFromParent();
    this.worldRoot.removeFromParent();
  }

  private applyLegs(): void {
    this.lift.position.y = this.legExtra;
    this.stilts.setLength(this.legExtra);
  }
}
