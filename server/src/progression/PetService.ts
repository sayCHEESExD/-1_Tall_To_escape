import {
  PET_LIMITS,
  eggBySlot,
  encodePets,
  equipAllPets,
  equipBestPets,
  inHatchZone,
  parsePets,
  rollPet,
  type PetDefinition,
} from '@highjump/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import type { FoodService } from './FoodService.js';
import { wallet } from './Wallet.js';

export type PetRefusal = 'unknown-egg' | 'not-at-shop' | 'inventory-full' | 'too-poor' | 'bad-index' | 'equip-limit';

export interface HatchResult {
  readonly pet?: PetDefinition;
  readonly reason?: PetRefusal;
}

/**
 * Server authority over eggs and the pet inventory.
 *
 * Hatching needs the player at the Egg Shop, room in the inventory and the
 * Wins; payment is the last check, and the roll happens HERE with the server's
 * random source. Every inventory change re-derives the food rate, because
 * equipped pets multiply it.
 */
export class PetService {
  constructor(private readonly random: () => number = Math.random) {}

  hatch(player: PlayerState, slot: number, food: FoodService): HatchResult {
    const egg = eggBySlot(slot);
    if (!egg) return { reason: 'unknown-egg' };
    if (!inHatchZone(player.x, player.y, player.z)) return { reason: 'not-at-shop' };
    const pets = parsePets(player.pets);
    if (pets.length >= PET_LIMITS.maxOwned) return { reason: 'inventory-full' };
    const pet = rollPet(egg.slot, this.random);
    if (!pet) return { reason: 'unknown-egg' };
    if (!wallet.spend(player, egg.cost)) return { reason: 'too-poor' };

    // A new pet goes straight on if there is a free slot.
    const equipped = pets.filter((entry) => entry.equipped).length;
    pets.push({ id: pet.id, equipped: equipped < PET_LIMITS.maxEquipped });
    player.pets = encodePets(pets);
    food.syncDerived(player);
    return { pet };
  }

  toggle(player: PlayerState, index: number, food: FoodService): PetRefusal | null {
    const pets = parsePets(player.pets);
    const at = Math.floor(index);
    const target = pets[at];
    if (!target) return 'bad-index';
    if (!target.equipped && pets.filter((pet) => pet.equipped).length >= PET_LIMITS.maxEquipped) {
      return 'equip-limit';
    }
    pets[at] = { id: target.id, equipped: !target.equipped };
    player.pets = encodePets(pets);
    food.syncDerived(player);
    return null;
  }

  equipAll(player: PlayerState, food: FoodService): void {
    player.pets = encodePets(equipAllPets(parsePets(player.pets)));
    food.syncDerived(player);
  }

  equipBest(player: PlayerState, food: FoodService): void {
    player.pets = encodePets(equipBestPets(parsePets(player.pets)));
    food.syncDerived(player);
  }

  remove(player: PlayerState, index: number, food: FoodService): PetRefusal | null {
    const pets = parsePets(player.pets);
    const at = Math.floor(index);
    if (!pets[at]) return 'bad-index';
    pets.splice(at, 1);
    player.pets = encodePets(pets);
    food.syncDerived(player);
    return null;
  }
}
