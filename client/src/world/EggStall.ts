import { EGGS, EGG_SHOP, HUB } from '@highjump/shared';
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { PALETTE } from '../config/worldVisuals.js';
import { CanvasSign } from './CanvasSign.js';
import { FramedSign, SIGN_THEMES } from './FramedSign.js';
import type { WorldTextures } from './WorldTextures.js';

/** Where the shopkeeper stands: on a raised step behind the counter. */
export const STALL_KEEPER = {
  x: EGG_SHOP.x,
  z: EGG_SHOP.z + 2.4,
  platformHeight: 1,
} as const;

/**
 * The Egg Shop at the foot of the staircase.
 *
 * A counter with a wooden top, gold trim and glass display cases each holding
 * an egg; a cash register; a back wall of shelves stocked with the five eggs;
 * a striped awning with a scalloped edge and hanging lanterns; crates, barrels,
 * potted plants and lollipops around it; a rug marking where to stand; a
 * chalkboard; and a framed, glowing sign. The shopkeeper stands on the step
 * behind the counter (see `Shopkeeper`). Standing on the rug opens the Egg Shop.
 */
export class EggStall {
  readonly root = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly sign: FramedSign;
  private readonly board: CanvasSign;
  private readonly gems: Mesh[] = [];
  private readonly lanterns: Group[] = [];
  private readonly rugGlow: MeshBasicMaterial;
  private time = 0;

