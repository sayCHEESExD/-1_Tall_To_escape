import { PLAYER_HEIGHT } from '@highjump/shared';
import {
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  SRGBColorSpace,
  SkinnedMesh,
  TextureLoader,
  Vector3,
  type Bone,
  type Object3D,
  type Skeleton,
  type Texture,
} from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { PlayerCharacter } from '../player/PlayerCharacter.js';
import { logger } from '../util/logger.js';
import { bloxityBodyFactory } from './BloxityBodyFactory.js';
import { BLOXITY_MODEL_HEIGHT, DEFAULT_SKIN_ID, resolveItemUrls, resolveSkinUrl } from './bloxityAssets.js';
import { DEFAULT_PROPORTIONS, isEquippedId, type LegionEquipped, type LegionProportions } from './legionTypes.js';

const SCOPE = 'bloxity/avatar';

/** World size of one unit of a Bloxity item, from the GLB's own scale. */
const ITEM_WORLD_SCALE = PLAYER_HEIGHT / BLOXITY_MODEL_HEIGHT;
/** The reference page's hat lift on the head bone, in GLB units. */
const HAT_LIFT = 0.8;

/**
 * The reference page's "counter-scale" for the offsets that widen a body:
 * shoulders, torso and leg spread move bones sideways by this fraction of how
 * far they already sit from the centre.
 */
const COUNTER_SCALE = 0.8;

/** Bones ABOVE the torso: widening the torso moves them, and must not stretch them. */
const ABOVE_TORSO: ReadonlySet<string> = new Set([
  'Spine2',
  'ArmL_Offset',
  'ArmL1',
  'ArmL2',
  'ArmR_Offset',
  'ArmR1',
  'ArmR2',
  'Neck_Offset',
  'Neck1',
]);
/** How far behind the chest a back item sits on the bundled body, in world units. */
const FBX_BACK_OFFSET = -0.18;

const SCRATCH = new Vector3();

/**
 * Bloxity cosmetics on the LOCAL player's character.
 *
 *  - the BODY: `player.glb` with its parts swapped in. A player with a Bloxity
 *    profile wears the BLOXITY body whatever they have equipped: with nothing
 *    equipped that is Bloxity's own default avatar (its default skin on the
 *    default body), which is what they picked, so the bundled `player.fbx` must
 *    not stand in for it. The bundled body is the fallback for exactly one case:
 *    no Bloxity avatar data at all (no SDK, or `player.glb` cannot be fetched),
 *    and `apply` is simply never called then;
 *  - the SKIN, as the body material's map;
 *  - the HAT and BACK item, parented to real bones so they follow the jump;
 *  - the PROPORTIONS, as scales and offsets on bones. Never rotations:
 *    `PlayerRig` rebuilds every bone quaternion each frame.
 *
 * Local and remote alike: the local player applies what the SDK reports, and a
 * remote player applies the look the server replicated for them.
 */
export class BloxityAvatar {
  private readonly objLoader = new OBJLoader();
  private readonly textureLoader = new TextureLoader();

  private equipped: LegionEquipped = {};
  private proportions: LegionProportions = DEFAULT_PROPORTIONS;

  private bodyKey = '';
  private bodyToken = 0;
  private bones = new Map<string, Bone>();
  private material: MeshStandardMaterial | null = null;
  private defaultMap: Texture | null = null;
  private wearingBloxityBody = false;
  /** Whether `material` belongs to a Bloxity body (not ours to dispose) or is our clone. */
  private wearingBloxityBodyMaterial = false;

  /** Bind-pose Y of this body's Neck_Offset bone, for the neck-height offset. */
  private neckOffsetBindY = 0;

  private readonly attachments = new Map<'hat' | 'back', Object3D>();
  private currentSkin: string | null = null;
  private currentHat: string | null = null;
  private currentBack: string | null = null;
  private readonly textures: Texture[] = [];

  private disposed = false;

  constructor(private readonly character: PlayerCharacter) {
    this.bind(character.modelRoot, false);
  }

  /** Wear this look. Safe to call on every avatar event; unchanged slots do no work. */
  apply(equipped: LegionEquipped, proportions: LegionProportions): void {
    if (this.disposed) return;
    this.equipped = equipped;
    this.proportions = proportions;

    // Keyed on body PARTS only, so a hat or skin change never refetches a body.
    // The empty key is the untouched bundled body, which this can only leave.
    const key = bodyKeyOf(equipped);
    if (key !== this.bodyKey) {
      this.bodyKey = key;
      void this.rebuildBody();
    }
    this.wearLayers();
  }

