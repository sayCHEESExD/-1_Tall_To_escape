/**
 * A player's Bloxity AVATAR, as a short replicated string.
 *
 * The look a player chose on Bloxity is theirs everywhere: their own screen and
 * every other player's. Their equipped ids and proportions are encoded here,
 * sent to the server, cleaned, and replicated, so a remote player is dressed
 * from the same data their own client drew them from.
 *
 * Present-but-default matters: `DEFAULT_AVATAR_LOOK` is what a player with a
 * Bloxity profile and nothing equipped sends, and it means "wear Bloxity's own
 * default avatar". Only an EMPTY string means "no Bloxity data at all", which
 * is the single case that falls back to this game's bundled character.
 */

/** Equipped slots, in the order they are encoded. */
export const AVATAR_SLOTS = ['skin', 'hat', 'back', 'head', 'torso', 'armL', 'armR', 'legL', 'legR'] as const;

export type AvatarSlot = (typeof AVATAR_SLOTS)[number];

export interface AvatarProportions {
  height: number;
  shoulderWidth: number;
  armLength: number;
  legOffsetX: number;
  torsoScaleX: number;
  neckHeight: number;
  headScale: number;
}

/** Proportions, in the order they are encoded. */
export const PROPORTION_KEYS = [
  'height',
  'shoulderWidth',
  'armLength',
  'legOffsetX',
  'torsoScaleX',
  'neckHeight',
  'headScale',
] as const;

/** Bloxity's documented clamp for each proportion; also what the in-game sliders offer. */
export const AVATAR_PROPORTION_RANGES: Readonly<Record<keyof AvatarProportions, readonly [number, number]>> = {
  height: [0.5, 1.6],
  shoulderWidth: [0.5, 1.5],
  armLength: [0.05, 3],
  legOffsetX: [-0.7, 5],
  torsoScaleX: [0.3, 2],
  neckHeight: [0.94, 1.2],
  headScale: [0.3, 2.6],
};

export const DEFAULT_AVATAR_PROPORTIONS: AvatarProportions = {
  height: 1,
  shoulderWidth: 1,
  armLength: 1,
  legOffsetX: 1,
  torsoScaleX: 1,
  neckHeight: 1,
  headScale: 1,
};

/** An id is only equipped if it is a real one - Bloxity spells "none" several ways. */
export const isAvatarId = (id: unknown): id is string =>
  typeof id === 'string' && id !== '' && id !== '-' && id !== '-1' && id !== 'undefined' && /^[A-Za-z0-9_-]{1,32}$/.test(id);

export type AvatarEquipped = Partial<Record<AvatarSlot, string | null | undefined>>;

export interface AvatarLook {
  readonly equipped: Readonly<Record<AvatarSlot, string | null>>;
  readonly proportions: AvatarProportions;
}

const NONE = '-';
const clamp = (value: unknown, key: keyof AvatarProportions): number => {
  const [min, max] = AVATAR_PROPORTION_RANGES[key];
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(number)) return DEFAULT_AVATAR_PROPORTIONS[key];
  return Math.min(Math.max(number, min), max);
};

/** The string a player with a Bloxity profile and nothing equipped sends. */
export const DEFAULT_AVATAR_LOOK = `${AVATAR_SLOTS.map(() => NONE).join(',')}|${PROPORTION_KEYS.map(() => '1').join(',')}`;

/** Longest look accepted, so a hostile client cannot send a novel. */
export const AVATAR_LOOK_MAX = 400;

export const encodeAvatarLook = (equipped: AvatarEquipped, proportions: Partial<AvatarProportions>): string => {
  const ids = AVATAR_SLOTS.map((slot) => (isAvatarId(equipped[slot]) ? (equipped[slot] as string) : NONE));
  const numbers = PROPORTION_KEYS.map((key) => {
    const value = clamp(proportions[key], key);
    return String(Math.round(value * 1000) / 1000);
  });
  return `${ids.join(',')}|${numbers.join(',')}`;
};

/**
 * The look a client sent, in canonical form - or '' when it is not a look at
 * all. Every id is checked against the id pattern and every proportion clamped
 * to Bloxity's own range, so nothing another player's browser says can reach
 * anyone else's screen unchecked.
 */
export const sanitizeAvatarLook = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw || raw.length > AVATAR_LOOK_MAX) return '';
  const [slots = '', numbers = ''] = raw.split('|');
  const ids = slots.split(',');
  if (ids.length !== AVATAR_SLOTS.length) return '';
  const values = numbers.split(',');
  const equipped: AvatarEquipped = {};
  AVATAR_SLOTS.forEach((slot, i) => {
    equipped[slot] = ids[i];
  });
  const proportions: Partial<AvatarProportions> = {};
  PROPORTION_KEYS.forEach((key, i) => {
    proportions[key] = clamp(values[i], key);
  });
  return encodeAvatarLook(equipped, proportions);
};

/** A replicated look, ready to wear. Null when there is no Bloxity data. */
export const parseAvatarLook = (raw: unknown): AvatarLook | null => {
  const clean = sanitizeAvatarLook(raw);
  if (!clean) return null;
  const [slots = '', numbers = ''] = clean.split('|');
  const ids = slots.split(',');
  const values = numbers.split(',');
  const equipped = {} as Record<AvatarSlot, string | null>;
  AVATAR_SLOTS.forEach((slot, i) => {
    const id = ids[i];
    equipped[slot] = isAvatarId(id) ? id : null;
  });
  const proportions = { ...DEFAULT_AVATAR_PROPORTIONS };
  PROPORTION_KEYS.forEach((key, i) => {
    proportions[key] = clamp(values[i], key);
  });
  return { equipped, proportions };
};
