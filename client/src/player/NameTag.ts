import { CanvasTexture, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import { avatarNow, drawAvatar, loadAvatar } from '../ui/avatarImages.js';

const WIDTH = 512;
const HEIGHT = 112;
const FONT = '"Arial Black", "Segoe UI", system-ui, sans-serif';

/**
 * On-screen height of the tag as a fraction of the view. The sprite ignores
 * distance, so a player whose legs carry them hundreds of units up the stairs
 * - with the camera pulled back to match - is still labelled legibly.
 */
const SCREEN_HEIGHT = 0.06;

/**
 * The name tag over a player: [avatar] Display Name.
 *
 * Shows exactly what the server replicated - the player's Bloxity display name
 * and avatar thumbnail - for the local player and every remote one alike. The
 * canvas is redrawn only when the name or avatar changes, or when the
 * thumbnail finishes loading.
 */
export class NameTag {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly material: SpriteMaterial;
  private name = '';
  private avatarUrl = '';
  /** Bumped per change, so a slow thumbnail never repaints over a newer identity. */
  private revision = 0;
  private disposed = false;

  constructor() {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.material = new SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: false,
    });
    this.sprite = new Sprite(this.material);
    // Anchored at its bottom edge, so it sits on top of the head.
    this.sprite.center.set(0.5, 0);
    this.sprite.scale.set((SCREEN_HEIGHT * WIDTH) / HEIGHT, SCREEN_HEIGHT, 1);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  set(name: string, avatarUrl: string): void {
    if (name === this.name && avatarUrl === this.avatarUrl) return;
    this.name = name;
    this.avatarUrl = avatarUrl;
    this.sprite.visible = name !== '';
    const revision = ++this.revision;
    this.draw();
    if (name && avatarNow(avatarUrl) === undefined) {
      void loadAvatar(avatarUrl).then(() => {
        if (!this.disposed && revision === this.revision) this.draw();
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.texture.dispose();
    this.material.dispose();
    this.sprite.removeFromParent();
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (this.name) {
      const radius = 40;
      const inset = 8;
      const gap = 14;
      const tail = 24;
      let size = 46;
      ctx.font = `900 ${size}px ${FONT}`;
      const room = WIDTH - inset - radius * 2 - gap - tail;
      let textWidth = ctx.measureText(this.name).width;
      if (textWidth > room) {
        size *= room / textWidth;
        ctx.font = `900 ${size}px ${FONT}`;
        textWidth = ctx.measureText(this.name).width;
      }

      const pillHeight = (radius + inset) * 2;
      const pillWidth = inset + radius * 2 + gap + textWidth + tail;
      const left = (WIDTH - pillWidth) / 2;
      const top = (HEIGHT - pillHeight) / 2;
      ctx.fillStyle = 'rgba(12, 18, 30, 0.55)';
      ctx.beginPath();
      ctx.roundRect(left, top, pillWidth, pillHeight, pillHeight / 2);
      ctx.fill();

      drawAvatar(ctx, avatarNow(this.avatarUrl), left + inset + radius, HEIGHT / 2, radius, '#ffffff');

      const textX = left + inset + radius * 2 + gap;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.18;
      ctx.strokeStyle = '#10141c';
      ctx.strokeText(this.name, textX, HEIGHT / 2 + 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.name, textX, HEIGHT / 2 + 2);
    }
    this.texture.needsUpdate = true;
  }
}
