import { COURSE_END_Z, HUB, equippedPetIds, halfWidthAt, petById, type PetDefinition } from '@highjump/shared';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Material,
} from 'three';

/** Where each follower walks, in the owner's frame: x to the side, z behind. */
const SLOTS: readonly { readonly x: number; readonly z: number }[] = [
  { x: 2.2, z: -2.2 },
  { x: -2.2, z: -2.2 },
  { x: 0, z: -3.6 },
];

const FOLLOW_RATE = 6;
/** A follower further than this from its spot is placed, not walked. */
const SNAP_DISTANCE = 40;
/** How close a follower may come to a boundary wall. */
const PET_WALL_CLEARANCE = 1;

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);

/**
 * The equipped pets, following their owner around.
 *
 * Built from coloured boxes like the rest of the scenery, one small group per
 * pet, living in WORLD space (under the character's `worldRoot`) so they trail
 * behind rather than being bolted to the body. They walk on the owner's
 * ground level - past the tall line they potter about the owner's feet - and
 * hop while the owner moves.
 *
 * Purely cosmetic: which pets are equipped is replicated server state.
 */
export class PetCompanions {
  readonly root = new Group();
  private readonly followers: { group: Group; phase: number; placed: boolean }[] = [];
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly materials: Material[] = [];
  private signature = '';
  private time = 0;

  /** Show the pets equipped in an encoded inventory. */
  setPets(encoded: string): void {
    const ids = equippedPetIds(encoded);
    const signature = ids.join(',');
    if (signature === this.signature) return;
    this.signature = signature;
    this.clear();
    ids.forEach((id, index) => {
      const pet = petById(id);
      if (!pet) return;
      const group = this.build(pet);
      this.root.add(group);
      this.followers.push({ group, phase: index * 2.1, placed: false });
    });
  }

  update(delta: number, x: number, y: number, z: number, yaw: number, speed: number): void {
    if (this.followers.length === 0) return;
    this.time += delta;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const alpha = 1 - Math.exp(-FOLLOW_RATE * Math.max(0, delta));
    const moving = speed > 1;

    this.followers.forEach((follower, index) => {
      const slot = SLOTS[index] ?? SLOTS[0];
      if (!slot) return;
      // Owner's local (x right-ish, z forward) into world space.
      // Owner's local offset into world space, kept inside the boundary walls
      // so a follower beside a player at a wall never walks into it.
      const tz = clamp(z - slot.x * sin + slot.z * cos, HUB.minZ + PET_WALL_CLEARANCE, COURSE_END_Z - PET_WALL_CLEARANCE);
      const half = halfWidthAt(tz) - PET_WALL_CLEARANCE;
      const tx = clamp(x + slot.x * cos + slot.z * sin, -half, half);
      const position = follower.group.position;
      const far = Math.hypot(tx - position.x, tz - position.z, y - position.y) > SNAP_DISTANCE;
      if (!follower.placed || far) {
        position.set(tx, y, tz);
        follower.placed = true;
      } else {
        position.x += (tx - position.x) * alpha;
        position.z += (tz - position.z) * alpha;
        position.y += (y - position.y) * alpha;
      }
      const t = this.time * (moving ? 9 : 2.2) + follower.phase;
      const hop = moving ? Math.abs(Math.sin(t)) * 0.55 : (Math.sin(t) + 1) * 0.08;
      (follower.group.children[0] as Group).position.y = hop;
      // Face the way the owner is facing, with a little wobble.
      follower.group.rotation.y = yaw + Math.sin(this.time * 3 + follower.phase) * 0.12;
    });
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.root.removeFromParent();
  }

  private clear(): void {
    for (const follower of this.followers) follower.group.removeFromParent();
    this.followers.length = 0;
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
  }

