import {
  FOOD_SHOP,
  FOOD_TIERS,
  HUB,
  bestOwnedFood,
  foodPadCentre,
  formatNumber,
  isFoodOwned,
} from '@highjump/shared';
import { BoxGeometry, Group, Mesh, MeshLambertMaterial, type BufferGeometry } from 'three';
import { PALETTE } from '../config/worldVisuals.js';
import { buildFoodModel, disposeFoodModel } from '../player/FoodModels.js';
import { FOOD_ICON_URL } from '../ui/hudStyles.js';
import { CanvasSign, type SignLine } from './CanvasSign.js';
import { FramedSign, SIGN_THEMES } from './FramedSign.js';

/** How big a food is shown on its pedestal. */
const DISPLAY_SCALE = 2.2;

/**
 * The Food Shop: fifteen foods on pedestals, three rows of five down the
 * player's LEFT (+X). Walk onto a pad holding the Wins to buy that food.
 *
 * Each pedestal shows the food itself, turning slowly. Signs redraw only when
 * ownership or affordability changes.
 */
export class FoodShop {
  readonly root = new Group();
  private readonly pads: Mesh[] = [];
  private readonly models: Group[] = [];
  private readonly signs: CanvasSign[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshLambertMaterial[] = [];
  private readonly padOwned: MeshLambertMaterial;
  private readonly padOpen: MeshLambertMaterial;
  private signature = '';
  private time = 0;
  private readonly title: FramedSign;

  constructor() {
    const pad = new BoxGeometry(FOOD_SHOP.padSize, FOOD_SHOP.padTop, FOOD_SHOP.padSize);
    this.geometries.push(pad);
    this.padOwned = this.lambert(PALETTE.foodPadOwned);
    this.padOpen = this.lambert(PALETTE.foodPad);

    for (const tier of FOOD_TIERS) {
      const centre = foodPadCentre(tier.slot);
      const padMesh = new Mesh(pad, this.padOpen);
      padMesh.position.set(centre.x, HUB.floorY + FOOD_SHOP.padTop / 2, centre.z);
      padMesh.receiveShadow = true;
      this.root.add(padMesh);
      this.pads.push(padMesh);

      const model = buildFoodModel(tier);
      model.scale.setScalar(DISPLAY_SCALE);
      model.position.set(centre.x, HUB.floorY + 1, centre.z);
      this.root.add(model);
      this.models.push(model);

      const row = Math.floor((tier.slot - 1) / FOOD_SHOP.perRow);
      const sign = new CanvasSign(8, 4.2, this.lines(tier.slot, 1, 0));
      sign.mesh.position.set(centre.x - 1, HUB.floorY + 6.5 + row * 3.2, centre.z);
      sign.mesh.rotation.y = -Math.PI / 2;
      this.root.add(sign.mesh);
      this.signs.push(sign);
    }

    // The landmark: the food icon in front of the name, gold frame, golden glow.
    this.title = new FramedSign(38, 10, 'Food Shop', FOOD_ICON_URL, SIGN_THEMES.gold);
    this.title.root.position.set(HUB.halfWidth - 0.35, 18.5, FOOD_SHOP.firstZ + FOOD_SHOP.spacingZ * 2);
    this.title.root.rotation.y = -Math.PI / 2;
    this.root.add(this.title.root);
  }

  setInventory(ownedFoods: number, wins: number): void {
    const affordable = FOOD_TIERS.map((tier) => (wins >= tier.cost ? 1 : 0)).join('');
    const signature = `${ownedFoods}|${affordable}`;
    if (signature === this.signature) return;
    this.signature = signature;
    FOOD_TIERS.forEach((tier, index) => {
      const pad = this.pads[index];
      if (pad) pad.material = isFoodOwned(ownedFoods, tier.slot) ? this.padOwned : this.padOpen;
      this.signs[index]?.redraw(this.lines(tier.slot, ownedFoods, wins));
    });
  }

  update(delta: number): void {
    this.time += delta;
    this.title.update(delta);
    this.models.forEach((model, index) => {
      model.rotation.y = this.time * 0.9 + index;
      model.position.y = HUB.floorY + 1 + Math.sin(this.time * 2 + index) * 0.25;
    });
  }

  private lines(slot: number, owned: number, wins: number): SignLine[] {
    const tier = FOOD_TIERS[slot - 1];
    if (!tier) return [];
    const status = isFoodOwned(owned, slot)
      ? bestOwnedFood(owned).slot === slot
        ? { text: 'Held', fill: '#7dff5c' }
        : { text: 'Owned', fill: '#bfe8ff' }
      : { text: `${formatNumber(tier.cost)} Wins`, fill: wins >= tier.cost ? '#ffe14d' : '#ff9a3d' };
    return [
      { text: tier.name, size: 0.8, fill: '#ffffff', stroke: '#1b2433', strokeWidth: 0.18 },
      { text: `+${formatNumber(tier.foodPerStep)}/Step`, size: 1, fill: '#b8ff5c', stroke: '#1b2433', strokeWidth: 0.18 },
      { text: status.text, size: 0.9, fill: status.fill, stroke: '#1b2433', strokeWidth: 0.18 },
    ];
  }

  private lambert(color: number): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color });
    this.materials.push(material);
    return material;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const model of this.models) disposeFoodModel(model);
    for (const sign of this.signs) sign.dispose();
    this.title.dispose();
    this.root.removeFromParent();
  }
}