  dispose(): void {
    this.disposed = true;
    this.bodyToken += 1;
    for (const node of this.attachments.values()) node.removeFromParent();
    this.attachments.clear();
    for (const texture of this.textures) texture.dispose();
    if (!this.wearingBloxityBodyMaterial) this.material?.dispose();
  }

  private async rebuildBody(): Promise<void> {
    const token = (this.bodyToken += 1);
    // null only when Bloxity's body cannot be fetched at all - then, and only
    // then, the bundled character stands in.
    const body = await bloxityBodyFactory.build(this.equipped);
    if (this.disposed || token !== this.bodyToken) return;

    const model = this.character.setModel(body);
    this.bind(model, body !== null);
    this.wearLayers();
    logger.info(SCOPE, body ? 'wearing the Bloxity body' : 'Bloxity body unavailable - wearing the bundled body');
  }

  /** Re-collect everything tied to a particular model, and forget what was worn on the old one. */
  private bind(model: Object3D, bloxityBody: boolean): void {
    for (const node of this.attachments.values()) node.removeFromParent();
    this.attachments.clear();
    this.currentSkin = null;
    this.currentHat = null;
    this.currentBack = null;

    this.wearingBloxityBody = bloxityBody;
    this.bones = collectBones(model);

    // Only a material this class cloned is its to dispose. The bundled body
    // shares ONE material with every remote player, so it is cloned before
    // anything writes to it.
    if (this.material && !this.wearingBloxityBodyMaterial) this.material.dispose();
    let material: MeshStandardMaterial | null = null;
    model.traverse((child) => {
      if (!(child instanceof Mesh) || !(child.material instanceof MeshStandardMaterial)) return;
      material ??= bloxityBody ? child.material : child.material.clone();
      child.material = material;
    });
    this.material = material;
    this.wearingBloxityBodyMaterial = bloxityBody;
    this.defaultMap = (material as MeshStandardMaterial | null)?.map ?? null;

    this.neckOffsetBindY = 0;
    if (bloxityBody) this.patchSkeletons(model);
  }

  /**
   * Widening a body - torso, shoulders, leg spread - is done to the SKINNING
   * MATRICES, exactly as Bloxity's own renderer does it: the torso's own
   * matrices are scaled, and every bone above it is SHIFTED rather than scaled,
   * so a broad chest does not stretch the head, the arms or a hat. Scaling the
   * bones themselves (which their children inherit) is what smeared these
   * avatars.
   *
   * Each body is patched with a closure over THIS avatar's proportions, so one
   * player's shape can never reach another's - there is no shared state here.
   */
  private patchSkeletons(model: Object3D): void {
    const patched: Skeleton[] = [];
    model.traverse((child) => {
      if (!(child instanceof SkinnedMesh) || patched.includes(child.skeleton)) return;
      patched.push(child.skeleton);
      this.patchSkeleton(child.skeleton);
    });
  }

