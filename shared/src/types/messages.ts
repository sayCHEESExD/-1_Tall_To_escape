/**
 * Client -> server input. INPUT ONLY: no position, velocity or rotation, so a
 * client has no channel through which to assert where it is.
 */
export interface MoveMessage {
  seq: number;
  dt: number;
  moveX: number;
  moveZ: number;
  jump: boolean;
  cameraYaw: number;
}

export type RespawnReason = 'outOfWorld' | 'win' | 'manual' | 'join' | 'rebirth';

export interface RespawnMessage {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  reason: RespawnReason;
}

/** "I am standing on this step's win pad." A request, never a grant. */
export interface ClaimWinMessage {
  step: number;
}

/** A win landed. Presentation only. */
export interface WinAwardedMessage {
  step: number;
  wins: number;
  total: number;
}

/** A slot-addressed request: foods, trails, eggs. */
export interface SlotMessage {
  slot: number;
}

/** An index-addressed request: a pet in the inventory. */
export interface IndexMessage {
  index: number;
}

/** An egg hatched. Presentation only: the pet is already in replicated state. */
export interface PetHatchedMessage {
  egg: number;
  pet: string;
}

/**
 * "My Bloxity identity is now this." A TOKEN, not an id: the server resolves it
 * with Bloxity, so nobody can claim another account's paid-for Bux grants by
 * naming its id. Empty means not signed in.
 *
 * `gameSlug` is the slug the client's SDK was initialised with: a token issued
 * inside a game is a game capability, which Bloxity verifies against that slug.
 *
 * `name` and `avatarUrl` are what Bloxity's SDK says this player is right now -
 * the signed-in account's name and picture, or a guest's. DISPLAY ONLY: the
 * server cleans them, prefers anything it verified with Bloxity itself, and
 * never lets them reach an account's Bux. They matter because the portal hands
 * an embedded game its user object whether or not it also hands it a token, and
 * a signed-in player must not be shown as "Guest" for want of one.
 */
export interface BloxityIdentityMessage {
  token: string;
  gameSlug?: string;
  /** The Bloxity name to show when the server has nothing verified. '' for a guest. */
  name?: string;
  /** The Bloxity avatar thumbnail to show when the server has nothing verified. */
  avatarUrl?: string;
  /**
   * The sender's Bloxity avatar (`encodeAvatarLook`), replicated so every other
   * player sees the look they picked. '' means no Bloxity data at all - the only
   * case that falls back to the bundled character.
   */
  look?: string;
}
