import { MongoServerError, type Collection } from 'mongodb';
import type { MongoProfileStorage } from '../persistence/MongoProfileStorage.js';
import { logger } from '../util/logger.js';
import { SKU_WINS, type GrantStore, type PendingGrant, type RecordOutcome } from './BuxGrants.js';

const SCOPE = 'bux/mongo';

type GrantState = 'pending' | 'applied' | 'unknown-sku';

interface GrantDocument {
  /** The Bloxity transaction id: unique, so a transaction pays out at most once, ever. */
  _id: string;
  account: string;
  sku: string;
  wins: number;
  state: GrantState;
  createdAt: Date;
  appliedAt?: Date;
}

const isDuplicateKey = (error: unknown): boolean => error instanceof MongoServerError && error.code === 11000;

/**
 * Purchases in the same managed MongoDB as the profiles, collection
 * `bux_grants`, one document per transaction.
 *
 *  - `_id` is the transaction id, so a retried webhook (on any pod, after any
 *    restart) hits the unique key and is a duplicate - it pays out once.
 *  - `record` resolves only after the insert is acknowledged, so the webhook's
 *    2xx always means "durably recorded".
 *  - `drain` claims one grant at a time with `findOneAndUpdate` pending ->
 *    applied, which is atomic on the server: two pods draining the same account
 *    can never both receive the same grant.
 */
export class MongoGrantStore implements GrantStore {
  private readonly grants: Collection<GrantDocument>;

  /** Shares the profile store's client, and its connection guard. */
  constructor(private readonly storage: MongoProfileStorage) {
    this.grants = storage.db.collection<GrantDocument>('bux_grants');
    void storage
      .track(() => this.grants.createIndex({ account: 1, state: 1, createdAt: 1 }))
      .catch((error: unknown) => logger.warn(SCOPE, `index not created yet (${String(error)}); retried on next boot`));
  }

  async record(accountId: string, transactionId: string, sku: string): Promise<RecordOutcome> {
    const wins = SKU_WINS[sku];
    try {
      await this.storage.track(() => this.grants.insertOne({
        _id: transactionId,
        account: accountId,
        sku,
        wins: wins ?? 0,
        state: wins === undefined ? 'unknown-sku' : 'pending',
        createdAt: new Date(),
      }));
    } catch (error) {
      if (isDuplicateKey(error)) {
        logger.info(SCOPE, `duplicate webhook for ${transactionId}, ignored`);
        return 'duplicate';
      }
      throw error;
    }
    if (wins === undefined) {
      logger.warn(SCOPE, `unknown sku "${sku}" [${transactionId}] - recorded as seen, nothing to grant`);
      return 'unknown-sku';
    }
    logger.info(SCOPE, `queued ${sku} (+${wins} wins) for ${accountId} [${transactionId}]`);
    return 'recorded';
  }

  async drain(accountId: string): Promise<PendingGrant[]> {
    const claimed: PendingGrant[] = [];
    for (;;) {
      const grant = await this.storage.track(() =>
        this.grants.findOneAndUpdate(
          { account: accountId, state: 'pending' },
          { $set: { state: 'applied', appliedAt: new Date() } },
          { sort: { createdAt: 1 }, returnDocument: 'after' },
        ),
      );
      if (!grant) return claimed;
      claimed.push({ transactionId: grant._id, sku: grant.sku, wins: grant.wins });
    }
  }

  /**
   * Import the legacy `bux-grants.json` insert-only: a pending grant stays
   * pending, a transaction that was only "seen" is recorded as applied so a
   * late retry of it cannot pay out again. Safe to run every boot.
   */
  async importLegacy(legacy: { pending: Record<string, PendingGrant[]>; seen: string[] }): Promise<number> {
    let inserted = 0;
    const pendingIds = new Set<string>();
    for (const [account, grants] of Object.entries(legacy.pending)) {
      for (const grant of grants) {
        pendingIds.add(grant.transactionId);
        const result = await this.storage.track(() => this.grants.updateOne(
          { _id: grant.transactionId },
          { $setOnInsert: { account, sku: grant.sku, wins: grant.wins, state: 'pending', createdAt: new Date() } },
          { upsert: true },
        ));
        inserted += result.upsertedCount;
      }
    }
    for (const id of legacy.seen) {
      if (pendingIds.has(id)) continue;
      const result = await this.storage.track(() => this.grants.updateOne(
        { _id: id },
        { $setOnInsert: { account: '', sku: '', wins: 0, state: 'applied', createdAt: new Date() } },
        { upsert: true },
      ));
      inserted += result.upsertedCount;
    }
    return inserted;
  }
}