  private material(color: number, emissive = false): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color });
    if (emissive) {
      material.emissive.setHex(color);
      material.emissiveIntensity = 0.35;
    }
    this.materials.push(material);
    return material;
  }

  /** One pet: an outer group placed in the world, an inner group that hops. */
  private build(pet: PetDefinition): Group {
    const outer = new Group();
    const body = new Group();
    outer.add(body);
    const glow = pet.rarity === 'Legendary' || pet.rarity === 'Epic';
    const main = this.material(pet.color, pet.rarity === 'Legendary');
    const accent = this.material(pet.accent, glow);
    const ink = this.material(0x12181f);
    const add = (material: Material, w: number, h: number, d: number, x: number, y: number, z: number, rz = 0): void => {
      const mesh = new Mesh(this.geometry, material);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.rotation.z = rz;
      mesh.castShadow = true;
      body.add(mesh);
    };
    const eyes = (y: number, z: number, spread = 0.2): void => {
      add(ink, 0.12, 0.14, 0.05, spread, y, z);
      add(ink, 0.12, 0.14, 0.05, -spread, y, z);
    };

    switch (pet.body) {
      case 'bunny':
        add(main, 0.8, 0.7, 0.9, 0, 0.35, 0);
        add(main, 0.6, 0.55, 0.55, 0, 0.95, 0.3);
        add(main, 0.14, 0.6, 0.12, 0.16, 1.5, 0.25);
        add(main, 0.14, 0.6, 0.12, -0.16, 1.5, 0.25);
        add(accent, 0.08, 0.4, 0.05, 0.16, 1.5, 0.32);
        add(accent, 0.08, 0.4, 0.05, -0.16, 1.5, 0.32);
        add(accent, 0.25, 0.25, 0.25, 0, 0.45, -0.5);
        eyes(1.0, 0.58, 0.15);
        break;
      case 'bird':
        add(main, 0.75, 0.8, 0.75, 0, 0.45, 0);
        add(main, 0.55, 0.5, 0.5, 0, 1.05, 0.12);
        add(accent, 0.2, 0.12, 0.3, 0, 1.0, 0.45);
        add(accent, 0.12, 0.5, 0.55, 0.43, 0.5, -0.05, 0.3);
        add(accent, 0.12, 0.5, 0.55, -0.43, 0.5, -0.05, -0.3);
        eyes(1.12, 0.38, 0.14);
        break;
      case 'cat':
        add(main, 0.7, 0.6, 1.1, 0, 0.45, 0);
        add(main, 0.65, 0.6, 0.6, 0, 1.0, 0.45);
        add(main, 0.18, 0.25, 0.12, 0.2, 1.4, 0.45, 0.2);
        add(main, 0.18, 0.25, 0.12, -0.2, 1.4, 0.45, -0.2);
        add(accent, 0.3, 0.2, 0.08, 0, 0.88, 0.76);
        add(main, 0.14, 0.14, 0.7, 0, 0.8, -0.8);
        for (const [x, z] of [[0.22, 0.35], [-0.22, 0.35], [0.22, -0.35], [-0.22, -0.35]] as const) add(accent, 0.16, 0.3, 0.16, x, 0.1, z);
        eyes(1.06, 0.76, 0.16);
        break;
      case 'dragon':
        add(main, 0.8, 0.75, 1.2, 0, 0.55, 0);
        add(main, 0.6, 0.55, 0.75, 0, 1.2, 0.55);
        add(accent, 0.1, 0.35, 0.1, 0.18, 1.62, 0.45, 0.3);
        add(accent, 0.1, 0.35, 0.1, -0.18, 1.62, 0.45, -0.3);
        add(accent, 0.1, 0.7, 0.9, 0.55, 0.95, -0.05, 0.7);
        add(accent, 0.1, 0.7, 0.9, -0.55, 0.95, -0.05, -0.7);
        add(main, 0.22, 0.22, 0.8, 0, 0.5, -0.95);
        eyes(1.28, 0.93, 0.16);
        break;
      case 'monkey':
        add(main, 0.75, 0.85, 0.65, 0, 0.5, 0);
        add(main, 0.7, 0.62, 0.62, 0, 1.2, 0.08);
        add(accent, 0.46, 0.36, 0.1, 0, 1.12, 0.4);
        add(accent, 0.18, 0.26, 0.12, 0.42, 1.25, 0.05);
        add(accent, 0.18, 0.26, 0.12, -0.42, 1.25, 0.05);
        add(main, 0.12, 0.12, 0.7, 0, 0.35, -0.55);
        eyes(1.3, 0.4, 0.14);
        break;
      case 'fish':
        add(main, 0.6, 0.7, 1.2, 0, 0.75, 0);
        add(accent, 0.1, 0.55, 0.45, 0, 0.8, -0.8);
        add(accent, 0.1, 0.4, 0.4, 0, 1.25, 0.05);
        add(accent, 0.5, 0.25, 0.3, 0, 0.55, 0.62);
        eyes(0.9, 0.55, 0.22);
        break;
      case 'bug':
        add(main, 0.9, 0.45, 0.9, 0, 0.3, 0);
        add(main, 0.5, 0.35, 0.4, 0, 0.35, 0.6);
        add(accent, 0.35, 0.25, 0.3, 0.55, 0.35, 0.7);
        add(accent, 0.35, 0.25, 0.3, -0.55, 0.35, 0.7);
        add(main, 0.14, 0.14, 0.6, 0, 0.75, -0.55, 0);
        for (const x of [0.5, -0.5]) for (const z of [0.25, -0.2]) add(accent, 0.3, 0.1, 0.1, x, 0.12, z);
        eyes(0.45, 0.8, 0.12);
        break;
      case 'blob':
      default:
        add(main, 1.0, 0.8, 1.1, 0, 0.45, 0);
        add(main, 0.6, 0.55, 0.5, 0, 0.9, 0.5);
        add(accent, 0.66, 0.2, 0.56, 0, 1.2, 0.5);
        for (const [x, z] of [[0.3, 0.35], [-0.3, 0.35], [0.3, -0.35], [-0.3, -0.35]] as const) add(accent, 0.18, 0.3, 0.18, x, 0.08, z);
        eyes(0.95, 0.76, 0.14);
        break;
    }
    return outer;
  }
}
