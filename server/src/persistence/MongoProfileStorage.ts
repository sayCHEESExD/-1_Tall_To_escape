import {
  MongoClient,
  MongoServerError,
  MongoTopologyClosedError,
  type AnyBulkWriteOperation,
  type Collection,
  type Db,
} from 'mongodb';
import { logger } from '../util/logger.js';
import { backoffDelay, sleep, type ProfileStorage } from './ProfileStorage.js';
import { CLEARABLE_FIELDS, normalizeProfile, writtenFields, type StoredProfile } from './StoredProfile.js';

const SCOPE = 'persistence/mongo';

/** How long an operation may wait for a server before it counts as a failure. */
const OPERATION_TIMEOUT_MS = 5000;
/** Profiles written in parallel by one pass of the write loop. */
const WRITE_BATCH = 16;

interface ProfileDocument {
  _id: string;
  [field: string]: unknown;
}

interface Pending {
  profile: StoredProfile;
  version: number;
}

const isDuplicateKey = (error: unknown): boolean => error instanceof MongoServerError && error.code === 11000;

/**
 * The PRODUCTION store: the managed MongoDB Legion injects as `MONGODB_URI`,
 * "an ISOLATED managed Mongo db scoped to THIS game+channel". The database is
 * the one named in the URI (`client.db()`); profiles are one document each in
 * `profiles`, `_id` = the profile key.
 *
 * Several pods share it, so every write is ONE player's document:
 * `updateOne({_id}, {$set: known fields}, {upsert})` - idempotent, and it never
 * touches a field this build does not know. Writes are queued per key (latest
 * snapshot wins), retried with backoff, and never dropped; a read on this pod
 * of a key whose write is still queued answers from the queue, because that is
 * newer than anything in the database.
 *
 * Nothing here throws at boot: the driver connects lazily and every operation
 * fails cleanly after `OPERATION_TIMEOUT_MS`, so `/health` keeps answering
 * while the database is down and joins are refused instead.
 */
export class MongoProfileStorage implements ProfileStorage {
  readonly kind = 'mongo';
  healthy = false;

  readonly client: MongoClient;
  readonly db: Db;
  private readonly profiles: Collection<ProfileDocument>;

  private connected = false;
  private connecting: Promise<void> | null = null;

  private readonly pending = new Map<string, Pending>();
  private readonly waiters: { key: string; version: number; resolve: () => void }[] = [];
  private version = 0;
  private writer: Promise<void> | null = null;
  private closed = false;

