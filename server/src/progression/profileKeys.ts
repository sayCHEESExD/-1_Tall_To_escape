/**
 * Profile keys: which document a player's progress lives in.
 *
 *  - ACCOUNT: `bloxity:<accountId>`, where the id is one the SERVER verified with
 *    Bloxity. The same account on any browser or device reaches the same key.
 *  - GUEST: the browser's own random id (`p_...`, from localStorage), exactly as
 *    before. It stays on that browser.
 *
 * The prefix is RESERVED. A browser id that starts with it is refused outright,
 * or a guest could simply name themselves into somebody's account; and a guest
 * id can never contain ':' anyway, so the two key spaces cannot meet.
 */
export const ACCOUNT_PREFIX = 'bloxity:';

const GUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const accountKey = (accountId: string): string => `${ACCOUNT_PREFIX}${accountId}`;

export const isAccountKey = (key: string): boolean => key.startsWith(ACCOUNT_PREFIX);

/** Thrown for a browser id that tries to use the reserved account prefix. */
export class ReservedKeyError extends Error {}

/**
 * The guest key for a browser id, or null when the browser sent none usable
 * (that session plays unsaved). Throws `ReservedKeyError` for an id that uses
 * the account prefix - such a join is refused, not quietly downgraded.
 */
export const guestKey = (browserId: unknown): string | null => {
  if (typeof browserId !== 'string' || !browserId) return null;
  if (browserId.toLowerCase().startsWith(ACCOUNT_PREFIX)) throw new ReservedKeyError('reserved player id');
  return GUEST_ID.test(browserId) ? browserId : null;
};
