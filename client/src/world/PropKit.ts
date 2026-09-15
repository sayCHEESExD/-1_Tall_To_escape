import { BoxGeometry, BufferAttribute, Color, Euler, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The scenery prop kit: props made of coloured BOXES, written into merged
 * geometry with the colour in the vertices, so a whole area's scenery is ONE
 * lit material and ONE unlit "glow" material - two draw calls - however many
 * props there are. Scenery is purely visual: nothing here collides.
 */

/** One box of a prop, in the prop's local space (y = 0 is the ground). */
interface Part {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  c: number;
  rx?: number;
  ry?: number;
  rz?: number;
  glow?: boolean;
}

type Rand = () => number;
type Prop = (r: Rand) => Part[];

const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number, extra: Partial<Part> = {}): Part => ({
  w, h, d, x, y: y + h / 2, z, c, ...extra,
});

const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;

// ------------------------------------------------------------------ props

const rock = (colors: readonly number[]): Prop => (r) => {
  const s = 0.7 + r() * 0.8;
  const c = pick(r, colors);
  return [
    box(1.6 * s, 1 * s, 1.3 * s, 0, 0, 0, c, { ry: r() * 3 }),
    box(0.9 * s, 0.7 * s, 1 * s, 0.7 * s, 0, 0.4 * s, pick(r, colors), { ry: r() * 3 }),
  ];
};

const pebbles = (colors: readonly number[]): Prop => (r) =>
  [0, 1, 2].map((i) => box(0.35 + r() * 0.3, 0.25, 0.35 + r() * 0.3, (r() - 0.5) * 1.6, 0, (r() - 0.5) * 1.6, pick(r, colors), { ry: r() * 3 + i }));

const tuft = (colors: readonly number[]): Prop => (r) => {
  const c = pick(r, colors);
  return [-0.4, -0.13, 0.13, 0.4].map((x, i) =>
    box(0.22, 0.9 + r() * 0.7, 0.22, x, 0, (r() - 0.5) * 0.5, c, { rz: (i - 1.5) * 0.3 }),
  );
};

const flower = (heads: readonly number[]): Prop => (r) => {
  const h = 0.9 + r() * 0.7;
  return [
    box(0.16, h, 0.16, 0, 0, 0, 0x3f9b2f),
    box(0.5, 0.12, 0.25, 0.25, h * 0.45, 0, 0x4fc34a, { rz: 0.4 }),
    box(0.8, 0.28, 0.8, 0, h, 0, pick(r, heads), { ry: r() * 3 }),
    box(0.32, 0.3, 0.32, 0, h + 0.02, 0, 0xffe14d),
  ];
};

const bush = (colors: readonly number[]): Prop => (r) => {
  const s = 0.8 + r() * 0.6;
  return [
    box(1.6 * s, 1.1 * s, 1.5 * s, 0, 0, 0, pick(r, colors)),
    box(1.1 * s, 1 * s, 1.1 * s, 0.9 * s, 0, 0.3 * s, pick(r, colors), { ry: 0.4 }),
    box(1 * s, 0.9 * s, 1 * s, -0.8 * s, 0, -0.2 * s, pick(r, colors), { ry: 0.8 }),
  ];
};

const roundTree = (leaves: readonly number[], trunk = 0x7a4a24): Prop => (r) => {
  const s = 0.9 + r() * 0.6;
  const l = pick(r, leaves);
  return [
    box(0.8 * s, 3 * s, 0.8 * s, 0, 0, 0, trunk),
    box(3.2 * s, 2.2 * s, 3.2 * s, 0, 2.6 * s, 0, l),
    box(2.2 * s, 1.4 * s, 2.2 * s, 0, 4.6 * s, 0, l, { ry: 0.5 }),
  ];
};

/** A big blocky tree with a branching trunk and chunky canopy, for outside the stair walls. */
const bigTree = (leaves: readonly number[], trunk = 0x9c5a3c): Prop => (r) => {
  const s = 2.2 + r() * 1.2;
  const l = pick(r, leaves);
  const l2 = pick(r, leaves);
  return [
    box(1.2 * s, 5 * s, 1.2 * s, 0, 0, 0, trunk),
    box(0.7 * s, 2.6 * s, 0.7 * s, 1 * s, 3.4 * s, 0, trunk, { rz: -0.6 }),
    box(0.7 * s, 2.6 * s, 0.7 * s, -1 * s, 3.2 * s, 0.3 * s, trunk, { rz: 0.6 }),
    box(5.2 * s, 3 * s, 5.2 * s, 0, 5 * s, 0, l, { ry: r() }),
    box(3.6 * s, 2.4 * s, 3.6 * s, 2.2 * s, 6.2 * s, 1 * s, l2, { ry: r() }),
    box(3.2 * s, 2.2 * s, 3.2 * s, -2 * s, 6.6 * s, -1 * s, l, { ry: r() }),
  ];
};

/** Deterministic PRNG, so every client places the same scenery. */
const seeded = (seed: number): Rand => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const UNIT = new BoxGeometry(1, 1, 1);
UNIT.deleteAttribute('uv');

const MATRIX = new Matrix4();
const QUAT = new Quaternion();
const EULER = new Euler();
const POS = new Vector3();
const SCALE = new Vector3();
const COLOR = new Color();

/** Accumulates boxes for one area and merges them. */
class Batch {
  readonly solid: BufferGeometry[] = [];
  readonly glow: BufferGeometry[] = [];

  add(part: Part, ox: number, oy: number, oz: number, spin: number): void {
    const geometry = UNIT.clone();
    // Rotate the part's offset by the prop's spin so the prop turns as one.
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    POS.set(ox + part.x * cos + part.z * sin, oy + part.y, oz - part.x * sin + part.z * cos);
    EULER.set(part.rx ?? 0, (part.ry ?? 0) + spin, part.rz ?? 0);
    QUAT.setFromEuler(EULER);
    SCALE.set(part.w, part.h, part.d);
    MATRIX.compose(POS, QUAT, SCALE);
    geometry.applyMatrix4(MATRIX);

    COLOR.setHex(part.c);
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = COLOR.r;
      colors[i * 3 + 1] = COLOR.g;
      colors[i * 3 + 2] = COLOR.b;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    (part.glow ? this.glow : this.solid).push(geometry);
  }

  prop(prop: Prop, r: Rand, x: number, y: number, z: number): void {
    const spin = r() * Math.PI * 2;
    for (const part of prop(r)) this.add(part, x, y, z, spin);
  }
}

/** Merge a batch into (at most) one lit and one glowing geometry, disposing the parts. */
export const mergeBatch = (batch: Batch): { solid: BufferGeometry | null; glow: BufferGeometry | null } => {
  const merge = (parts: BufferGeometry[]): BufferGeometry | null => {
    if (parts.length === 0) return null;
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    merged?.computeBoundingSphere();
    return merged;
  };
  return { solid: merge(batch.solid), glow: merge(batch.glow) };
};

export { Batch, bigTree, box, bush, flower, pebbles, rock, roundTree, seeded, tuft };
export type { Part, Prop, Rand };