  constructor(uri: string) {
    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: OPERATION_TIMEOUT_MS,
      connectTimeoutMS: OPERATION_TIMEOUT_MS,
      socketTimeoutMS: 30_000,
      maxPoolSize: 10,
      retryWrites: true,
      appName: 'tall-escape-server',
    });
    this.db = this.client.db();
    this.profiles = this.db.collection<ProfileDocument>('profiles');
  }

  /** Connect in the background. Failure is logged, never thrown - boot must survive a dead database. */
  connect(): void {
    this.ensureConnected()
      .then(() => logger.info(SCOPE, `connected to database "${this.db.databaseName}"`))
      .catch((error: unknown) => {
        logger.error(SCOPE, `COULD NOT REACH MONGODB (${String(error)}) - joins will be refused until it is back`);
      });
  }

  /**
   * THE connection guard, run before every operation (profiles and purchases).
   *
   * The driver's first connect is special: if it fails, the client's topology is
   * CLOSED, and every later operation fails with "Topology is closed" even once
   * the database is back - only calling `connect()` again recovers it. A pod that
   * booted while MongoDB was down would never have recovered. So any operation on
   * an unconnected client reconnects first (one attempt at a time), and an
   * operation that finds the topology closed marks it for reconnection.
   */
  ensureConnected(): Promise<void> {
    if (this.connected) return Promise.resolve();
    this.connecting ??= this.client
      .connect()
      .then(() => {
        this.connected = true;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  async get(key: string): Promise<StoredProfile | null> {
    const queued = this.pending.get(key);
    if (queued) return queued.profile;
    const document = await this.track(() => this.profiles.findOne({ _id: key }, { maxTimeMS: OPERATION_TIMEOUT_MS }));
    return normalizeProfile(document);
  }

  put(key: string, profile: StoredProfile): Promise<void> {
    this.version += 1;
    const version = this.version;
    // A newer snapshot replaces a queued one - but must not lose a migration
    // marker the queued one was carrying (an autosave never carries them).
    const queued = this.pending.get(key)?.profile;
    const merged: StoredProfile = { ...profile };
    const from = profile.migratedFrom ?? queued?.migratedFrom;
    const to = profile.migratedTo ?? queued?.migratedTo;
    if (from) merged.migratedFrom = from;
    if (to) merged.migratedTo = to;
    this.pending.set(key, { profile: merged, version });
    const landed = new Promise<void>((resolve) => this.waiters.push({ key, version, resolve }));
    this.startWriter();
    return landed;
  }

  async insertIfAbsent(key: string, profile: StoredProfile): Promise<boolean> {
    if (this.pending.has(key)) return false;
    try {
      const result = await this.track(() =>
        this.profiles.updateOne({ _id: key }, { $setOnInsert: writtenFields(profile) }, { upsert: true }),
      );
      return result.upsertedCount === 1;
    } catch (error) {
      // Two pods raced to create the same document: the other one won.
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  async loadAll(): Promise<Map<string, StoredProfile>> {
    const documents = await this.track(() => this.profiles.find({}, { maxTimeMS: 15_000 }).toArray());
    const all = new Map<string, StoredProfile>();
    for (const document of documents) {
      const profile = normalizeProfile(document);
      if (profile) all.set(document._id, profile);
    }
    for (const [key, queued] of this.pending) all.set(key, queued.profile);
    return all;
  }

  /**
   * Import legacy profiles INSERT-ONLY (`$setOnInsert`): a profile already in the
   * database is never touched, so this is safe to run on every boot.
   *
   * @returns how many were newly inserted
   */
  async importInsertOnly(profiles: ReadonlyMap<string, Record<string, unknown>>): Promise<number> {
    if (profiles.size === 0) return 0;
    const operations: AnyBulkWriteOperation<ProfileDocument>[] = [];
    for (const [key, raw] of profiles) {
      const profile = normalizeProfile(raw);
      if (!profile) continue;
      operations.push({
        updateOne: { filter: { _id: key }, update: { $setOnInsert: writtenFields(profile) }, upsert: true },
      });
    }
    const result = await this.track(() => this.profiles.bulkWrite(operations, { ordered: false }));
    return result.upsertedCount;
  }

  async flush(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size > 0 && Date.now() < deadline) await sleep(50);
    if (this.pending.size > 0) logger.error(SCOPE, `${this.pending.size} profile write(s) still queued at flush deadline`);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.client.close().catch(() => undefined);
  }

  // -------------------------------------------------------------- writing

  private startWriter(): void {
    this.writer ??= this.writeLoop().finally(() => {
      this.writer = null;
      // A put that arrived as the loop was finishing.
      if (this.pending.size > 0 && !this.closed) this.startWriter();
    });
  }

  private async writeLoop(): Promise<void> {
    let attempt = 0;
    while (this.pending.size > 0 && !this.closed) {
      const batch = [...this.pending].slice(0, WRITE_BATCH);
      const results = await Promise.allSettled(batch.map(([key, queued]) => this.writeOne(key, queued)));
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length === 0) {
        attempt = 0;
        continue;
      }
      const delay = backoffDelay(attempt);
      attempt += 1;
      const reason = (failed[0] as PromiseRejectedResult).reason as unknown;
      logger.error(SCOPE, `${failed.length} profile write(s) failed (${String(reason)}); retrying in ${delay} ms - nothing is dropped`);
      await sleep(delay);
    }
  }

  private async writeOne(key: string, queued: Pending): Promise<void> {
    const update: Record<string, unknown> = { $set: writtenFields(queued.profile) };
    const clear = CLEARABLE_FIELDS.filter((field) => queued.profile[field] === undefined);
    if (clear.length > 0) update['$unset'] = Object.fromEntries(clear.map((field) => [field, '']));
    await this.track(() => this.profiles.updateOne({ _id: key }, update, { upsert: true }));
    // Only forget it if no newer snapshot for this key arrived meanwhile.
    if (this.pending.get(key)?.version === queued.version) this.pending.delete(key);
    for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
      const waiter = this.waiters[i];
      if (waiter && waiter.key === key && waiter.version <= queued.version) {
        this.waiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  /** Connect if needed, run the operation, and record whether storage answered. */
  async track<T>(operation: () => Promise<T>): Promise<T> {
    try {
      await this.ensureConnected();
      const result = await operation();
      if (!this.healthy) logger.info(SCOPE, 'MongoDB reachable again');
      this.healthy = true;
      return result;
    } catch (error) {
      if (error instanceof MongoTopologyClosedError) this.connected = false;
      if (this.healthy) logger.error(SCOPE, `MongoDB operation failed: ${String(error)}`);
      this.healthy = false;
      throw error;
    }
  }
}
