/**
 * Where Bloxity's avatar assets live.
 *
 * The URL patterns from the SDK spec and the reference page
 * (`https://bloxity.io/test-game.html`). Callers must only ask for a slot whose
 * id passes `isEquippedId` - an unequipped slot has no asset, and a URL built
 * out of `'-1'` is a guaranteed 404.
 */
export const AVATAR_CDN = 'https://static.bloxity.io/avatars';

/** The base body. Its skeleton carries the same twelve bone names `PlayerRig` binds. */
export const PLAYER_GLB_URL = `${AVATAR_CDN}/player.glb`;

/** The skin Bloxity's own renderer falls back to when none is equipped. */
export const DEFAULT_SKIN_ID = '0';

/** Fallback portrait for accounts and friends without one. */
export const DEFAULT_PFP_URL = 'https://static.bloxity.io/img/pfps/0.png?width=128&quality=85';

export const hatUrls = (id: string): { mesh: string; texture: string } => ({
  mesh: `${AVATAR_CDN}/items/hats/${id}.obj`,
  texture: `${AVATAR_CDN}/textures/hats/${id}.png`,
});

export const backUrls = (id: string): { mesh: string; texture: string } => ({
  mesh: `${AVATAR_CDN}/items/back/${id}.obj`,
  texture: `${AVATAR_CDN}/textures/back/${id}.png`,
});

export const skinUrl = (id: string): string => `${AVATAR_CDN}/skins/${id}.png`;

export const iconUrl = (id: string): string => `${AVATAR_CDN}/icons/${id}.png`;

/** Head and torso are single meshes. */
export const partUrl = (type: 'head' | 'torso', id: string): string => `${AVATAR_CDN}/parts/${type}/${id}.glb`;

/** Arms and legs are authored as a left and a right under one id. */
export const pairedPartUrl = (type: 'arms' | 'legs', id: string, side: 'L' | 'R'): string =>
  `${AVATAR_CDN}/parts/${type}/${id}_${side}.glb`;

/**
 * The catalogue's own asset paths for an item, or null.
 *
 * The id-based patterns above cover almost every catalogue item, but not all:
 * a few keep their texture under a different filename. So the catalogue's
 * `assetPaths` are used when they can be had, and the spec pattern is the
 * FALLBACK. `GET /v1/avatar/items/{id}` is public; the promise is cached per id,
 * including a failed lookup, so a missing item is not retried in a loop.
 */
interface ItemPaths {
  readonly mesh?: string;
  readonly texture?: string;
}

const CATALOGUE_API = 'https://api.bloxity.io/v1/avatar/items';
const STATIC_HOST = 'https://static.bloxity.io';
const catalogue = new Map<string, Promise<ItemPaths | null>>();

const catalogPaths = (id: string): Promise<ItemPaths | null> => {
  const cached = catalogue.get(id);
  if (cached) return cached;
  const request = fetch(`${CATALOGUE_API}/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(6000) })
    .then(async (response) => {
      if (!response.ok) return null;
      const body = (await response.json()) as { assetPaths?: ItemPaths; item?: { assetPaths?: ItemPaths } };
      return body.assetPaths ?? body.item?.assetPaths ?? null;
    })
    .catch(() => null);
  catalogue.set(id, request);
  return request;
};

const fromCdn = (path: string): string => (path.startsWith('http') ? path : `${STATIC_HOST}${path}`);

/** Mesh and texture for a hat or back item: catalogue first, spec pattern as fallback. */
export const resolveItemUrls = async (slot: 'hat' | 'back', id: string): Promise<{ mesh: string; texture: string }> => {
  const fallback = slot === 'hat' ? hatUrls(id) : backUrls(id);
  const paths = await catalogPaths(id);
  return {
    mesh: paths?.mesh ? fromCdn(paths.mesh) : fallback.mesh,
    texture: paths?.texture ? fromCdn(paths.texture) : fallback.texture,
  };
};

/** A skin's texture: catalogue first, spec pattern as fallback. The default needs no lookup. */
export const resolveSkinUrl = async (id: string): Promise<string> => {
  if (id === DEFAULT_SKIN_ID) return skinUrl(id);
  const paths = await catalogPaths(id);
  return paths?.texture ? fromCdn(paths.texture) : skinUrl(id);
};

/** The mesh in `player.glb` each part replaces (the reference page's `PART_MESH_NAMES`). */
export const PART_MESH_NAMES = {
  head: 'default_head',
  torso: 'default_torso',
  arm_L: 'default_arm_L',
  arm_R: 'default_arm_R',
  leg_L: 'default_leg_L',
  leg_R: 'default_leg_R',
} as const;

/**
 * How tall `player.glb` stands in its own units. The Bloxity body and its hats
 * are scaled by the bundled character's height over this, so they are
 * interchangeable with `player.fbx`.
 */
export const BLOXITY_MODEL_HEIGHT = 6.4;
