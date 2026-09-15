import { DINING, DINING_CHAIRS, DINING_TIERS, FOOD_TIERS, HUB } from '@highjump/shared';
import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type BufferGeometry,
  type Material,
} from 'three';
import { buildFoodModel, disposeFoodModel } from '../player/FoodModels.js';
import { FOOD_ICON_URL } from '../ui/hudStyles.js';
import { CanvasSign, type SignLine } from './CanvasSign.js';
import { FramedSign, SIGN_THEMES } from './FramedSign.js';
import { texturedBox } from './texturedBox.js';
import type { WorldTextures } from './WorldTextures.js';

/** Chair proportions, in world units. The seat top matches the sitting pose's hip height. */
const CHAIR = { seat: 2.3, seatTop: 0.75, seatThick: 0.22, leg: 0.24, back: 2.4 } as const;

/** Which food sits on each tier's plates: a feast that gets fancier with the tier. */
const TABLE_FOODS: readonly number[] = [3, 7, 11, 15];

/** The rebirth sign over each set: size and height above the floor. */
const SIGN = { width: 24, height: 9, y: 10 } as const;

/** How much lighter the border tiles round a mat are drawn. */
const MAT_BORDER = 1.2;

/**
 * The Dining Hall: four dining table sets along the back of the hub, each on
 * its own coloured floor mat and gated by a rebirth count (0, 2, 5, 10).
 *
 * Each set is a table and four chairs in the tier's colour, with plates of
 * food and a candle, and a big floating sign above it facing the approach from
 * spawn: "Locked" (while locked), "xN Height Power" and "Rebirth N". Sitting on
 * a chair (the shared `diningSeatAt` zone) eats on the spot. The tables are
 * real solids in shared data; chairs are decoration the player sits "into".
 */
