import { Client, Room, ServerError, type Delayed } from '@colyseus/core';
import {
  MAX_PLAYERS_PER_ROOM,
  MessageType,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  normalizeAvatarUrl,
  resolveShownName,
  sanitizeAvatarLook,
  type BloxityIdentityMessage,
  type ClaimWinMessage,
  type IndexMessage,
  type MoveMessage,
  type PetHatchedMessage,
  type RespawnMessage,
  type RespawnReason,
  type SlotMessage,
  type WinAwardedMessage,
} from '@highjump/shared';
import { tokenHash, type Verification, type VerifiedBloxityUser } from '../bloxity/BloxityVerifier.js';
import { grantEvents } from '../bloxity/buxWebhook.js';
import { serverConfig } from '../config/serverConfig.js';
import { MovementService } from '../movement/MovementService.js';
import { resolveProfileTarget, type ProfileTarget } from '../progression/AccountResolver.js';
import { CosmeticService, TRAIL_BINDING } from '../progression/CosmeticService.js';
import { FoodService } from '../progression/FoodService.js';
import { FoodShopService } from '../progression/FoodShopService.js';
import { leaderboardService } from '../progression/LeaderboardService.js';
import { PetService } from '../progression/PetService.js';
import { accountKey, guestKey, ReservedKeyError } from '../progression/profileKeys.js';
import { ProfileService } from '../progression/ProfileService.js';
import { RebirthService } from '../progression/RebirthService.js';
import { wallet } from '../progression/Wallet.js';
import { WinService } from '../progression/WinService.js';
import { grantStore, profileService, verifier } from '../runtime.js';
import { logger } from '../util/logger.js';
import { GameState } from './state/GameState.js';
import { PlayerState } from './state/PlayerState.js';

const SCOPE = 'GameRoom';

/** Seconds between autosaves of every connected player. */
const AUTOSAVE_SECONDS = 15;

/** Seconds between checks for purchases recorded by OTHER pods. */
const GRANT_POLL_SECONDS = 10;

/** Milliseconds between two shop/menu requests from one player. */
const REQUEST_COOLDOWN_MS = 150;

/** The longest a mid-session sign-in or sign-out waits on storage before staying put. */
const SWITCH_TIMEOUT_MS = 8000;

/** Re-verification delays after Bloxity was unavailable. The last one repeats. */
const REVERIFY_MS = [5000, 15000, 30000, 60000, 120000, 300000] as const;

/** Join refused because storage could not be read. The client's backoff retries it. */
export const STORAGE_UNAVAILABLE = 4503;
/** Join refused because the browser id used the reserved account prefix. */
export const RESERVED_ID = 4401;

interface JoinOptions {
  /** This browser's guest id (localStorage). Never trusted as an account. */
  playerId?: string;
  /** The Bloxity portal TOKEN, verified with Bloxity. Never an account id. */
  bloxityToken?: string;
  /** What Bloxity's SDK says this player is, display only. */
  name?: string;
  avatarUrl?: string;
  /** The Bloxity avatar being worn, display only. */
  look?: string;
}

/** What `onAuth` settles before a player is let in; Colyseus hands it to `onJoin`. */
interface AuthResult {
  readonly guestKey: string | null;
  readonly token: string;
  readonly verification: Verification | null;
  readonly target: ProfileTarget;
}

/** One connected player's identity and where their progress is saved. */
interface Session {
  readonly guestKey: string | null;
  /** Where this session saves: an account key, the guest key, or null (unsaved). */
  key: string | null;
  /** The VERIFIED account, or null. Purchases are drained against this and nothing else. */
  accountId: string | null;
  user: VerifiedBloxityUser | null;
  /** Hash of the token the current identity came from; '' for none. */
  tokenHash: string;
  /** The latest display data (name, picture, avatar) from the client. */
  display: Partial<BloxityIdentityMessage>;
  /** True while switching profiles: this session's autosaves are blocked. */
  switching: boolean;
  /** The newest login that arrived mid-switch; older ones are dropped. */
  queued: Partial<BloxityIdentityMessage> | null;
  draining: boolean;
  retry: Delayed | null;
  retryAttempt: number;
}

