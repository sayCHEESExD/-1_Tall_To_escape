import {
  BackSide,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config/worldVisuals.js';

const DOME_RADIUS = 2600;

/** Deterministic PRNG, so every client sees the same sky. */
const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * A gradient dome that FOLLOWS the camera - the staircase climbs thousands of
 * units, and a fixed dome would be left behind - plus layers of blocky clouds
 * strung up the height of the climb. Three draw calls in all.
 */
export class Sky {
  readonly root = new Group();
  private readonly dome: Mesh;
  private readonly disposables: (BufferGeometry | ShaderMaterial | MeshBasicMaterial)[] = [];

  constructor(courseLength: number, courseTop: number) {
    const geometry = new SphereGeometry(DOME_RADIUS, 24, 16);
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new Color(0x2a86e0) },
        midColor: { value: new Color(PALETTE.sky) },
        bottomColor: { value: new Color(PALETTE.fog) },
      },
      vertexShader: `
        varying float vHeight;
        void main() {
          vHeight = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 bottomColor;
        varying float vHeight;
        void main() {
          float h = clamp(vHeight, -1.0, 1.0);
          vec3 sky = mix(midColor, topColor, clamp(h * 1.6, 0.0, 1.0));
          vec3 low = mix(bottomColor, midColor, clamp((h + 0.25) * 3.0, 0.0, 1.0));
          gl_FragColor = vec4(h > 0.0 ? sky : low, 1.0);
        }
      `,
    });
    this.disposables.push(geometry, material);
    this.dome = new Mesh(geometry, material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    this.root.add(this.dome);
    this.buildClouds(courseLength, courseTop);
  }

  follow(x: number, y: number, z: number): void {
    this.dome.position.set(x, y, z);
  }

  private buildClouds(courseLength: number, courseTop: number): void {
    const random = seeded(0x9a1ce);
    const tops: BufferGeometry[] = [];
    const clusters = 70;
    for (let i = 0; i < clusters; i += 1) {
      const side = random() < 0.5 ? -1 : 1;
      const cx = side * (90 + random() * 500);
      const cz = -300 + random() * (courseLength + 600);
      const cy = 40 + random() * (courseTop + 200);
      const scale = 10 + random() * 16;
      const blocks = 4 + Math.floor(random() * 4);
      for (let b = 0; b < blocks; b += 1) {
        const t = blocks === 1 ? 0.5 : b / (blocks - 1);
        const bulge = Math.sin(t * Math.PI);
        const box = new BoxGeometry(
          scale * (1.1 + bulge * 1.5),
          scale * (0.5 + bulge * 0.55),
          scale * (1 + bulge * 1.2),
        );
        box.translate(cx + (t - 0.5) * scale * 4.2, cy + bulge * scale * 0.35, cz + (random() - 0.5) * scale);
        tops.push(box);
      }
    }
    const merged = mergeGeometries(tops, false);
    for (const part of tops) part.dispose();
    if (!merged) return;
    const material = new MeshBasicMaterial({ color: PALETTE.cloud, fog: false });
    this.disposables.push(merged, material);
    const mesh = new Mesh(merged, material);
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.root.removeFromParent();
  }
}
