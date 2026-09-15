import {
  MessageType,
  ROOM_NAME,
  type BloxityIdentityMessage,
  type ClaimWinMessage,
  type IndexMessage,
  type MoveMessage,
  type PetHatchedMessage,
  type RespawnMessage,
  type SlotMessage,
  type WinAwardedMessage,
} from '@highjump/shared';
import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import { clientConfig } from '../config/clientConfig.js';
import { logger } from '../util/logger.js';
import type {
  ConnectionStatus,
  IdentityPayload,
  LeaderboardSnapshot,
  NetGameState,
  NetLeaderEntry,
  NetPlayerState,
} from './netTypes.js';

const SCOPE = 'NetworkClient';
const PLAYER_ID_KEY = 'tallescape.playerId';

/**
 * Backoff between join attempts. A cold managed host takes a while to wake, and
 * a single attempt would turn that into a session that is permanently offline.
 */
const JOIN_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A stable id for this browser, so progression survives a reload. */
const resolvePlayerId = (): string => {
  const fresh = `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  try {
    const existing = window.localStorage.getItem(PLAYER_ID_KEY);
    if (existing) return existing;
    window.localStorage.setItem(PLAYER_ID_KEY, fresh);
  } catch {
    return fresh;
  }
  return fresh;
};

export interface NetworkHandlers {
  onStatusChange?(status: ConnectionStatus, detail?: string): void;
  onSelfJoined?(sessionId: string): void;
  onPlayerAdded?(sessionId: string, player: NetPlayerState): void;
  onPlayerChanged?(sessionId: string, player: NetPlayerState): void;
  onPlayerRemoved?(sessionId: string): void;
  onRespawn?(message: RespawnMessage): void;
  onWinAwarded?(message: WinAwardedMessage): void;
  onPetHatched?(message: PetHatchedMessage): void;
}

/**
 * Thin wrapper over colyseus.js. The rest of the client never imports it.
 * Every method that sends anything sends a REQUEST; nothing here grants.
 */
export class NetworkClient {
  /** Built on connect, so an unconfigured build reports the real cause. */
  private client: Client | null = null;
  private room: Room<NetGameState> | null = null;

  /**
   * Where the join gets the Bloxity identity from. A callback rather than a
   * stored value, so a logout between two joins can never send the previous token.
   */
  private identity: (() => IdentityPayload) | null = null;

  constructor(private readonly handlers: NetworkHandlers = {}) {}

  /** Where to read the Bloxity identity at join time. */
  setIdentityProvider(provider: () => IdentityPayload): void {
    this.identity = provider;
  }

  /** Tell the room about a login, logout or new avatar that happened after joining. */
  sendIdentity(identity: IdentityPayload): void {
    const message: BloxityIdentityMessage = {
      token: identity.token ?? '',
      gameSlug: identity.gameSlug,
      guestAvatar: identity.guestAvatar,
    };
    this.room?.send(MessageType.BloxityIdentity, message);
  }

  /** The Colyseus room id, or '' when not in one. */
  get roomId(): string {
    return this.room?.roomId ?? '';
  }

  get sessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  async connect(): Promise<void> {
    if (!clientConfig.serverUrl) {
      this.handlers.onStatusChange?.('error');
      throw new Error(
        'No game server is configured. Set VITE_SERVER_URL to the Colyseus endpoint and rebuild.',
      );
    }

    this.handlers.onStatusChange?.('connecting');
    logger.info(SCOPE, `joining "${ROOM_NAME}" at ${clientConfig.serverUrl}`);
    this.client ??= new Client(clientConfig.serverUrl);
    const playerId = resolvePlayerId();
    const attempts = JOIN_BACKOFF_MS.length + 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const identity = this.identity?.();
        this.room = await this.client.joinOrCreate<NetGameState>(ROOM_NAME, {
          playerId,
          // Optional. Verified by the server with Bloxity, never trusted as-is.
          bloxityToken: identity?.token ?? undefined,
          // The slug an in-game token was issued for, so the server can verify it.
          gameSlug: identity?.gameSlug || undefined,
          // Display only, for a guest; accepted by the server only as a Bloxity image.
          guestAvatar: identity?.guestAvatar || undefined,
        });
        break;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(SCOPE, `join attempt ${attempt}/${attempts} failed: ${detail}`);
        if (attempt === attempts) {
          this.handlers.onStatusChange?.('error', detail);
          throw error;
        }
        await sleep(JOIN_BACKOFF_MS[attempt - 1] ?? 0);
      }
    }
    if (!this.room) throw new Error('join produced no room');

    this.bindRoom(this.room);
    this.handlers.onStatusChange?.('connected');
    logger.info(SCOPE, `joined roomId=${this.room.roomId} sessionId=${this.room.sessionId}`);
    this.handlers.onSelfJoined?.(this.room.sessionId);
  }

  /** Every simulated input is sent: the server advances only by what it receives. */
  sendInput(message: MoveMessage): void {
    this.room?.send(MessageType.Move, message);
  }

  claimWin(step: number): void {
    const message: ClaimWinMessage = { step };
    this.room?.send(MessageType.ClaimWin, message);
  }

  requestRebirth(): void {
    this.room?.send(MessageType.Rebirth, {});
  }

  requestRespawn(): void {
    this.room?.send(MessageType.RequestRespawn, {});
  }

  sendSlot(type: MessageType, slot: number): void {
    const message: SlotMessage = { slot };
    this.room?.send(type, message);
  }

  sendIndex(type: MessageType, index: number): void {
    const message: IndexMessage = { index };
    this.room?.send(type, message);
  }

  /** A request that carries nothing: Equip All, Equip Best. */
  sendEmpty(type: MessageType): void {
    this.room?.send(type, {});
  }

  /** The boards, COPIED out of the schema so a renderer never holds a live reference. */
  get leaderboard(): LeaderboardSnapshot | null {
    const board = this.room?.state?.leaderboard;
    if (!board) return null;
    const copy = (rows: ArrayLike<NetLeaderEntry>): NetLeaderEntry[] => {
      const out: NetLeaderEntry[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (row) out.push({ name: row.name, avatarUrl: row.avatarUrl, value: row.value });
      }
      return out;
    };
    return { wins: copy(board.wins), height: copy(board.height), time: copy(board.time) };
  }

  async disconnect(): Promise<void> {
    await this.room?.leave(true);
    this.room = null;
    this.handlers.onStatusChange?.('disconnected');
  }

  private bindRoom(room: Room<NetGameState>): void {
    const $ = getStateCallbacks(room);
    $(room.state).players.onAdd((player, sessionId) => {
      this.handlers.onPlayerAdded?.(sessionId, player);
      $(player).onChange(() => this.handlers.onPlayerChanged?.(sessionId, player));
    });
    $(room.state).players.onRemove((_player, sessionId) => this.handlers.onPlayerRemoved?.(sessionId));
    room.onMessage<RespawnMessage>(MessageType.Respawn, (message) => this.handlers.onRespawn?.(message));
    room.onMessage<WinAwardedMessage>(MessageType.WinAwarded, (message) =>
      this.handlers.onWinAwarded?.(message),
    );
    room.onMessage<PetHatchedMessage>(MessageType.PetHatched, (message) => this.handlers.onPetHatched?.(message));
    room.onError((code, message) => {
      logger.error(SCOPE, `room error ${code}: ${message ?? ''}`);
      this.handlers.onStatusChange?.('error', message);
    });
    room.onLeave((code) => {
      logger.warn(SCOPE, `left room (code ${code})`);
      this.handlers.onStatusChange?.('disconnected', `code ${code}`);
    });
  }
}
