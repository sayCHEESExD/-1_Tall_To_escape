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

type Json = Record<string, unknown>;

interface Answer {
  readonly status: number;
  readonly body: Json | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The user inside the few shapes Bloxity's responses take. */
const userOf = (body: Json): Json => {
  const inner = body['user'] ?? body['profile'] ?? body['data'];
  return (inner && typeof inner === 'object' ? inner : body) as Json;
};

const idOf = (user: Json | null): string => {
  const id = user?.['_id'] ?? user?.['id'];
  return typeof id === 'string' ? id : '';
};

const avatarOf = (user: Json | null): string =>
  user ? normalizeAvatarUrl(user['pfp'] ?? user['avatarUrl'] ?? user['profilePicture']) : '';

/** The verified account, filling anything `user` lacks from `extra` (the same account). */
const toVerified = (user: Json, extra: Json | null = null): VerifiedBloxityUser => {
  const username = text(user['username']) || text(extra?.['username']);
  const displayName = text(user['displayName']) || text(extra?.['displayName']) || username;
  return { id: idOf(user), username, displayName: displayName.slice(0, 40), avatarUrl: avatarOf(user) || avatarOf(extra) };
};

/** A slug as Bloxity writes them. Anything else is not sent. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

const request = async (url: string, token: string, body?: Json): Promise<Answer> => {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return { status: response.status, body: null };
  return { status: response.status, body: (await response.json()) as Json };
};

/**
 * Resolve a Bloxity token to the account it belongs to.
 *
 * The client sends its TOKEN, never its id. A claimed id would let anybody say
 * they were somebody else and collect that person's paid-for Bux grants; a
 * token can only be answered by Bloxity for the account that owns it.
 *
 * A token issued inside a game is a GAME CAPABILITY, which Bloxity's account
 * routes refuse (401). It is verified exactly the way Bloxity's own SDK verifies
 * it: `POST /v1/auth/game-token/verify` with the game's slug. Only if no slug
 * accepts it is it treated as a plain account token and verified with
 * `/v1/social/profile`, with `/v1/auth/me` filling in a missing display name or
 * avatar for the same account.
 *
 * @param gameSlugs slugs to verify an in-game token against (the client's, then this server's)
 */
export const verifyBloxityToken = async (
  token: string,
  apiBase: string,
  gameSlugs: readonly string[],
): Promise<VerifiedBloxityUser | null> => {
  if (!token || token.length > 4096) return null;
  const refused: string[] = [];
  try {
    for (const gameSlug of new Set(gameSlugs.filter((slug) => SLUG.test(slug)))) {
      const answer = await request(`${apiBase}/v1/auth/game-token/verify`, token, { gameSlug });
      const user = answer.body ? userOf(answer.body) : null;
      if (user && idOf(user)) return toVerified(user);
      refused.push(`game-token/verify "${gameSlug}" HTTP ${answer.status}`);
    }

    const profile = await request(`${apiBase}/v1/social/profile`, token);
    const profileUser = profile.body ? userOf(profile.body) : null;
    if (profileUser && idOf(profileUser) && text(profileUser['displayName']) && avatarOf(profileUser)) {
      return toVerified(profileUser);
    }

    const me = await request(`${apiBase}/v1/auth/me`, token);
    const meUser = me.body ? userOf(me.body) : null;
    if (profileUser && idOf(profileUser)) {
      return toVerified(profileUser, meUser && idOf(meUser) === idOf(profileUser) ? meUser : null);
    }
    if (meUser && idOf(meUser)) return toVerified(meUser);

    refused.push(`social/profile HTTP ${profile.status}`, `auth/me HTTP ${me.status}`);
    logger.warn(SCOPE, `Bloxity did not accept the player's token (${refused.join(', ')})`);
    return null;
  } catch (error) {
    logger.warn(SCOPE, `could not verify token: ${String(error)}`);
    return null;
  }
};
