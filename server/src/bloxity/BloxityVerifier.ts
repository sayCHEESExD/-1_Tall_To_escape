import { createHash } from 'node:crypto';
import { normalizeAvatarUrl } from '@highjump/shared';
import { logger } from '../util/logger.js';

const SCOPE = 'bloxity/auth';

/**
 * Bloxity's API. A CONSTANT, not configuration: an env var here would let
 * whoever sets it decide who counts as a verified account.
 */
export const BLOXITY_API = 'https://api.bloxity.io';

/** The route Bloxity's own SDK validates its token with (`refreshUserFromApi`). */
export const VERIFY_URL = `${BLOXITY_API}/v1/auth/game-token/verify`;

const REQUEST_TIMEOUT_MS = 5000;
/** A verified answer is reused this long, and never past the token's own `exp`. */
const VERIFIED_TTL_MS = 5 * 60_000;
/** A rejected token is not asked about again for this long. */
const REJECTED_TTL_MS = 30_000;
const CACHE_LIMIT = 2000;
const MAX_TOKEN_LENGTH = 4096;

/** A Bloxity account, as the SERVER established it. */
export interface VerifiedBloxityUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  /** The account's Bloxity avatar thumbnail (on static.bloxity.io), or ''. */
  readonly avatarUrl: string;
}

/**
 * THREE outcomes, not two:
 *  - `verified`: Bloxity answered 2xx with a user carrying a string `_id`;
 *  - `rejected`: Bloxity said no - play as a guest;
 *  - `unavailable`: no usable answer (timeout, network, 5xx, 429) - play as a
 *    guest FOR NOW and ask again on a backoff. Never a permanent demotion.
 */
export type Verification =
  | { readonly status: 'verified'; readonly user: VerifiedBloxityUser }
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly reason: string };

interface CacheEntry {
  readonly result: Verification;
  readonly until: number;
}

/** A key for the cache that is not the token itself. */
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * The token's `exp`, in ms - READ, NOT VERIFIED. It only caps how long a
 * verified answer is cached; the verification itself is always Bloxity's.
 * (`JWT_SECRET` is this game's own secret, not Bloxity's signing key, so the
 * token cannot be checked locally, and is not.)
 */
const tokenExpiry = (token: string): number | null => {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof decoded.exp === 'number' && Number.isFinite(decoded.exp) ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Server-side verification of a Bloxity portal token, exactly as Bloxity's own
 * SDK does it: `POST /v1/auth/game-token/verify`, `Authorization: Bearer
 * <token>`, body `{ gameSlug }`. The slug is THIS server's game id (Legion
 * injects `BLOXITY_GAME_ID`) - never one a client supplies, or a capability
 * minted for some other game would verify here.
 *
 * FAIL CLOSED: only a 2xx whose user carries a non-empty string `_id` counts.
 */
export class BloxityVerifier {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<Verification>>();

  constructor(private readonly gameSlug: string) {}

  verify(token: string): Promise<Verification> {
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      return Promise.resolve({ status: 'rejected', reason: 'malformed token' });
    }
    const key = tokenHash(token);
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return Promise.resolve(cached.result);
    const running = this.inFlight.get(key);
    if (running) return running;

    const request = this.ask(token)
      .then((result) => {
        this.remember(key, token, result);
        return result;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private async ask(token: string): Promise<Verification> {
    let response: Response;
    try {
      response = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameSlug: this.gameSlug }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return { status: 'unavailable', reason: `request failed: ${String(error)}` };
    }

    if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) {
      return { status: 'unavailable', reason: `HTTP ${response.status}` };
    }
    if (!response.ok) return { status: 'rejected', reason: `HTTP ${response.status}` };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      logger.error(SCOPE, 'Bloxity answered 2xx with a body that is not JSON - treating as unavailable');
      return { status: 'unavailable', reason: 'unreadable 2xx' };
    }
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const user = (body['user'] && typeof body['user'] === 'object' ? body['user'] : body) as Record<string, unknown>;
    const id = user['_id'];
    if (typeof id !== 'string' || !id || id.length > 128) {
      logger.error(SCOPE, 'Bloxity answered 2xx without a string _id - NOT counting it as verified');
      return { status: 'unavailable', reason: '2xx without _id' };
    }
    const username = text(user['username']);
    return {
      status: 'verified',
      user: {
        id,
        username,
        displayName: (text(user['displayName']) || username).slice(0, 40),
        avatarUrl: normalizeAvatarUrl(user['pfp'] ?? user['avatarUrl']),
      },
    };
  }

  private remember(key: string, token: string, result: Verification): void {
    const now = Date.now();
    let until = 0;
    if (result.status === 'verified') until = Math.min(now + VERIFIED_TTL_MS, tokenExpiry(token) ?? Infinity);
    else if (result.status === 'rejected') until = now + REJECTED_TTL_MS;
    if (until <= now) return; // "unavailable" (and an already-expired token) is never cached
    if (this.cache.size >= CACHE_LIMIT) {
      for (const [cachedKey, entry] of this.cache) if (entry.until <= now) this.cache.delete(cachedKey);
      if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
    }
    this.cache.set(key, { result, until });
  }
}
