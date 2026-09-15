import { NO_TRAIL, trailBySlot, type TrailStyle } from '@highjump/shared';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
} from 'three';

const SAMPLES = 24;
const SAMPLE_DISTANCE = 0.4;
const MOVING_SPEED = 1.4;
const RIBBON_HALF_WIDTH = 0.42;
const EMIT_HEIGHT = 1.1;
const FADE_SECONDS = 0.55;

interface Sample {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  life: number;
}

/**
 * The ribbon a trail leaves behind the player, in WORLD space.
 *
 * Emission is distance-based, so a standing player lays nothing down. One
 * geometry and one material rewritten in place each frame: one draw call, no
 * per-particle objects.
 */
export class TrailEffect {
  readonly root = new Group();

  private readonly geometry = new BufferGeometry();
  private readonly material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    fog: false,
  });
  private readonly mesh: Mesh;
  private readonly positions = new Float32Array(SAMPLES * 6);
  private readonly colors = new Float32Array(SAMPLES * 6);
  private readonly samples: Sample[] = [];

  private slot = NO_TRAIL;
  private style: TrailStyle = 'solid';
  private readonly baseColor = new Color();
  private readonly scratch = new Color();
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private seeded = false;
  private time = 0;

  constructor() {
    for (let i = 0; i < SAMPLES; i += 1) this.samples.push({ x: 0, y: 0, z: 0, nx: 0, nz: 0, life: 0 });
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    const indices: number[] = [];
    for (let i = 0; i < SAMPLES - 1; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(indices);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.root.add(this.mesh);
  }

  setSlot(slot: number): void {
    if (slot === this.slot) return;
    this.slot = slot;
    const tier = trailBySlot(slot);
    if (!tier) {
      this.clear();
      return;
    }
    this.style = tier.style;
    this.baseColor.setHex(tier.color);
    // Black cannot glow additively, so the void trail draws normally.
    this.material.blending = this.style === 'void' ? NormalBlending : AdditiveBlending;
  }

  update(delta: number, x: number, y: number, z: number, speed: number): void {
    if (this.slot === NO_TRAIL) return;
    this.time += delta;
    if (!this.seeded) {
      this.lastX = x;
      this.lastY = y;
      this.lastZ = z;
      this.seeded = true;
    }

    const dx = x - this.lastX;
    const dz = z - this.lastZ;
    const travelled = Math.hypot(dx, y - this.lastY, dz);
    const flat = Math.hypot(dx, dz);
    if ((speed > MOVING_SPEED || Math.abs(y - this.lastY) > 0.2) && travelled >= SAMPLE_DISTANCE) {
      const inverse = flat > 1e-4 ? 1 / flat : 0;
      this.push(x, y + EMIT_HEIGHT, z, flat > 1e-4 ? -dz * inverse : 1, flat > 1e-4 ? dx * inverse : 0);
      this.lastX = x;
      this.lastY = y;
      this.lastZ = z;
    }

    const decay = delta / FADE_SECONDS;
    let alive = 0;
    for (const sample of this.samples) {
      if (sample.life <= 0) continue;
      sample.life -= decay;
      if (sample.life > 0) alive += 1;
    }
    this.mesh.visible = alive > 1;
    if (this.mesh.visible) this.writeGeometry();
  }

  clear(): void {
    for (const sample of this.samples) sample.life = 0;
    this.seeded = false;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private push(x: number, y: number, z: number, nx: number, nz: number): void {
    for (let i = this.samples.length - 1; i > 0; i -= 1) {
      Object.assign(this.samples[i] as Sample, this.samples[i - 1] as Sample);
    }
    Object.assign(this.samples[0] as Sample, { x, y, z, nx, nz, life: 1 });
  }

  private writeGeometry(): void {
    for (let i = 0; i < this.samples.length; i += 1) {
      const sample = this.samples[i] as Sample;
      const life = Math.max(0, sample.life);
      const width = RIBBON_HALF_WIDTH * life;
      const base = i * 6;
      this.positions[base] = sample.x + sample.nx * width;
      this.positions[base + 1] = sample.y;
      this.positions[base + 2] = sample.z + sample.nz * width;
      this.positions[base + 3] = sample.x - sample.nx * width;
      this.positions[base + 4] = sample.y;
      this.positions[base + 5] = sample.z - sample.nz * width;
      this.tint(i, life);
      for (let v = 0; v < 2; v += 1) {
        this.colors[base + v * 3] = this.scratch.r;
        this.colors[base + v * 3 + 1] = this.scratch.g;
        this.colors[base + v * 3 + 2] = this.scratch.b;
      }
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  private tint(index: number, life: number): void {
    switch (this.style) {
      case 'rainbow':
        this.scratch.setHSL(((index / SAMPLES) * 0.8 + this.time * 0.35) % 1, 0.95, 0.55);
        break;
      case 'void':
        this.scratch.setHex(index % 5 === 0 ? 0x8f7bff : 0x0a0b10);
        break;
      case 'hacker':
        // Matrix green that flickers block by block.
        this.scratch.setHex(Math.floor(this.time * 14 + index * 3) % 3 === 0 ? 0xb6ffb0 : 0x16c93a);
        break;
      case 'heaven':
        this.scratch.copy(this.baseColor).offsetHSL(0, 0, Math.sin(this.time * 2 + index) * 0.08);
        break;
      case 'cosmic':
        this.scratch.setHSL((0.72 + Math.sin(this.time * 1.6 + index * 0.35) * 0.09 + 1) % 1, 0.9, 0.6);
        break;
      case 'music':
        // Pulses on a beat, hue stepping like an equaliser.
        this.scratch.setHSL(
          (Math.floor(this.time * 4) * 0.13 + index * 0.02) % 1,
          1,
          0.45 + Math.abs(Math.sin(this.time * Math.PI * 4)) * 0.2,
        );
        break;
      default:
        this.scratch.copy(this.baseColor);
        break;
    }
    this.scratch.multiplyScalar(this.style === 'void' ? 1 : life);
  }
}
