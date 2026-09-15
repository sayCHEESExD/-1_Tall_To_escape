import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Every world texture, drawn on a canvas at runtime and cached. Not one image
 * file is used for the world - the toy-brick look costs a few kilobytes of code.
 */
export class WorldTextures {
  private readonly cache = new Map<string, Texture>();

  /** A studded brick plate: one stud per tile with a highlight and a shadow. */
  studs(colour: string, line: string): Texture {
    return this.cached(`studs:${colour}:${line}`, () => {
      const size = 64;
      const ctx = context(size);
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = line;
      ctx.fillRect(0, 0, size, 2);
      ctx.fillRect(0, 0, 2, size);
      // Stud shadow, body and highlight.
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.arc(size / 2 + 2, size / 2 + 3, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = line;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(size / 2 - 1, size / 2 - 1, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(size / 2 - 1, size / 2 - 1, 11, Math.PI * 1.05, Math.PI * 1.6);
      ctx.stroke();
      return ctx.canvas;
    });
  }

  /** Neutral brick courses, tinted by the material colour: cliffs and walls. */
  bricks(): Texture {
    return this.cached('bricks', () => {
      const size = 64;
      const ctx = context(size);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#d9d9d9';
      ctx.fillRect(0, 30, size, 3);
      ctx.fillRect(0, 62, size, 2);
      ctx.fillRect(30, 0, 3, 31);
      ctx.fillRect(0, 33, 2, 30);
      ctx.fillRect(62, 33, 2, 30);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(4, 4, 22, 3);
      ctx.fillRect(36, 37, 22, 3);
      return ctx.canvas;
    });
  }

  /**
   * A stone face: a flat colour with a scatter of darker square blocks, the
   * clean staircase's look. Deterministic, so every client draws the same.
   */
  speckle(colour: string, mark: string): Texture {
    return this.cached(`speckle:${colour}:${mark}`, () => {
      const size = 64;
      const ctx = context(size);
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, size, size);
      let seed = 41;
      const next = (): number => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      ctx.fillStyle = mark;
      for (let i = 0; i < 9; i += 1) {
        const w = 5 + next() * 9;
        ctx.globalAlpha = 0.35 + next() * 0.4;
        ctx.fillRect(next() * (size - w), next() * (size - w), w, w);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0, 0, size, 2);
      return ctx.canvas;
    });
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }

  private cached(key: string, draw: () => HTMLCanvasElement): Texture {
    const existing = this.cache.get(key);
    if (existing) return existing;
    const texture = new CanvasTexture(draw());
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.anisotropy = 4;
    this.cache.set(key, texture);
    return texture;
  }
}

const context = (size: number): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
};
