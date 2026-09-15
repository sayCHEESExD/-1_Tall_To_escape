import {
  COURSE_END_Z,
  COURSE_TOP_Y,
  HUB,
  STAIRS,
  STAIR_START_Z,
  STEPS,
  TALL_LINE_Z,
  WIN_PADS,
  WorldCollision,
  formatNumber,
  type StepDefinition,
} from '@highjump/shared';
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config/worldVisuals.js';
import { CanvasSign } from './CanvasSign.js';
import { DiningArea } from './DiningArea.js';
import { EggStall } from './EggStall.js';
import { FoodShop } from './FoodShop.js';
import { HubDecor } from './HubDecor.js';
import { Batch, bigTree, bush, mergeBatch, seeded } from './PropKit.js';
import { Scoreboard } from './Scoreboard.js';
import { SignAtlas, type AtlasSign } from './SignAtlas.js';
import { Sky } from './Sky.js';
import { texturedBox } from './texturedBox.js';
import { WorldTextures } from './WorldTextures.js';

/** World units one stud covers. */
const STUD = 4;

/** Height of the golden light column over each win pad. */
const GLOW_HEIGHT = 6;

/** Trophy images floating inside each win pad's glow. */
const TROPHIES_PER_PAD = 2;

/** The tall line's gate: post height and where the beam crosses. */
const TALL_GATE = { postHeight: 14, beamY: 13 } as const;

/**
 * How see-through the steps are. Players walk UNDER the staircase with their
 * body up at the steps' height, so a body below a step's top is inside it - a
 * slightly translucent stair keeps them visible from outside.
 */
const STAIR_OPACITY = 0.86;

/** Thickness of the walkway's boundary walls. */
const WALL_THICKNESS = 3;

/** The strip of grass and trees either side of the walkway walls. */
const OUTSIDE = { width: 60, treeSpacing: 34 } as const;

const LEAVES = [0x9ad63a, 0x86c42e, 0xb0e04a];

/** A soft round glow, bright in the middle and clear at the edges. */
const radialGlowCanvas = (): HTMLCanvasElement => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.55, 'rgba(255,220,120,0.45)');
    gradient.addColorStop(1, 'rgba(255,200,60,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
};

/** The top of the step before this one (the walkway floor for the first). */
const previousTop = (step: StepDefinition): number => STEPS[step.index - 1]?.top ?? HUB.floorY;

/**
 * The visible world, built from exactly the same shared data the collision
 * model uses (`STEPS`, `WIN_PADS`, `HUB`), so what is drawn and what is solid
 * cannot drift apart.
 *
 * The staircase is one clean, continuous stair of stone blocks between two
 * orange brick walls, with a walkway floor under it: players walk along the
 * floor and their long legs lift them up to the steps. The steps, the tops,
 * every win pad and every level sign are merged across the whole staircase, so
 * fifty steps cost a handful of draw calls.
 */
