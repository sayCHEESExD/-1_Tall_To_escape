import { foodBySlot } from '@highjump/shared';
import { Group, Quaternion, Vector3, type Bone } from 'three';
import { buildFoodModel, disposeFoodModel } from './FoodModels.js';

/**
 * Where the palm sits relative to the lower arm bone, in world units at bind
 * pose: the arms hang down, so the hand is below the elbow and a little ahead.
 */
const HAND_OFFSET = new Vector3(0, -0.72, 0.18);

/** The held food's size, in world units. */
const HELD_SCALE = 0.55;

/**
 * The food a player is holding and eating, in their right hand.
 *
 * Parented to the right lower-arm bone, so it follows walking, eating and
 * jumping with no animation code of its own. The holder is placed from the
 * bind pose exactly as the leg stilts are: the world offset rotated into bone
 * space and divided by the bone's world scale, counter-rotated so the food
 * stays upright relative to the character.
 *
 * Purely cosmetic. Which food is held is replicated server state (the best one
 * owned).
 */
export class HeldFood {
  private readonly holder: Group | null = null;
  private model: Group | null = null;
  private slot = -1;

  constructor(handBone: Bone | null) {
    if (!handBone) return;
    handBone.updateWorldMatrix(true, false);
    const boneWorld = new Quaternion();
    const boneScale = new Vector3();
    handBone.getWorldQuaternion(boneWorld);
    handBone.getWorldScale(boneScale);
    const scale = boneScale.x || 1;
    const inverse = boneWorld.clone().invert();

    const holder = new Group();
    holder.position.copy(HAND_OFFSET).applyQuaternion(inverse).divideScalar(scale);
    holder.quaternion.copy(inverse);
    holder.scale.setScalar(1 / scale);
    handBone.add(holder);
    this.holder = holder;
  }

  get currentSlot(): number {
    return this.slot;
  }

  /** Hold the given food tier. */
  setSlot(slot: number): void {
    if (slot === this.slot || !this.holder) return;
    this.slot = slot;
    if (this.model) disposeFoodModel(this.model);
    this.model = null;
    const tier = foodBySlot(slot);
    if (!tier) return;
    const model = buildFoodModel(tier);
    model.scale.setScalar(HELD_SCALE);
    model.position.y = -0.2;
    model.traverse((child) => {
      // Skinned-model bounds are unreliable; never cull food out of a hand.
      child.frustumCulled = false;
    });
    this.holder.add(model);
    this.model = model;
  }

  dispose(): void {
    if (this.model) disposeFoodModel(this.model);
    this.model = null;
    this.holder?.removeFromParent();
  }
}
