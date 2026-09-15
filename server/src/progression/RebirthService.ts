import { canRebirth } from '@highjump/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import type { FoodService } from './FoodService.js';

/**
 * Server authority over rebirths.
 *
 * Resets level and banked food; raises the height multiplier, the food cost
 * multiplier and (through the rebirth count) the next rebirth's level
 * requirement. It grants no jumps and never touches the food per step. Wins,
 * foods, trails and pets are untouched. The client
 * sends an empty message - eligibility is decided from server state.
 */
export class RebirthService {
  rebirth(player: PlayerState, food: FoodService): boolean {
    if (!canRebirth(player.level, player.rebirths)) return false;
    player.rebirths += 1;
    player.level = 1;
    player.food = 0;
    food.syncDerived(player);
    return true;
  }
}