export class DiningArea {
  readonly root = new Group();
  private readonly signs: CanvasSign[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly foods: Group[] = [];
  private readonly seatGlows: MeshBasicMaterial[] = [];
  private readonly flames: Mesh[] = [];
  private rebirths = -1;
  private time = 0;
  private readonly title: FramedSign;

  constructor(textures: WorldTextures) {
    const plate = this.lambert({ color: 0xf5f7fb });
    const candle = this.lambert({ color: 0xfff4de });
    const flame = this.track(new MeshBasicMaterial({ color: 0xffb13d }));

    const W = DINING.tableWidth;
    const D = DINING.tableDepth;
    const H = DINING.tableHeight;
    const top = this.box(W, 0.3, D);
    const tableLeg = this.box(0.5, H - 0.3, 0.5);
    const plateGeometry = new CylinderGeometry(0.62, 0.5, 0.08, 16);
    const candleGeometry = new CylinderGeometry(0.1, 0.1, 0.7, 8);
    const flameGeometry = new CylinderGeometry(0, 0.1, 0.28, 6);
    this.geometries.push(plateGeometry, candleGeometry, flameGeometry);
    const seat = this.box(CHAIR.seat, CHAIR.seatThick, CHAIR.seat);
    const chairLeg = this.box(CHAIR.leg, CHAIR.seatTop - CHAIR.seatThick, CHAIR.leg);
    const back = this.box(CHAIR.seat, CHAIR.back, 0.24);
    const glowRing = this.box(DINING.seatSize, 0.04, DINING.seatSize);
    const mat = this.box(DINING.matWidth, 0.08, DINING.matDepth);
    const borderX = this.box(DINING.matWidth + MAT_BORDER * 2, 0.06, MAT_BORDER);
    const borderZ = this.box(MAT_BORDER, 0.06, DINING.matDepth);

    DINING_TIERS.forEach((tier, index) => {
      const set = new Group();
      const cx = DINING.xs[index] ?? 0;
      set.position.set(cx, HUB.floorY, DINING.centerZ);

      // The coloured mat with a lighter border, as in the reference.
      const matMaterial = this.lambert({ color: tier.color, map: textures.studs('#ffffff', '#e6e6e6') });
      const borderMaterial = this.lambert({ color: tier.glow, map: textures.studs('#ffffff', '#e6e6e6') });
      this.add(set, mat, matMaterial, 0, 0.04, 0).castShadow = false;
      for (const side of [-1, 1]) {
        this.add(set, borderX, borderMaterial, 0, 0.03, side * (DINING.matDepth / 2 + MAT_BORDER / 2)).castShadow = false;
        this.add(set, borderZ, borderMaterial, side * (DINING.matWidth / 2 + MAT_BORDER / 2), 0.03, 0).castShadow = false;
      }

      // The table, in the tier's colour.
      const wood = this.lambert({ color: tier.furniture, map: textures.studs('#ffffff', '#dddddd') });
      const woodDark = this.lambert({ color: tier.furniture });
      woodDark.color.multiplyScalar(0.72);
      this.add(set, top, wood, 0, H - 0.15, 0);
      for (const x of [-(W / 2 - 0.5), W / 2 - 0.5]) {
        for (const z of [-(D / 2 - 0.4), D / 2 - 0.4]) this.add(set, tableLeg, woodDark, x, (H - 0.3) / 2, z);
      }

      // Plates of food in front of every chair, and a candle in the middle.
      const food = FOOD_TIERS[(TABLE_FOODS[index] ?? 1) - 1];
      const chairs = DINING_CHAIRS.filter((entry) => entry.table === tier.index);
      for (const chair of chairs) {
        const px = chair.x - cx;
        const pz = Math.sign(chair.z - DINING.centerZ) * (D / 2 - 0.8);
        this.add(set, plateGeometry, plate, px, H + 0.04, pz);
        if (food) {
          const model = buildFoodModel(food);
          model.scale.setScalar(0.7);
          model.position.set(px, H + 0.08, pz);
          set.add(model);
          this.foods.push(model);
        }
      }
      this.add(set, candleGeometry, candle, 0, H + 0.35, 0);
      const fire = this.add(set, flameGeometry, flame, 0, H + 0.85, 0);
      fire.castShadow = false;
      this.flames.push(fire);

      // Four chairs, backs away from the table, each over a softly glowing seat mark.
      const glow = this.track(
        new MeshBasicMaterial({ color: tier.glow, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false }),
      );
      this.seatGlows.push(glow);
      for (const chair of chairs) {
        const x = chair.x - cx;
        const z = chair.z - DINING.centerZ;
        const away = Math.sign(z);
        this.add(set, glowRing, glow, x, 0.1, z).castShadow = false;
        this.add(set, seat, wood, x, CHAIR.seatTop - CHAIR.seatThick / 2, z);
        for (const lx of [-1, 1]) {
          for (const lz of [-1, 1]) {
            this.add(set, chairLeg, woodDark, x + lx * (CHAIR.seat / 2 - 0.2), (CHAIR.seatTop - CHAIR.seatThick) / 2, z + lz * (CHAIR.seat / 2 - 0.2));
          }
        }
        this.add(set, back, wood, x, CHAIR.seatTop + CHAIR.back / 2, z + away * (CHAIR.seat / 2 - 0.12));
      }

      // The rebirth sign: floating text over the set, facing spawn (+Z).
      const sign = new CanvasSign(SIGN.width, SIGN.height, this.lines(index, 0));
      sign.mesh.position.set(0, SIGN.y, 0);
      sign.mesh.renderOrder = 3;
      set.add(sign.mesh);
      this.signs.push(sign);

      this.root.add(set);
    });

    // The hall's landmark, on the back wall.
    this.title = new FramedSign(44, 10, 'Dining Hall', FOOD_ICON_URL, SIGN_THEMES.purple);
    this.title.root.position.set(0, 20.5, HUB.minZ + 0.35);
    this.root.add(this.title.root);
    this.setRebirths(0);
  }

  /** Redraw the rebirth signs when the player's rebirth count changes. */
  setRebirths(rebirths: number): void {
    if (rebirths === this.rebirths) return;
    this.rebirths = rebirths;
    DINING_TIERS.forEach((tier, index) => {
      this.signs[index]?.redraw(this.lines(index, rebirths));
      const glow = this.seatGlows[index];
      if (glow) glow.color.setHex(rebirths >= tier.rebirthsRequired ? tier.glow : 0x555a66);
    });
  }

  update(delta: number): void {
    this.time += delta;
    this.title.update(delta);
    this.flames.forEach((fire, i) => {
      fire.scale.set(1, 0.85 + Math.sin(this.time * 11 + i * 2) * 0.15, 1);
    });
    for (const glow of this.seatGlows) glow.opacity = 0.35 + Math.sin(this.time * 2.4) * 0.15;
  }

  /** "Locked" (only while locked), "xN Height Power" in the tier's colour, "Rebirth N". */
  private lines(index: number, rebirths: number): SignLine[] {
    const tier = DINING_TIERS[index];
    if (!tier) return [];
    const locked = rebirths < tier.rebirthsRequired;
    return [
      { text: locked ? 'Locked' : '', size: 0.7, fill: '#ff4a5a', stroke: '#3a0a12', strokeWidth: 0.16 },
      { text: `x${tier.multiplier} Height Power`, size: 1, fill: tier.textColor, stroke: '#2a1633', strokeWidth: 0.16 },
      { text: `Rebirth ${tier.rebirthsRequired}`, size: 0.72, fill: '#ffffff', stroke: '#2a1633', strokeWidth: 0.16 },
    ];
  }

  private box(w: number, h: number, d: number): BufferGeometry {
    const geometry = texturedBox(w, h, d, 2);
    this.geometries.push(geometry);
    return geometry;
  }

  private lambert(params: ConstructorParameters<typeof MeshLambertMaterial>[0]): MeshLambertMaterial {
    return this.track(new MeshLambertMaterial(params));
  }

  private track<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private add(parent: Group, geometry: BufferGeometry, material: Material, x: number, y: number, z: number): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const food of this.foods) disposeFoodModel(food);
    for (const sign of this.signs) sign.dispose();
    this.title.dispose();
    this.root.removeFromParent();
  }
}
