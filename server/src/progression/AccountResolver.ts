import type { Verification, VerifiedBloxityUser } from '../bloxity/BloxityVerifier.js';
import type { StoredProfile } from '../persistence/StoredProfile.js';
import { logger } from '../util/logger.js';
import { accountKey } from './profileKeys.js';
import { ProfileService } from './ProfileService.js';

const SCOPE = 'accounts';

/** How long to wait for the migrated guest copy to be marked before carrying on. */
const MARK_WAIT_MS = 5000;

/** Where a session's progress lives, and what it starts from. */
export interface ProfileTarget {
  /** Storage key: an account key, the guest key, or null for an unsaved session. */
  readonly key: string | null;
  /** The progress to start from (null = fresh). */
  readonly profile: StoredProfile | null;
  /** The VERIFIED Bloxity account, or null. Purchases are drained against this only. */
  readonly accountId: string | null;
  readonly user: VerifiedBloxityUser | null;
  /** For the log: how the decision was reached. */
  readonly note: string;
}

const waitAtMost = <T>(promise: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))]);

/**
 * Decide which profile a login gets. Reads storage and THROWS if it cannot -
 * the caller then refuses the join (or stays on the current profile), because
 * letting someone in on an empty profile would autosave over their real one.
 *
 *  - VERIFIED account with a profile: that profile, always. Browser data never
 *    touches it.
 *  - VERIFIED account with no profile, and this browser's guest profile has real
 *    progress (and was never migrated): the guest progress is inserted into the
 *    account (`insertIfAbsent`, carrying `migratedFrom`), and only AFTER that
 *    succeeds is the guest copy marked `migratedTo` - its data kept as a
 *    recovery copy. A crash in between duplicates progress; it never loses it.
 *    If another pod won the insert race, the winner is loaded instead.
 *  - Anyone else is a guest on the browser's own key - unless that guest
 *    profile already moved to an account, in which case the session starts
 *    fresh and UNSAVED, so the recovery copy is never overwritten and one
 *    browser can never seed progress into a second account.
 *
 * @param liveGuest the live guest state when signing in mid-session (newer than
 *                  the last autosave); undefined to read the guest from storage
 */
export const resolveProfileTarget = async (
  profiles: ProfileService,
  verification: Verification | null,
  guestKey: string | null,
  liveGuest?: StoredProfile,
): Promise<ProfileTarget> => {
  const storedGuest = guestKey ? await profiles.get(guestKey) : null;

  if (verification?.status === 'verified') {
    const { user } = verification;
    const key = accountKey(user.id);
    const existing = await profiles.get(key);
    if (existing) return { key, profile: existing, accountId: user.id, user, note: 'account (existing)' };

    const guest = liveGuest ?? storedGuest;
    if (guestKey && guest && !storedGuest?.migratedTo && ProfileService.hasProgress(guest)) {
      const seeded: StoredProfile = { ...guest, migratedFrom: guestKey, updatedAt: Date.now() };
      delete seeded.migratedTo;
      if (await profiles.insertIfAbsent(key, seeded)) {
        // Only now that the account has it: mark the guest copy.
        await waitAtMost(profiles.put(guestKey, { ...guest, migratedTo: key, updatedAt: Date.now() }), MARK_WAIT_MS);
        logger.info(SCOPE, `guest progress migrated into ${key} (level ${seeded.level}, wins ${seeded.wins})`);
        return { key, profile: seeded, accountId: user.id, user, note: 'account (migrated from this browser)' };
      }
      const winner = await profiles.get(key);
      return { key, profile: winner, accountId: user.id, user, note: 'account (existing, created concurrently)' };
    }
    return { key, profile: null, accountId: user.id, user, note: 'account (new)' };
  }

  if (!guestKey) return { key: null, profile: null, accountId: null, user: null, note: 'guest (no browser id, unsaved)' };
  if (storedGuest?.migratedTo) {
    return { key: null, profile: null, accountId: null, user: null, note: 'guest (this browser moved to an account; fresh, unsaved)' };
  }
  return {
    key: guestKey,
    profile: storedGuest,
    accountId: null,
    user: null,
    note: storedGuest ? 'guest (restored)' : 'guest (new)',
  };
};
