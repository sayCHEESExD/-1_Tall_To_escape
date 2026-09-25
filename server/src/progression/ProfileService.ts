import { encodePets, foodMask, parsePets, STARTER_FOOD } from '@highjump/shared';
import type { ProfileStorage } from '../persistence/ProfileStorage.js';
import type { StoredProfile } from '../persistence/StoredProfile.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { logger } from '../util/logger.js';

const SCOPE = 'profiles';

/** How often the leaderboard cache is re-read from storage, for other pods' players. */
const BOARD_REFRESH_MS = 60_000;
/** Retry delay while the leaderboard cache cannot be loaded at all. */
const BOARD_RETRY_MS = 10_000;

const STARTER_MASK = foodMask(STARTER_FOOD);

/**
 * Progression that outlives a session.
 *
 * Reads for a JOIN go straight to storage (`get`), never to a cache: another pod
 * may have written this player a moment ago. The one cache here is the
 * leaderboards' view of offline players - loaded at boot, re-read on a timer
 * (newer `updatedAt` wins) and fed by this pod's own writes.
 */
export class ProfileService {
  private readonly board = new Map<string, StoredProfile>();
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(readonly storage: ProfileStorage) {}

  /** Read one profile from storage. Throws if storage cannot answer. */
  get(key: string): Promise<StoredProfile | null> {
    return this.storage.get(key);
  }

  insertIfAbsent(key: string, profile: StoredProfile): Promise<boolean> {
    this.remember(key, profile);
    return this.storage.insertIfAbsent(key, profile);
  }

  /** Queue a write. Resolves once durable; never rejects. */
  put(key: string, profile: StoredProfile): Promise<void> {
    this.remember(key, profile);
    return this.storage.put(key, profile);
  }

  /** Save a live player under `key`. */
  save(key: string, player: PlayerState): Promise<void> {
    return this.put(key, ProfileService.snapshot(player));
  }

  /** Offline profiles for the leaderboards: never a guest copy that moved to an account. */
  *boardEntries(): Iterable<[string, StoredProfile]> {
    for (const entry of this.board) if (!entry[1].migratedTo) yield entry;
  }

  /** Load the leaderboard cache now (retrying until storage answers), then keep it fresh. */
  startBoardRefresh(): void {
    const load = (): void => {
      this.storage
        .loadAll()
        .then((all) => {
          for (const [key, profile] of all) this.remember(key, profile);
          this.schedule(BOARD_REFRESH_MS, load);
        })
        .catch((error: unknown) => {
          logger.warn(SCOPE, `leaderboard profiles not loaded (${String(error)}); retrying`);
          this.schedule(BOARD_RETRY_MS, load);
        });
    };
    load();
  }

  stopBoardRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private schedule(ms: number, run: () => void): void {
    this.refreshTimer = setTimeout(run, ms);
    this.refreshTimer.unref?.();
  }

  private remember(key: string, profile: StoredProfile): void {
    const known = this.board.get(key);
    if (known && known.updatedAt > profile.updatedAt) return;
    this.board.set(key, { ...profile, migratedTo: profile.migratedTo ?? known?.migratedTo });
  }

  // ------------------------------------------------------ profile <-> state

  /**
   * Put a profile onto a player: EVERY progression field is reset first, so
   * switching profiles mid-session can never carry one profile's progress into
   * another. Derived figures (height, leg reach, rates) are recomputed after by
   * `FoodService.initialise`.
   */
  static apply(player: PlayerState, profile: StoredProfile | null): void {
    player.level = profile ? Math.max(1, Math.floor(profile.level)) : 1;
    player.food = profile?.food ?? 0;
    player.lifetimeFood = 0;
    player.rebirths = Math.floor(profile?.rebirths ?? 0);
    player.wins = Math.floor(profile?.wins ?? 0);
    player.playSeconds = profile?.playSeconds ?? 0;
    player.ownedFoods = ((profile?.ownedFoods ?? 0) | STARTER_MASK) & 0xffff;
    player.ownedTrails = (profile?.ownedTrails ?? 0) & 0xffff;
    player.trailSlot = (profile?.trailSlot ?? 0) & 0xff;
    // Re-encoded, so a pet removed from the table since the save simply drops.
    player.pets = profile ? encodePets(parsePets(profile.pets)) : '';
  }

  /**
   * A live player as a profile. Never carries the migration markers: those are
   * written only by the migration itself, and a write never removes a field it
   * does not carry.
   */
  static snapshot(player: PlayerState): StoredProfile {
    return {
      displayName: player.displayName,
      avatarUrl: player.avatarUrl,
      level: player.level,
      food: player.food,
      rebirths: player.rebirths,
      wins: player.wins,
      playSeconds: player.playSeconds,
      ownedFoods: player.ownedFoods,
      ownedTrails: player.ownedTrails,
      trailSlot: player.trailSlot,
      pets: player.pets,
      updatedAt: Date.now(),
    };
  }

  /** Real progress worth migrating. Time played alone is not. */
  static hasProgress(profile: StoredProfile): boolean {
    return (
      profile.level > 1 ||
      profile.food > 0 ||
      profile.rebirths > 0 ||
      profile.wins > 0 ||
      (profile.ownedFoods & ~STARTER_MASK) !== 0 ||
      profile.ownedTrails > 0 ||
      profile.pets !== ''
    );
  }
}
