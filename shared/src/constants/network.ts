/**
 * Network-level constants. Must stay identical on client and server.
 */

/** Colyseus room registered by the server and joined by the client. */
export const ROOM_NAME = 'tallescape';

/**
 * Default server port. Override with the PORT env var on the server.
 *
 * Deliberately not 2567-2570: the previous games in this series answer on
 * those, and sharing one would mean whichever server started first silently
 * served every client.
 */
export const DEFAULT_SERVER_PORT = 2571;

/**
 * Most players in ONE room. The matchmaker locks a full room and
 * `joinOrCreate` opens another, so the sixteenth player is routed, not refused.
 */
export const MAX_PLAYERS_PER_ROOM = 15;

/** Server simulation / state broadcast rate, in Hz. */
export const SERVER_TICK_RATE = 20;

/** Milliseconds between server ticks. */
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;

/** Client <-> server message identifiers. Every client message is a REQUEST. */
export const MessageType = {
  /** Client -> server: one frame of INPUT. Never a transform. */
  Move: 'move',
  /** Server -> client: authoritative respawn instruction. */
  Respawn: 'respawn',
  /** Client -> server: "put me back at spawn". */
  RequestRespawn: 'requestRespawn',
  /** Client -> server: "I am standing on this step's win pad". */
  ClaimWin: 'claimWin',
  /** Server -> client: a win was granted. Drives the celebration. */
  WinAwarded: 'winAwarded',
  /** Client -> server: "rebirth me". Carries nothing. */
  Rebirth: 'rebirth',
  /** Client -> server: "I am on this food's pedestal, sell it to me". */
  BuyFood: 'buyFood',
  BuyTrail: 'buyTrail',
  EquipTrail: 'equipTrail',
  /** Client -> server: "hatch this egg for me" (at the Egg Shop). */
  HatchEgg: 'hatchEgg',
  /** Server -> client: which pet came out. Presentation only. */
  PetHatched: 'petHatched',
  /** Client -> server: toggle one pet on or off. */
  TogglePet: 'togglePet',
  /** Client -> server: fill every free slot with owned pets. */
  EquipAllPets: 'equipAllPets',
  /** Client -> server: equip the best owned pets. */
  EquipBestPets: 'equipBestPets',
  /** Client -> server: delete one pet. */
  DeletePet: 'deletePet',
  /**
   * Client -> server: "my Bloxity token is now this" (login or logout mid-session).
   * The server verifies it with Bloxity; it never trusts an id from a client.
   */
  BloxityIdentity: 'bloxityIdentity',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
