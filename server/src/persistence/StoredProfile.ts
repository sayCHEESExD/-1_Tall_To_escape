import { normalizeAvatarUrl, sanitizeDisplayName } from '@highjump/shared';

/**
 * Everything worth keeping about a player between sessions: ONE document per
 * player, keyed by `profileKeys` (an account key or a browser's guest key).
 *
 * The DERIVING facts only: height, leg reach, jump physics and food per step
 * are recomputed from these on load through the same formulas a live session
 * uses, so a tuning change reaches returning players. `displayName` and
 * `avatarUrl` are the Bloxity name and thumbnail last shown for the player, kept
 * so the boards can still show who an offline player is.
 */
export interface StoredProfile {
  displayName: string;
  avatarUrl: string;
  level: number;
  food: number;
  rebirths: number;
  wins: number;
  playSeconds: number;
  ownedFoods: number;
  ownedTrails: number;
  trailSlot: number;
  pets: string;
  updatedAt: number;
  /** On an ACCOUNT profile: the guest key its first progress was migrated from. */
  migratedFrom?: string;
  /**
   * On a GUEST profile: the account key it was migrated into. Such a profile is
   * a recovery copy only - never restored, never migrated again, never ranked.
   */
  migratedTo?: string;
}

/**
 * The fields THIS build writes. A write sets exactly these and nothing else, so
 * a field written by some other build (or added by hand) is never destroyed.
 */
export const WRITTEN_FIELDS = [
  'displayName',
  'avatarUrl',
  'level',
  'food',
  'rebirths',
  'wins',
  'playSeconds',
  'ownedFoods',
  'ownedTrails',
  'trailSlot',
  'pets',
  'updatedAt',
  'migratedFrom',
  'migratedTo',
] as const satisfies readonly (keyof StoredProfile)[];

/**
 * Optional fields a write may CLEAR. Empty today: the migration markers, once
 * set, are permanent, and every other field always has a value. A field only
 * ever leaves a document by being listed here.
 */
export const CLEARABLE_FIELDS: readonly (keyof StoredProfile)[] = [];

const numeric = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value ? value.slice(0, max) : undefined;

/** A stored document as the game reads it: every known field present and sane. */
export const normalizeProfile = (raw: unknown): StoredProfile | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const profile: StoredProfile = {
    displayName: sanitizeDisplayName(value['displayName']),
    avatarUrl: normalizeAvatarUrl(value['avatarUrl']),
    level: Math.max(1, numeric(value['level'])),
    food: numeric(value['food']),
    rebirths: numeric(value['rebirths']),
    wins: numeric(value['wins']),
    playSeconds: numeric(value['playSeconds']),
    ownedFoods: numeric(value['ownedFoods']),
    ownedTrails: numeric(value['ownedTrails']),
    trailSlot: numeric(value['trailSlot']),
    pets: typeof value['pets'] === 'string' ? value['pets'].slice(0, 2048) : '',
    updatedAt: numeric(value['updatedAt']),
  };
  const from = text(value['migratedFrom'], 200);
  const to = text(value['migratedTo'], 200);
  if (from) profile.migratedFrom = from;
  if (to) profile.migratedTo = to;
  return profile;
};

/** The subset of a profile a write sets: only `WRITTEN_FIELDS`, and only those with a value. */
export const writtenFields = (profile: StoredProfile): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const field of WRITTEN_FIELDS) {
    const value = profile[field];
    if (value !== undefined) out[field] = value;
  }
  return out;
};
