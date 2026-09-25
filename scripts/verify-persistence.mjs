/**
 * Persistent, cross-device progress - verified end to end.
 *
 * Spawns the BUILT server (`npm run build:server` first) with ONE thing stubbed:
 * Bloxity's token-verify URL, via `node --import scripts/persistence/bloxity-stub.mjs`
 * (no test switches exist in production code). Real colyseus.js clients join,
 * sign in and out, buy things through the real webhook, and the storage is read
 * DIRECTLY - the JSON file, or the MongoDB collections - to check what landed.
 *
 *   npm run verify:persistence
 *       JSON store only.
 *   MONGOD_BIN=/path/to/mongod npm run verify:persistence
 *       + MongoDB on a mongod this script starts itself (fixed port, temp dbPath),
 *       including the outage tests (the database is killed and restarted).
 *   MONGODB_URI=mongodb://host/some_test_db npm run verify:persistence
 *       + MongoDB against that database, without the outage tests.
 *
 * !!! WARNING: WITH MONGODB_URI, THAT DATABASE IS DROPPED - EVERY COLLECTION IN IT !!!
 * !!! Point it at a throwaway TEST database only, never at a real game's data.       !!!
 *
 * Not part of `npm run verify`: it spawns processes and takes a few minutes.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'colyseus.js';
import { MongoClient } from 'mongodb';
import { MessageType, ROOM_NAME } from '../shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(ROOT, 'server', 'dist', 'index.js');
const STUB = pathToFileURL(path.join(ROOT, 'scripts', 'persistence', 'bloxity-stub.mjs')).href;
const SECRET = 'persistence-test-secret';
const MONGOD_PORT = 27319;
const IS_WINDOWS = process.platform === 'win32';

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `probe` returns something truthy; returns it, or null on timeout. */
const waitFor = async (probe, timeoutMs = 8000, everyMs = 100) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value = null;
    try {
      value = await probe();
    } catch {
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(everyMs);
  }
};

if (!existsSync(SERVER_ENTRY)) {
  console.error(`No built server at ${SERVER_ENTRY}. Run "npm run build:server" first.`);
  process.exit(1);
}

// ------------------------------------------------------------ processes

/** The built game server, spawned with the Bloxity stub preloaded. */
class GameServer {
  constructor({ port, dataDir, mongoUri, downFile }) {
    Object.assign(this, { port, dataDir, mongoUri, downFile });
    this.log = [];
    this.child = null;
  }

  async start() {
    const lineCount = this.log.length;
    this.child = spawn(process.execPath, ['--import', STUB, SERVER_ENTRY, '--port', String(this.port)], {
      cwd: ROOT,
      env: {
        ...process.env,
        HIGHJUMP_DATA_DIR: this.dataDir,
        MONGODB_URI: this.mongoUri ?? '',
        BLOXITY_WEBHOOK_SECRET: SECRET,
        BLOXITY_GAME_ID: 'tall-to-escape',
        STUB_DOWN_FILE: this.downFile,
        HOST: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collect = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) this.log.push(line);
    };
    this.child.stdout.on('data', collect);
    this.child.stderr.on('data', collect);
    const up = await waitFor(() => this.log.slice(lineCount).some((line) => line.includes('listening on')), 20000);
    if (!up) throw new Error(`server did not start:\n${this.log.slice(lineCount).join('\n')}`);
  }

  /**
   * Kill it HARD. On Windows a signal never reaches Node's handlers, so there is
   * no graceful path to test there anyway - callers wait for their writes to
   * land in storage first, which is exactly what a crash would find.
   */
  async kill() {
    if (!this.child || this.child.exitCode !== null) return;
    const exited = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.kill('SIGKILL');
    await exited;
  }

  since(mark) {
    return this.log.slice(mark);
  }
}

/** A real mongod on a fixed port and dbPath, so it can be killed and brought back. */
class Mongod {
  constructor(bin, dbPath) {
    Object.assign(this, { bin, dbPath });
    this.child = null;
  }

