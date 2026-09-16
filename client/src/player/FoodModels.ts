import type { FoodTier } from '@highjump/shared';
import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Object3D,
} from 'three';

/**
 * Low-poly food models, built from primitives: one per food tier, about one
 * world unit across and standing on y = 0.
 *
 * Used twice - on the Food Shop pedestals and in every player's hand - so the
 * food a player holds is the food they bought. Each call builds fresh meshes;
 * `disposeFoodModel` frees them.
 */

interface PartOptions {
  readonly color: number;
  readonly emissive?: number;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
  readonly sx?: number;
  readonly sy?: number;
  readonly sz?: number;
}

const part = (group: Group, geometry: BufferGeometry, options: PartOptions): Mesh => {
  const material = new MeshLambertMaterial({ color: options.color });
  if (options.emissive !== undefined) {
    material.emissive.setHex(options.emissive);
    material.emissiveIntensity = 0.45;
  }
  const mesh = new Mesh(geometry, material);
  mesh.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0);
  mesh.rotation.set(options.rx ?? 0, options.ry ?? 0, options.rz ?? 0);
  mesh.scale.set(options.sx ?? 1, options.sy ?? 1, options.sz ?? 1);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
};

const sphere = (): SphereGeometry => new SphereGeometry(0.5, 12, 8);
const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
const cylinder = (top: number, bottom: number, h: number, segments = 14): CylinderGeometry =>
  new CylinderGeometry(top, bottom, h, segments);

