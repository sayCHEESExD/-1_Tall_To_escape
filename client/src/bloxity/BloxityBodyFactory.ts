import { PLAYER_HEIGHT } from '@highjump/shared';
import { Mesh, MeshStandardMaterial, SkinnedMesh, type BufferAttribute, type BufferGeometry, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { logger } from '../util/logger.js';
import { BLOXITY_MODEL_HEIGHT, PART_MESH_NAMES, PLAYER_GLB_URL, pairedPartUrl, partUrl } from './bloxityAssets.js';
import { isEquippedId, type LegionEquipped } from './legionTypes.js';

const SCOPE = 'bloxity/body';

/** A part as it was downloaded: its geometry and the rig it was authored against. */
interface SourcePart {
  readonly geometry: BufferGeometry;
  readonly boneNames: readonly string[];
}

/**
 * Builds a character body out of a player's Bloxity avatar.
 *
 * The body is Bloxity's `player.glb`, and body PARTS are geometry swapped onto
 * its skeleton by mesh name - the reference page's approach, because a part is
 * a skinned mesh authored against that one shared rig. The GLB's rig carries
 * the same twelve bone names `PlayerRig` binds, so the run, sit and jump
 * drive a Bloxity body without knowing it is one. Nothing in this file animates.
 *
 * Everything is cached by URL, so rebuilding for a hat-and-skin change costs no
 * network at all.
 */
export class BloxityBodyFactory {
  private prototype: Promise<Object3D | null> | null = null;
  /** Downloads, cached by URL. The geometry here is never worn - each body gets its own copy. */
  private readonly parts = new Map<string, Promise<SourcePart | null>>();

  private loadPrototype(): Promise<Object3D | null> {
    this.prototype ??= new GLTFLoader()
      .loadAsync(PLAYER_GLB_URL)
      .then((gltf) => {
        const root = gltf.scene;
        // Remembered so proportions can scale RELATIVE to it later.
        const scale = PLAYER_HEIGHT / BLOXITY_MODEL_HEIGHT;
        root.scale.setScalar(scale);
        root.userData['baseScale'] = scale;
        root.updateMatrixWorld(true);
        return root;
      })
      .catch((error: unknown) => {
        logger.warn(SCOPE, `base body failed to load: ${String(error)}`);
        return null;
      });
    return this.prototype;
  }

  /**
   * A body wearing these parts, or null if the base body cannot be had. Null is
   * the fallback path, not an error: the caller keeps the bundled `player.fbx`.
   */
  async build(equipped: LegionEquipped): Promise<Object3D | null> {
    const prototype = await this.loadPrototype();
    if (!prototype) return null;

    const body = cloneSkeleton(prototype);
    body.userData['baseScale'] = prototype.userData['baseScale'];
    // Marks a body whose material is its OWN and may be disposed on a swap.
    body.userData['bloxityBody'] = true;

    // One material for the whole body: the skin is a single atlas covering
    // every part. `BloxityAvatar` owns its map.
    const material = new MeshStandardMaterial({ metalness: 0, roughness: 1 });
    const skinned: SkinnedMesh[] = [];
    body.traverse((child) => {
      if (child instanceof SkinnedMesh) {
        child.material = material;
        child.castShadow = true;
        child.frustumCulled = false;
        skinned.push(child);
      } else if (child instanceof Mesh) {
        child.material = material;
        child.castShadow = true;
      }
    });

    await this.wearParts(equipped, skinned);
    return body;
  }

  private async wearParts(equipped: LegionEquipped, skinned: readonly SkinnedMesh[]): Promise<void> {
    const jobs: { url: string; mesh: string }[] = [];
    if (isEquippedId(equipped.headId)) jobs.push({ url: partUrl('head', equipped.headId), mesh: PART_MESH_NAMES.head });
    if (isEquippedId(equipped.torsoId)) jobs.push({ url: partUrl('torso', equipped.torsoId), mesh: PART_MESH_NAMES.torso });
    // Each limb slot has its own id, and each is loaded from its own side's file.
    if (isEquippedId(equipped.armLId)) jobs.push({ url: pairedPartUrl('arms', equipped.armLId, 'L'), mesh: PART_MESH_NAMES.arm_L });
    if (isEquippedId(equipped.armRId)) jobs.push({ url: pairedPartUrl('arms', equipped.armRId, 'R'), mesh: PART_MESH_NAMES.arm_R });
    if (isEquippedId(equipped.legLId)) jobs.push({ url: pairedPartUrl('legs', equipped.legLId, 'L'), mesh: PART_MESH_NAMES.leg_L });
    if (isEquippedId(equipped.legRId)) jobs.push({ url: pairedPartUrl('legs', equipped.legRId, 'R'), mesh: PART_MESH_NAMES.leg_R });

    await Promise.all(
      jobs.map(async ({ url, mesh }) => {
        const target = skinned.find((candidate) => candidate.name === mesh);
        if (!target) {
          logger.warn(SCOPE, `base body has no mesh named ${mesh}`);
          return;
        }
        const source = await this.loadPart(url);
        // Retargeted PER BODY, so no two players ever share a geometry that was
        // mapped onto one of their skeletons.
        if (source) target.geometry = retarget(source, target);
      }),
    );
  }

  /**
   * Download one part, once per URL. What is cached is the DOWNLOAD - the
   * geometry as authored and the names of the rig it was authored against - not
   * a geometry bound to some particular player's skeleton.
   */
  private loadPart(url: string): Promise<SourcePart | null> {
    const cached = this.parts.get(url);
    if (cached) return cached;

    const request = new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => {
        let source: SkinnedMesh | null = null;
        gltf.scene.traverse((child) => {
          if (!source && child instanceof SkinnedMesh) source = child;
        });
        const mesh = source as SkinnedMesh | null;
        return mesh ? { geometry: mesh.geometry, boneNames: mesh.skeleton.bones.map((bone) => bone.name) } : null;
      })
      .catch((error: unknown) => {
        logger.warn(SCOPE, `part ${url} failed to load: ${String(error)}`);
        return null;
      });

    this.parts.set(url, request);
    return request;
  }
}

/**
 * One player's copy of a part, its skinning translated onto THAT player's
 * skeleton. A part GLB ships its own copy of the rig, whose joint order differs
 * from the body's, so `skinIndex` values are translated through the bone NAME.
 * The copy is marked so the body that wears it can free it later.
 */
const retarget = (source: SourcePart, target: SkinnedMesh): BufferGeometry => {
  const geometry = source.geometry.clone();
  geometry.userData['bloxityPart'] = true;
  const attribute = geometry.getAttribute('skinIndex') as BufferAttribute | undefined;
  if (!attribute) return geometry;

  const byName = new Map<string, number>();
  target.skeleton.bones.forEach((bone, index) => {
    if (!byName.has(bone.name)) byName.set(bone.name, index);
  });
  const translation = new Map<number, number>();
  source.boneNames.forEach((name, index) => {
    const mapped = byName.get(name);
    if (mapped !== undefined) translation.set(index, mapped);
  });

  const array = attribute.array as unknown as { length: number; [index: number]: number };
  for (let i = 0; i < array.length; i += 1) {
    const mapped = translation.get(array[i] as number);
    if (mapped !== undefined) array[i] = mapped;
  }
  attribute.needsUpdate = true;
  return geometry;
};

/** One factory for the client, so its caches are shared. */
export const bloxityBodyFactory = new BloxityBodyFactory();