  async start() {
    mkdirSync(this.dbPath, { recursive: true });
    const output = [];
    this.child = spawn(this.bin, ['--port', String(MONGOD_PORT), '--dbpath', this.dbPath, '--bind_ip', '127.0.0.1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (chunk) => output.push(String(chunk));
    this.child.stdout.on('data', keep);
    this.child.stderr.on('data', keep);
    this.child.on('error', (error) => output.push(`spawn error: ${error.message}`));
    // A FRESH client per attempt: a driver client whose first connect failed stays
    // closed. After a hard kill, Windows releases the old process's file handles
    // slowly and the new mongod recovers from an unclean shutdown - so wait.
    let lastError = '';
    const up = await waitFor(
      async () => {
        const client = new MongoClient(`mongodb://127.0.0.1:${MONGOD_PORT}`, { serverSelectionTimeoutMS: 1000 });
        try {
          return (await client.db('admin').command({ ping: 1 })).ok === 1;
        } catch (error) {
          lastError = String(error?.message ?? error);
          return false;
        } finally {
          await client.close().catch(() => undefined);
        }
      },
      120_000,
      500,
    );
    if (!up) {
      const all = output.join('');
      const fatal = all.split('\n').filter((line) => /"s":"(E|F)"/.test(line)).slice(-4).join('\n');
      throw new Error(
        `mongod did not answer (exit ${this.child.exitCode}, listening: ${all.includes('Waiting for connections')}, ` +
          `last ping error: ${lastError})\n${fatal}`,
      );
    }
  }

  async kill() {
    if (!this.child || this.child.exitCode !== null) return;
    const exited = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.kill('SIGKILL');
    await exited;
    await sleep(500);
  }
}

// -------------------------------------------------------------- storage

/** Reads the JSON store straight off the disk, as the next boot would. */
class JsonStorage {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'profiles.json');
  }
  async all() {
    return existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
  }
  async get(key) {
    return (await this.all())[key] ?? null;
  }
  async seed(profiles) {
    writeFileSync(this.file, JSON.stringify({ ...(await this.all()), ...profiles }));
  }
}

/** Reads MongoDB directly, with its own client. */
class MongoStorage {
  constructor(uri) {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    this.db = this.client.db();
  }
  async get(key) {
    return this.db.collection('profiles').findOne({ _id: key });
  }
  async seed(profiles) {
    for (const [key, profile] of Object.entries(profiles)) {
      await this.db.collection('profiles').replaceOne({ _id: key }, profile, { upsert: true });
    }
  }
  async wipe() {
    await this.db.dropDatabase();
  }
  async close() {
    await this.client.close();
  }
}

const profile = (over = {}) => ({
  displayName: '',
  avatarUrl: '',
  level: 1,
  food: 0,
  rebirths: 0,
  wins: 0,
  playSeconds: 0,
  ownedFoods: 1,
  ownedTrails: 0,
  trailSlot: 0,
  pets: '',
  updatedAt: Date.now() - 60_000,
  ...over,
});

// --------------------------------------------------------------- players

const me = (room) => room.state?.players?.get(room.sessionId);

/** Join as a browser would. (Not called `join`: that is path.join's name.) */
const enter = async (port, { playerId, token, name } = {}) => {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const room = await client.joinOrCreate(ROOM_NAME, { playerId, bloxityToken: token || undefined, name: name ?? '' });
  room.onMessage('*', () => undefined); // respawns, wins: nothing to render here
  const ready = await waitFor(() => me(room), 8000);
  if (!ready) throw new Error('no player state after joining');
  return room;
};

/** The error code a join is refused with, or null if it was let in. */
const refusedWith = async (port, options) => {
  try {
    const room = await enter(port, options);
    await room.leave(true);
    return null;
  } catch (error) {
    return error?.code ?? String(error?.message ?? error);
  }
};

const identify = (room, token, name = '') => room.send(MessageType.BloxityIdentity, { token: token ?? '', name });
const leave = async (room) => {
  await room.leave(true).catch(() => undefined);
  await sleep(300);
};

/** Walk back and forth by spawn, which is what earns food. */
const walk = async (room, seconds) => {
  let seq = (me(room)?.lastInputSeq ?? 0) + 1;
  const frames = Math.round(seconds * 30);
  for (let i = 0; i < frames; i += 1) {
    room.send(MessageType.Move, { seq: seq++, dt: 1 / 30, moveX: 0, moveZ: i % 60 < 30 ? 1 : -1, jump: false, cameraYaw: 0 });
    await sleep(33);
  }
};

const webhook = async (port, body) => {
  const response = await fetch(`http://127.0.0.1:${port}/bloxity/bux`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-legion-webhook-secret': SECRET },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

// ------------------------------------------------------------- scenarios

/**
 * Everything that must hold for ANY store. `store` reads storage directly;
 * `server` is the running game server.
 */
const commonScenarios = async (server, store, label) => {
  const port = server.port;
  console.log(`\n[${label}] an existing guest profile restores, and unknown fields survive\n`);
  {
    const room = await enter(port, { playerId: 'p_alice' });
    check('restored level and wins', me(room).level === 12 && me(room).wins === 345, `level ${me(room).level} wins ${me(room).wins}`);
    await leave(room);
    const stored = await waitFor(async () => {
      const doc = await store.get('p_alice');
      return doc && doc.updatedAt > Date.now() - 20_000 ? doc : null;
    });
    check('it was saved again on leave', Boolean(stored));
    check('a field this build does not know is preserved', stored?.legacyNote === 'keep me', JSON.stringify(stored));
  }

  console.log(`\n[${label}] a reserved id, a raw account id and a forged token get NOTHING\n`);
  {
    check('a browser id using the account prefix is refused outright', (await refusedWith(port, { playerId: 'bloxity:acc-owner' })) === 4401);
    const raw = await enter(port, { playerId: 'acc-owner' });
    check('a raw account id as the browser id is just a fresh guest', me(raw).level === 1 && me(raw).wins === 0);
    await leave(raw);
    const forged = await enter(port, { playerId: 'p_forger', token: 'forged-token' });
    check('a forged token plays as a fresh guest', me(forged).level === 1 && me(forged).wins === 0);
    await leave(forged);
    const owner = await store.get('bloxity:acc-owner');
    check("and the account's profile was never touched", owner?.level === 40 && owner?.wins === 9999);
  }

  console.log(`\n[${label}] first login migrates this browser's guest progress\n`);
  const migRoom = await enter(port, { playerId: 'p_mig', token: 'tok:acc-mig:Mig', name: 'Mig' });
  {
    check('the session keeps its progress', me(migRoom).level === 9 && me(migRoom).wins === 120, `level ${me(migRoom).level}`);
    const account = await waitFor(() => store.get('bloxity:acc-mig'));
    check('the account now holds it, fields preserved', account?.level === 9 && account?.wins === 120 && account?.pets === 'cat*' && account?.ownedFoods === 7);
    check('marked migratedFrom the guest key', account?.migratedFrom === 'p_mig');
    const guest = await waitFor(async () => {
      const doc = await store.get('p_mig');
      return doc?.migratedTo ? doc : null;
    });
    check('the guest copy is marked migratedTo the account', guest?.migratedTo === 'bloxity:acc-mig');
    check('and keeps its data as a recovery copy', guest?.level === 9 && guest?.wins === 120);
    check('the server log shows the join as an account', server.log.some((line) => line.includes('as account (migrated from this browser)')));
  }

  console.log(`\n[${label}] logout -> guest (fresh, since this browser migrated); sign back in -> account\n`);
  {
    identify(migRoom, '');
    const fresh = await waitFor(() => me(migRoom).level === 1 && me(migRoom).wins === 0, 10000);
    check('signing out leaves a fresh guest', Boolean(fresh), `level ${me(migRoom).level}`);
    identify(migRoom, 'tok:acc-mig:Mig', 'Mig');
    const back = await waitFor(() => me(migRoom).level === 9 && me(migRoom).wins === 120, 10000);
    check('signing back in restores the account', Boolean(back));
    await leave(migRoom);
    const guest = await store.get('p_mig');
    check('the recovery copy was never overwritten by the fresh guest', guest?.level === 9 && guest?.migratedTo === 'bloxity:acc-mig');
  }

  console.log(`\n[${label}] signing in mid-session migrates the LIVE state (newer than any autosave)\n`);
  {
    const room = await enter(port, { playerId: 'p_live' });
    await walk(room, 5);
    const earned = await waitFor(() => (me(room).food > 0 || me(room).level > 1 ? { food: me(room).food, level: me(room).level } : null), 5000);
    check('walking earned progress', Boolean(earned));
    identify(room, 'tok:acc-live:Live', 'Live');
    const account = await waitFor(async () => {
      const doc = await store.get('bloxity:acc-live');
      return doc?.migratedFrom === 'p_live' ? doc : null;
    }, 10000);
    check('the account got the live progress', Boolean(account) && (account.level > 1 || account.food > 0), JSON.stringify(account));
    check('and the session kept it', me(room).level >= (earned?.level ?? 1) && (me(room).level > 1 || me(room).food > 0));
    check('the guest copy is marked', (await waitFor(async () => (await store.get('p_live'))?.migratedTo)) === 'bloxity:acc-live');
    await leave(room);
  }

  console.log(`\n[${label}] reconnect as the same account, and on another browser\n`);
  {
    const again = await enter(port, { playerId: 'p_mig', token: 'tok:acc-mig:Mig' });
    check('reconnecting restores the account', me(again).level === 9 && me(again).wins === 120);
    await leave(again);
    const elsewhere = await enter(port, { playerId: 'p_other_browser', token: 'tok:acc-mig:Mig' });
    check('another browser gets the same account progress', me(elsewhere).level === 9 && me(elsewhere).wins === 120);
    await leave(elsewhere);
  }

  console.log(`\n[${label}] an existing account is never overwritten by a browser profile\n`);
  {
    const room = await enter(port, { playerId: 'p_b2', token: 'tok:acc-exist:Exist' });
    check('the account wins', me(room).level === 20 && me(room).wins === 2000);
    const guest = await store.get('p_b2');
    check('the browser profile is left alone (not migrated)', guest?.level === 5 && !guest?.migratedTo);
    identify(room, '');
    const own = await waitFor(() => me(room).level === 5 && me(room).wins === 50, 10000);
    check("logging out returns this browser's own progress", Boolean(own), `level ${me(room).level}`);
    await leave(room);
    const account = await store.get('bloxity:acc-exist');
    check('and the account still holds its own', account?.level === 20 && account?.wins === 2000);
  }

  console.log(`\n[${label}] purchases go to the verified account only, and survive a restart\n`);
  {
    const first = await webhook(port, { transactionId: 'txn-1', userId: 'acc-buyer', sku: 'wins_small' });
    check('the webhook answers 2xx once recorded', first.status === 200 && first.body.outcome === 'recorded');
    const retry = await webhook(port, { transactionId: 'txn-1', userId: 'acc-buyer', sku: 'wins_small' });
    check('a retried delivery is a duplicate', retry.status === 200 && retry.body.outcome === 'duplicate');

    await server.kill();
    await server.start();
    check('(server restarted between the webhook and the join)', true);

    const impostor = await enter(port, { playerId: 'acc-buyer' });
    await sleep(1500);
    check('a browser naming the account id gets nothing', me(impostor).wins === 0);
    await leave(impostor);

    const buyer = await enter(port, { playerId: 'p_buyer', token: 'tok:acc-buyer:Buyer' });
    const paid = await waitFor(() => me(buyer).wins === 500, 8000);
    check('the verified account receives it after the restart', Boolean(paid), `wins ${me(buyer).wins}`);
    await webhook(port, { transactionId: 'txn-2', userId: 'acc-buyer', sku: 'wins_large' });
    const live = await waitFor(() => me(buyer).wins === 5500, 15000);
    check('a purchase made while playing arrives in the session', Boolean(live), `wins ${me(buyer).wins}`);
    await leave(buyer);
    const again = await enter(port, { playerId: 'p_buyer', token: 'tok:acc-buyer:Buyer' });
    await sleep(1500);
    check('and each transaction paid out exactly once', me(again).wins === 5500, `wins ${me(again).wins}`);
    await leave(again);
  }

  console.log(`\n[${label}] Bloxity unavailable -> let in as a guest, then the account once it answers\n`);
  {
    writeFileSync(server.downFile, 'down');
    const room = await enter(port, { playerId: 'p_down', token: 'tok:acc-mig:Mig' });
    check('let in (as a guest) while Bloxity cannot answer', me(room).level === 1);
    check('logged as unavailable', server.log.some((line) => line.includes('[bloxity: unavailable]')));
    unlinkSync(server.downFile);
    const recovered = await waitFor(() => me(room).level === 9 && me(room).wins === 120, 15000);
    check('re-verified on the backoff and switched to the account', Boolean(recovered));
    await leave(room);
  }

  console.log(`\n[${label}] a server restart loses nothing\n`);
  {
    const expected = {
      'bloxity:acc-mig': { level: 9, wins: 120 },
      'bloxity:acc-exist': { level: 20, wins: 2000 },
      'bloxity:acc-buyer': { wins: 5500 },
    };
    const landed = await waitFor(async () => {
      for (const [key, want] of Object.entries(expected)) {
        const doc = await store.get(key);
        if (!doc || Object.entries(want).some(([field, value]) => doc[field] !== value)) return false;
      }
      return true;
    }, 10000);
    check('everything is in storage before the kill', Boolean(landed));
    await server.kill();
    await server.start();
    const mig = await enter(port, { playerId: 'p_x1', token: 'tok:acc-mig:Mig' });
    const exist = await enter(port, { playerId: 'p_x2', token: 'tok:acc-exist:Exist' });
    const buyer = await enter(port, { playerId: 'p_x3', token: 'tok:acc-buyer:Buyer' });
    check('after the restart every account is intact',
      me(mig).level === 9 && me(exist).level === 20 && me(buyer).wins === 5500,
      `${me(mig).level} ${me(exist).level} ${me(buyer).wins}`);
    await Promise.all([leave(mig), leave(exist), leave(buyer)]);
  }
};

const SEED = {
  p_alice: profile({ level: 12, wins: 345, food: 7, pets: 'bunny*', ownedFoods: 7, legacyNote: 'keep me' }),
  'bloxity:acc-owner': profile({ level: 40, wins: 9999 }),
  p_mig: profile({ level: 9, wins: 120, pets: 'cat*', ownedFoods: 7 }),
  p_b2: profile({ level: 5, wins: 50 }),
  'bloxity:acc-exist': profile({ level: 20, wins: 2000 }),
};

const scanLogs = (server, label) => {
  // Real crashes only: an unhandled rejection, an uncaught exception, or raw stack
  // output. A HANDLED error the server logs on purpose (a corrupt file moved
  // aside, a refused join) is a structured log line and does not count.
  const bad = server.log.filter((line) => /UNHANDLED|Uncaught|^(TypeError|ReferenceError|SyntaxError|RangeError)\b|^\s+at\s/.test(line));
  check(`[${label}] no unhandled errors in the server log`, bad.length === 0, bad.slice(0, 5).join('\n'));
};

// ------------------------------------------------------------------ runs

const runJson = async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tallescape-persist-json-'));
  const downFile = path.join(dataDir, 'bloxity-down');
  const store = new JsonStorage(dataDir);
  await store.seed(SEED);
  const server = new GameServer({ port: 2591, dataDir, downFile });
  await server.start();
  try {
    await commonScenarios(server, store, 'json');

    console.log('\n[json] a corrupt profiles file is moved aside, never overwritten\n');
    await server.kill();
    const garbage = '{ this is not json, and it holds someone\'s progress';
    writeFileSync(path.join(dataDir, 'profiles.json'), garbage);
    await server.start();
    const aside = readdirSync(dataDir).find((name) => name.startsWith('profiles.json.corrupt-'));
    check('the unreadable file was moved aside', Boolean(aside));
    check('with its contents intact', aside ? readFileSync(path.join(dataDir, aside), 'utf8') === garbage : false);
    const room = await enter(server.port, { playerId: 'p_after_corrupt' });
    check('and the server still lets players in', me(room).level === 1);
    await leave(room);
    scanLogs(server, 'json');
  } finally {
    await server.kill();
  }
  if (failures === 0) rmSync(dataDir, { recursive: true, force: true });
  else console.log(`  (json data kept for inspection: ${dataDir})`);
};

const runMongo = async ({ uri, mongod }) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tallescape-persist-mongo-'));
  const downFile = path.join(dataDir, 'bloxity-down');
  const store = new MongoStorage(uri);
  await store.wipe();
  await store.seed(SEED);

  // A legacy JSON store: one new profile, one that must NOT overwrite Mongo.
  writeFileSync(
    path.join(dataDir, 'profiles.json'),
    JSON.stringify({ p_legacy: profile({ level: 7, wins: 70 }), p_alice: profile({ level: 99, wins: 99999 }) }),
  );

  const server = new GameServer({ port: 2592, dataDir, mongoUri: uri, downFile });
  await server.start();
  try {
    console.log('\n[mongo] legacy profiles.json is imported insert-only\n');
    const legacy = await waitFor(() => store.get('p_legacy'), 15000);
    check('a legacy profile is imported', legacy?.level === 7 && legacy?.wins === 70);
    const alice = await store.get('p_alice');
    check('an existing profile is never overwritten by the import', alice?.level === 12 && alice?.wins === 345);

    await commonScenarios(server, store, 'mongo');

    const again = server.log.length;
    await server.kill();
    await server.start();
    const reimport = await waitFor(() => server.since(again).find((line) => line.includes('legacy import:')), 15000);
    check('re-running the import on the next boot inserts nothing', Boolean(reimport) && reimport.includes(': 0 of'), reimport ?? '');

    if (mongod) {
      console.log('\n[mongo] database down -> joins refused, never fresh; back -> intact\n');
      await mongod.kill();
      const code = await refusedWith(server.port, { playerId: 'p_alice' });
      check('a join while the database is down is refused', code === 4503, String(code));
      const health = await fetch(`http://127.0.0.1:${server.port}/health`).then((r) => r.status).catch(() => 0);
      check('/health still answers 200 (no restart loop)', health === 200);

      // A pod can BOOT while the database is down (scale-from-zero, a deploy
      // during an outage). It must come up, refuse joins, and recover by itself.
      await server.kill();
      await server.start();
      const bootHealth = await fetch(`http://127.0.0.1:${server.port}/health`).then((r) => r.json()).catch(() => null);
      check('a server booted with the database down still starts and answers /health', bootHealth?.ok === true && bootHealth?.storageOk === false);
      check('and refuses joins rather than letting anyone in fresh', (await refusedWith(server.port, { playerId: 'p_alice' })) === 4503);
      await mongod.start();
      const room = await waitFor(() => enter(server.port, { playerId: 'p_alice' }).catch(() => null), 20000, 1000);
      check('once it is back, the same player gets their real profile', room && me(room).level === 12 && me(room).wins === 345);
      if (room) await leave(room);

      console.log('\n[mongo] a sign-out that cannot reach storage stays put; a save during the outage lands later\n');
      const session = await enter(server.port, { playerId: 'p_so', token: 'tok:acc-exist:Exist' });
      check('signed in to the account', me(session).level === 20);
      await mongod.kill();
      const mark = server.log.length;
      identify(session, '');
      await sleep(12000);
      check('the sign-out could not save, so the session stayed on the account', me(session).level === 20 && me(session).wins === 2000);
      check('logged as staying put', server.since(mark).some((line) => line.includes('STAYS on its current profile')));
      const before = me(session).food;
      await walk(session, 5);
      const earned = me(session).food;
      check('progress made during the outage', earned > before, `${before} -> ${earned}`);
      await leave(session);
      await mongod.start();
      const landed = await waitFor(async () => {
        const doc = await store.get('bloxity:acc-exist');
        return doc && doc.food >= earned ? doc : null;
      }, 40000, 500);
      check('the save made during the outage landed once the database was back', Boolean(landed), JSON.stringify(landed));
    } else {
      console.log('\n[mongo] outage tests skipped: they need MONGOD_BIN (a database this script can kill)\n');
    }
    scanLogs(server, 'mongo');
  } finally {
    await server.kill();
    await store.close();
  }
  if (failures === 0) rmSync(dataDir, { recursive: true, force: true });
};

console.log('\nPersistent progress - end to end (built server, Bloxity verify stubbed)');
// PERSIST_ONLY=mongo skips the JSON half (a test-script convenience only).
if (process.env.PERSIST_ONLY !== 'mongo') await runJson();

if (process.env.MONGOD_BIN) {
  const dbPath = mkdtempSync(path.join(tmpdir(), 'tallescape-mongod-'));
  const mongod = new Mongod(process.env.MONGOD_BIN, dbPath);
  await mongod.start();
  try {
    await runMongo({ uri: `mongodb://127.0.0.1:${MONGOD_PORT}/tall_escape_persistence_test`, mongod });
  } finally {
    await mongod.kill();
    if (!IS_WINDOWS || failures === 0) rmSync(dbPath, { recursive: true, force: true });
  }
} else if (process.env.MONGODB_URI) {
  console.log('\n!!! MONGODB_URI given: that database is being DROPPED for this test !!!');
  await runMongo({ uri: process.env.MONGODB_URI, mongod: null });
} else {
  console.log('\n(MongoDB skipped: set MONGOD_BIN or MONGODB_URI to run it)');
}

console.log(`\n${failures === 0 ? 'persistence verified' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
