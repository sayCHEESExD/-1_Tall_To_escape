import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../util/logger.js';

const SCOPE = 'bux';

/**
 * What each SKU hands over, in Wins.
 *
 * The PRICE is not here and never may be: Bloxity charges from its own
 * catalogue keyed by the game slug. This is only the game's half - what a
 * bought SKU is worth in-game. The SKUs must match the products created for
 * the game on bloxity.io.
 */
export const SKU_WINS: Readonly<Record<string, number>> = {
  wins_small: 500,
  wins_large: 5000,
};

export interface PendingGrant {
  readonly transactionId: string;
  readonly sku: string;
  readonly wins: number;
}

export type RecordOutcome = 'recorded' | 'duplicate' | 'unknown-sku';

/**
 * Purchases paid for and not yet handed over, keyed by the VERIFIED Bloxity
 * account that paid (the webhook's `userId`, sent server-to-server by Bloxity
 * behind a shared secret - never anything a browser said).
 *
 * A QUEUE, not a direct write: a player live in a room has Wins in replicated
 * state that the next autosave writes over the stored profile. So the webhook
 * only RECORDS, and a room holding that verified account drains it.
 *
 *  - `record` resolves only once the grant is DURABLE; the webhook answers 2xx
 *    after it, because a 2xx tells Bloxity the purchase is safe.
 *  - Each transaction pays out once, across retries, pods and restarts.
 *  - `drain` claims ATOMICALLY, so two pods can never both apply one grant.
 */
export interface GrantStore {
  record(accountId: string, transactionId: string, sku: string): Promise<RecordOutcome>;
  drain(accountId: string): Promise<PendingGrant[]>;
}

interface StoredGrants {
  pending: Record<string, PendingGrant[]>;
  seen: string[];
}

/**
 * The development grant store: one JSON file beside the profiles, written
 * synchronously and atomically before anything is acknowledged. One process
 * only, which is what makes its read-modify-write safe.
 */
export class JsonGrantStore implements GrantStore {
  private readonly pending = new Map<string, PendingGrant[]>();
  private readonly seen = new Set<string>();

  /** @param path JSON file to persist to, or null to keep grants in memory (tests). */
  constructor(private readonly path: string | null) {
    this.load();
  }

  async record(accountId: string, transactionId: string, sku: string): Promise<RecordOutcome> {
    if (this.seen.has(transactionId)) {
      logger.info(SCOPE, `duplicate webhook for ${transactionId}, ignored`);
      return 'duplicate';
    }
    const wins = SKU_WINS[sku];
    const queue = this.pending.get(accountId) ?? [];
    const nextQueue = wins === undefined ? queue : [...queue, { transactionId, sku, wins }];
    // Durable FIRST: memory only changes once the file has it.
    this.save(accountId, nextQueue, transactionId);
    this.seen.add(transactionId);
    if (nextQueue.length > 0) this.pending.set(accountId, nextQueue);
    if (wins === undefined) {
      logger.warn(SCOPE, `unknown sku "${sku}" [${transactionId}] - nothing to grant`);
      return 'unknown-sku';
    }
    logger.info(SCOPE, `queued ${sku} (+${wins} wins) for ${accountId} [${transactionId}]`);
    return 'recorded';
  }

  async drain(accountId: string): Promise<PendingGrant[]> {
    const queue = this.pending.get(accountId);
    if (!queue || queue.length === 0) return [];
    this.save(accountId, [], null);
    this.pending.delete(accountId);
    return queue;
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StoredGrants>;
      for (const [id, grants] of Object.entries(raw.pending ?? {})) {
        if (Array.isArray(grants) && grants.length > 0) this.pending.set(id, grants);
      }
      for (const id of raw.seen ?? []) this.seen.add(id);
    } catch (error) {
      const aside = `${this.path}.corrupt-${Date.now()}`;
      logger.error(SCOPE, `could not read ${this.path} (${String(error)}); moving it aside to ${aside}`);
      renameSync(this.path, aside);
    }
  }

  /** Synchronous and atomic: it must be on disk before the webhook answers. Throws if it is not. */
  private save(accountId: string, queue: PendingGrant[], seenId: string | null): void {
    if (!this.path) return;
    const pending = Object.fromEntries(this.pending);
    if (queue.length > 0) pending[accountId] = queue;
    else delete pending[accountId];
    const data: StoredGrants = { pending, seen: seenId ? [...this.seen, seenId] : [...this.seen] };
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(data));
    renameSync(temp, this.path);
  }

  /** Everything in the file, for the one-time import into MongoDB. */
  snapshot(): StoredGrants {
    return { pending: Object.fromEntries(this.pending), seen: [...this.seen] };
  }
}
