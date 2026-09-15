import { normalizeAvatarUrl } from '@highjump/shared';
import { logger } from '../util/logger.js';

const SCOPE = 'bloxity/identity';

/** A Bloxity account, as the SERVER established it. */
export interface VerifiedBloxityUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  /** The account's Bloxity avatar thumbnail (on static.bloxity.io), or ''. */
  readonly avatarUrl: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The user inside the few shapes Bloxity's responses take. */
const userOf = (body: Record<string, unknown>): Record<string, unknown> =>
  (body['user'] ?? body['profile'] ?? body['data'] ?? body) as Record<string, unknown>;

const avatarOf = (user: Record<string, unknown>): string =>
  normalizeAvatarUrl(user['pfp'] ?? user['avatarUrl'] ?? user['profilePicture']);

const getJson = async (url: string, token: string): Promise<Record<string, unknown> | null> => {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) {
    logger.warn(SCOPE, `token rejected by Bloxity at ${new URL(url).pathname} (HTTP ${response.status})`);
    return null;
  }
  return (await response.json()) as Record<string, unknown>;
};

/**
 * Resolve a Bloxity token to the account it belongs to.
 *
 * The client sends its TOKEN, never its id. A claimed id would let anybody say
 * they were somebody else and collect that person's paid-for Bux grants; a
 * token can only be answered by Bloxity for the account that owns it.
 *
 * Verified with Bloxity's authenticated profile route (`/v1/social/profile`,
 * the one the reference page calls through `Legion.SDK.api.get`). The display
 * name and avatar thumbnail come from the same answer; when it lacks either,
 * `/v1/auth/me` - the route Bloxity's SDK builds its own user object from - is
 * asked with the same token, and used only if it names the same account.
 */
export const verifyBloxityToken = async (token: string, apiBase: string): Promise<VerifiedBloxityUser | null> => {
  if (!token || token.length > 4096) return null;
  try {
    const body = await getJson(`${apiBase}/v1/social/profile`, token);
    if (!body) return null;
    const candidate = userOf(body);
    const id = candidate['_id'] ?? candidate['id'];
    if (typeof id !== 'string' || !id) {
      logger.warn(SCOPE, 'Bloxity profile response had no id');
      return null;
    }
    const username = text(candidate['username']);
    let displayName = text(candidate['displayName']);
    let avatarUrl = avatarOf(candidate);

    if (!displayName || !avatarUrl) {
      try {
        const me = await getJson(`${apiBase}/v1/auth/me`, token);
        const user = me ? userOf(me) : null;
        if (user && (user['_id'] ?? user['id']) === id) {
          displayName ||= text(user['displayName']);
          avatarUrl ||= avatarOf(user);
        }
      } catch (error) {
        logger.warn(SCOPE, `could not read the Bloxity user profile: ${String(error)}`);
      }
    }

    return { id, username, displayName: (displayName || username).slice(0, 40), avatarUrl };
  } catch (error) {
    logger.warn(SCOPE, `could not verify token: ${String(error)}`);
    return null;
  }
};
