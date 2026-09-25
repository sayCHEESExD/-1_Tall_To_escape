import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonGrantStore, type GrantStore } from '../bloxity/BuxGrants.js';
import { MongoGrantStore } from '../bloxity/MongoGrantStore.js';
import { logger } from '../util/logger.js';
import { JsonProfileStorage } from './JsonProfileStorage.js';
import { MongoProfileStorage } from './MongoProfileStorage.js';
import { backoffDelay, sleep, type ProfileStorage } from './ProfileStorage.js';

export type { ProfileStorage } from './ProfileStorage.js';
export type { StoredProfile } from './StoredProfile.js';

const SCOPE = 'persistence';

export interface Persistence {
  readonly profiles: ProfileStorage;
  readonly grants: GrantStore;
  /** Best-effort synchronous write on process exit (JSON store only). */
  readonly flushSync: () => void;
}

/**
 * The ONLY place a concrete store is named.
 *
 *  - `MONGODB_URI` set (Legion injects it into every pod: an isolated managed
 *    database for this game + channel) -> MongoDB, for profiles AND purchases.
 *    Progress survives restarts, scale-to-zero and deploys, and every pod sees
 *    the same data.
 *  - Unset -> the JSON files in `dataDir`, the development store.
 *
 * Neither path throws at boot: a dead database must not stop `/health`
 * answering, or Legion restart-loops the pod. Joins are refused cleanly instead.
 */
export const createPersistence = (mongoUri: string, dataDir: string): Persistence => {
  const grantsFile = join(dataDir, 'bux-grants.json');
  if (!mongoUri) {
    logger.info(SCOPE, `no MONGODB_URI - using the JSON development store in ${dataDir}`);
    const profiles = new JsonProfileStorage(dataDir);
    return { profiles, grants: new JsonGrantStore(grantsFile), flushSync: () => profiles.flushSync() };
  }

  const profiles = new MongoProfileStorage(mongoUri);
  profiles.connect();
  const grants = new MongoGrantStore(profiles);
  void importLegacy(profiles, grants, dataDir, grantsFile);
  return { profiles, grants, flushSync: () => undefined };
};

/**
 * Import any existing JSON store into MongoDB, INSERT-ONLY: a profile or a
 * transaction already in the database is never touched, so this is safe on
 * every boot. Retries until the database answers.
 */
const importLegacy = async (
  profiles: MongoProfileStorage,
  grants: MongoGrantStore,
  dataDir: string,
  grantsFile: string,
): Promise<void> => {
  const profilesFile = join(dataDir, 'profiles.json');
  const legacyProfiles = readLegacy(profilesFile);
  const legacyGrants = existsSync(grantsFile) ? new JsonGrantStore(grantsFile).snapshot() : null;
  if (legacyProfiles.size === 0 && !legacyGrants) return;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const inserted = await profiles.importInsertOnly(legacyProfiles);
      const insertedGrants = legacyGrants ? await grants.importLegacy(legacyGrants) : 0;
      logger.info(
        SCOPE,
        `legacy import: ${inserted} of ${legacyProfiles.size} profile(s) and ${insertedGrants} grant record(s) ` +
          `inserted (existing ones untouched)`,
      );
      return;
    } catch (error) {
      const delay = backoffDelay(attempt);
      logger.warn(SCOPE, `legacy import waiting for MongoDB (${String(error)}); retrying in ${delay} ms`);
      await sleep(delay);
    }
  }
};

const readLegacy = (path: string): Map<string, Record<string, unknown>> => {
  const out = new Map<string, Record<string, unknown>>();
  if (!existsSync(path)) return out;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (value && typeof value === 'object') out.set(key, value as Record<string, unknown>);
    }
  } catch (error) {
    // Left where it is: the import never modifies or moves the legacy file.
    logger.error(SCOPE, `legacy ${path} could not be read (${String(error)}); nothing imported from it`);
  }
  return out;
};
