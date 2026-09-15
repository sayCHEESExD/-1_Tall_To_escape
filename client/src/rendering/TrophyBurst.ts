import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  type Texture,
  type Vector3,
} from 'three';

/** Trophies per award. */
const COUNT = 8;
/** Seconds one trophy lives: pop out, hover, fade. */
const LIFETIME = 1.3;
/** Seconds between one trophy popping and the next. */
const STAGGER = 0.035;
/** World size of a trophy. */
const SIZE = 1.5;
/** Height / width of `trophy.png`. */
const ASPECT = 486 / 514;

const clamp01 = (t: number): number => Math.min(Math.max(t, 0), 1);
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
/** Overshoots past 1 and settles back: the "pop". */
const easeOutBack = (t: number): number => 1 + 2.9 * (t - 1) ** 3 + 1.9 * (t - 1) ** 2;

interface Cup {
  readonly sprite: Sprite;
  readonly material: SpriteMaterial;
  angle: number;
  radius: number;
  height: number;
  spin: number;
}

/**
 * The win collection effect: a ring of trophies pops out around the player,
 * hovers and turns for a moment, then floats up and fades - with a golden
 * flash and a shockwave ring at the feet.
 *
 * World-space and attached to the player's position every frame, so it stays
 * around them through the return to spawn. Local presentation only: a fixed
 * pool of eight sprites, a ring and a flash, hidden and skipped when idle.
 */
export class TrophyBurst {
  readonly root = new Group();

  private readonly texture: Texture;
  private readonly cups: Cup[] = [];
  private readonly glowTexture: CanvasTexture;
  private readonly flashMaterial: MeshBasicMaterial | SpriteMaterial;
  private readonly flash: Sprite;
  private readonly ringGeometry = new RingGeometry(0.85, 1, 48);
  private readonly ringMaterial = new MeshBasicMaterial({
    color: 0xffc933,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  private readonly ring: Mesh;
  private age = 0;

  constructor() {
    this.texture = new TextureLoader().load('/ui/trophy.png');
    this.texture.colorSpace = SRGBColorSpace;

    for (let i = 0; i < COUNT; i += 1) {
      const material = new SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new Sprite(material);
      sprite.renderOrder = 6;
      this.root.add(sprite);
      this.cups.push({ sprite, material, angle: 0, radius: 0, height: 0, spin: 0 });
    }

    this.glowTexture = new CanvasTexture(TrophyBurst.drawGlow());
    this.glowTexture.colorSpace = SRGBColorSpace;
    this.flashMaterial = new SpriteMaterial({
      map: this.glowTexture,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    });
    this.flash = new Sprite(this.flashMaterial);
    this.flash.position.y = 2;
    this.flash.renderOrder = 5;

    this.ring = new Mesh(this.ringGeometry, this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.1;

    this.root.add(this.flash, this.ring);
    this.root.visible = false;
  }

  /** Start (or restart) the burst. */
  play(): void {
    this.age = 0;
    const offset = Math.random() * Math.PI * 2;
    this.cups.forEach((cup, i) => {
      cup.angle = offset + (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      cup.radius = 2.3 + Math.random() * 0.9;
      cup.height = 1.2 + Math.random() * 2.4;
      cup.spin = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6);
    });
    this.root.visible = true;
  }

  update(delta: number, position: Vector3 | null): void {
    if (!this.root.visible) return;
    this.age += delta;
    if (this.age >= LIFETIME + STAGGER * COUNT) {
      this.root.visible = false;
      return;
    }
    if (position) this.root.position.copy(position);
    const age = this.age;

    this.cups.forEach((cup, i) => {
      const t = clamp01((age - i * STAGGER) / LIFETIME);
      if (t <= 0) {
        cup.sprite.visible = false;
        return;
      }
      cup.sprite.visible = true;
      const pop = clamp01(t / 0.3);
      const fade = clamp01((t - 0.68) / 0.32);
      const angle = cup.angle + age * cup.spin;
      const radius = cup.radius * easeOutBack(pop) * (1 - fade * 0.3);
      cup.sprite.position.set(
        Math.cos(angle) * radius,
        0.8 + cup.height * easeOutCubic(pop) + Math.sin(age * 5 + i) * 0.12 * (1 - fade) + fade * fade * 1.8,
        Math.sin(angle) * radius,
      );
      // Overshoot on the pop, a glint as it lands, then shrink away.
      const glint = t > 0.3 ? 0.2 * Math.exp(-(t - 0.3) * 18) : 0;
      const scale = SIZE * (easeOutBack(pop) + glint) * (1 - 0.55 * fade);
      cup.sprite.scale.set(scale, scale * ASPECT, 1);
      cup.material.opacity = Math.min(1, pop * 3) * (1 - fade);
      cup.material.rotation = Math.sin(age * 6 + i) * 0.2 * (1 - fade);
    });

    const flashT = clamp01(age / 0.45);
    this.flash.scale.setScalar(1 + easeOutCubic(flashT) * 6);
    this.flashMaterial.opacity = (1 - flashT) * 0.85;

    const ringT = clamp01(age / 0.6);
    this.ring.scale.setScalar(0.6 + easeOutCubic(ringT) * 4.2);
    this.ringMaterial.opacity = 0.9 * (1 - ringT);
  }

  dispose(): void {
    this.texture.dispose();
    this.glowTexture.dispose();
    for (const cup of this.cups) cup.material.dispose();
    this.flashMaterial.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    this.root.removeFromParent();
  }

  /** A soft golden radial glow. */
  private static drawGlow(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 244, 190, 1)');
    gradient.addColorStop(0.35, 'rgba(255, 200, 60, 0.55)');
    gradient.addColorStop(1, 'rgba(255, 170, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    return canvas;
  }
}
