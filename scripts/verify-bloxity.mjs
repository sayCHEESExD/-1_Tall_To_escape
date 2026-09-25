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
  resolveShownName,
  sanitizeAvatarLook,
  sanitizeDisplayName,
} from '../shared/dist/index.js';
import { JsonGrantStore, SKU_WINS } from '../server/dist/bloxity/BuxGrants.js';
import { BloxityVerifier, VERIFY_URL } from '../server/dist/bloxity/BloxityVerifier.js';
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
  const grants = new JsonGrantStore(null);
  check('no secret header is refused', (await processBuxWebhook(undefined, body(), grants, SIGNED)).status === 401);
  check('a wrong secret is refused', (await processBuxWebhook('nope', body(), grants, SIGNED)).status === 401);
  check('a refused delivery grants nothing', (await grants.drain('user-a')).length === 0);
  check(
    'a server with NO secret configured refuses rather than granting to anyone',
    (await processBuxWebhook(undefined, body(), grants, { secret: '', allowUnsigned: false })).status === 503,
  );
  check(
    'unsigned deliveries are accepted only when explicitly allowed (local dev)',
    (await processBuxWebhook(undefined, body({ transactionId: 'dev-1' }), grants, { secret: '', allowUnsigned: true })).status === 200,
  );
}

console.log('\nwebhook payloads\n');
{
  const grants = new JsonGrantStore(null);
  check('malformed JSON is a 400', (await processBuxWebhook('s3cret', '{not json', grants, SIGNED)).status === 400);
  check('a missing transactionId is a 400', (await processBuxWebhook('s3cret', body({ transactionId: '' }), grants, SIGNED)).status === 400);
  check('a missing userId is a 400', (await processBuxWebhook('s3cret', body({ userId: undefined }), grants, SIGNED)).status === 400);

  const first = await processBuxWebhook('s3cret', body(), grants, SIGNED);
  check('a valid delivery is 2xx', first.status === 200);
  const retry = await processBuxWebhook('s3cret', body(), grants, SIGNED);
  check('a RETRIED delivery is still 2xx (so Bloxity stops retrying)', retry.status === 200);
  check('but reports it as a duplicate', retry.body.outcome === 'duplicate');

  const owed = await grants.drain('user-a');
  check('the purchase is queued exactly ONCE', owed.length === 1, `queued ${owed.length}`);
  check('for the SKU table value, never a client figure', owed[0]?.wins === SKU_WINS.wins_small);
  check('draining empties the queue', (await grants.drain('user-a')).length === 0);
  check('grants belong to the paying account only', (await grants.drain('user-b')).length === 0);

  const unknown = await processBuxWebhook('s3cret', body({ transactionId: 'txn-x', sku: 'from_the_future' }), grants, SIGNED);
  check('an unknown SKU is still 2xx, so a real purchase is not refunded', unknown.status === 200);
  check('and grants nothing', (await grants.drain('user-a')).length === 0);
  check('the price in the payload is never used as a grant', !Object.values(SKU_WINS).includes(100));

  const broken = { record: async () => { throw new Error('database down'); }, drain: async () => [] };
  const down = await processBuxWebhook('s3cret', body({ transactionId: 'txn-down' }), broken, SIGNED);
  check('storage that cannot take the grant answers 503, so Bloxity retries instead of believing it', down.status === 503);
}

