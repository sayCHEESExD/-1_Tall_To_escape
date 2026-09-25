import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { mkdir, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../util/logger.js';
import { backoffDelay, sleep, type ProfileStorage } from './ProfileStorage.js';
import { CLEARABLE_FIELDS, normalizeProfile, writtenFields, type StoredProfile } from './StoredProfile.js';

const SCOPE = 'persistence/json';

/** How long a write waits for more changes before hitting the disk. */
const DEBOUNCE_MS = 150;

type RawProfile = Record<string, unknown>;

/**
 * The DEVELOPMENT store: one JSON file, used whenever there is no `MONGODB_URI`.
 *
 * It is a single process's store, so its in-memory copy IS the store and a read
 * never fails. It still honours the per-key contract - a write merges ONLY the
 * fields this build knows into that player's document, so anything else in the
 * file survives - and it keeps the file safe:
 *
 *  - every write is atomic: temp file, fsync, rename. A crash leaves the old
 *    file or the new one, never half of one;
 *  - a leftover `.tmp` from an interrupted write is recovered on boot (per key,
 *    the newer `updatedAt` wins);
 *  - a file that cannot be parsed is MOVED ASIDE, never overwritten, so the
 *    data in it can still be recovered by hand.
 */
export class JsonProfileStorage implements ProfileStorage {
  readonly kind = 'json';
  healthy = true;

  private readonly path: string;
  private readonly tempPath: string;
  private readonly raw = new Map<string, RawProfile>();

  private dirtyVersion = 0;
  private writtenVersion = 0;
  private readonly waiters: { version: number; resolve: () => void }[] = [];
  private writer: Promise<void> | null = null;

  constructor(private readonly directory: string) {
    this.path = join(directory, 'profiles.json');
    this.tempPath = join(directory, 'profiles.json.tmp');
    this.load();
  }

  get size(): number {
    return this.raw.size;
  }

  async get(key: string): Promise<StoredProfile | null> {
    return normalizeProfile(this.raw.get(key));
  }

  put(key: string, profile: StoredProfile): Promise<void> {
    const document = { ...(this.raw.get(key) ?? {}), ...writtenFields(profile) };
    for (const field of CLEARABLE_FIELDS) if (profile[field] === undefined) delete document[field];
    this.raw.set(key, document);
    return this.markDirty();
  }

  async insertIfAbsent(key: string, profile: StoredProfile): Promise<boolean> {
    if (this.raw.has(key)) return false;
    this.raw.set(key, writtenFields(profile));
    await this.markDirty();
    return true;
  }

  async loadAll(): Promise<Map<string, StoredProfile>> {
    const all = new Map<string, StoredProfile>();
    for (const [key, value] of this.raw) {
      const profile = normalizeProfile(value);
      if (profile) all.set(key, profile);
    }
    return all;
  }

  async flush(timeoutMs: number): Promise<void> {
    if (this.writtenVersion >= this.dirtyVersion) return;
    const done = new Promise<void>((resolve) => this.waiters.push({ version: this.dirtyVersion, resolve }));
    await Promise.race([done, sleep(timeoutMs)]);
  }

  /** Last resort on process exit, where nothing asynchronous can run. */
  flushSync(): void {
    if (this.writtenVersion >= this.dirtyVersion) return;
    try {
      mkdirSync(this.directory, { recursive: true });
      const handle = openSync(this.tempPath, 'w');
      try {
        writeSync(handle, JSON.stringify(Object.fromEntries(this.raw)));
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      renameSync(this.tempPath, this.path);
      this.writtenVersion = this.dirtyVersion;
    } catch (error) {
      logger.error(SCOPE, `final write of ${this.path} failed:`, error);
    }
  }

  async close(): Promise<void> {
    await this.flush(10_000);
  }

  // -------------------------------------------------------------- writing

  private markDirty(): Promise<void> {
    this.dirtyVersion += 1;
    const version = this.dirtyVersion;
    const landed = new Promise<void>((resolve) => this.waiters.push({ version, resolve }));
    this.writer ??= this.writeLoop().finally(() => {
      this.writer = null;
    });
    return landed;
  }

  /** Writes until the file matches memory. A failed write is retried, never dropped. */
  private async writeLoop(): Promise<void> {
    await sleep(DEBOUNCE_MS);
    let attempt = 0;
    while (this.writtenVersion < this.dirtyVersion) {
      const version = this.dirtyVersion;
      try {
        await this.writeFile(JSON.stringify(Object.fromEntries(this.raw)));
        this.writtenVersion = version;
        this.healthy = true;
        attempt = 0;
        this.release();
      } catch (error) {
        this.healthy = false;
        const delay = backoffDelay(attempt);
        attempt += 1;
        logger.error(SCOPE, `write of ${this.path} failed (retrying in ${delay} ms):`, error);
        await sleep(delay);
      }
    }
  }

  private release(): void {
    for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
      const waiter = this.waiters[i];
      if (waiter && waiter.version <= this.writtenVersion) {
        this.waiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  private async writeFile(payload: string): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const handle = await open(this.tempPath, 'w');
    try {
      await handle.writeFile(payload);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(this.tempPath, this.path);
  }

  // -------------------------------------------------------------- loading

  private load(): void {
    const main = this.readFile(this.path);
    const temp = this.readFile(this.tempPath);
    for (const source of [main, temp]) {
      if (!source) continue;
      for (const [key, value] of Object.entries(source)) {
        if (!value || typeof value !== 'object') continue;
        const existing = this.raw.get(key);
        const newer = !existing || Number(value['updatedAt'] ?? 0) >= Number(existing['updatedAt'] ?? 0);
        if (newer) this.raw.set(key, value);
      }
    }
    if (temp) {
      // Recovered: fold it into the real file so the next boot starts clean.
      logger.warn(SCOPE, `recovered an interrupted write from ${this.tempPath}`);
      this.dirtyVersion += 1;
      this.flushSync();
    }
    logger.info(SCOPE, `loaded ${this.raw.size} profile(s) from ${this.path}`);
  }

  /** A parsed file, or null. A file that will not parse is moved aside, never overwritten. */
  private readFile(path: string): Record<string, RawProfile> | null {
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed as Record<string, RawProfile>;
    } catch (error) {
      const aside = `${path}.corrupt-${Date.now()}`;
      try {
        renameSync(path, aside);
        logger.error(SCOPE, `${path} could not be read (${String(error)}); moved aside to ${aside} - its data is intact there`);
      } catch (moveError) {
        logger.error(SCOPE, `${path} could not be read AND could not be moved aside:`, moveError);
        throw moveError;
      }
      return null;
    }
  }
}
