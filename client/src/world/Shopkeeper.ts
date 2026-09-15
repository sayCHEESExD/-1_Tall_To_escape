import {
  Bone,
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PoseBuffer } from '../animation/PoseBuffer.js';
import { PlayerRig } from '../animation/rig/PlayerRig.js';
import { IDLE } from '../config/animationConfig.js';
import { playerModelLoader } from '../player/PlayerModelLoader.js';
import { CanvasSign } from './CanvasSign.js';
import { STALL_KEEPER } from './EggStall.js';

/** Seconds between waves, and how long a wave lasts. */
const WAVE_PERIOD = 6;
const WAVE_LENGTH = 1.8;
/** How close the player must be before she turns her head to look at them. */
const LOOK_RANGE = 40;
const MAX_HEAD_YAW = 0.7;

const HAIR = 0xf6c26b;
const HAIR_SHADE = 0xd99a3f;
const BOW = 0xff5fa2;
const APRON = 0xfff7f0;
const SKIRT = 0xff8cc6;

/** RGB (0..1) to HSL (0..1). */
const toHsl = (r: number, g: number, b: number): [number, number, number] => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
};

const fromHsl = (h: number, s: number, l: number): [number, number, number] => {
  if (s === 0) return [l, l, l];
  const hue = (p: number, q: number, t: number): number => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
};

/**
 * The player's texture with the teal outfit turned pastel pink. Skin tones sit
 * outside the teal hue range and are left untouched.
 */
