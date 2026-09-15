import { encodePets, foodMask, parsePets, STARTER_FOOD } from '@highjump/shared';
import { createPersistence, type PersistenceAdapter, type StoredProfile } from '../persistence/index.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/**
 * Progression that outlives a session: a CACHE in front of a durable adapter.
 *
 * Process-wide, because a room closes with its last client. Keyed by the
 * browser-stored player id.
 */
class ProfileStore {
  private readonly profiles = new Map<string, StoredProfile>();
  private readonly adapter: PersistenceAdapter = createPersistence();
  private opened = false;

  open(): void {
    if (this.opened) return;
    this.opened = true;
    for (const [id, profile] of this.adapter.load()) this.profiles.set(id, profile);
  }

  get size(): number {
    return this.profiles.size;
  }

  entries(): IterableIterator<[string, StoredProfile]> {
    return this.profiles.entries();
  }

  /** Apply a stored profile onto fresh state. Derived figures are recomputed after. */
  restore(playerId: string, player: PlayerState): boolean {
    const profile = this.profiles.get(playerId);
    if (!profile) return false;
    player.level = Math.max(1, Math.floor(profile.level));
    player.food = profile.food;
    player.rebirths = Math.floor(profile.rebirths);
    player.wins = Math.floor(profile.wins);
    player.playSeconds = profile.playSeconds;
    player.ownedFoods = (profile.ownedFoods | foodMask(STARTER_FOOD)) & 0xffff;
    player.ownedTrails = profile.ownedTrails & 0xffff;
    player.trailSlot = profile.trailSlot & 0xff;
    // Re-encoded, so a pet removed from the table since the save simply drops.
    player.pets = encodePets(parsePets(profile.pets));
    return true;
  }

  save(playerId: string, player: PlayerState): void {
    if (!playerId) return;
    this.profiles.set(playerId, {
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
    });
    this.adapter.save(this.profiles);
  }

  flush(): void {
    this.adapter.flush();
  }
}

export const profileStore = new ProfileStore();
