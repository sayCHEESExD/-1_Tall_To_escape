import {
  BoxGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Bone,
} from 'three';

/**
 * Where the sole sits relative to the lower leg bone, in world units at bind
 * pose (the bone is ~0.6 above the sole, and the foot pokes slightly forward).
 */
const SOLE_OFFSET = new Vector3(0, -0.62, 0.12);

/**
 * How thick the long legs are: a little thicker the longer they get, so they
 * read from far away - but never so thick that the legs and shoes (1.5x the
 * width, beside the hips) reach past `WALL_CLEARANCE` into a boundary wall.
 */
const WIDTH = { base: 0.46, perUnit: 0.002, max: 1.2 } as const;

/** Below this much extra length the stilts are hidden. */
const MIN_VISIBLE = 0.05;

/**
 * The TALL LEGS: a long leg column under each foot, from the sole down to the
 * ground, with a shoe at the bottom.
 *
 * `PlayerCharacter` raises the whole body by exactly the extra length while
 * the legs are long, and each column spans exactly that gap, so the new feet
 * stand on the ground and the body stands on top of them.
 *
 * Parented to the two lower leg bones, so they follow walking and jumping
 * with no animation code of their own. The leg bones' local axes do not match
 * the character's, and the FBX bakes a scale onto them, so each holder is
 * placed from the bind pose: the world offset is rotated into bone space and
 * divided by the bone's world scale, and the holder is counter-rotated so the
 * column hangs straight down.
 *
 * Purely cosmetic. The length follows the replicated leg reach.
 */
export class LegStilts {
  private readonly holders: Group[] = [];
  private readonly columns: Mesh[] = [];
  private readonly shoes: Mesh[] = [];
  private readonly knees: Mesh[] = [];
  private readonly column = new BoxGeometry(1, 1, 1);
  private readonly shoe = new BoxGeometry(1, 1, 1);
  private readonly legMaterial = new MeshLambertMaterial({ color: 0x2f8fa0 });
  private readonly bandMaterial = new MeshLambertMaterial({ color: 0xf2f5f7 });
  private readonly shoeMaterial = new MeshLambertMaterial({ color: 0x1b2433 });
  private length = -1;

  constructor(legBones: readonly (Bone | null)[]) {
    // Unit box whose top face is at y = 0, so scaling Y by the length hangs it down.
    this.column.translate(0, -0.5, 0);
    this.shoe.translate(0, 0.5, 0.2);

    const boneWorld = new Quaternion();
    const boneScale = new Vector3();
    for (const bone of legBones) {
      if (!bone) continue;
      bone.updateWorldMatrix(true, false);
      bone.getWorldQuaternion(boneWorld);
      bone.getWorldScale(boneScale);
      const scale = boneScale.x || 1;
      const inverse = boneWorld.clone().invert();

      const holder = new Group();
      holder.position.copy(SOLE_OFFSET).applyQuaternion(inverse).divideScalar(scale);
      holder.quaternion.copy(inverse);
      holder.scale.setScalar(1 / scale);

      const column = new Mesh(this.column, this.legMaterial);
      const band = new Mesh(this.column, this.bandMaterial);
      const shoe = new Mesh(this.shoe, this.shoeMaterial);
      for (const mesh of [column, band, shoe]) {
        mesh.castShadow = true;
        // Skinned-model bounds are unreliable; never cull a leg off a body.
        mesh.frustumCulled = false;
        holder.add(mesh);
      }
      holder.visible = false;
      bone.add(holder);
      this.holders.push(holder);
      this.columns.push(column);
      this.knees.push(band);
      this.shoes.push(shoe);
    }
  }

  /** Show legs `extra` world units longer than normal, or hide them at 0. */
  setLength(extra: number): void {
    const length = Number.isFinite(extra) ? Math.max(0, extra) : 0;
    if (Math.abs(length - this.length) < 1e-3) return;
    this.length = length;
    const visible = length > MIN_VISIBLE;
    const width = Math.min(WIDTH.max, WIDTH.base + WIDTH.perUnit * length);
    for (let i = 0; i < this.holders.length; i += 1) {
      (this.holders[i] as Group).visible = visible;
      if (!visible) continue;
      const column = this.columns[i] as Mesh;
      column.scale.set(width, length, width);
      column.position.y = 0;
      // A white band at the top, where the long leg meets the real one.
      const band = this.knees[i] as Mesh;
      band.scale.set(width * 1.08, Math.min(0.25, length * 0.3), width * 1.08);
      band.position.y = 0;
      const shoe = this.shoes[i] as Mesh;
      shoe.scale.set(width * 1.5, Math.max(0.2, width * 0.55), width * 2);
      shoe.position.y = -length;
    }
  }

  dispose(): void {
    for (const holder of this.holders) holder.removeFromParent();
    this.column.dispose();
    this.shoe.dispose();
    this.legMaterial.dispose();
    this.bandMaterial.dispose();
    this.shoeMaterial.dispose();
  }
}
