import { Schema, type } from '@colyseus/schema';
import { SPAWN_POSITION, SPAWN_ROTATION_Y } from '@highjump/shared';

/**
 * Replicated per-player state.
 *
 * Every field is written by the SERVER. Transform and motion come out of the
 * authoritative simulation; progression, Wins and inventories are written
 * only by their own service. Nothing is ever copied from a client message.
 */
export class PlayerState extends Schema {
  @type('string') sessionId = '';
  /**
   * The name shown for this player everywhere: their Bloxity display name
   * (verified by the server for a signed-in account), their Bloxity guest name,
   * or `GUEST_NAME`. Never an internal id - those never leave the server.
   */
  @type('string') displayName = '';
  /** Their Bloxity avatar thumbnail (static.bloxity.io only), or '' for the default. */
  @type('string') avatarUrl = '';

  @type('float32') x: number = SPAWN_POSITION.x;
  @type('float32') y: number = SPAWN_POSITION.y;
  @type('float32') z: number = SPAWN_POSITION.z;
  @type('float32') rotationY: number = SPAWN_ROTATION_Y;

  @type('float32') speed = 0;
  @type('float32') verticalVelocity = 0;
  @type('boolean') grounded = true;
  @type('float32') velocityX = 0;
  @type('float32') velocityY = 0;
  @type('float32') velocityZ = 0;
  @type('uint32') lastInputSeq = 0;

  /** Latched simulation state, so client replay resumes exactly where the server stopped. */
  @type('boolean') jumpLatched = false;
  @type('float32') coyote = 0;

  /** Monotonic jump counter, so remote clients derive the one-shot jump animation. */
  @type('uint32') jumpCount = 0;

  /** Dining table the player is seated at, derived by the simulation from the server's own position. */
  @type('uint8') dining = 0;

  // ---- progression (server-authoritative)
  @type('uint32') level = 1;
  /** Food banked toward the next level. */
  @type('float64') food = 0;
  /** Lifetime food, for the gain popups only. Never spent. */
  @type('float64') lifetimeFood = 0;
  @type('uint32') rebirths = 0;
  @type('float64') wins = 0;
  /** Seconds played, for the Time board. */
  @type('float64') playSeconds = 0;

  // ---- derived from progression by FoodService
  /** The height figure (level 73 = 3.6K). */
  @type('float64') height = 10;
  /** Leg reach in world units: the step height past the tall line, and how long the legs are drawn. */
  @type('float32') legReach = 8;
  @type('float32') jumpVelocity = 40;
  @type('float32') gravity = 100;
  @type('float64') foodPerStep = 1;

  // ---- inventories
  /** Owned foods as a bit mask (Lettuce is always owned). */
  @type('uint16') ownedFoods = 1;
  @type('uint16') ownedTrails = 0;
  @type('uint8') trailSlot = 0;
  /** Pet inventory, encoded by `encodePets`. */
  @type('string') pets = '';

  /** True once the server has simulated at least one input for this player. */
  @type('boolean') ready = false;
}
