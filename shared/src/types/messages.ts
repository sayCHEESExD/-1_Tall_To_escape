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
 * Without a token the player is shown as a guest, and `guestAvatar` is the
 * thumbnail Bloxity's SDK built for them (`auth.getGuest()`) - DISPLAY ONLY,
 * accepted only as a Bloxity-hosted image, and tied to no account.
 */
export interface BloxityIdentityMessage {
  token: string;
  gameSlug?: string;
  guestAvatar?: string;
  /**
   * The sender's Bloxity avatar (`encodeAvatarLook`), replicated so every other
   * player sees the look they picked. '' means no Bloxity data at all - the only
   * case that falls back to the bundled character.
   */
  look?: string;
}
