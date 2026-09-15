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
 * Without a token, the guest name and thumbnail Bloxity's SDK gave this player
 * (`auth.getGuest()`) are sent instead. They are DISPLAY ONLY: cleaned by the
 * server, the thumbnail only ever a Bloxity-hosted image, and never tied to an
 * account, so they can reach nobody's Bux.
 */
export interface BloxityIdentityMessage {
  token: string;
  guestName?: string;
  guestAvatar?: string;
}