export class CourseWorld {
  readonly root = new Group();
  readonly collision = new WorldCollision();
  readonly textures = new WorldTextures();
  readonly scoreboard = new Scoreboard();
  readonly dining: DiningArea;
  readonly foodShop: FoodShop;
  readonly stall: EggStall;
  readonly sky = new Sky(COURSE_END_Z, COURSE_TOP_Y);

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly signs: CanvasSign[] = [];
  private readonly atlasSigns: AtlasSign[] = [];
  private atlas: SignAtlas | null = null;
  /** Floating trophies over every win pad, and their bob phase and base height. */
  private readonly padTrophies: { sprite: Sprite; baseY: number; phase: number }[] = [];
  private readonly padGlow = new MeshBasicMaterial({
    color: 0xffc933,
    transparent: true,
    opacity: 0.2,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  private readonly padFloorGlow: MeshBasicMaterial;
  private readonly trophyMaterial: SpriteMaterial;
  private readonly tallLineGlow = new MeshBasicMaterial({
    color: PALETTE.tallLine,
    transparent: true,
    opacity: 0.8,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly textures2: Texture[] = [];
  private time = 0;
  private readonly hubDecor = new HubDecor();

  constructor() {
    const trophy = new TextureLoader().load('/ui/trophy.png');
    trophy.colorSpace = SRGBColorSpace;
    this.trophyMaterial = new SpriteMaterial({ map: trophy, transparent: true, depthWrite: false });
    const floor = new CanvasTexture(radialGlowCanvas());
    floor.colorSpace = SRGBColorSpace;
    this.padFloorGlow = new MeshBasicMaterial({
      map: floor,
      color: 0xffd23d,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.textures2.push(trophy, floor);
    this.dining = new DiningArea(this.textures);
    this.foodShop = new FoodShop();
    this.stall = new EggStall(this.textures);
    this.root.add(
      this.sky.root,
      this.scoreboard.root,
      this.dining.root,
      this.foodShop.root,
      this.stall.root,
      this.hubDecor.root,
    );

    this.buildHub();
    this.buildTallLine();
    this.buildWalkway();
    this.buildStaircase();
    this.buildWinPads();
    this.atlas = new SignAtlas(this.atlasSigns);
    this.root.add(this.atlas.mesh);
  }

  addTo(parent: Group | { add: (object: Group) => unknown }): void {
    parent.add(this.root);
  }

  update(delta: number, cameraX: number, cameraY: number, cameraZ: number): void {
    this.sky.follow(cameraX, cameraY, cameraZ);
    this.dining.update(delta);
    this.foodShop.update(delta);
    this.stall.update(delta);
    this.hubDecor.update(delta);

    this.time += delta;
    this.padGlow.opacity = 0.16 + Math.sin(this.time * 2.2) * 0.06;
    this.padFloorGlow.opacity = 0.75 + Math.sin(this.time * 2.2) * 0.2;
    this.tallLineGlow.opacity = 0.6 + Math.sin(this.time * 3) * 0.25;
    for (const trophy of this.padTrophies) {
      trophy.sprite.position.y = trophy.baseY + Math.sin(this.time * 1.8 + trophy.phase) * 0.45;
      trophy.sprite.material.rotation = Math.sin(this.time * 1.3 + trophy.phase) * 0.18;
    }
  }

  private buildHub(): void {
    const floorMat = this.lambert({ map: this.textures.studs(PALETTE.hubFloor, PALETTE.hubFloorLine) });
    const width = HUB.halfWidth * 2;
    const depth = HUB.maxZ - HUB.minZ;
    this.mesh(texturedBox(width, 4, depth, STUD), floorMat, 0, HUB.floorY - 2, (HUB.minZ + HUB.maxZ) / 2);

    const wallMat = this.lambert({ color: PALETTE.hubWall, map: this.textures.bricks() });
    const capMat = this.lambert({ map: this.textures.studs(PALETTE.grass, PALETTE.grassLine) });
    const h = HUB.wallHeight;
    const firstHalf = STAIRS.width / 2;

    const walls: [number, number, number, number, number][] = [
      // x, z, width, depth - back, left, right, and the two front segments.
      [0, HUB.minZ - 1.5, width + 6, 3, h],
      [HUB.halfWidth + 1.5, (HUB.minZ + HUB.maxZ) / 2, 3, depth + 3, h],
      [-HUB.halfWidth - 1.5, (HUB.minZ + HUB.maxZ) / 2, 3, depth + 3, h],
      [(firstHalf + HUB.halfWidth + 3) / 2, HUB.maxZ + 1, HUB.halfWidth + 3 - firstHalf, 2, h],
      [-(firstHalf + HUB.halfWidth + 3) / 2, HUB.maxZ + 1, HUB.halfWidth + 3 - firstHalf, 2, h],
    ];
    for (const [x, z, w, d, height] of walls) {
      this.mesh(texturedBox(w, height, d, STUD), wallMat, x, height / 2, z);
      this.mesh(texturedBox(w + 1, 2, d + 1, STUD), capMat, x, height + 1, z);
    }

    const title = new CanvasSign(40, 6, [
      { text: '+1 TALL ESCAPE', size: 1, fill: '#ffe14d', stroke: '#6b3a00', strokeWidth: 0.2 },
    ]);
    title.mesh.position.set(0, h + 6, HUB.maxZ + 2.2);
    title.mesh.rotation.y = Math.PI;
    this.addSign(title);
  }

  /**
   * THE tall line across the stair mouth: a glowing strip on the floor under a
   * gate. Walking past it grows the legs; walking back shrinks them.
   */
  private buildTallLine(): void {
    const half = STAIRS.width / 2 - 1;
    const post = this.lambert({ color: 0x2b3a78 });
    const cap = this.lambert({ color: PALETTE.tallLine, emissive: PALETTE.tallLine, emissiveIntensity: 0.6 });
    this.mesh(new BoxGeometry(half * 2, 0.08, 1.4), this.tallLineGlow, 0, HUB.floorY + 0.05, TALL_LINE_Z).castShadow = false;
    for (const side of [-1, 1]) {
      this.mesh(new BoxGeometry(1.4, TALL_GATE.postHeight, 1.4), post, side * half, TALL_GATE.postHeight / 2, TALL_LINE_Z);
      this.mesh(new BoxGeometry(2, 1, 2), cap, side * half, TALL_GATE.postHeight + 0.5, TALL_LINE_Z);
    }
    this.mesh(new BoxGeometry(half * 2, 0.7, 0.7), this.tallLineGlow, 0, TALL_GATE.beamY, TALL_LINE_Z).castShadow = false;

    const sign = new CanvasSign(22, 4, [
      { text: 'TALL LINE - LEGS GROW HERE', size: 1, fill: '#5ce1ff', stroke: '#0b1f3a', strokeWidth: 0.2 },
    ]);
    sign.mesh.position.set(0, TALL_GATE.beamY - 2.6, TALL_LINE_Z - 0.4);
    sign.mesh.rotation.y = Math.PI;
    this.addSign(sign);
  }

  /**
   * The floor under the staircase, the orange brick walls either side of it
   * and across its far end with grass on top, and grass with big blocky trees
   * beyond the walls. The walls' inner faces are the walkway's edges, which
   * the collision clamp holds the player's body clear of.
   */
  private buildWalkway(): void {
    const length = COURSE_END_Z - STAIR_START_Z;
    const midZ = (STAIR_START_Z + COURSE_END_Z) / 2;
    const half = STAIRS.width / 2;
    const h = STAIRS.wallHeight;

    const floor = this.lambert({ map: this.textures.studs(PALETTE.walkway, PALETTE.walkwayLine) });
    this.mesh(texturedBox(STAIRS.width, 4, length, STUD), floor, 0, HUB.floorY - 2, midZ);

    const wall = this.lambert({ map: this.textures.studs(PALETTE.stairWall, PALETTE.stairWallLine) });
    const grass = this.lambert({ map: this.textures.studs(PALETTE.grass, PALETTE.grassLine) });
    for (const side of [-1, 1]) {
      const x = side * (half + WALL_THICKNESS / 2);
      this.mesh(texturedBox(WALL_THICKNESS, h, length + WALL_THICKNESS, STUD), wall, x, h / 2, midZ + WALL_THICKNESS / 2);
      this.mesh(texturedBox(WALL_THICKNESS + 1, 1.2, length + WALL_THICKNESS, STUD), grass, x, h + 0.6, midZ + WALL_THICKNESS / 2);
      // The grass beyond the wall, level with its top.
      const outsideX = side * (half + WALL_THICKNESS + OUTSIDE.width / 2);
      this.mesh(texturedBox(OUTSIDE.width, h, length + 8, STUD), wall, outsideX, h / 2, midZ).receiveShadow = true;
      this.mesh(texturedBox(OUTSIDE.width, 1.2, length + 8, STUD), grass, outsideX, h + 0.6, midZ);
    }
    const endZ = COURSE_END_Z + WALL_THICKNESS / 2;
    this.mesh(texturedBox(STAIRS.width + WALL_THICKNESS * 2, h, WALL_THICKNESS, STUD), wall, 0, h / 2, endZ);
    this.mesh(texturedBox(STAIRS.width + WALL_THICKNESS * 2 + 1, 1.2, WALL_THICKNESS + 1, STUD), grass, 0, h + 0.6, endZ);

    const batch = new Batch();
    const r = seeded(0x7a11);
    for (let z = STAIR_START_Z + 6; z < COURSE_END_Z; z += OUTSIDE.treeSpacing) {
      for (const side of [-1, 1]) {
        const x = side * (half + 12 + r() * 30);
        batch.prop(bigTree(LEAVES), r, x, h + 1.2, z + r() * 14);
        batch.prop(bush(LEAVES), r, side * (half + 6 + r() * 4), h + 1.2, z + 8 + r() * 10);
      }
    }
    const { solid } = mergeBatch(batch);
    if (solid) {
      const material = this.lambert({ vertexColors: true });
      const trees = this.mesh(solid, material, 0, 0, 0);
      trees.receiveShadow = false;
    }
  }

  /**
   * One clean stair: a stone block per step from the floor to its top, with a
   * lighter studded top plate. Translucent, because players stand inside it:
   * their feet on the floor below and their body up at the steps' height.
   */
  private buildStaircase(): void {
    const blocks: BufferGeometry[] = [];
    const tops: BufferGeometry[] = [];
    for (const step of STEPS) {
      const w = step.maxX - step.minX;
      const d = step.maxZ - step.minZ;
      const cz = (step.minZ + step.maxZ) / 2;
      const block = texturedBox(w, step.top - 0.6, d, STUD * 2);
      block.translate(0, (step.top - 0.6) / 2, cz);
      blocks.push(block);
      const top = texturedBox(w, 0.6, d, STUD);
      top.translate(0, step.top - 0.3, cz);
      tops.push(top);
      this.addLevelSign(step);
    }
    const stone = this.lambert({
      map: this.textures.speckle(PALETTE.stairFace, PALETTE.stairFaceMark),
      transparent: true,
      opacity: STAIR_OPACITY,
      side: FrontSide,
    });
    const plate = this.lambert({
      map: this.textures.studs(PALETTE.stairTop, PALETTE.stairTopLine),
      transparent: true,
      opacity: Math.min(1, STAIR_OPACITY + 0.08),
      side: FrontSide,
    });
    this.merged(blocks, stone);
    this.merged(tops, plate);

    const summit = STEPS[STEPS.length - 1];
    if (summit) {
      const sign = new CanvasSign(30, 7, [
        { text: 'HEAVEN', size: 1, fill: '#ffd23d', stroke: '#5a2b00', strokeWidth: 0.22 },
      ]);
      sign.mesh.position.set(0, summit.top + 10, summit.maxZ - 2);
      sign.mesh.rotation.y = Math.PI;
      this.addSign(sign);
    }
  }

  /**
   * The Recommended Level sign on a step's riser, at the RIGHT edge of the
   * stair (-X), clear of the walking line and of the win pads on the left.
   * Informational only: nothing gates on it. A short riser still gets a
   * readable sign - it simply stands up past the riser's top edge.
   */
  private addLevelSign(step: StepDefinition): void {
    const rise = step.top - previousTop(step);
    const height = Math.min(10, Math.max(4, rise * 0.8));
    const width = height * 2.5;
    this.atlasSigns.push({
      lines: [
        { text: 'RECOMMENDED', size: 0.5, fill: '#ffffff', stroke: '#2d2838', strokeWidth: 0.2 },
        { text: `LEVEL ${step.recommendedLevel}`, size: 1, fill: '#2d2838', stroke: '#ffffff', strokeWidth: 0.14 },
      ],
      width,
      height,
      x: -(STAIRS.width / 2 - width / 2 - 1.5),
      y: previousTop(step) + 0.3 + height / 2,
      z: step.minZ - 0.35,
      rotationY: Math.PI,
      plate: 'rgba(255,255,255,0.28)',
    });
  }

  /** One gold pad on EVERY step's top: merged pad meshes, merged glow, labels in the atlas. */
  private buildWinPads(): void {
    const gold = this.lambert({
      map: this.textures.studs(PALETTE.padGold, PALETTE.padGoldLine),
      emissive: 0x6b4a00,
    });
    const frame = this.lambert({ color: 0x1b2433 });
    const frames: BufferGeometry[] = [];
    const golds: BufferGeometry[] = [];
    const glows: BufferGeometry[] = [];
    const pools: BufferGeometry[] = [];

    for (const pad of WIN_PADS) {
      const w = pad.maxX - pad.minX;
      const d = pad.maxZ - pad.minZ;
      const cx = (pad.minX + pad.maxX) / 2;
      const cz = (pad.minZ + pad.maxZ) / 2;

      const border = texturedBox(w + 1, 0.2, d + 1, STUD);
      border.translate(cx, pad.minY + 0.1, cz);
      frames.push(border);
      const plate = texturedBox(w, pad.maxY - pad.minY, d, 2);
      plate.translate(cx, (pad.minY + pad.maxY) / 2 + 0.02, cz);
      golds.push(plate);

      // The golden glow: a soft column of light over the pad and a bright pool
      // on its floor, both additive so they read as light rather than as walls.
      const column = new BoxGeometry(w - 0.4, GLOW_HEIGHT, d - 0.4);
      column.translate(cx, pad.maxY + GLOW_HEIGHT / 2, cz);
      glows.push(column);
      const pool = new PlaneGeometry(w + 4, d + 4);
      pool.rotateX(-Math.PI / 2);
      pool.translate(cx, pad.maxY + 0.06, cz);
      pools.push(pool);

      this.atlasSigns.push({
        lines: [
          { text: `+${formatNumber(pad.wins)} Win${pad.wins === 1 ? '' : 's'}`, size: 1, fill: '#ffd23d', stroke: '#5a2b00', strokeWidth: 0.2 },
          { text: 'Return', size: 0.7, fill: '#ffffff', stroke: '#1b2433', strokeWidth: 0.18 },
        ],
        width: 12,
        height: 5,
        x: cx,
        y: pad.maxY + 8,
        z: cz,
        rotationY: Math.PI,
      });

      // Trophies floating inside the glow. Sprites share one material and
      // always face the camera; `update` bobs them.
      for (let i = 0; i < TROPHIES_PER_PAD; i += 1) {
        const sprite = new Sprite(this.trophyMaterial);
        const angle = (i / TROPHIES_PER_PAD) * Math.PI * 2 + pad.step;
        const baseY = pad.maxY + 1.6 + ((i * 0.37 + pad.step * 0.13) % 1) * 2.8;
        sprite.position.set(cx + Math.cos(angle) * (w / 2 - 3), baseY, cz + Math.sin(angle) * (d / 2 - 2.5));
        sprite.scale.setScalar(1.7 + (i % 2) * 0.3);
        this.root.add(sprite);
        this.padTrophies.push({ sprite, baseY, phase: i * 1.7 + pad.step });
      }
    }

    this.merged(frames, frame);
    this.merged(golds, gold);
    const glow = this.merged(glows, this.padGlow);
    if (glow) glow.castShadow = false;
    const pool = this.merged(pools, this.padFloorGlow);
    if (pool) {
      pool.castShadow = false;
      pool.receiveShadow = false;
    }
  }

  private lambert(params: ConstructorParameters<typeof MeshLambertMaterial>[0]): MeshLambertMaterial {
    const material = new MeshLambertMaterial(params);
    this.materials.push(material);
    return material;
  }

  private mesh(geometry: BufferGeometry, material: Material, x: number, y: number, z: number): Mesh {
    this.geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  private merged(parts: BufferGeometry[], material: Material): Mesh | null {
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) return null;
    return this.mesh(geometry, material, 0, 0, 0);
  }

  private addSign(sign: CanvasSign): void {
    this.signs.push(sign);
    this.root.add(sign.mesh);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const sign of this.signs) sign.dispose();
    this.atlas?.dispose();
    this.padGlow.dispose();
    this.padFloorGlow.dispose();
    this.tallLineGlow.dispose();
    this.trophyMaterial.dispose();
    for (const texture of this.textures2) texture.dispose();
    this.hubDecor.dispose();
    this.scoreboard.dispose();
    this.dining.dispose();
    this.foodShop.dispose();
    this.stall.dispose();
    this.sky.dispose();
    this.textures.dispose();
    this.root.removeFromParent();
  }
}
