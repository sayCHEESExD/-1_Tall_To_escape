/**
 * How players are SHOWN: their Bloxity display name and avatar thumbnail.
 *
 * There is no identity system of this game's own. A signed-in player is shown
 * by their Bloxity account's display name and avatar, verified by the server.
 * Everyone else is `GUEST_NAME` - never the random name Bloxity generates for a
 * guest - with their Bloxity guest avatar. Internal ids (the browser player id,
 * the Bloxity account id, the session id) never leave the server as a name.
 */

/** The id this game is registered under on Bloxity (the deploy workflow's game id). */
export const BLOXITY_GAME_ID = 'tall-to-escape';

/** Shown for every player who is not signed in to a Bloxity account. */
export const GUEST_NAME = 'Guest';

/** Longest display name shown, so a name fits a board row and a name tag. */
export const DISPLAY_NAME_MAX = 32;

/** Bloxity's avatar image host. Thumbnails from anywhere else are refused. */
export const AVATAR_ORIGIN = 'https://static.bloxity.io';

/** Bloxity's default character thumbnail (the one its SDK uses for a default guest). */
export const DEFAULT_AVATAR_URL = `${AVATAR_ORIGIN}/img/pfps/s0.png?width=128&quality=85&v=2`;

/** How many places each board shows. Matches the reference art's nine rows. */
export const LEADERBOARD_SIZE = 9;

/**
 * Control, zero-width, line/paragraph-separator and bidi-override characters:
 * invisible, or able to garble a row. Tested by code point rather than written
 * into a regular expression, so the source file holds no invisible characters.
 */
const isInvisible = (code: number): boolean =>
  code <= 0x1f ||
  (code >= 0x7f && code <= 0x9f) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202e) ||
  (code >= 0x2060 && code <= 0x206f) ||
  code === 0xfeff;

/**
 * A Bloxity display name, cleaned for display: invisible characters removed,
 * whitespace collapsed, capped. Nothing is added or rewritten - "Chicken 877"
 * stays "Chicken 877". Anything that is not a string is ''.
 */
export const sanitizeDisplayName = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const visible = Array.from(raw.normalize('NFC'))
    .map((char) => (isInvisible(char.codePointAt(0) ?? 0) ? ' ' : char))
    .join('');
  return Array.from(visible.replace(/\s+/g, ' ').trim()).slice(0, DISPLAY_NAME_MAX).join('').trim();
};

const SAFE_PATH = /^[A-Za-z0-9._~/-]+(\?[A-Za-z0-9._~=&%+-]*)?$/;

/**
 * THE name a player is shown by: what the server verified with Bloxity, else
 * what Bloxity's own SDK reported to their client, else `GUEST_NAME`.
 *
 * The reported name matters because the portal hands an embedded game its user
 * object whether or not it also hands it a token to verify, and a signed-in
 * player must not be shown as "Guest" for want of one. It is DISPLAY ONLY: only
 * a verified token ever grants the Bloxity id that Bux is paid against.
 */
export const resolveShownName = (verified: unknown, reported: unknown): string =>
  sanitizeDisplayName(verified) || sanitizeDisplayName(reported) || GUEST_NAME;

/**
 * A Bloxity avatar thumbnail URL, or '' when it is not one.
 *
 * Accepts an https URL on `static.bloxity.io`, or the relative `/pfps/...` path
 * Bloxity's API returns, resolved the way its SDK resolves it (under `/img/`).
 * Everything else is refused: this URL is broadcast to every player in the
 * room, so it may never point at an arbitrary host.
 */
export const normalizeAvatarUrl = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if (!value || value.length > 512) return '';
  if (value.startsWith('//')) value = `https:${value}`;

  let path: string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    if (!value.startsWith(`${AVATAR_ORIGIN}/`)) return '';
    path = value.slice(AVATAR_ORIGIN.length + 1);
  } else {
    path = value.replace(/^\/+/, '');
    if (!path.startsWith('img/')) path = `img/${path}`;
    if (!path.includes('?')) path += '?width=128&quality=85';
  }

  const segments = (path.split('?')[0] ?? '').split('/');
  if (!SAFE_PATH.test(path) || segments.some((segment) => segment === '..' || segment === '.')) return '';
  return `${AVATAR_ORIGIN}/${path}`;
};
