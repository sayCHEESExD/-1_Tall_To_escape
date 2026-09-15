import {
  AdditiveBlending,
  CanvasTexture,
  FrontSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';

/** The colours of one framed sign. */
export interface FramedSignTheme {
  readonly frame: string;
  readonly frameLight: string;
  readonly frameDark: string;
  /** The glow around the whole sign. */
  readonly glow: string;
  readonly panelTop: string;
  readonly panelBottom: string;
  readonly text: string;
  readonly textStroke: string;
}

export const SIGN_THEMES = {
  gold: {
    frame: '#ffc933',
    frameLight: '#fff3b0',
    frameDark: '#8a5a00',
    glow: '#ffcc33',
    panelTop: '#5a3a08',
    panelBottom: '#241400',
    text: '#ffe14d',
    textStroke: '#3a2400',
  },
  purple: {
    frame: '#c77dff',
    frameLight: '#f1dcff',
    frameDark: '#4a1a7a',
    glow: '#b04dff',
    panelTop: '#3a0f5a',
    panelBottom: '#16052a',
    text: '#f6d2ff',
    textStroke: '#2a0845',
  },
  cyan: {
    frame: '#4fd8ff',
    frameLight: '#d8f7ff',
    frameDark: '#0d4a72',
    glow: '#3ac8ff',
    panelTop: '#0d3a5a',
    panelBottom: '#051a2c',
    text: '#ffffff',
    textStroke: '#062238',
  },
} as const satisfies Record<string, FramedSignTheme>;

const PIXELS_PER_UNIT = 36;
const FONT = '"Arial Black", "Segoe UI", system-ui, sans-serif';

/**
 * A landmark sign: a rectangular bevelled frame with a glow around the whole
 * sign, an icon IN FRONT of the name, and a soft additive halo behind it that
 * pulses. Two draw calls. The icon is a supplied PNG, drawn onto the canvas
 * once it has loaded.
 */
export class FramedSign {
  readonly root = new Group();

  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly geometry: PlaneGeometry;
  private readonly glowTexture: CanvasTexture;
  private readonly glowMaterial: MeshBasicMaterial;
  private readonly glowGeometry: PlaneGeometry;
  private time = Math.random() * 10;

  constructor(
    width: number,
    height: number,
    private readonly text: string,
    iconUrl: string,
    private readonly theme: FramedSignTheme,
  ) {
    this.canvas.width = Math.round(width * PIXELS_PER_UNIT);
    this.canvas.height = Math.round(height * PIXELS_PER_UNIT);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.texture.anisotropy = 8;
    this.geometry = new PlaneGeometry(width, height);
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, side: FrontSide, depthWrite: false, fog: false });
    const sign = new Mesh(this.geometry, this.material);
    sign.renderOrder = 2;

    const glowCanvas = this.drawGlow(width * 1.2, height * 1.5);
    this.glowTexture = new CanvasTexture(glowCanvas);
    this.glowTexture.colorSpace = SRGBColorSpace;
    this.glowGeometry = new PlaneGeometry(width * 1.2, height * 1.5);
    this.glowMaterial = new MeshBasicMaterial({
      map: this.glowTexture,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: FrontSide,
      fog: false,
    });
    const glow = new Mesh(this.glowGeometry, this.glowMaterial);
    glow.position.z = -0.05;
    glow.renderOrder = 1;

    this.root.add(glow, sign);
    this.draw(null);

    const image = new Image();
    image.onload = () => {
      this.draw(image);
      this.texture.needsUpdate = true;
    };
    image.src = iconUrl;
  }

  /** Pulse the glow. */
  update(delta: number): void {
    this.time += delta;
    this.glowMaterial.opacity = 0.7 + Math.sin(this.time * 2.4) * 0.3;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.geometry.dispose();
    this.glowTexture.dispose();
    this.glowMaterial.dispose();
    this.glowGeometry.dispose();
    this.root.removeFromParent();
  }

  private draw(icon: HTMLImageElement | null): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const theme = this.theme;
    ctx.clearRect(0, 0, W, H);

    const margin = H * 0.13;
    const x0 = margin;
    const y0 = margin;
    const w = W - margin * 2;
    const h = H - margin * 2;
    const line = h * 0.1;
    const radius = h * 0.16;

    // Glow around the frame, drawn twice so it reads at a distance.
    ctx.save();
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = margin * 1.1;
    ctx.lineWidth = line;
    ctx.strokeStyle = theme.frame;
    for (let pass = 0; pass < 2; pass += 1) {
      ctx.beginPath();
      ctx.roundRect(x0, y0, w, h, radius);
      ctx.stroke();
    }
    ctx.restore();

    // Panel.
    const panel = ctx.createLinearGradient(0, y0, 0, y0 + h);
    panel.addColorStop(0, theme.panelTop);
    panel.addColorStop(1, theme.panelBottom);
    ctx.beginPath();
    ctx.roundRect(x0 + line / 2, y0 + line / 2, w - line, h - line, radius * 0.8);
    ctx.fillStyle = panel;
    ctx.fill();

    // Bevelled frame: light on top, dark underneath.
    const bevel = ctx.createLinearGradient(0, y0, 0, y0 + h);
    bevel.addColorStop(0, theme.frameLight);
    bevel.addColorStop(0.35, theme.frame);
    bevel.addColorStop(1, theme.frameDark);
    ctx.lineWidth = line;
    ctx.strokeStyle = bevel;
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, radius);
    ctx.stroke();
    ctx.lineWidth = line * 0.18;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.roundRect(x0 + line * 0.9, y0 + line * 0.9, w - line * 1.8, h - line * 1.8, radius * 0.6);
    ctx.stroke();

    // Corner rivets.
    ctx.fillStyle = theme.frameLight;
    for (const [cx, cy] of [
      [x0 + line * 1.6, y0 + line * 1.6],
      [x0 + w - line * 1.6, y0 + line * 1.6],
      [x0 + line * 1.6, y0 + h - line * 1.6],
      [x0 + w - line * 1.6, y0 + h - line * 1.6],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx, cy, line * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }

    // Icon, in front of the name.
    const iconSize = h * 0.82;
    const iconX = x0 + line * 2.2;
    const iconY = y0 + (h - iconSize) / 2;
    if (icon && icon.width > 0) {
      const scale = Math.min(iconSize / icon.width, iconSize / icon.height);
      const dw = icon.width * scale;
      const dh = icon.height * scale;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = h * 0.06;
      ctx.shadowOffsetY = h * 0.03;
      ctx.drawImage(icon, iconX + (iconSize - dw) / 2, iconY + (iconSize - dh) / 2, dw, dh);
      ctx.restore();
    }

    // Name, fitted to the space right of the icon.
    const textLeft = iconX + iconSize + h * 0.12;
    const textRight = x0 + w - line * 2.4;
    const room = textRight - textLeft;
    let size = h * 0.58;
    ctx.font = `900 ${size}px ${FONT}`;
    while (ctx.measureText(this.text).width + size * 0.2 > room && size > 10) {
      size -= 2;
      ctx.font = `900 ${size}px ${FONT}`;
    }
    const cx = (textLeft + textRight) / 2;
    const cy = y0 + h / 2 + size * 0.04;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = theme.textStroke;
    ctx.strokeText(this.text, cx, cy);
    const fill = ctx.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
    fill.addColorStop(0, '#ffffff');
    fill.addColorStop(0.55, theme.text);
    ctx.fillStyle = fill;
    ctx.fillText(this.text, cx, cy);
  }

  /** A soft rounded-rectangle halo in the glow colour, for the additive plane behind. */
  private drawGlow(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = Math.max(64, Math.round((512 * height) / width));
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const W = canvas.width;
    const H = canvas.height;
    const insetX = W * 0.1;
    const insetY = H * 0.2;
    ctx.shadowColor = this.theme.glow;
    ctx.shadowBlur = Math.min(W, H) * 0.12;
    ctx.fillStyle = this.theme.glow;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(insetX, insetY, W - insetX * 2, H - insetY * 2, H * 0.1);
    ctx.fill();
    return canvas;
  }
}
