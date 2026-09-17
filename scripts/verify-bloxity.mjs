/**
 * The server's half of the Bloxity integration, exercised without a server.
 *
 * Bux are real money. The webhook is the ONLY way a purchase becomes Wins, so
 * every rule it holds is asserted here: a delivery without the shared secret is
 * refused, a server with no secret configured refuses rather than granting to
 * anyone, a retried transaction pays once, an unknown SKU is still answered 2xx
 * so Bloxity does not refund a purchase that was really made, and the queue is
 * on disk before the webhook answers.
 *
 * Run with `npm run verify:bloxity`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_AVATAR_LOOK,
  DEFAULT_AVATAR_URL,
  GUEST_NAME,
  LEADERBOARD_SIZE,
  encodeAvatarLook,
  normalizeAvatarUrl,
  parseAvatarLook,
  sanitizeAvatarLook,
  sanitizeDisplayName,
} from '../shared/dist/index.js';
import { BuxGrants, SKU_WINS } from '../server/dist/bloxity/BuxGrants.js';
import { verifyBloxityToken } from '../server/dist/bloxity/bloxityIdentity.js';
import { processBuxWebhook } from '../server/dist/bloxity/buxWebhook.js';
import { LeaderboardService } from '../server/dist/progression/LeaderboardService.js';

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
};

const body = (over = {}) =>
  JSON.stringify({
    transactionId: 'txn-1',
    userId: 'user-a',
    username: 'alice',
    gameSlug: 'tall-escape',
    sku: 'wins_small',
    productName: 'Pouch of Wins',
    productPrice: 100,
    metadata: {},
    timestamp: new Date().toISOString(),
    ...over,
  });

const SIGNED = { secret: 's3cret', allowUnsigned: false };

console.log('\nwebhook authentication\n');
{
  const grants = new BuxGrants(null);
  check('no secret header is refused', processBuxWebhook(undefined, body(), grants, SIGNED).status === 401);
  check('a wrong secret is refused', processBuxWebhook('nope', body(), grants, SIGNED).status === 401);
  check('a refused delivery grants nothing', grants.drain('user-a').length === 0);
  check(
    'a server with NO secret configured refuses rather than granting to anyone',
    processBuxWebhook(undefined, body(), grants, { secret: '', allowUnsigned: false }).status === 503,
  );
  check(
    'unsigned deliveries are accepted only when explicitly allowed (local dev)',
    processBuxWebhook(undefined, body({ transactionId: 'dev-1' }), grants, { secret: '', allowUnsigned: true }).status === 200,
  );
}

console.log('\nwebhook payloads\n');
{
  const grants = new BuxGrants(null);
  check('malformed JSON is a 400', processBuxWebhook('s3cret', '{not json', grants, SIGNED).status === 400);
  check('a missing transactionId is a 400', processBuxWebhook('s3cret', body({ transactionId: '' }), grants, SIGNED).status === 400);
  check('a missing userId is a 400', processBuxWebhook('s3cret', body({ userId: undefined }), grants, SIGNED).status === 400);

  const first = processBuxWebhook('s3cret', body(), grants, SIGNED);
  check('a valid delivery is 2xx', first.status === 200);
  const retry = processBuxWebhook('s3cret', body(), grants, SIGNED);
  check('a RETRIED delivery is still 2xx (so Bloxity stops retrying)', retry.status === 200);
  check('but reports it as a duplicate', retry.body.outcome === 'duplicate');

  const owed = grants.drain('user-a');
  check('the purchase is queued exactly ONCE', owed.length === 1, `queued ${owed.length}`);
  check('for the SKU table value, never a client figure', owed[0]?.wins === SKU_WINS.wins_small);
  check('draining empties the queue', grants.drain('user-a').length === 0);
  check('grants belong to the paying account only', grants.drain('user-b').length === 0);

  const unknown = processBuxWebhook('s3cret', body({ transactionId: 'txn-x', sku: 'from_the_future' }), grants, SIGNED);
  check('an unknown SKU is still 2xx, so a real purchase is not refunded', unknown.status === 200);
  check('and grants nothing', grants.drain('user-a').length === 0);
  check('the price in the payload is never used as a grant', !Object.values(SKU_WINS).includes(100));}

console.log('\npersistence\n');
{
  const dir = mkdtempSync(join(tmpdir(), 'tallescape-bux-'));
  const file = join(dir, 'bux-grants.json');
  try {
    const before = new BuxGrants(file);
    before.record('user-a', 'txn-9', 'wins_large');
    check('the queue is on disk before the webhook answers', readFileSync(file, 'utf8').includes('txn-9'));

    const after = new BuxGrants(file);
    check('a restarted server still owes the purchase', after.drain('user-a')[0]?.wins === SKU_WINS.wins_large);
    check(
      'and still recognises the transaction, so a post-restart retry does not pay twice',
      after.record('user-a', 'txn-9', 'wins_large') === 'duplicate',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nplayer identity: Bloxity display names and avatars, never internal ids\n');
{
  check('a Bloxity display name is shown exactly', sanitizeDisplayName('Chicken 877') === 'Chicken 877');
  check('invisible characters and runs of spaces are cleaned', sanitizeDisplayName(' Chicken' + String.fromCharCode(0) + '   877' + String.fromCharCode(10, 0x200b, 0x202e)) === 'Chicken 877');
  check('a non-string name is empty, and the room shows "Guest"', sanitizeDisplayName(42) === '' && GUEST_NAME === 'Guest');
  check('names are capped to fit a row', sanitizeDisplayName('x'.repeat(200)).length === 32);

  const sdkGuest = 'https://static.bloxity.io/img/pfps/s0.png?width=128&quality=85&v=2';
  check('a Bloxity-hosted thumbnail is kept as-is', normalizeAvatarUrl(sdkGuest) === sdkGuest);
  check(
    "Bloxity's relative pfp path resolves under static.bloxity.io/img, as the SDK does",
    normalizeAvatarUrl('/pfps/s3_h12.png') === 'https://static.bloxity.io/img/pfps/s3_h12.png?width=128&quality=85',
  );
  check(
    'a thumbnail on any other host or scheme is refused',
    normalizeAvatarUrl('https://evil.example/track.png') === '' &&
      normalizeAvatarUrl('http://static.bloxity.io/img/a.png') === '' &&
      normalizeAvatarUrl('https://static.bloxity.io.evil.com/x.png') === '' &&
      normalizeAvatarUrl('javascript:alert(1)') === '',
  );
  check('path traversal is refused', normalizeAvatarUrl('/../secret') === '' && normalizeAvatarUrl('https://static.bloxity.io/img/../x') === '');
  check('the default thumbnail is Bloxity\'s own', DEFAULT_AVATAR_URL.startsWith('https://static.bloxity.io/img/pfps/'));

  const rows = () => Array.from({ length: LEADERBOARD_SIZE }, () => ({ name: '', avatarUrl: '', value: 0 }));
  const board = { wins: rows(), height: rows(), time: rows() };
  const avatar = 'https://static.bloxity.io/img/pfps/s7_h3.png?width=128&quality=85&v=2';
  const live = new Map([
    ['session-a', { displayName: 'Chicken 877', avatarUrl: avatar, wins: 50, height: 900, rebirths: 2, playSeconds: 4000 }],
    ['session-b', { displayName: '', avatarUrl: '', wins: 10, height: 100, rebirths: 0, playSeconds: 120 }],
  ]);
  const ids = new Map([['session-a', 'p_internal_abc123'], ['session-b', 'p_internal_def456']]);
  new LeaderboardService().update(1, board, live, ids);
  const shown = [...board.wins, ...board.height, ...board.time].filter((row) => row.name);
  check('the boards show the Bloxity display name', board.wins[0].name === 'Chicken 877' && board.height[0].name === 'Chicken 877');
  check('with that player\'s Bloxity avatar thumbnail', board.wins[0].avatarUrl === avatar);
  check('a player with no Bloxity name is "Guest"', board.wins[1].name === 'Guest');
  check(
    'no row shows an @, a generated tag, a session id or an internal player id',
    shown.length === 6 && shown.every((row) => !/@|_[0-9A-F]{4}$|p_internal|session-/.test(row.name)),
    shown.map((row) => row.name).join(', '),
  );
}

console.log("\ntoken verification: a signed-in player is their Bloxity account, not Guest\n");
{
  const realFetch = globalThis.fetch;
  const reply = (status, body = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const pathOf = (url) => new URL(url).pathname;
  try {
    // An in-game token: Bloxity's account routes refuse it, like the live API does.
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      const path = pathOf(url);
      calls.push({ path, method: init.method ?? 'GET', body: init.body ?? '', auth: init.headers?.Authorization });
      if (path === '/v1/auth/game-token/verify') {
        return JSON.parse(init.body).gameSlug === 'tall-to-escape'
          ? reply(200, { user: { _id: 'acc-1', username: 'chicken877', displayName: 'Chicken 877', pfp: '/pfps/s3_h12.png' } })
          : reply(401, { code: 'GAME_TOKEN_INVALID' });
      }
      return reply(401, { code: 'GAME_TOKEN_REQUIRED' });
    };
    const user = await verifyBloxityToken('game-capability', 'https://api.test', ['tall-to-escape']);
    check(
      "an in-game token is verified the SDK's way: POST /v1/auth/game-token/verify with the game slug",
      calls[0]?.path === '/v1/auth/game-token/verify' && calls[0].method === 'POST' &&
        JSON.parse(calls[0].body).gameSlug === 'tall-to-escape' && calls[0].auth === 'Bearer game-capability',
    );
    check('the signed-in player is shown by their Bloxity display name', user?.displayName === 'Chicken 877' && user?.id === 'acc-1');
    check('with their Bloxity avatar thumbnail', user?.avatarUrl === 'https://static.bloxity.io/img/pfps/s3_h12.png?width=128&quality=85');

    calls.length = 0;
    const second = await verifyBloxityToken('game-capability', 'https://api.test', ['tall-escape', 'tall-to-escape']);
    check('a slug that refuses the token is followed by the next one', second?.displayName === 'Chicken 877' && calls.length === 2);

    // A plain account token (not issued inside a game).
    globalThis.fetch = async (url) => {
      const path = pathOf(url);
      if (path === '/v1/social/profile') return reply(200, { user: { _id: 'acc-2', username: 'owl', displayName: 'Night Owl' } });
      if (path === '/v1/auth/me') return reply(200, { user: { _id: 'acc-2', pfp: 'https://static.bloxity.io/img/pfps/s5.png' } });
      return reply(401);
    };
    const account = await verifyBloxityToken('account-token', 'https://api.test', ['tall-to-escape']);
    check(
      'an account token still verifies through the profile routes',
      account?.displayName === 'Night Owl' && account?.avatarUrl === 'https://static.bloxity.io/img/pfps/s5.png',
    );

    globalThis.fetch = async () => reply(401);
    check('a token Bloxity refuses everywhere is no account', (await verifyBloxityToken('bad', 'https://api.test', ['tall-to-escape'])) === null);

    const sent = [];
    globalThis.fetch = async (url, init = {}) => {
      if (pathOf(url) === '/v1/auth/game-token/verify') sent.push(JSON.parse(init.body).gameSlug);
      return reply(401);
    };
    await verifyBloxityToken('x', 'https://api.test', ['../evil', '', 'tall-to-escape', 'tall-to-escape']);
    check('only well-formed slugs are tried, once each', sent.length === 1 && sent[0] === 'tall-to-escape', sent.join(','));
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('\navatars: the look Bloxity gives a player is what everyone draws\n');
{
  const nothing = encodeAvatarLook({}, {});
  check('a player with nothing equipped still sends a look - their Bloxity DEFAULT avatar', nothing === DEFAULT_AVATAR_LOOK && nothing !== '');
  check('and it parses to no equipped ids, so the Bloxity default body and skin are worn', (() => {
    const look = parseAvatarLook(nothing);
    return look !== null && Object.values(look.equipped).every((id) => id === null) && look.proportions.height === 1;
  })());
  check('only an EMPTY look means no Bloxity data (the one bundled-body fallback)', parseAvatarLook('') === null && sanitizeAvatarLook('') === '');

  const custom = encodeAvatarLook(
    { skin: '12', hat: 'h7', back: '-1', head: 'hd3', torso: undefined, armL: null, armR: 'a9', legL: '', legR: 'l4' },
    { height: 1.2, headScale: 2, armLength: 0.5, shoulderWidth: 1.1, legOffsetX: 1, torsoScaleX: 1, neckHeight: 1 },
  );
  const worn = parseAvatarLook(custom);
  check('a custom avatar keeps every equipped id', worn.equipped.skin === '12' && worn.equipped.hat === 'h7' && worn.equipped.head === 'hd3' && worn.equipped.armR === 'a9' && worn.equipped.legR === 'l4');
  check('and every spelling of "none" Bloxity uses means none', worn.equipped.back === null && worn.equipped.torso === null && worn.equipped.armL === null && worn.equipped.legL === null);
  check('and the proportions survive the round trip', worn.proportions.height === 1.2 && worn.proportions.headScale === 2 && worn.proportions.armLength === 0.5);

  check("proportions are clamped to Bloxity's own range", (() => {
    const look = parseAvatarLook(encodeAvatarLook({}, { height: 99, headScale: -5 }));
    return look.proportions.height === 1.6 && look.proportions.headScale === 0.3;
  })());
  check('a junk id is refused rather than fetched', parseAvatarLook(encodeAvatarLook({ hat: '../../etc/passwd' }, {})).equipped.hat === null);
  check('a malformed look is refused outright', sanitizeAvatarLook('nonsense') === '' && sanitizeAvatarLook('a,b|1') === '' && sanitizeAvatarLook(42) === '');
  check('an oversized look is refused', sanitizeAvatarLook('x'.repeat(500)) === '');
  check('what the server replicates is canonical, whatever the client spelled', sanitizeAvatarLook(sanitizeAvatarLook(custom)) === sanitizeAvatarLook(custom));
}


console.log(`\n${failures === 0 ? 'bloxity verified' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