const recolour = (image: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const [h, s, l] = toHsl((px[i] ?? 0) / 255, (px[i + 1] ?? 0) / 255, (px[i + 2] ?? 0) / 255);
    if (s < 0.1 || h < 0.14 || h > 0.6) continue;
    const [r, g, b] = fromHsl(0.9, Math.min(1, s * 0.9 + 0.25), Math.min(0.9, l * 1.35 + 0.18));
    px[i] = Math.round(r * 255);
    px[i + 1] = Math.round(g * 255);
    px[i + 2] = Math.round(b * 255);
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
};

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Mia, the shopkeeper behind the Egg Shop counter.
 *
 * The same blocky character as the player - a clone of `player.fbx` - in a
 * pink outfit (the player's own texture, recoloured), with long blonde hair, a
 * bow, an apron and a skirt built from boxes and hung on her bones so they
 * follow her. She breathes, waves at customers every few seconds and turns
 * her head toward the local player when they come near.
 *
 * Purely local scenery: she is not a player, not replicated and not solid.
 */
export class Shopkeeper {
  readonly root = new Group();

  private readonly model: Object3D;
  private readonly rig: PlayerRig;
  private readonly pose = new PoseBuffer();
  private readonly nameTag: CanvasSign;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];
  private time = 0;
  private headYaw = 0;

  constructor() {
    this.model = playerModelLoader.createInstance();
    this.root.add(this.model);
    this.dressTexture();

    this.root.updateMatrixWorld(true);
    this.rig = new PlayerRig(this.model, this.model);

    const neck = this.rig.getBone('Neck1');
    const hips = this.rig.getBone('LegL1');
    const neckY = neck ? neck.getWorldPosition(new Vector3()).y : 2.2;
    const hipY = hips ? hips.getWorldPosition(new Vector3()).y : 1.2;
    const head = this.bounds((p) => p.y > neckY + 0.05);
    const headHalf = (head.maxX - head.minX) / 2;
    const headX = (head.minX + head.maxX) / 2;
    const body = this.bounds((p) => p.y > hipY && p.y < neckY && Math.abs(p.x - headX) < headHalf + 0.05);

    this.addHair(head, neck);
    this.addApron(body, hipY, neckY, this.rig.getBone('Spine1'));
    this.addSkirt(body, hipY, this.rig.getBone('Rig1'));

    this.nameTag = new CanvasSign(5.4, 1.3, [
      { text: 'Shopkeeper Mia', size: 1, fill: '#ffd1e8', stroke: '#5a1036', strokeWidth: 0.18 },
    ]);
    this.nameTag.mesh.position.set(headX, head.maxY + 1.1, 0);
    this.root.add(this.nameTag.mesh);

    // On her step behind the counter, facing the customers (-Z).
    this.root.position.set(STALL_KEEPER.x, STALL_KEEPER.platformHeight, STALL_KEEPER.z);
    this.root.rotation.y = Math.PI;
    this.model.traverse((child) => {
      if (child instanceof Mesh) child.castShadow = true;
    });
  }

  /** Breathe, wave, and look at the local player if they are nearby. */
  update(delta: number, playerPosition: Vector3 | null): void {
    this.time += delta;
    const breath = Math.sin(this.time * 2.2);
    const pose = this.pose;
    pose.applyDefinition(IDLE.basePose);
    pose.add('Spine1', breath * 0.03);
    pose.add('Neck1', -breath * 0.02);
    // Hands resting forward on the counter.
    pose.add('ArmL1', -0.45, 0, -0.1);
    pose.add('ArmL2', 0.6);

    const cycle = this.time % WAVE_PERIOD;
    const wave = cycle < WAVE_LENGTH ? Math.sin((Math.PI * cycle) / WAVE_LENGTH) : 0;
    const flutter = Math.sin(this.time * 10) * 0.35 * wave;
    pose.add('ArmR1', -0.45 * (1 - wave) - 2.6 * wave, 0, 0.1 * (1 - wave) + (0.25 + flutter) * wave);
    pose.add('ArmR2', 0.6 * (1 - wave) + 0.3 * wave);

    let targetYaw = 0;
    if (playerPosition) {
      const dx = playerPosition.x - this.root.position.x;
      const dz = playerPosition.z - this.root.position.z;
      if (Math.hypot(dx, dz) < LOOK_RANGE) {
        // Into her own space: she is turned half a circle to face -Z.
        const localX = -dx;
        const localZ = -dz;
        targetYaw = Math.max(-MAX_HEAD_YAW, Math.min(MAX_HEAD_YAW, Math.atan2(localX, localZ)));
      }
    }
    this.headYaw += (targetYaw - this.headYaw) * (1 - Math.exp(-4 * delta));
    pose.add('Neck1', 0, this.headYaw, 0);
    pose.bobY = 0;
    this.rig.applyPose(pose);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.nameTag.dispose();
    this.root.removeFromParent();
  }

  /** Swap the shared player material for a recoloured copy. */
  private dressTexture(): void {
    let dressed: MeshStandardMaterial | null = null;
    this.model.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const source = child.material as MeshStandardMaterial;
      if (!dressed) {
        dressed = source.clone();
        const image = source.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
        if (image && image.width > 0) {
          const texture = new CanvasTexture(recolour(image));
          texture.colorSpace = SRGBColorSpace;
          texture.flipY = source.map?.flipY ?? true;
          texture.magFilter = NearestFilter;
          texture.minFilter = NearestFilter;
          texture.generateMipmaps = false;
          dressed.map = texture;
          this.textures.push(texture);
        }
        this.materials.push(dressed);
      }
      child.material = dressed;
    });
  }

  /** Bounds of the model's vertices that pass a test, in character space. */
  private bounds(test: (p: Vector3) => boolean): Bounds {
    const out: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    const p = new Vector3();
    this.model.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const positions = child.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i += 1) {
        p.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld);
        if (!test(p)) continue;
        out.minX = Math.min(out.minX, p.x);
        out.maxX = Math.max(out.maxX, p.x);
        out.minY = Math.min(out.minY, p.y);
        out.maxY = Math.max(out.maxY, p.y);
        out.minZ = Math.min(out.minZ, p.z);
        out.maxZ = Math.max(out.maxZ, p.z);
      }
    });
    if (!Number.isFinite(out.minX)) return { minX: -0.5, maxX: 0.5, minY: 2.1, maxY: 3.2, minZ: -0.5, maxZ: 0.5 };
    return out;
  }

  /**
   * Hang a group of character-space boxes on a bone, so they follow it.
   *
   * The FBX bakes rotations and a scale into its bones, so the holder cancels
   * the bone's bind-pose world rotation and scale; the pieces inside can then
   * be authored in plain character coordinates.
   */
  private hang(bone: Bone | null, pieces: { geometry: BufferGeometry; material: Material }[]): void {
    const holder = new Group();
    for (const { geometry, material } of pieces) {
      this.geometries.push(geometry);
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      holder.add(mesh);
    }
    if (!bone) {
      this.root.add(holder);
      return;
    }
    const position = bone.getWorldPosition(new Vector3());
    const rotation = bone.getWorldQuaternion(new Quaternion()).invert();
    const scale = bone.getWorldScale(new Vector3()).x || 1;
    holder.quaternion.copy(rotation);
    holder.scale.setScalar(1 / scale);
    holder.position.copy(position).negate().applyQuaternion(rotation).divideScalar(scale);
    bone.add(holder);
  }

  private merged(boxes: [number, number, number, number, number, number][]): BufferGeometry {
    const parts = boxes.map(([w, h, d, x, y, z]) => new BoxGeometry(w, h, d).translate(x, y, z));
    const geometry = mergeGeometries(parts, false) ?? (parts[0] as BufferGeometry);
    for (const part of parts) if (part !== geometry) part.dispose();
    return geometry;
  }

  private lambert(color: number): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color });
    this.materials.push(material);
    return material;
  }

  private addHair(head: Bounds, neck: Bone | null): void {
    const w = head.maxX - head.minX;
    const d = head.maxZ - head.minZ;
    const cx = (head.minX + head.maxX) / 2;
    const cz = (head.minZ + head.maxZ) / 2;
    const top = head.maxY;
    const hair = this.merged([
      // Crown.
      [w + 0.18, 0.3, d + 0.18, cx, top + 0.08, cz],
      // Long hair down the back.
      [w + 0.2, 2.1, 0.32, cx, top - 0.95, head.minZ - 0.1],
      // Side locks framing the face.
      [0.24, 1.35, d * 0.75, head.minX - 0.08, top - 0.6, cz - 0.08],
      [0.24, 1.35, d * 0.75, head.maxX + 0.08, top - 0.6, cz - 0.08],
      // Bangs.
      [w + 0.14, 0.3, 0.22, cx, top - 0.14, head.maxZ + 0.07],
    ]);
    const shade = this.merged([
      // A darker underlayer, so the hair reads as layered rather than a helmet.
      [w + 0.1, 0.4, 0.2, cx, top - 2.0, head.minZ - 0.12],
    ]);
    const bow = this.merged([
      [0.3, 0.3, 0.28, head.maxX - 0.15, top + 0.38, cz],
      [0.5, 0.42, 0.22, head.maxX - 0.55, top + 0.4, cz],
      [0.5, 0.42, 0.22, head.maxX + 0.25, top + 0.4, cz],
    ]);
    this.hang(neck, [
      { geometry: hair, material: this.lambert(HAIR) },
      { geometry: shade, material: this.lambert(HAIR_SHADE) },
      { geometry: bow, material: this.lambert(BOW) },
    ]);
  }

  private addApron(body: Bounds, hipY: number, neckY: number, spine: Bone | null): void {
    const w = body.maxX - body.minX;
    const cx = (body.minX + body.maxX) / 2;
    const front = body.maxZ + 0.04;
    const apron = this.merged([
      // Bib and skirt of the apron.
      [w * 0.62, (neckY - hipY) * 0.55, 0.06, cx, neckY - (neckY - hipY) * 0.35, front],
      [w * 0.9, 0.9, 0.06, cx, hipY - 0.1, front + 0.02],
    ]);
    const pocket = this.merged([[w * 0.35, 0.3, 0.07, cx, hipY - 0.05, front + 0.06]]);
    this.hang(spine, [
      { geometry: apron, material: this.lambert(APRON) },
      { geometry: pocket, material: this.lambert(SKIRT) },
    ]);
  }

  private addSkirt(body: Bounds, hipY: number, hips: Bone | null): void {
    const w = body.maxX - body.minX;
    const d = body.maxZ - body.minZ;
    const cx = (body.minX + body.maxX) / 2;
    const cz = (body.minZ + body.maxZ) / 2;
    const skirt = this.merged([
      [w + 0.3, 0.45, d + 0.3, cx, hipY + 0.05, cz],
      [w + 0.6, 0.45, d + 0.55, cx, hipY - 0.35, cz],
    ]);
    this.hang(hips, [{ geometry: skirt, material: this.lambert(SKIRT) }]);
  }
}
