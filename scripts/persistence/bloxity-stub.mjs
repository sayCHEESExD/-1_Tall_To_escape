/**
 * TEST ONLY - preloaded into the test server with `node --import`, never part
 * of the build. It replaces exactly ONE URL, Bloxity's token-verify route, so
 * the server's real code path is exercised end to end without a real account.
 * Every other request goes to the real `fetch`.
 *
 * Tokens it understands:
 *   tok:<accountId>:<name>   -> 200 { user: { _id, username, displayName } }
 *   anything else            -> 401 GAME_TOKEN_INVALID (a forged token)
 * A request whose `gameSlug` is not STUB_GAME_SLUG is refused (401), as
 * Bloxity refuses a capability minted for another game.
 * While the file STUB_DOWN_FILE exists, every verify answers 503 - Bloxity
 * "unavailable" - so the backoff and recovery path can be driven from outside.
 */
import { existsSync } from 'node:fs';

const VERIFY_URL = 'https://api.bloxity.io/v1/auth/game-token/verify';
const EXPECTED_SLUG = process.env.STUB_GAME_SLUG ?? 'tall-to-escape';
const DOWN_FILE = process.env.STUB_DOWN_FILE ?? '';
const realFetch = globalThis.fetch;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== VERIFY_URL) return realFetch(input, init);

  if (DOWN_FILE && existsSync(DOWN_FILE)) return json(503, { error: 'stub: bloxity down' });
  if ((init.method ?? 'GET').toUpperCase() !== 'POST') return json(404, { error: 'not found' });

  let slug = '';
  try {
    slug = JSON.parse(String(init.body ?? '{}')).gameSlug ?? '';
  } catch {
    /* no body */
  }
  if (slug !== EXPECTED_SLUG) return json(401, { code: 'GAME_TOKEN_INVALID', error: 'stub: wrong game' });

  const header = new Headers(init.headers).get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const match = /^tok:([A-Za-z0-9_-]+):([A-Za-z0-9 _-]+)$/.exec(token);
  if (!match) return json(401, { code: token ? 'GAME_TOKEN_INVALID' : 'GAME_TOKEN_REQUIRED' });
  const [, id, name] = match;
  return json(200, { user: { _id: id, username: name.toLowerCase().replace(/\s+/g, ''), displayName: name } });
};

console.log(`[stub] Bloxity verify stubbed (slug "${EXPECTED_SLUG}")`);