console.log('\npersistence\n');
{
  const dir = mkdtempSync(join(tmpdir(), 'tallescape-bux-'));
  const file = join(dir, 'bux-grants.json');
  try {
    const before = new JsonGrantStore(file);
    await before.record('user-a', 'txn-9', 'wins_large');
    check('the grant is on disk before the webhook answers', readFileSync(file, 'utf8').includes('txn-9'));

    const after = new JsonGrantStore(file);
    check('a restarted server still owes the purchase', (await after.drain('user-a'))[0]?.wins === SKU_WINS.wins_large);
    check(
      'and still recognises the transaction, so a post-restart retry does not pay twice',
      (await after.record('user-a', 'txn-9', 'wins_large')) === 'duplicate',
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
  new LeaderboardService().update(1, board, live, ids, []);
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

console.log('\ntoken verification: three outcomes, Bloxity decides, fail closed\n');
{
  const realFetch = globalThis.fetch;
  const reply = (status, payload = {}) =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  let calls = [];
  const serve = (handler) => {
    calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null });
      return handler(String(url), init);
    };
  };
  try {
    check('the Bloxity API is a constant, not configuration', VERIFY_URL === 'https://api.bloxity.io/v1/auth/game-token/verify');

    serve(() => reply(200, { user: { _id: 'acc-1', username: 'chicken877', displayName: 'Chicken 877', pfp: '/pfps/s3_h12.png' } }));
    const verifier = new BloxityVerifier('tall-to-escape');
    const token = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const first = await verifier.verify(token);
    check(
      "it asks exactly as Bloxity's SDK does: POST game-token/verify, Bearer token, THIS server's slug",
      calls[0]?.url === VERIFY_URL && calls[0].method === 'POST' && calls[0].auth === `Bearer ${token}` &&
        calls[0].body?.gameSlug === 'tall-to-escape',
    );
    check('a 2xx with a string _id is VERIFIED', first.status === 'verified' && first.user.id === 'acc-1' && first.user.displayName === 'Chicken 877');
    check('with the account picture', first.user.avatarUrl === 'https://static.bloxity.io/img/pfps/s3_h12.png?width=128&quality=85');
    await verifier.verify(token);
    check('a verified answer is cached (keyed by a hash of the token)', calls.length === 1);

    serve(() => reply(200, { _id: 'acc-2', username: 'owl' }));
    const bare = await new BloxityVerifier('tall-to-escape').verify(jwt({ exp: Math.floor(Date.now() / 1000) + 60 }));
    check('the user may also be the reply itself', bare.status === 'verified' && bare.user.id === 'acc-2');

    serve(() => reply(200, { user: { id: 'acc-3', username: 'no-underscore' } }));
    const noId = await new BloxityVerifier('tall-to-escape').verify('tok-no-id');
    check('a 2xx WITHOUT a string _id is not verified (fail closed)', noId.status !== 'verified');

    serve(() => reply(200, { user: { _id: 'acc-4' } }));
    const expired = new BloxityVerifier('tall-to-escape');
    const old = jwt({ exp: Math.floor(Date.now() / 1000) - 10 });
    await expired.verify(old);
    await expired.verify(old);
    check("a verified answer is never cached past the token's exp", calls.length === 2);

    serve(() => reply(401, { code: 'GAME_TOKEN_INVALID' }));
    const rejecting = new BloxityVerifier('tall-to-escape');
    const rejected = await rejecting.verify('forged');
    await rejecting.verify('forged');
    check('a 401 is REJECTED', rejected.status === 'rejected');
    check('and a rejection is cached briefly (Bloxity is not asked again at once)', calls.length === 1);

    serve(() => reply(503));
    const flaky = new BloxityVerifier('tall-to-escape');
    const down = await flaky.verify('tok-503');
    await flaky.verify('tok-503');
    check('a 5xx is UNAVAILABLE, not rejected', down.status === 'unavailable');
    check('and "unavailable" is never cached', calls.length === 2);

    serve(() => { throw new TypeError('network down'); });
    check('a network failure is UNAVAILABLE', (await new BloxityVerifier('tall-to-escape').verify('tok-net')).status === 'unavailable');

    serve((url, init) => (JSON.parse(init.body).gameSlug === 'tall-to-escape' ? reply(200, { user: { _id: 'x' } }) : reply(401)));
    const other = await new BloxityVerifier('some-other-game').verify('tok-slug');
    check("a server for another game cannot verify this game's capability", other.status === 'rejected');

    const empty = await new BloxityVerifier('tall-to-escape').verify('');
    const huge = await new BloxityVerifier('tall-to-escape').verify('x'.repeat(5000));
    check('an empty or oversized token never reaches Bloxity', empty.status === 'rejected' && huge.status === 'rejected');
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


console.log('\nthe name shown: verified first, then what Bloxity told the client\n');
{
  check('a verified Bloxity account is shown by its name', resolveShownName('Chicken 877', '') === 'Chicken 877');
  check(
    "a signed-in player the portal gave no verifiable token is still shown by their Bloxity name",
    resolveShownName('', 'Chicken 877') === 'Chicken 877',
  );
  check('the verified name WINS over whatever the client reported', resolveShownName('Real Name', 'I Am Someone Else') === 'Real Name');
  check('a player Bloxity knows nothing about is Guest', resolveShownName('', '') === GUEST_NAME && resolveShownName(null, undefined) === GUEST_NAME);
  check('a reported name is cleaned like any other', resolveShownName('', '  Chicken' + String.fromCharCode(0) + '  877 ') === 'Chicken 877');
  check('a reported name cannot be a novel', resolveShownName('', 'x'.repeat(200)).length === 32);
}


console.log(`\n${failures === 0 ? 'bloxity verified' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
