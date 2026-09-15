import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  FrontSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
} from 'three';
import { drawLines, type SignLine } from './CanvasSign.js';

export interface AtlasSign {
  readonly lines: readonly SignLine[];
  /** Panel size in world units. */
  readonly width: number;
  readonly height: number;
  /** Panel centre and facing (rotation about Y). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotationY: number;
  /** Optional plate behind the text, as a CSS colour. */
  readonly plate?: string;
}

/** Pixels per atlas cell. Every sign is drawn at this size, whatever its world size. */
const CELL = { width: 256, height: 104 } as const;
const COLUMNS = 8;

/**
 * Many small STATIC signs drawn into ONE canvas and ONE merged mesh.
 *
 * Every step has a win-pad label and a level label on its riser - close to a
 * hundred signs. As separate `CanvasSign`s that would be a hundred textures
 * and a hundred draw calls; as an atlas it is one texture and one draw call.
 * Signs here never change after construction; anything that redraws stays a
 * `CanvasSign`.
 */
export class SignAtlas {
  readonly mesh: Mesh;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly geometry = new BufferGeometry();

  constructor(signs: readonly AtlasSign[]) {
    const rows = Math.max(1, Math.ceil(signs.length / COLUMNS));
    const canvas = document.createElement('canvas');
    canvas.width = CELL.width * COLUMNS;
    canvas.height = CELL.height * rows;
    const ctx = canvas.getContext('2d');

    const positions = new Float32Array(signs.length * 12);
    const uvs = new Float32Array(signs.length * 8);
    const indices: number[] = [];

    signs.forEach((sign, index) => {
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const left = column * CELL.width;
      const top = row * CELL.height;

      if (ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, CELL.width, CELL.height);
        ctx.clip();
        ctx.translate(left, top);
        if (sign.plate) {
          ctx.fillStyle = sign.plate;
          roundRect(ctx, 3, 3, CELL.width - 6, CELL.height - 6, 16);
          ctx.fill();
        }
        drawLines(ctx, CELL.width, CELL.height, sign.lines, false);
        ctx.restore();
      }

      // A quad facing +Z in its own space, turned by `rotationY`.
      const cos = Math.cos(sign.rotationY);
      const sin = Math.sin(sign.rotationY);
      const hw = sign.width / 2;
      const hh = sign.height / 2;
      const corners: readonly [number, number][] = [
        [-hw, hh],
        [hw, hh],
        [-hw, -hh],
        [hw, -hh],
      ];
      corners.forEach(([cx, cy], corner) => {
        const at = (index * 4 + corner) * 3;
        positions[at] = sign.x + cx * cos;
        positions[at + 1] = sign.y + cy;
        positions[at + 2] = sign.z - cx * sin;
      });

      // Half a texel in, so a neighbouring cell never bleeds onto the edge.
      const u0 = (left + 0.5) / canvas.width;
      const u1 = (left + CELL.width - 0.5) / canvas.width;
      const v0 = 1 - (top + 0.5) / canvas.height;
      const v1 = 1 - (top + CELL.height - 0.5) / canvas.height;
      uvs.set([u0, v0, u1, v0, u0, v1, u1, v1], index * 8);

      const base = index * 4;
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    });

    this.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);
    this.geometry.computeBoundingSphere();

    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.texture.anisotropy = 8;
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: FrontSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.geometry.dispose();
    this.mesh.removeFromParent();
  }
}

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};