  private patchSkeleton(skeleton: Skeleton): void {
    const inverse = new Matrix4();
    const bindX = new Map<string, number>();
    skeleton.bones.forEach((bone, index) => {
      const boneInverse = skeleton.boneInverses[index];
      if (!boneInverse) return;
      const position = new Vector3().setFromMatrixPosition(inverse.copy(boneInverse).invert());
      bindX.set(bone.name, position.x);
      if (bone.name === 'Neck_Offset') this.neckOffsetBindY = position.y;
    });
    const spineX = bindX.get('Spine1') ?? 0;

    const update = skeleton.update.bind(skeleton);
    const read = (): LegionProportions => this.proportions;
    skeleton.update = function patchedUpdate(this: Skeleton): void {
      update();
      const p = read();
      const shoulders = finite(p.shoulderWidth);
      const legs = finite(p.legOffsetX);
      const torso = finite(p.torsoScaleX);
      if (shoulders === 1 && legs === 1 && torso === 1) return;

      const matrices = this.boneMatrices;
      if (!matrices) return;
      for (let i = 0; i < this.bones.length; i += 1) {
        const name = this.bones[i]?.name ?? '';
        const at = i * 16;
        if (torso !== 1 && (name === 'Spine1' || name === 'Spine2')) {
          for (let k = 0; k < 4; k += 1) matrices[at + k] = (matrices[at + k] ?? 0) * torso;
        }
        if (torso !== 1 && ABOVE_TORSO.has(name)) {
          const x = bindX.get(name);
          if (x !== undefined) matrices[at + 12] = (matrices[at + 12] ?? 0) + (x - spineX) * (torso - 1) * COUNTER_SCALE;
        }
        if (shoulders !== 1 && name.startsWith('Arm')) {
          const x = bindX.get(name.startsWith('ArmL') ? 'ArmL_Offset' : 'ArmR_Offset') ?? 0;
          if (x) matrices[at + 12] = (matrices[at + 12] ?? 0) + x * (shoulders - 1) * COUNTER_SCALE;
        }
        if (legs !== 1 && name.startsWith('Leg')) {
          const x = bindX.get(name.startsWith('LegL') ? 'LegL_Offset' : 'LegR_Offset') ?? 0;
          if (x) matrices[at + 12] = (matrices[at + 12] ?? 0) + x * (legs - 1) * COUNTER_SCALE;
        }
      }
    };
  }

  private wearLayers(): void {
    void this.applySkin();
    void this.applyItem('hat', this.equipped.hatId ?? null);
    void this.applyItem('back', this.equipped.backId ?? null);
    this.applyProportions(this.proportions);
  }

  // ------------------------------------------------------------------ skin

  private async applySkin(): Promise<void> {
    // Only the Bloxity body wears a Bloxity skin, and with none equipped it
    // wears Bloxity's default rather than rendering white.
    const wanted = this.wearingBloxityBody ? (isEquippedId(this.equipped.skinId) ? this.equipped.skinId : DEFAULT_SKIN_ID) : null;
    if (wanted === this.currentSkin) return;
    this.currentSkin = wanted;

    const material = this.material;
    if (!material) return;
    if (!wanted) {
      material.map = this.defaultMap;
      material.needsUpdate = true;
      return;
    }

    const url = await resolveSkinUrl(wanted);
    if (this.disposed || this.currentSkin !== wanted || this.material !== material) return;

    this.textureLoader.load(
      url,
      (texture) => {
        if (this.disposed || this.currentSkin !== wanted || this.material !== material) {
          texture.dispose();
          return;
        }
        pixelArt(texture);
        this.textures.push(texture);
        material.map = texture;
        material.needsUpdate = true;
      },
      undefined,
      () => logger.warn(SCOPE, `skin ${wanted} failed to load`),
    );
  }

  // ----------------------------------------------------------------- items

  private async applyItem(slot: 'hat' | 'back', id: string | null): Promise<void> {
    const wanted = isEquippedId(id) ? id : null;
    const current = slot === 'hat' ? this.currentHat : this.currentBack;
    if (wanted === current) return;
    if (slot === 'hat') this.currentHat = wanted;
    else this.currentBack = wanted;

    this.attachments.get(slot)?.removeFromParent();
    this.attachments.delete(slot);
    if (!wanted) return;

    const anchor = this.bones.get(slot === 'hat' ? 'Neck1' : 'Spine2');
    if (!anchor) {
      logger.warn(SCOPE, `no bone to hang a ${slot} on`);
      return;
    }

    try {
      const urls = await resolveItemUrls(slot, wanted);
      const [object, texture] = await Promise.all([
        this.objLoader.loadAsync(urls.mesh),
        this.textureLoader.loadAsync(urls.texture),
      ]);
      const still = slot === 'hat' ? this.currentHat : this.currentBack;
      // `anchor.parent` is null once a body swap has taken this skeleton away.
      if (this.disposed || still !== wanted || !anchor.parent || !this.bones.has(anchor.name)) {
        texture.dispose();
        return;
      }
      pixelArt(texture);
      this.textures.push(texture);
      const material = new MeshStandardMaterial({ map: texture, roughness: 0.85 });
      object.traverse((child) => {
        if (child instanceof Mesh) {
          child.material = material;
          child.castShadow = true;
        }
      });

      if (this.wearingBloxityBody) {
        // Bloxity's body: an item is authored in THIS rig's bone space, so it
        // hangs at scale 1 exactly as Bloxity's renderer hangs it and the head's
        // own scale carries it. Compensating for the bone's world scale (which
        // the bundled body below does need) is what left hats half-sized and
        // sunk into a big head.
        object.scale.setScalar(1);
        object.position.set(0, slot === 'hat' ? HAT_LIFT : 0, 0);
        if (slot === 'back') object.scale.x = Math.max(0.05, finite(this.proportions.height));
      } else {
        // The bundled body is a different rig: size the item in WORLD terms.
        anchor.updateWorldMatrix(true, false);
        const boneScale = anchor.getWorldScale(SCRATCH).y || 1;
        object.scale.setScalar(ITEM_WORLD_SCALE / boneScale);
        object.position.set(0, slot === 'hat' ? (HAT_LIFT * ITEM_WORLD_SCALE) / boneScale : 0, 0);
        if (slot === 'back') object.position.z = FBX_BACK_OFFSET / boneScale;
      }

      anchor.add(object);
      this.attachments.set(slot, object);
    } catch {
      logger.warn(SCOPE, `${slot} ${wanted} failed to load`);
    }
  }

