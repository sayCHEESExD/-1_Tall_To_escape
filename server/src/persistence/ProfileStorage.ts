import type { StoredProfile } from './StoredProfile.js';

/**
 * Where profiles live - PER KEY, one document per player.
 *
 * Several pods share one database, so nothing here writes a whole-map snapshot,
 * and a profile is read from storage when a player JOINS rather than from a
 * cache filled at boot (a boot cache is only good enough for leaderboards).
 *
 * `createProfileStorage` (index.ts) is the only place a concrete store is named:
 * MongoDB when Legion injects `MONGODB_URI`, the JSON file otherwise.
 */
export interface ProfileStorage {
  readonly kind: 'mongo' | 'json';

  /**
   * The profile stored under `key` right now, or null if there is none.
   *
   * THROWS when storage cannot answer. A failed read is never "no profile": a
   * player let in on an empty profile would autosave it over their real one.
   */
  get(key: string): Promise<StoredProfile | null>;

  /**
   * Queue this snapshot. Only the latest per key is written; a failed write is
   * retried with backoff and never dropped. Resolves once this snapshot (or a
   * newer one for the key) is durable - it never rejects, so a caller that must
   * not wait forever races it against a timeout.
   */
  put(key: string, profile: StoredProfile): Promise<void>;

  /** Store `profile` only if nothing is stored under `key`. True if it was stored. Throws on failure. */
  insertIfAbsent(key: string, profile: StoredProfile): Promise<boolean>;

  /** Every profile, for the leaderboards. Throws on failure. */
  loadAll(): Promise<Map<string, StoredProfile>>;

  /** Wait (at most `timeoutMs`) for every queued write to land. */
  flush(timeoutMs: number): Promise<void>;

  /** Whether the last operation reached storage. For /health and logs only. */
  readonly healthy: boolean;

  close(): Promise<void>;
}

/** Retry delays for a failed write, in ms. The last one repeats forever. */
export const WRITE_BACKOFF_MS = [500, 1000, 2000, 5000, 10000, 30000] as const;

export const backoffDelay = (attempt: number): number =>
  WRITE_BACKOFF_MS[Math.min(attempt, WRITE_BACKOFF_MS.length - 1)] ?? 30000;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