  constructor(textures: WorldTextures) {
    const s = EGG_SHOP;
    const frontZ = s.z - s.depth / 2;
    const counterMat = this.lambert({ map: textures.studs('#f5f7fb', '#d6dde8') });
    const wood = this.lambert({ color: PALETTE.stallWood });
    const woodDark = this.lambert({ color: 0x5c3a1e });
    const gold = this.lambert({ color: 0xffc933, emissive: 0x6b4a00 });
    const stripeA = this.lambert({ color: PALETTE.stallAwningA });
    const stripeB = this.lambert({ color: PALETTE.stallAwningB });
    const pink = this.lambert({ color: 0xffb8dc });
    const wall = this.lambert({ map: textures.studs('#bfe8ff', '#9fd0f0') });

    // Counter: body, wooden top, gold trim and pastel front panels.
    this.add(new BoxGeometry(s.width, s.height, s.depth), counterMat, s.x, s.height / 2, s.z);
    this.add(new BoxGeometry(s.width + 0.6, 0.3, s.depth + 0.5), wood, s.x, s.height + 0.15, s.z);
    for (const y of [0.3, s.height - 0.3]) {
      this.add(new BoxGeometry(s.width + 0.1, 0.25, 0.2), gold, s.x, y, frontZ - 0.05);
    }
    for (const dx of [-4, 0, 4]) this.add(new BoxGeometry(3.2, 1.3, 0.12), pink, s.x + dx, s.height / 2, frontZ - 0.08);

    // Posts and a back wall with three shelves of eggs.
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        this.add(new BoxGeometry(0.8, 8, 0.8), wood, s.x + dx * (s.width / 2 - 0.4), 4, s.z + dz * (s.depth / 2 + 1));
      }
    }
    const wallZ = s.z + 4.6;
    this.add(new BoxGeometry(s.width + 1.5, 7.5, 0.6), wall, s.x, 3.75, wallZ);
    const eggGeometry = new SphereGeometry(0.4, 12, 10);
    eggGeometry.scale(1, 1.3, 1);
    this.geometries.push(eggGeometry);
    const eggMaterials = EGGS.map((egg) => this.lambert({ color: egg.color, emissive: egg.accent, emissiveIntensity: 0.2 }));
    [3.2, 4.8, 6.4].forEach((y) => {
      this.add(new BoxGeometry(s.width, 0.25, 1.2), wood, s.x, y, wallZ - 0.65);
      for (let i = 0; i < EGGS.length; i += 1) {
        const gem = new Mesh(eggGeometry, eggMaterials[i]);
        gem.position.set(s.x - 4.8 + i * 2.4, y + 0.65, wallZ - 0.65);
        this.root.add(gem);
        this.gems.push(gem);
      }
    });

    // The shopkeeper's step.
    this.add(new BoxGeometry(6, STALL_KEEPER.platformHeight, 1.8), woodDark, STALL_KEEPER.x, STALL_KEEPER.platformHeight / 2, STALL_KEEPER.z + 0.1);

    // Glass display cases on the counter, each with a turning egg inside.
    const glass = this.track(new MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide }));
    const bigGem = new SphereGeometry(0.45, 14, 10);
    bigGem.scale(1, 1.3, 1);
    this.geometries.push(bigGem);
    [
      [-4.3, EGGS[1]?.color ?? 0x5ce1ff],
      [4.3, EGGS[4]?.color ?? 0xff5fd0],
    ].forEach(([dx, colour]) => {
      const x = s.x + (dx as number);
      const top = s.height + 0.3;
      this.add(new BoxGeometry(1.9, 0.2, 1.7), gold, x, top + 0.1, s.z);
      this.add(new BoxGeometry(1.7, 1.4, 1.5), glass, x, top + 0.9, s.z).castShadow = false;
      this.add(new BoxGeometry(1.9, 0.15, 1.7), gold, x, top + 1.67, s.z);
      const gem = new Mesh(bigGem, this.lambert({ color: colour as number, emissive: colour as number, emissiveIntensity: 0.6 }));
      gem.position.set(x, top + 0.9, s.z);
      this.root.add(gem);
      this.gems.push(gem);
    });

    // Cash register.
    const register = this.lambert({ color: 0xff8cc6 });
    this.add(new BoxGeometry(1.4, 0.8, 1.0), register, s.x + 2.1, s.height + 0.7, s.z + 0.2);
    this.add(new BoxGeometry(1.1, 0.55, 0.12), this.lambert({ color: 0x1b2433, emissive: 0x0a3a2a }), s.x + 2.1, s.height + 1.35, s.z + 0.35).rotation.x = -0.35;
    this.add(new BoxGeometry(1.5, 0.3, 1.1), this.lambert({ color: 0xffffff }), s.x + 2.1, s.height + 0.25, s.z + 0.2);

    // Striped awning with a scalloped front edge.
    const stripes = 6;
    const stripeW = (s.width + 2) / stripes;
    for (let i = 0; i < stripes; i += 1) {
      const stripe = this.add(
        new BoxGeometry(stripeW, 0.5, s.depth + 5),
        i % 2 === 0 ? stripeA : stripeB,
        s.x - (s.width + 2) / 2 + stripeW * (i + 0.5),
        8.6,
        s.z - 0.6,
      );
      stripe.rotation.x = -0.22;
    }
    const scallops = 12;
    const scallopW = (s.width + 2) / scallops;
    for (let i = 0; i < scallops; i += 1) {
      this.add(
        new BoxGeometry(scallopW * 0.9, 0.7, 0.2),
        i % 2 === 0 ? stripeA : stripeB,
        s.x - (s.width + 2) / 2 + scallopW * (i + 0.5),
        7.35,
        s.z - 4.45,
      ).castShadow = false;
    }

    // Hanging lanterns under the awning.
    const lanternBody = new BoxGeometry(0.6, 0.8, 0.6);
    const lanternCap = new BoxGeometry(0.75, 0.15, 0.75);
    const cord = new BoxGeometry(0.05, 1, 0.05);
    this.geometries.push(lanternBody, lanternCap, cord);
    const lanternGlow = this.track(new MeshBasicMaterial({ color: 0xffd98a }));
    for (const dx of [-4, 0, 4]) {
      const lantern = new Group();
      const line = new Mesh(cord, woodDark);
      line.position.y = -0.5;
      const top = new Mesh(lanternCap, woodDark);
      top.position.y = -1.05;
      const body = new Mesh(lanternBody, lanternGlow);
      body.position.y = -1.5;
      const bottom = new Mesh(lanternCap, woodDark);
      bottom.position.y = -1.95;
      lantern.add(line, top, body, bottom);
      lantern.position.set(s.x + dx, 8.1, s.z - 3.2);
      this.root.add(lantern);
      this.lanterns.push(lantern);
    }

    // Lollipops either side.
    const stick = new CylinderGeometry(0.15, 0.15, 4, 6);
    const candy = new CylinderGeometry(1.6, 1.6, 0.5, 16);
    this.geometries.push(stick, candy);
    [
      [-1, 0xff4fa3],
      [1, 0x4fb8ff],
    ].forEach(([side, colour]) => {
      const x = s.x + (side as number) * (s.width / 2 + 2.5);
      const stickMesh = new Mesh(stick, stripeB);
      stickMesh.position.set(x, 2, s.z - 1);
      const head = new Mesh(candy, this.lambert({ color: colour as number }));
      head.position.set(x, 5.2, s.z - 1);
      head.rotation.x = Math.PI / 2;
      this.root.add(stickMesh, head);
    });

    // Crates on one side, barrels on the other.
    const crate = this.lambert({ color: 0xb5823f });
    this.add(new BoxGeometry(2, 2, 2), crate, s.x + 9.6, 1, s.z + 2.6).rotation.y = 0.2;
    this.add(new BoxGeometry(1.5, 1.5, 1.5), crate, s.x + 9.5, 2.75, s.z + 2.5).rotation.y = -0.3;
    this.add(new BoxGeometry(2.1, 0.2, 0.25), woodDark, s.x + 9.6, 1, s.z + 1.55).rotation.y = 0.2;
    const barrelGeometry = new CylinderGeometry(0.85, 0.85, 1.8, 10);
    const hoopGeometry = new CylinderGeometry(0.9, 0.9, 0.15, 10);
    this.geometries.push(barrelGeometry, hoopGeometry);
    for (const [dx, dz] of [
      [-9.4, 2.4],
      [-10.4, 0.6],
    ] as const) {
      const barrel = new Mesh(barrelGeometry, wood);
      barrel.position.set(s.x + dx, 0.9, s.z + dz);
      barrel.castShadow = true;
      this.root.add(barrel);
      for (const y of [0.45, 1.35]) {
        const hoop = new Mesh(hoopGeometry, woodDark);
        hoop.position.set(s.x + dx, y, s.z + dz);
        this.root.add(hoop);
      }
    }

    // Potted plants at the front corners.
    const pot = this.lambert({ color: 0xc9784a });
    const leaf = this.lambert({ color: 0x3fae3a });
    for (const side of [-1, 1]) {
      const x = s.x + side * 6.6;
      this.add(new BoxGeometry(1, 0.9, 1), pot, x, 0.45, s.z - 3.2);
      this.add(new BoxGeometry(1.3, 1, 1.3), leaf, x, 1.4, s.z - 3.2).rotation.y = 0.4;
      this.add(new BoxGeometry(0.9, 0.8, 0.9), leaf, x + 0.2, 2.1, s.z - 3.3).rotation.y = 0.9;
    }

    // A rug where customers stand, with a softly glowing border.
    const zone = s.zone;
    const zoneX = (zone.minX + zone.maxX) / 2;
    const zoneZ = (zone.minZ + zone.maxZ) / 2;
    const zoneW = zone.maxX - zone.minX;
    const zoneD = zone.maxZ - zone.minZ;
    this.add(new BoxGeometry(zoneW - 4, 0.06, zoneD - 3), this.lambert({ color: 0xc23b5a }), zoneX, HUB.floorY + 0.03, zoneZ).castShadow = false;
    this.add(new BoxGeometry(zoneW - 6, 0.08, zoneD - 5), this.lambert({ color: 0xffc933 }), zoneX, HUB.floorY + 0.04, zoneZ).castShadow = false;
    this.add(new BoxGeometry(zoneW - 7, 0.1, zoneD - 6), this.lambert({ color: 0x8a1f3a }), zoneX, HUB.floorY + 0.05, zoneZ).castShadow = false;
    this.rugGlow = this.track(new MeshBasicMaterial({ color: 0x3ac8ff, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false }));
    for (const [w, d, x, z] of [
      [zoneW, 0.3, zoneX, zone.minZ],
      [zoneW, 0.3, zoneX, zone.maxZ],
      [0.3, zoneD, zone.minX, zoneZ],
      [0.3, zoneD, zone.maxX, zoneZ],
    ] as const) {
      this.add(new BoxGeometry(w, 0.05, d), this.rugGlow, x, HUB.floorY + 0.06, z).castShadow = false;
    }

    // A chalkboard stand out front.
    const boardX = s.x + 7.4;
    const boardZ = s.z - 6.2;
    for (const dx of [-1.2, 1.2]) this.add(new BoxGeometry(0.18, 3, 0.18), woodDark, boardX + dx, 1.5, boardZ + 0.2).rotation.x = 0.12;
    this.add(new BoxGeometry(2.9, 2.1, 0.12), this.lambert({ color: 0x1f3a2a }), boardX, 2.2, boardZ);
    this.board = new CanvasSign(2.6, 1.8, [
      { text: 'HATCH PETS', size: 1, fill: '#ffe14d', stroke: '#1f3a2a', strokeWidth: 0.1 },
      { text: '5 eggs inside!', size: 0.8, fill: '#ffffff', stroke: '#1f3a2a', strokeWidth: 0.1 },
    ]);
    this.board.mesh.position.set(boardX, 2.2, boardZ - 0.08);
    this.board.mesh.rotation.y = Math.PI;
    this.root.add(this.board.mesh);

    // The framed, glowing sign.
    this.sign = new FramedSign(24, 6.5, 'Egg Shop', '/ui/shop.png', SIGN_THEMES.cyan);
    this.sign.root.position.set(s.x, 12.4, s.z - 2);
    this.sign.root.rotation.y = Math.PI;
    this.root.add(this.sign.root);
  }

  update(delta: number): void {
    this.time += delta;
    this.gems.forEach((gem, i) => {
      gem.rotation.y = this.time * 1.2 + i;
      gem.position.y += Math.sin(this.time * 2 + i) * 0.002;
    });
    this.lanterns.forEach((lantern, i) => {
      lantern.rotation.z = Math.sin(this.time * 1.4 + i) * 0.06;
    });
    this.rugGlow.opacity = 0.35 + Math.sin(this.time * 2.2) * 0.2;
    this.sign.update(delta);
  }

  private lambert(params: ConstructorParameters<typeof MeshLambertMaterial>[0]): MeshLambertMaterial {
    return this.track(new MeshLambertMaterial(params));
  }

  private track<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private add(geometry: BufferGeometry, material: Material, x: number, y: number, z: number): Mesh {
    this.geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.sign.dispose();
    this.board.dispose();
    this.root.removeFromParent();
  }
}