  // ----------------------------------------------------------- proportions

  /**
   * Proportions, as Bloxity's own renderer applies them: height stretches the
   * body vertically, arm length scales the arm bones, head scale scales the neck
   * bone while undoing that stretch on it, and the neck offset carries both the
   * height/head difference and the neck-height slider.
   *
   * What is NOT here: torso width, shoulder width and leg spread. Those widen a
   * body WITHOUT stretching what sits above it, which bone scale cannot do
   * (children inherit it), so they are done to the skinning matrices in
   * `patchSkeleton`. Everything is relative to each bone's REST values, so the
   * two bodies' units never matter, and all of it is this avatar's alone.
   */
  private applyProportions(p: LegionProportions): void {
    const height = Math.max(0.05, finite(p.height));
    const head = finite(p.headScale);

    const model = this.character.modelRoot;
    const base = (model.userData['baseScale'] as number | undefined) ?? model.scale.x;
    model.userData['baseScale'] = base;
    model.scale.set(base, base * height, base);

    for (const name of ['ArmL1', 'ArmR1']) {
      this.scaleBone(name, (rest, bone) => bone.scale.set(rest.x, rest.y * finite(p.armLength), rest.z));
    }
    this.scaleBone('Neck1', (rest, bone) => bone.scale.set(rest.x * head, (rest.y * head) / height, rest.z * head));
    // The head rides the body's stretch rather than being pushed through it.
    this.moveBone('Neck_Offset', (rest, bone) => {
      bone.position.y = rest.y + (height - head) * rest.y + this.neckOffsetBindY * (finite(p.neckHeight) - 1) * COUNTER_SCALE;
    });
  }

  private scaleBone(name: string, write: (rest: Vector3, bone: Bone) => void): void {
    const bone = this.bones.get(name);
    if (!bone) return;
    bone.userData['restScale'] ??= bone.scale.clone();
    write(bone.userData['restScale'] as Vector3, bone);
  }

  private moveBone(name: string, write: (rest: Vector3, bone: Bone) => void): void {
    const bone = this.bones.get(name);
    if (!bone) return;
    bone.userData['restPosition'] ??= bone.position.clone();
    write(bone.userData['restPosition'] as Vector3, bone);
  }
}

/** A proportion the sliders can actually produce; anything else means "unchanged". */
const finite = (value: number | undefined): number => (typeof value === 'number' && Number.isFinite(value) ? value : 1);

/** Body parts only: a hat or skin change must not refetch an identical body. */
const bodyKeyOf = (e: LegionEquipped): string =>
  [e.headId, e.torsoId, e.armLId, e.armRId, e.legLId, e.legRId].map((id) => (isEquippedId(id) ? id : '-')).join('|');

/** Bloxity textures are pixel art; smoothing turns faces into smudges. */
const pixelArt = (texture: Texture): void => {
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
};

/** Bones by name, first one wins - the same rule `PlayerRig` uses. */
const collectBones = (model: Object3D): Map<string, Bone> => {
  const found = new Map<string, Bone>();
  model.traverse((child) => {
    const bone = child as Bone;
    if (bone.isBone && !found.has(bone.name)) found.set(bone.name, bone);
  });
  return found;
};
