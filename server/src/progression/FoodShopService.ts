import { foodBySlot, foodMask, foodPadAt, isFoodOwned } from '@highjump/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import type { FoodService } from './FoodService.js';
import { wallet } from './Wallet.js';

export type FoodRefusal = 'unknown-food' | 'already-owned' | 'not-on-pad' | 'too-poor';

/**
 * Server authority over the Food Shop.
 *
 * Buying is a deliberate act: the player must stand on the pedestal holding
 * the Wins. Every check runs before the payment, and the payment runs last.
 */
export class FoodShopService {
  claim(player: PlayerState, slot: number, food: FoodService): FoodRefusal | null {
    const tier = foodBySlot(slot);
    if (!tier) return 'unknown-food';
    if (isFoodOwned(player.ownedFoods, tier.slot)) return 'already-owned';
    if (foodPadAt(player.x, player.y, player.z) !== tier.slot) return 'not-on-pad';
    if (!wallet.spend(player, tier.cost)) return 'too-poor';
    player.ownedFoods |= foodMask(tier.slot);
    food.syncDerived(player);
    return null;
  }
}
