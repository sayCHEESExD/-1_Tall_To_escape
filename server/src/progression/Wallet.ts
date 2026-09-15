import { MAX_WINS } from '@highjump/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/**
 * The ONE place Wins are added or removed.
 *
 * Win pads and Bux grants add; foods, trails and eggs spend. Three shops must
 * not become three ways to take payment, so every one of them goes through here.
 */
export const wallet = {
  /** Credit Wins, saturating at the ceiling. Returns what was actually added. */
  add(player: PlayerState, amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const before = player.wins;
    player.wins = Math.min(MAX_WINS, Math.floor(before + amount));
    return player.wins - before;
  },

  canAfford(player: PlayerState, cost: number): boolean {
    if (!Number.isFinite(cost) || cost < 0) return false;
    return player.wins >= Math.floor(cost);
  },

  /** Deduct Wins. False, and nothing changes, when the player cannot afford it. */
  spend(player: PlayerState, cost: number): boolean {
    if (!Number.isFinite(cost) || cost < 0) return false;
    const price = Math.floor(cost);
    if (player.wins < price) return false;
    player.wins -= price;
    return true;
  },
};