export const buildFoodModel = (tier: FoodTier): Group => {
  const g = new Group();
  const c = tier.color;
  const a = tier.accent;
  switch (tier.shape) {
    case 'lettuce':
      part(g, sphere(), { color: c, y: 0.42, sx: 1.1, sy: 0.8, sz: 1.1 });
      part(g, sphere(), { color: a, y: 0.55, x: 0.22, sx: 0.6, sy: 0.6, sz: 0.6 });
      part(g, sphere(), { color: 0x4fb83a, y: 0.5, x: -0.25, z: 0.1, sx: 0.55, sy: 0.6, sz: 0.55 });
      break;
    case 'bread':
      part(g, box(1.1, 0.45, 0.62), { color: c, y: 0.23 });
      // Shorter than the crust box (1.1): end caps flush with its sides shared
      // a plane with them and striped the face of the loaf.
      part(g, cylinder(0.31, 0.31, 1.02), { color: a, y: 0.45, rz: Math.PI / 2, sy: 1, sz: 0.9 });
      break;
    case 'apple':
    case 'goldenApple': {
      const shine = tier.shape === 'goldenApple' ? c : undefined;
      part(g, sphere(), { color: c, emissive: shine, y: 0.5, sx: 1, sy: 0.92, sz: 1 });
      part(g, cylinder(0.04, 0.05, 0.3, 6), { color: 0x5a3a1a, y: 1.02 });
      part(g, box(0.28, 0.05, 0.14), { color: tier.shape === 'goldenApple' ? 0xfff4b0 : 0x5cd65c, emissive: shine, x: 0.14, y: 1.06, rz: 0.4 });
      break;
    }
    case 'lollipop':
      part(g, cylinder(0.04, 0.04, 0.9, 6), { color: 0xffffff, y: 0.45 });
      part(g, cylinder(0.42, 0.42, 0.14, 20), { color: c, y: 1.2, rx: Math.PI / 2 });
      part(g, new TorusGeometry(0.24, 0.05, 6, 18), { color: a, y: 1.2, z: 0.08 });
      break;
    case 'sandwich':
      part(g, box(1, 0.16, 1), { color: c, y: 0.08 });
      part(g, box(1.06, 0.06, 1.06), { color: a, y: 0.19 });
      part(g, box(0.98, 0.08, 0.98), { color: 0xffd23d, y: 0.26, ry: 0.3 });
      part(g, box(0.96, 0.1, 0.96), { color: 0xd65a4a, y: 0.34 });
      part(g, box(1, 0.16, 1), { color: c, y: 0.47 });
      break;
    case 'hotdog':
      part(g, box(1.2, 0.26, 0.5), { color: 0xe8b86a, y: 0.13 });
      part(g, new CapsuleGeometry(0.16, 1.1, 4, 10), { color: c, y: 0.34, rz: Math.PI / 2 });
      part(g, box(1.05, 0.04, 0.08), { color: a, y: 0.5 });
      break;
    case 'steak':
      part(g, sphere(), { color: c, y: 0.18, sx: 1.2, sy: 0.32, sz: 0.85 });
      part(g, cylinder(0.07, 0.07, 0.6, 8), { color: a, x: 0.7, y: 0.2, rz: Math.PI / 2 });
      part(g, sphere(), { color: a, x: 1.0, y: 0.2, sx: 0.25, sy: 0.25, sz: 0.25 });
      break;
    case 'chocolate':
      part(g, box(0.8, 0.18, 1.2), { color: c, y: 0.09 });
      part(g, box(0.84, 0.22, 0.55), { color: a, y: 0.11, z: 0.36 });
      for (const z of [-0.45, -0.2]) for (const x of [-0.2, 0.2]) part(g, box(0.3, 0.05, 0.2), { color: 0x4a2812, x, y: 0.2, z });
      break;
    case 'cupcake':
      part(g, cylinder(0.42, 0.3, 0.45), { color: a, y: 0.22 });
      part(g, sphere(), { color: c, y: 0.55, sx: 1, sy: 0.7, sz: 1 });
      part(g, sphere(), { color: 0xe8313a, y: 0.88, sx: 0.22, sy: 0.22, sz: 0.22 });
      break;
    case 'pizza': {
      const slice = new CylinderGeometry(0.9, 0.9, 0.1, 3, 1, false, 0, Math.PI / 3);
      part(g, slice, { color: c, y: 0.08 });
      part(g, box(0.9, 0.12, 0.14), { color: 0xd9953f, x: 0.39, y: 0.1, z: 0.66, ry: -Math.PI / 6 });
      for (const [x, z] of [[0.2, 0.35], [0.4, 0.2]] as const) part(g, cylinder(0.08, 0.08, 0.04, 10), { color: a, x, y: 0.15, z });
      break;
    }
    case 'cake':
      part(g, cylinder(0.55, 0.55, 0.4, 18), { color: c, y: 0.2 });
      part(g, cylinder(0.57, 0.57, 0.08, 18), { color: a, y: 0.38 });
      part(g, cylinder(0.36, 0.36, 0.32, 18), { color: c, y: 0.58 });
      part(g, cylinder(0.03, 0.03, 0.26, 6), { color: 0x3aa8ff, y: 0.87 });
      part(g, sphere(), { color: 0xffd23d, emissive: 0xffa31f, y: 1.03, sx: 0.1, sy: 0.14, sz: 0.1 });
      break;
    case 'donut':
      part(g, new TorusGeometry(0.4, 0.18, 10, 20), { color: 0xd9a55a, y: 0.2, rx: Math.PI / 2 });
      part(g, new TorusGeometry(0.4, 0.14, 10, 20), { color: c, emissive: c, y: 0.28, rx: Math.PI / 2 });
      for (let i = 0; i < 5; i += 1) {
        const angle = (i / 5) * Math.PI * 2;
        part(g, new OctahedronGeometry(0.09, 0), { color: a, emissive: a, x: Math.cos(angle) * 0.4, y: 0.42, z: Math.sin(angle) * 0.4 });
      }
      break;
    case 'iceCream':
      part(g, new ConeGeometry(0.3, 0.8, 12), { color: 0xd9a55a, y: 0.4, rx: Math.PI });
      part(g, sphere(), { color: c, y: 0.9, sx: 0.72, sy: 0.72, sz: 0.72 });
      part(g, sphere(), { color: a, y: 1.28, sx: 0.62, sy: 0.62, sz: 0.62 });
      part(g, sphere(), { color: 0xffe14d, y: 1.6, sx: 0.5, sy: 0.5, sz: 0.5 });
      break;
    case 'burger':
      part(g, cylinder(0.55, 0.5, 0.16, 16), { color: 0x9d7aff, y: 0.08 });
      part(g, cylinder(0.58, 0.58, 0.16, 16), { color: c, emissive: 0x2a1a66, y: 0.24 });
      part(g, cylinder(0.62, 0.62, 0.05, 16), { color: 0x5cff8a, emissive: 0x106030, y: 0.34 });
      part(g, sphere(), { color: a, emissive: 0x551040, y: 0.4, sx: 1.15, sy: 0.6, sz: 1.15 });
      for (let i = 0; i < 4; i += 1) {
        const angle = (i / 4) * Math.PI * 2 + 0.4;
        part(g, new OctahedronGeometry(0.06, 0), { color: 0xffffff, emissive: 0xffffff, x: Math.cos(angle) * 0.3, y: 0.62, z: Math.sin(angle) * 0.3 });
      }
      break;
  }
  return g;
};

/** Free every geometry and material a food model built. */
export const disposeFoodModel = (root: Object3D): void => {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as MeshLambertMaterial).dispose();
  });
  root.removeFromParent();
};
