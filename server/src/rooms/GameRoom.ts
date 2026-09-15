import { Client, Room, ServerError } from '@colyseus/core';
import {
  MAX_PLAYERS_PER_ROOM,
  MessageType,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  GUEST_NAME,
  normalizeAvatarUrl,
  sanitizeDisplayName,
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
import { verifyBloxityToken } from '../bloxity/bloxityIdentity.js';
import { buxGrants } from '../bloxity/buxGrantsStore.js';
import { serverConfig } from '../config/serverConfig.js';
import { MovementService } from '../movement/MovementService.js';
import { CosmeticService, TRAIL_BINDING } from '../progression/CosmeticService.js';
import { FoodService } from '../progression/FoodService.js';
import { FoodShopService } from '../progression/FoodShopService.js';
import { leaderboardService } from '../progression/LeaderboardService.js';
import { PetService } from '../progression/PetService.js';
import { profileStore } from '../progression/ProfileStore.js';
import { RebirthService } from '../progression/RebirthService.js';
import { wallet } from '../progression/Wallet.js';
import { WinService } from '../progression/WinService.js';
import { logger } from '../util/logger.js';
import { GameState } from './state/GameState.js';
import { PlayerState } from './state/PlayerState.js';

const SCOPE = 'GameRoom';

/** Seconds between autosaves of every connected player. */
const AUTOSAVE_SECONDS = 15;

/** Milliseconds between two shop/menu requests from one player. */
const REQUEST_COOLDOWN_MS = 150;

interface JoinOptions {
  playerId?: string;
  /** A Bloxity token, verified by the server with Bloxity. Never an id. */
  bloxityToken?: string;
  /** Without a token: the Bloxity guest name and thumbnail, display only. */
  guestName?: string;
  guestAvatar?: string;
}

/**
 * The authoritative room.
 *
 * Composition only: every rule lives in a service, and this decides the order
 * they run in. The one hard rule: nothing a client sends is ever copied into
 * state. A Move is simulated, a claim is validated, a purchase is checked, and
 * each produces a result the server writes itself.
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

  private readonly playerIds = new Map<string, string>();
  private readonly lastRequest = new Map<string, number>();
  private autosaveTimer = 0;

  /**
   * VERIFIED Bloxity account id per session, for Bux fulfilment. Only ever
   * written from a token Bloxity itself resolved, so a grant can only reach the
   * account that paid for it.
   */
  private readonly bloxityIds = new Map<string, string>();
  /** Latest identity check per session, so a stale verification cannot win a race. */
  private readonly identityChecks = new Map<string, number>();

  override onCreate(): void {
    this.setState(new GameState());
    this.setPatchRate(serverConfig.patchRateMs);

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
      this.resolveIdentity(client.sessionId, message && typeof message === 'object' ? message : { token: '' }),
    );

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), serverConfig.patchRateMs);
    logger.info(SCOPE, `room ${this.roomId} created (capacity ${MAX_PLAYERS_PER_ROOM})`);
  }

  /** Capacity re-checked at the door, independent of the matchmaker's reservation. */
  override onAuth(): boolean {
    if (this.clients.length >= MAX_PLAYERS_PER_ROOM) {
      throw new ServerError(4103, 'room is full');
    }
    return true;
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const player = new PlayerState();
    player.sessionId = client.sessionId;

    const playerId = typeof options.playerId === 'string' ? options.playerId.slice(0, 64) : '';
    if (playerId) this.playerIds.set(client.sessionId, playerId);

    // Restore BEFORE deriving: height, leg reach and rates follow from it.
    const restored = playerId ? profileStore.restore(playerId, player) : false;

    this.state.players.set(client.sessionId, player);
    this.movement.initialise(player);
    this.food.initialise(player);
    this.placeAt(client, player, 'join');

    // Who they are. A token is verified in the background - a join must not
    // wait on a round trip to Bloxity - and until it answers, a returning
    // player keeps the name they were last saved with.
    this.resolveIdentity(client.sessionId, {
      token: typeof options.bloxityToken === 'string' ? options.bloxityToken : '',
      guestName: options.guestName,
      guestAvatar: options.guestAvatar,
    });

    logger.info(
      SCOPE,
      `join ${client.sessionId} (${restored ? 'restored' : 'new'}) level=${player.level} ` +
        `wins=${player.wins} rebirths=${player.rebirths} (${this.clients.length}/${MAX_PLAYERS_PER_ROOM})`,
    );
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    this.persist(client.sessionId, player);
    this.state.players.delete(client.sessionId);
    this.movement.forget(client.sessionId);
    this.food.forget(client.sessionId);
    this.winService.forget(client.sessionId);
    this.playerIds.delete(client.sessionId);
    this.lastRequest.delete(client.sessionId);
    this.bloxityIds.delete(client.sessionId);
    this.identityChecks.delete(client.sessionId);
    logger.info(SCOPE, `leave ${client.sessionId} (${this.clients.length} left)`);
  }

  override onDispose(): void {
    for (const [sessionId, player] of this.state.players) this.persist(sessionId, player);
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
    this.persist(client.sessionId, player);
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
    this.persist(client.sessionId, player);
  }

  private tick(delta: number): void {
    leaderboardService.update(delta, this.state.leaderboard, this.state.players, this.playerIds);

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

    // Bux bought by someone already in the room. One boolean in the common case.
    if (buxGrants.hasPending) {
      for (const [sessionId, player] of this.state.players) this.applyGrants(sessionId, player);
    }

    this.autosaveTimer += delta;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      for (const [sessionId, player] of this.state.players) this.persist(sessionId, player);
    }
  }

  /**
   * Resolve who this player is - the name and avatar everyone sees - and hand
   * over anything their account bought.
   *
   * With a token, Bloxity is asked, and the account's display name and avatar
   * thumbnail become the player's. Without one (or with one Bloxity refuses)
   * the player is a Bloxity guest, shown by the guest name and thumbnail the SDK
   * gave them, or as `GUEST_NAME`; a guest is never given a Bloxity id, so
   * nothing they send reaches anyone's Bux. Internal ids are never shown.
   * Every call supersedes the one before it, so a slow verification of an old
   * token can never overwrite a newer answer.
   */
  private resolveIdentity(sessionId: string, message: Partial<BloxityIdentityMessage>): void {
    const check = (this.identityChecks.get(sessionId) ?? 0) + 1;
    this.identityChecks.set(sessionId, check);
    const token = typeof message.token === 'string' ? message.token : '';

    if (!token) {
      this.bloxityIds.delete(sessionId);
      const player = this.state.players.get(sessionId);
      if (player) this.showAsGuest(sessionId, player, message);
      return;
    }

    void verifyBloxityToken(token, serverConfig.bloxityApiBase).then((user) => {
      if (this.identityChecks.get(sessionId) !== check) return;
      const player = this.state.players.get(sessionId);
      if (!player) return;
      if (!user) {
        this.bloxityIds.delete(sessionId);
        this.showAsGuest(sessionId, player, message);
        return;
      }
      this.bloxityIds.set(sessionId, user.id);
      player.displayName = sanitizeDisplayName(user.displayName) || sanitizeDisplayName(user.username) || GUEST_NAME;
      player.avatarUrl = user.avatarUrl;
      logger.info(SCOPE, `${sessionId} verified with Bloxity as "${player.displayName}"`);
      this.persist(sessionId, player);
      this.applyGrants(sessionId, player);
    });
  }

  /** A guest: their Bloxity guest name and thumbnail, cleaned, or plain `GUEST_NAME`. */
  private showAsGuest(sessionId: string, player: PlayerState, message: Partial<BloxityIdentityMessage>): void {
    player.displayName = sanitizeDisplayName(message.guestName) || GUEST_NAME;
    player.avatarUrl = normalizeAvatarUrl(message.guestAvatar);
    this.persist(sessionId, player);
  }

  /**
   * Hand over purchases waiting for this player's verified account. Through
   * `wallet.add` like every other award, and saved immediately.
   */
  private applyGrants(sessionId: string, player: PlayerState): void {
    const bloxityId = this.bloxityIds.get(sessionId);
    if (!bloxityId) return;
    const grants = buxGrants.drain(bloxityId);
    if (grants.length === 0) return;
    for (const grant of grants) {
      wallet.add(player, grant.wins);
      logger.info(SCOPE, `granted ${grant.sku} to ${sessionId} (+${grant.wins} wins) [${grant.transactionId}]`);
    }
    this.persist(sessionId, player);
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

  private persist(sessionId: string, player: PlayerState | undefined): void {
    const playerId = this.playerIds.get(sessionId);
    if (player && playerId) profileStore.save(playerId, player);
  }
}
