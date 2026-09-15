import type { MapSchema } from '@colyseus/schema';

/**
 * Client-side TYPE mirror of the server's Colyseus schema. Types only -
 * colyseus.js builds the instances from the handshake reflection.
 */
export interface NetPlayerState {
  sessionId: string;
  /** The Bloxity display name (or guest name, or "Guest"). Never an internal id. */
  displayName: string;
  /** Bloxity avatar thumbnail, or '' for the default. */
  avatarUrl: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  speed: number;
  verticalVelocity: number;
  grounded: boolean;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  lastInputSeq: number;
  jumpLatched: boolean;
  coyote: number;
  jumpCount: number;
  dining: number;

  level: number;
  food: number;
  lifetimeFood: number;
  rebirths: number;
  wins: number;
  playSeconds: number;

  height: number;
  legReach: number;
  jumpVelocity: number;
  gravity: number;
  foodPerStep: number;

  ownedFoods: number;
  ownedTrails: number;
  trailSlot: number;
  pets: string;

  ready: boolean;
}

export interface NetLeaderEntry {
  /** Bloxity display name; '' for an empty row. */
  name: string;
  avatarUrl: string;
  value: number;
}

/**
 * Who this client is, as Bloxity says: a token for a signed-in account (the
 * server verifies it against `gameSlug`), otherwise a guest with the SDK's
 * guest avatar thumbnail.
 */
export interface IdentityPayload {
  token: string | null;
  gameSlug: string;
  guestAvatar: string;
}

export interface NetLeaderboardState {
  wins: ArrayLike<NetLeaderEntry>;
  height: ArrayLike<NetLeaderEntry>;
  time: ArrayLike<NetLeaderEntry>;
}

export interface NetGameState {
  players: MapSchema<NetPlayerState>;
  leaderboard: NetLeaderboardState;
}

export interface LeaderboardSnapshot {
  wins: readonly NetLeaderEntry[];
  height: readonly NetLeaderEntry[];
  time: readonly NetLeaderEntry[];
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