const tokenOf = (message: Partial<BloxityIdentityMessage>): string =>
  typeof message.token === 'string' ? message.token : '';

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)),
  ]);

/**
 * The authoritative room.
 *
 * Composition only: every rule lives in a service, and this decides the order
 * they run in. The one hard rule: nothing a client sends is ever copied into
 * state. A Move is simulated, a claim is validated, a purchase is checked, and
 * each produces a result the server writes itself.
 *
 * Who a player IS is settled before they are let in (`onAuth`): the portal token
 * is verified with Bloxity and their profile is READ FROM STORAGE there, so a
 * signed-in player gets their account's progress on any browser or pod, and a
 * storage outage refuses the join instead of starting them on an empty profile.
 */
export class GameRoom extends Room<GameState> {
  override maxClients = MAX_PLAYERS_PER_ROOM;

  /**
   * An empty room CLOSES ITSELF. Written out even though it is the Colyseus
   * default, because it is a requirement of this game.
   */
  override autoDispose = true;

  private readonly movement = new MovementService();
  private readonly food = new FoodService();
  private readonly winService = new WinService();
  private readonly rebirths = new RebirthService();
  private readonly foodShop = new FoodShopService();
  private readonly trails = new CosmeticService(TRAIL_BINDING);
  private readonly pets = new PetService();

  private readonly sessions = new Map<string, Session>();
  private readonly lastRequest = new Map<string, number>();
  private autosaveTimer = 0;
  private grantTimer = 0;

  /** Purchases recorded on THIS pod reach a player here at once. */
  private readonly onGrantRecorded = (accountId: string): void => {
    for (const [sessionId, session] of this.sessions) {
      if (session.accountId === accountId) void this.applyGrants(sessionId);
    }
  };

