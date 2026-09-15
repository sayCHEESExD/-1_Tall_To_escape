/**
 * The Bloxity SDK's shape, as this game uses it.
 *
 * The SDK ships as a plain script that installs `window.Legion`, with no types
 * of its own. These declarations are the CONTRACT this game codes against, and
 * every namespace is optional because the script comes from a third-party CDN
 * and may simply not be there - offline, blocked, or an older build.
 */

export interface LegionUser {
  readonly _id: string;
  readonly username: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly pfp?: string;
  readonly avatar?: string;
}

/**
 * A friend's presence.
 *
 * The in-game status is spelled both ways in the wild - the docs say `in-game`
 * and the reference page emits `in_game` - so anything reading it accepts both.
 */
export interface LegionPresence {
  readonly status: 'online' | 'in-game' | 'in_game' | 'away' | 'offline';
  readonly currentGame?: string;
  readonly currentRoom?: string;
  readonly currentParty?: string;
  readonly gameSlug?: string;
  readonly gameName?: string;
  readonly lastSeen?: string;
}

export interface LegionFriend {
  readonly _id: string;
  readonly username: string;
  readonly displayName?: string;
  readonly pfp?: string;
  readonly presence?: LegionPresence;
}

/** Equipped cosmetic ids. `'-1'`, `''`, `'undefined'` and null all mean NONE. */
export interface LegionEquipped {
  readonly hatId?: string | null;
  readonly backId?: string | null;
  readonly skinId?: string | null;
  readonly headId?: string | null;
  readonly armLId?: string | null;
  readonly armRId?: string | null;
  readonly legLId?: string | null;
  readonly legRId?: string | null;
  readonly torsoId?: string | null;
}

/** Avatar proportions. Every value is a multiplier defaulting to 1. */
export interface LegionProportions {
  readonly height: number;
  readonly shoulderWidth: number;
  readonly armLength: number;
  readonly legOffsetX: number;
  readonly torsoScaleX: number;
  readonly neckHeight: number;
  readonly headScale: number;
}

export const DEFAULT_PROPORTIONS: LegionProportions = {
  height: 1,
  shoulderWidth: 1,
  armLength: 1,
  legOffsetX: 1,
  torsoScaleX: 1,
  neckHeight: 1,
  headScale: 1,
};

/** The documented clamp for each proportion, used by the in-game sliders. */
export const PROPORTION_RANGES: Readonly<Record<keyof LegionProportions, readonly [number, number]>> = {
  height: [0.5, 1.6],
  shoulderWidth: [0.5, 1.5],
  armLength: [0.05, 3],
  legOffsetX: [-0.7, 5],
  torsoScaleX: [0.3, 2],
  neckHeight: [0.94, 1.2],
  headScale: [0.3, 2.6],
};

export interface LegionPurchaseResult {
  readonly success: boolean;
  readonly transactionId?: string;
  readonly error?: string;
}

export interface LegionFriendRequestResult {
  readonly success: boolean;
  readonly status?: 'accepted' | 'pending';
  readonly error?: string;
}

export interface LegionInviteLinkOptions {
  readonly gameSlug?: string;
  readonly roomId?: string;
  readonly partyId?: string;
  readonly baseUrl?: string;
  readonly ref?: string;
}

export interface LegionSdk {
  /**
   * `apiUrl` / `portalUrl` default to api.bloxity.io / bloxity.io - or to the
   * page's own origin on localhost, which is the SDK's documented behaviour.
   */
  init(options: { gameSlug: string; apiUrl?: string; portalUrl?: string }): void;

  auth?: {
    getUser(): LegionUser | null;
    getToken(): string | null;
    isLoggedIn(): boolean;
    showAuthPopup(): Promise<LegionUser | null>;
    logout(): void;
    onUserChanged(callback: (user: LegionUser | null) => void): () => void;
    authenticateWithServer(url: string): Promise<unknown | null>;
  };

  avatar?: {
    getEquipped(): LegionEquipped;
    getHatId(): string;
    getBackId(): string;
    getSkinId(): string;
    getHeadId(): string;
    getArmLId(): string;
    getArmRId(): string;
    getLegLId(): string;
    getLegRId(): string;
    getTorsoId(): string;
    getProportions(): LegionProportions;
    setProportions(partial: Partial<LegionProportions>): Promise<unknown>;
    resetProportions(): Promise<unknown>;
    onAvatarChanged(callback: (equipped: LegionEquipped) => void): () => void;
    onProportionsChanged(callback: (proportions: LegionProportions) => void): () => void;
    showCustomizer(): void;
    hideCustomizer(): void;
    toggleCustomizer(): void;
    isCustomizerOpen(): boolean;
  };

  social?: {
    getFriends(): Promise<LegionFriend[]>;
    inviteFriend(userId: string): Promise<boolean>;
    getInviteFriendsLink(options?: LegionInviteLinkOptions): string;
    sendFriendRequest(userId: string): Promise<LegionFriendRequestResult>;
  };

  settings?: {
    listen(key: string, callback: (value: string) => void): () => void;
    get(key: string): string;
    getAll(): Record<string, string>;
    onChanged(callback: (settings: Record<string, string>) => void): () => void;
    triggerAll(): void;
    refresh(): void;
  };

  game?: {
    loadingStep(text: string): void;
    loadingEnd(): void;
    gameplayStart(): void;
    gameplayEnd(): void;
    updateRoom(roomId: string, partyId?: string): void;
    playerJoined(username: string): void;
    playerInRoom(username: string): void;
  };

  player?: {
    /** The spec's event stream: `(event, data)`. */
    onEvent?(callback: (event: string, data?: unknown) => void): () => void;
    /** The reference page's per-event listeners, used when `onEvent` is absent. */
    onRespawnRequest?(callback: () => void): () => void;
    onChatMessageSent?(callback: (message: string) => void): () => void;
  };

  bux?: {
    requestPurchase(sku: string, metadata?: Record<string, unknown>): Promise<LegionPurchaseResult>;
    getBalance(): Promise<number>;
  };

  portal?: {
    isInIframe(): boolean;
    isEmbeddedInLegion(): boolean;
    requestFullscreen(): void;
    exitFullscreen(): void;
    showMenu(lockCursorOnResume?: boolean): void;
  };

  api?: {
    get(path: string): Promise<unknown>;
    post(path: string, body?: unknown): Promise<unknown>;
    patch(path: string, body?: unknown): Promise<unknown>;
    delete(path: string): Promise<unknown>;
  };
}

declare global {
  interface Window {
    Legion?: { SDK?: LegionSdk };
  }
}

/** An id is only equipped if it is a real one - exactly the reference page's test. */
export const isEquippedId = (id: string | null | undefined): id is string =>
  id != null && id !== '' && id !== '-1' && id !== 'undefined';
