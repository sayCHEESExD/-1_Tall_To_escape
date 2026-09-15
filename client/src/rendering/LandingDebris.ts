import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  RingGeometry,
} from 'three';

/** Chunks in the shared pool. */
const POOL_SIZE = 64;

/** Chunks thrown by the weakest and the strongest landing. */
const PER_BURST_MIN = 6;
const PER_BURST_MAX = 18;

/** Seconds a chunk lives. Short: this is an impact, not smoke. */
const LIFETIME_MIN = 0.3;
const LIFETIME_MAX = 0.55;

/** Gravity on the debris. Heavier than the player, so it settles fast. */
const GRAVITY = 34;

const CHUNK_SIZE = 0.16;

/** Concrete grit and dust tones, picked per chunk. */
const TONES = [0x9aa6b2, 0xb9a98f, 0xd8d2c4] as const;

/** Dust rings on screen at once. A new landing reuses the oldest. */
const RING_POOL = 4;
const RING_LIFETIME = 0.4;

interface Chunk {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  rotX: number;
  rotY: number;
  scale: number;
  life: number;
  ttl: number;
}

interface Ring {
  mesh: Mesh;
  material: MeshBasicMaterial;
  life: number;
  radius: number;
}

/**
 * The landing impact: a burst of rubble and a fast-spreading dust ring at the
 * player's feet.
 *
 * Adapted from the backflip game's landing debris. ONE InstancedMesh for every
 * chunk and a fixed pool of four rings, so the effect never allocates and never
 * outlives the moment: chunks shrink out within about half a second and rings
 * fade in less. `strength` (0..1) scales the amount, speed and size.
 *
 * Purely local presentation - nothing here is replicated or touches physics.
 */
export class LandingDebris {
  readonly root = new Group();

  private readonly mesh: InstancedMesh;
  private readonly geometry = new BoxGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
  private readonly material = new MeshLambertMaterial();
  private readonly ringGeometry = new RingGeometry(0.7, 1, 24);
  private readonly chunks: Chunk[] = [];
  private readonly rings: Ring[] = [];
  private readonly dummy = new Object3D();
  private readonly tint = new Color();
  private live = 0;
  private nextRing = 0;

  constructor() {
    this.mesh = new InstancedMesh(this.geometry, this.material, POOL_SIZE);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);

    for (let i = 0; i < POOL_SIZE; i += 1) {
      this.chunks.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spinX: 0, spinY: 0, rotX: 0, rotY: 0, scale: 1, life: 0, ttl: 1 });
      this.hide(i);
      this.mesh.setColorAt(i, this.tint.setHex(TONES[0]));
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < RING_POOL; i += 1) {
      const material = new MeshBasicMaterial({
        color: 0xe8dfcc,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(this.ringGeometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.root.add(mesh);
      this.rings.push({ mesh, material, life: 0, radius: 1 });
    }
  }

  /** Throw a burst at a landing point. `strength` is 0..1. */
  burst(x: number, y: number, z: number, strength: number): void {
    const s = Math.min(Math.max(strength, 0), 1);
    const count = Math.round(PER_BURST_MIN + (PER_BURST_MAX - PER_BURST_MIN) * s);
    let thrown = 0;
    for (let i = 0; i < POOL_SIZE && thrown < count; i += 1) {
      const chunk = this.chunks[i] as Chunk;
      if (chunk.life > 0) continue;

      // Outward in a ring from under the feet, rather than fountaining up.
      const angle = Math.random() * Math.PI * 2;
      const speed = (2 + Math.random() * 3.2) * (0.7 + s * 0.8);
      chunk.x = x + Math.cos(angle) * 0.25;
      chunk.y = y + 0.08 + Math.random() * 0.12;
      chunk.z = z + Math.sin(angle) * 0.25;
      chunk.vx = Math.cos(angle) * speed;
      chunk.vz = Math.sin(angle) * speed;
      chunk.vy = (2.2 + Math.random() * 3) * (0.7 + s * 0.6);
      chunk.spinX = (Math.random() - 0.5) * 22;
      chunk.spinY = (Math.random() - 0.5) * 22;
      chunk.rotX = Math.random() * Math.PI;
      chunk.rotY = Math.random() * Math.PI;
      chunk.scale = (0.55 + Math.random() * 0.95) * (0.8 + s * 0.6);
      chunk.ttl = LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN);
      chunk.life = chunk.ttl;
      this.mesh.setColorAt(i, this.tint.setHex(TONES[Math.floor(Math.random() * TONES.length)] ?? TONES[0]));
      thrown += 1;
      this.live += 1;
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    const ring = this.rings[this.nextRing] as Ring;
    this.nextRing = (this.nextRing + 1) % RING_POOL;
    ring.life = RING_LIFETIME;
    ring.radius = 1.4 + s * 1.8;
    ring.mesh.position.set(x, y + 0.06, z);
    ring.mesh.visible = true;
  }

  /** Advance every live chunk and ring. Costs nothing while all are idle. */
  update(delta: number): void {
    for (const ring of this.rings) {
      if (ring.life <= 0) continue;
      ring.life -= delta;
      if (ring.life <= 0) {
        ring.mesh.visible = false;
        continue;
      }
      const t = 1 - ring.life / RING_LIFETIME;
      const scale = 0.4 + ring.radius * (1 - (1 - t) * (1 - t));
      ring.mesh.scale.set(scale, scale, 1);
      ring.material.opacity = 0.55 * (1 - t);
    }

    if (this.live === 0) return;
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const chunk = this.chunks[i] as Chunk;
      if (chunk.life <= 0) continue;
      chunk.life -= delta;
      if (chunk.life <= 0) {
        this.hide(i);
        this.live -= 1;
        continue;
      }
      chunk.vy -= GRAVITY * delta;
      chunk.x += chunk.vx * delta;
      chunk.y += chunk.vy * delta;
      chunk.z += chunk.vz * delta;
      chunk.rotX += chunk.spinX * delta;
      chunk.rotY += chunk.spinY * delta;
      const drag = Math.exp(-4 * delta);
      chunk.vx *= drag;
      chunk.vz *= drag;
      // Shrink out over the last of the life, so nothing pops away.
      const fade = Math.min(1, chunk.life / (chunk.ttl * 0.45));
      this.dummy.position.set(chunk.x, chunk.y, chunk.z);
      this.dummy.rotation.set(chunk.rotX, chunk.rotY, 0);
      this.dummy.scale.setScalar(chunk.scale * fade);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.ringGeometry.dispose();
    for (const ring of this.rings) ring.material.dispose();
    this.root.removeFromParent();
  }

  /** Park a slot at zero scale - an instance cannot be individually hidden. */
  private hide(index: number): void {
    this.dummy.position.set(0, -10000, 0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
  }
}
