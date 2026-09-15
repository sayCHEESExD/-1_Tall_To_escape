/**
 * Everything worth keeping about a player between sessions.
 *
 * The DERIVING facts only: height, leg reach, jump physics and food per
 * step are recomputed from these on load through the same formulas a
 * live session uses, so a tuning change reaches returning players.
 */
export interface StoredProfile {
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
}

/**
 * Where profiles live. `createPersistence` is the ONLY place naming a concrete
 * adapter; nothing above this boundary knows it is a JSON file.
 */
export interface PersistenceAdapter {
  load(): Map<string, StoredProfile>;
  save(profiles: Map<string, StoredProfile>): void;
  flush(): void;
}
