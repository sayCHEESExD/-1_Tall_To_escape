import {
  AVATAR_PROPORTION_RANGES,
  DEFAULT_AVATAR_PROPORTIONS,
  isAvatarId,
  type AvatarLook,
  type AvatarProportions,
} from '@highjump/shared';

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
  /** True for the guest profile `auth.getGuest()` builds for a player who is not signed in. */
  readonly isGuest?: boolean;
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
export type LegionProportions = AvatarProportions;

export const DEFAULT_PROPORTIONS: LegionProportions = DEFAULT_AVATAR_PROPORTIONS;

/** The documented clamp for each proportion, used by the in-game sliders. */
export const PROPORTION_RANGES = AVATAR_PROPORTION_RANGES;

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
    /** The guest profile (name, pfp) while nobody is signed in; null when signed in. */
    getGuest?(): LegionUser | null;
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

/** Bloxity's equipped ids as the replicated look spells them. */
export const toAvatarSlots = (e: LegionEquipped): Record<string, string | null | undefined> => ({
  skin: e.skinId,
  hat: e.hatId,
  back: e.backId,
  head: e.headId,
  torso: e.torsoId,
  armL: e.armLId,
  armR: e.armRId,
  legL: e.legLId,
  legR: e.legRId,
});

/** A replicated look as the SDK's own equipped ids, for `BloxityAvatar`. */
export const toLegionEquipped = (look: AvatarLook): LegionEquipped => {
  const id = (value: string | null): string | null => (isAvatarId(value) ? value : null);
  return {
    skinId: id(look.equipped.skin),
    hatId: id(look.equipped.hat),
    backId: id(look.equipped.back),
    headId: id(look.equipped.head),
    torsoId: id(look.equipped.torso),
    armLId: id(look.equipped.armL),
    armRId: id(look.equipped.armR),
    legLId: id(look.equipped.legL),
    legRId: id(look.equipped.legR),
  };
};