  override onCreate(): void {
    this.setState(new GameState());
    this.setPatchRate(serverConfig.patchRateMs);
    grantEvents.on('recorded', this.onGrantRecorded);

    this.onMessage(MessageType.Move, (client, message: MoveMessage) => this.onMove(client, message));
    this.onMessage(MessageType.RequestRespawn, (client) => this.respawn(client, 'manual'));
    this.onMessage(MessageType.ClaimWin, (client, message: ClaimWinMessage) =>
      this.onClaimWin(client, message),
    );
    this.onMessage(MessageType.Rebirth, (client) =>
      this.request(client, (player) => {
        if (!this.rebirths.rebirth(player, this.food)) return;
        this.placeAt(client, player, 'rebirth');
        logger.info(SCOPE, `${client.sessionId} rebirthed to ${player.rebirths}`);
      }),
    );
    this.onMessage(MessageType.BuyFood, (client, message: SlotMessage) =>
      this.request(client, (player) => {
        if (this.foodShop.claim(player, Number(message?.slot), this.food) === null) {
          logger.info(SCOPE, `${client.sessionId} bought food ${message.slot}`);
        }
      }),
    );
    this.onMessage(MessageType.BuyTrail, (client, message: SlotMessage) =>
      this.request(client, (player) => this.trails.buy(player, Number(message?.slot), this.food)),
    );
    this.onMessage(MessageType.EquipTrail, (client, message: SlotMessage) =>
      this.request(client, (player) => this.trails.equip(player, Number(message?.slot), this.food)),
    );
    this.onMessage(MessageType.HatchEgg, (client, message: SlotMessage) =>
      this.request(client, (player) => {
        const result = this.pets.hatch(player, Number(message?.slot), this.food);
        if (!result.pet) return;
        const payload: PetHatchedMessage = { egg: Math.floor(Number(message.slot)), pet: result.pet.id };
        client.send(MessageType.PetHatched, payload);
        logger.info(SCOPE, `${client.sessionId} hatched ${result.pet.id} from egg ${payload.egg}`);
      }),
    );
    this.onMessage(MessageType.TogglePet, (client, message: IndexMessage) =>
      this.request(client, (player) => this.pets.toggle(player, Number(message?.index), this.food)),
    );
    this.onMessage(MessageType.EquipAllPets, (client) =>
      this.request(client, (player) => this.pets.equipAll(player, this.food)),
    );
    this.onMessage(MessageType.EquipBestPets, (client) =>
      this.request(client, (player) => this.pets.equipBest(player, this.food)),
    );
    this.onMessage(MessageType.DeletePet, (client, message: IndexMessage) =>
      this.request(client, (player) => this.pets.remove(player, Number(message?.index), this.food)),
    );

    this.onMessage(MessageType.BloxityIdentity, (client, message: BloxityIdentityMessage) =>
      this.onIdentity(client, message && typeof message === 'object' ? message : { token: '' }),
    );

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), serverConfig.patchRateMs);
    logger.info(SCOPE, `room ${this.roomId} created (capacity ${MAX_PLAYERS_PER_ROOM})`);
  }

  /**
   * The door. Capacity is re-checked, the token (if any) is verified with
   * Bloxity, and the profile is read from STORAGE - so everything `onJoin`
   * needs is settled before the player is in the room.
   *
   * A storage failure REFUSES the join (the client's backoff retries it): a
   * player let in on an empty profile would autosave over their real one.
   */
  override async onAuth(_client: Client, options: JoinOptions = {}): Promise<AuthResult> {
    if (this.clients.length >= MAX_PLAYERS_PER_ROOM) throw new ServerError(4103, 'room is full');

    let guest: string | null;
    try {
      guest = guestKey(options.playerId);
    } catch (error) {
      if (error instanceof ReservedKeyError) {
        logger.warn(SCOPE, 'join refused: a browser id tried to use the reserved account prefix');
        throw new ServerError(RESERVED_ID, 'invalid player id');
      }
      throw error;
    }

    const token = typeof options.bloxityToken === 'string' ? options.bloxityToken : '';
    const verification = token ? await verifier.verify(token) : null;
    try {
      const target = await resolveProfileTarget(profileService, verification, guest);
      return { guestKey: guest, token, verification, target };
    } catch (error) {
      logger.error(SCOPE, `join REFUSED - progress storage unavailable (${String(error)})`);
      throw new ServerError(STORAGE_UNAVAILABLE, 'progress storage unavailable, retrying');
    }
  }

  override onJoin(client: Client, options: JoinOptions = {}, auth?: AuthResult): void {
    if (!auth) throw new ServerError(STORAGE_UNAVAILABLE, 'join without authentication');
    const { target, verification, token } = auth;

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    // Restore BEFORE deriving: height, leg reach and rates follow from it.
    ProfileService.apply(player, target.profile);

    const session: Session = {
      guestKey: auth.guestKey,
      key: target.key,
      accountId: target.accountId,
      user: target.user,
      tokenHash: token ? tokenHash(token) : '',
      display: { token, name: options.name, avatarUrl: options.avatarUrl, look: options.look },
      switching: false,
      queued: null,
      draining: false,
      retry: null,
      retryAttempt: 0,
    };
    this.sessions.set(client.sessionId, session);

    this.state.players.set(client.sessionId, player);
    this.movement.initialise(player);
    this.food.initialise(player);
    this.placeAt(client, player, 'join');
    this.applyDisplay(player, session);

    if (verification?.status === 'unavailable') this.scheduleReverify(client, token);
    if (session.accountId) void this.applyGrants(client.sessionId);

    logger.info(
      SCOPE,
      `join ${client.sessionId} as ${target.note}${verification ? ` [bloxity: ${verification.status}]` : ''} ` +
        `level=${player.level} wins=${player.wins} rebirths=${player.rebirths} ` +
        `(${this.clients.length}/${MAX_PLAYERS_PER_ROOM})`,
    );
  }

  override onLeave(client: Client): void {
    const session = this.sessions.get(client.sessionId);
    this.persist(client.sessionId);
    session?.retry?.clear();
    this.sessions.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.movement.forget(client.sessionId);
    this.food.forget(client.sessionId);
    this.winService.forget(client.sessionId);
    this.lastRequest.delete(client.sessionId);
    logger.info(SCOPE, `leave ${client.sessionId} (${this.clients.length} left)`);
  }

  override onDispose(): void {
    grantEvents.off('recorded', this.onGrantRecorded);
    for (const sessionId of this.sessions.keys()) this.persist(sessionId);
    logger.info(SCOPE, `room ${this.roomId} disposed (empty)`);
  }

  /** Simulate an input, then pay for the movement it actually produced. */
  private onMove(client: Client, message: MoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!this.movement.applyInput(client.sessionId, player, message)) return;
    this.food.credit(client.sessionId, player, this.movement.lastStep);
  }

  private onClaimWin(client: Client, message: ClaimWinMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const result = this.winService.claim(player, Number(message?.step), Date.now());
    if (!result.granted) {
      if (result.reason !== 'cooldown' && result.reason !== 'already-claimed') {
        logger.warn(
          SCOPE,
          `win claim ${message?.step} refused for ${client.sessionId} (${result.reason}) at ` +
            `(${player.x.toFixed(1)}, ${player.y.toFixed(1)}, ${player.z.toFixed(1)})`,
        );
      }
      return;
    }

    const payload: WinAwardedMessage = {
      step: Math.floor(Number(message.step)),
      wins: result.wins,
      total: player.wins,
    };
    client.send(MessageType.WinAwarded, payload);
    // Banking a win ends the attempt. No checkpoints: straight back to spawn.
    this.placeAt(client, player, 'win');
    this.persist(client.sessionId);
    logger.info(SCOPE, `step ${payload.step} banked by ${client.sessionId} (+${result.wins})`);
  }

  /** Rate-limited wrapper for every menu and shop request. */
  private request(client: Client, action: (player: PlayerState) => unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const now = Date.now();
    if (now - (this.lastRequest.get(client.sessionId) ?? 0) < REQUEST_COOLDOWN_MS) return;
    this.lastRequest.set(client.sessionId, now);
    action(player);
    this.persist(client.sessionId);
  }

  private tick(delta: number): void {
    leaderboardService.update(delta, this.state.leaderboard, this.state.players, this.sessionKeys(), profileService.boardEntries());

    for (const [sessionId, player] of this.state.players) {
      player.playSeconds += delta;
      if (!player.ready) continue;
      // Missing a step never moves anyone - gaps have floors. This only rescues
      // a player a glitch has left outside the world entirely.
      if (this.movement.collision.isOutOfWorld(player.y)) {
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) this.respawn(client, 'outOfWorld');
      }
    }

    // Purchases recorded on another pod (this pod's arrive through `grantEvents`).
    this.grantTimer += delta;
    if (this.grantTimer >= GRANT_POLL_SECONDS) {
      this.grantTimer = 0;
      for (const [sessionId, session] of this.sessions) if (session.accountId) void this.applyGrants(sessionId);
    }

    this.autosaveTimer += delta;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      for (const sessionId of this.sessions.keys()) this.persist(sessionId);
    }
  }

  private sessionKeys(): Map<string, string> {
    const keys = new Map<string, string>();
    for (const [sessionId, session] of this.sessions) if (session.key) keys.set(sessionId, session.key);
    return keys;
  }

  // -------------------------------------------------------------- identity

  /**
   * A login, logout or account switch on the LIVE session - deliberately not a
   * reconnect, which could land on another pod before this one's last write
   * reached the database.
   *
   * Display data (name, picture, worn avatar) always applies at once. A changed
   * TOKEN switches profile; an unchanged one is display only.
   */
  private onIdentity(client: Client, message: Partial<BloxityIdentityMessage>): void {
    const session = this.sessions.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!session || !player) return;

    session.display = message;
    this.applyDisplay(player, session);

    const token = tokenOf(message);
    if ((token ? tokenHash(token) : '') === session.tokenHash) return;
    if (session.switching) {
      // Only the newest login counts: it replaces anything already waiting.
      session.queued = message;
      return;
    }
    void this.switchIdentity(client, token);
  }

  /**
   * Move a live session to the profile a login resolves to.
   *
   * While switching, the session's autosaves are blocked. The profile being LEFT
   * is saved from live state and waited for; the new one is read (migrating this
   * browser's live guest progress into an account that has none). Then the same
   * initialisation `onJoin` runs, pending purchases, a place at spawn, a save.
   * If storage fails at any point the session STAYS on its current profile.
   */
  private async switchIdentity(client: Client, token: string): Promise<void> {
    const sessionId = client.sessionId;
    const session = this.sessions.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!session || !player) return;

    session.switching = true;
    session.retry?.clear();
    session.retry = null;
    let switched = false;
    try {
      const verification = token ? await verifier.verify(token) : null;
      if (this.sessions.get(sessionId) !== session) return;

      const live = ProfileService.snapshot(player);
      const leaving = session.key;
      if (leaving) await withTimeout(profileService.put(leaving, live), SWITCH_TIMEOUT_MS, 'saving the profile being left');

      const liveGuest = leaving !== null && leaving === session.guestKey ? live : undefined;
      const target = await withTimeout(
        resolveProfileTarget(profileService, verification, session.guestKey, liveGuest),
        SWITCH_TIMEOUT_MS,
        'reading the new profile',
      );
      if (this.sessions.get(sessionId) !== session) return;

      switched = target.key !== session.key || target.accountId !== session.accountId;
      if (switched) {
        ProfileService.apply(player, target.profile);
        this.food.initialise(player);
        this.placeAt(client, player, 'account');
      }
      session.key = target.key;
      session.accountId = target.accountId;
      session.user = target.user;
      session.tokenHash = token ? tokenHash(token) : '';
      if (verification?.status === 'unavailable') this.scheduleReverify(client, token);
      else session.retryAttempt = 0;
      this.applyDisplay(player, session);
      logger.info(
        SCOPE,
        `${sessionId} ${switched ? 'switched to' : 'stays on'} ${target.note}` +
          `${verification ? ` [bloxity: ${verification.status}]` : ' [signed out]'} level=${player.level}`,
      );
    } catch (error) {
      switched = false;
      logger.warn(SCOPE, `${sessionId} STAYS on its current profile - ${String(error)}`);
    } finally {
      session.switching = false;
    }

    if (switched) {
      void this.applyGrants(sessionId);
      this.persist(sessionId);
    }
    const queued = session.queued;
    session.queued = null;
    if (queued && this.sessions.get(sessionId) === session) this.onIdentity(client, queued);
  }

  /** Bloxity could not answer: stay a guest for now, and ask again on a backoff. */
  private scheduleReverify(client: Client, token: string): void {
    const session = this.sessions.get(client.sessionId);
    if (!session || !token) return;
    session.retry?.clear();
    const delay = REVERIFY_MS[Math.min(session.retryAttempt, REVERIFY_MS.length - 1)] ?? 300000;
    session.retryAttempt += 1;
    session.retry = this.clock.setTimeout(() => {
      session.retry = null;
      if (this.sessions.get(client.sessionId) !== session || session.switching) return;
      // Still the same login? Then verify it again; a newer one supersedes it.
      if (tokenOf(session.display) !== token) return;
      session.tokenHash = '';
      void this.switchIdentity(client, token);
    }, delay);
    logger.info(SCOPE, `${client.sessionId}: Bloxity unavailable - playing as a guest, re-verifying in ${delay / 1000}s`);
  }

  /**
   * Name, picture and worn avatar. The name is what the SERVER verified, else
   * what Bloxity's SDK reported to the client, else "Guest" (`resolveShownName`).
   */
  private applyDisplay(player: PlayerState, session: Session): void {
    const message = session.display;
    player.avatar = sanitizeAvatarLook(message.look);
    const user = session.user;
    player.displayName = resolveShownName(user ? user.displayName || user.username : '', message.name);
    player.avatarUrl = user?.avatarUrl || normalizeAvatarUrl(message.avatarUrl);
  }

  // ------------------------------------------------------------- purchases

  /**
   * Hand over purchases waiting for this session's VERIFIED account - the only
   * account a grant is ever drained against. Claimed atomically in storage, so
   * no other pod can apply the same grant. If the session has moved on by the
   * time the claim returns, the Wins go into the account's stored profile.
   */
  private async applyGrants(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const accountId = session?.accountId;
    if (!session || !accountId || session.draining || session.switching) return;
    session.draining = true;
    try {
      const grants = await grantStore.drain(accountId);
      if (grants.length === 0) return;
      const wins = grants.reduce((sum, grant) => sum + grant.wins, 0);
      const player = this.state.players.get(sessionId);
      if (player && this.sessions.get(sessionId) === session && session.accountId === accountId) {
        wallet.add(player, wins);
        this.persist(sessionId);
      } else {
        await this.creditStored(accountKey(accountId), wins);
      }
      for (const grant of grants) {
        logger.info(SCOPE, `granted ${grant.sku} to account session ${sessionId} (+${grant.wins} wins) [${grant.transactionId}]`);
      }
    } catch (error) {
      logger.warn(SCOPE, `purchases for ${sessionId} not drained yet (${String(error)}); will retry`);
    } finally {
      session.draining = false;
    }
  }

  /** Credit Wins to a stored profile whose player is no longer here. */
  private async creditStored(key: string, wins: number): Promise<void> {
    for (;;) {
      try {
        const profile = await profileService.get(key);
        const base = profile ?? ProfileService.snapshot(new PlayerState());
        await profileService.put(key, { ...base, wins: base.wins + wins, updatedAt: Date.now() });
        return;
      } catch (error) {
        logger.warn(SCOPE, `crediting ${wins} wins to ${key} waits for storage (${String(error)})`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private respawn(client: Client, reason: RespawnReason): void {
    const player = this.state.players.get(client.sessionId);
    if (player) this.placeAt(client, player, reason);
  }

  /**
   * THE one way a player is placed, and there is exactly ONE destination: the
   * hub spawn. This takes no position for that reason - a placement that could
   * land elsewhere is a checkpoint system waiting to be reintroduced. Every
   * placement starts a fresh attempt, so each win pad can pay again once.
   */
  private placeAt(client: Client, player: PlayerState, reason: RespawnReason): void {
    const from = `(${player.x.toFixed(1)}, ${player.y.toFixed(1)}, ${player.z.toFixed(1)})`;
    this.movement.teleport(
      client.sessionId,
      player,
      SPAWN_POSITION.x,
      SPAWN_POSITION.y,
      SPAWN_POSITION.z,
      SPAWN_ROTATION_Y,
    );
    this.food.reset(client.sessionId, player);
    this.winService.startAttempt(client.sessionId);

    const message: RespawnMessage = {
      x: SPAWN_POSITION.x,
      y: SPAWN_POSITION.y,
      z: SPAWN_POSITION.z,
      rotationY: SPAWN_ROTATION_Y,
      reason,
    };
    client.send(MessageType.Respawn, message);
    if (reason !== 'join') logger.info(SCOPE, `place ${client.sessionId} ${from} -> spawn (${reason})`);
  }

  /** Queue a save of this session's live state. Blocked mid-switch, and for an unsaved session. */
  private persist(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!session || !player || !session.key || session.switching) return;
    void profileService.save(session.key, player);
  }
}
