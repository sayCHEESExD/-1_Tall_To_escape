import { MAX_WINS } from './progression.js';

/**
 * Pets: hatched from eggs at the Egg Shop, bought with Wins.
 *
 * Every egg holds four pets with rarity-weighted chances. A pet adds a FOOD
 * multiplier and a WINS multiplier while equipped; the bonuses of equipped pets
 * add up (three x2 pets make x4, not x8). A player owns at most
 * `PET_LIMITS.maxOwned` pets and equips at most `PET_LIMITS.maxEquipped`.
 *
 * The roll happens on the SERVER. The client only asks to hatch.
 */
export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';

export const RARITIES: Readonly<Record<Rarity, { readonly color: string }>> = {
  Common: { color: '#9ca3af' },
  Uncommon: { color: '#4ade80' },
  Rare: { color: '#38bdf8' },
  Epic: { color: '#a78bfa' },
  Legendary: { color: '#fbbf24' },
};

/** What a pet looks like when it follows its owner. */
export type PetBody = 'bunny' | 'bird' | 'cat' | 'dragon' | 'monkey' | 'fish' | 'bug' | 'blob';

export interface PetDefinition {
  readonly id: string;
  readonly name: string;
  readonly egg: number;
  readonly rarity: Rarity;
  /** Relative chance within its egg. The four weights of an egg sum to 100. */
  readonly chance: number;
  /** Food multiplier while equipped (x1.5 adds +50%). */
  readonly food: number;
  /** Wins multiplier while equipped. */
  readonly wins: number;
  readonly body: PetBody;
  readonly color: number;
  readonly accent: number;
}

export interface EggDefinition {
  readonly slot: number;
  readonly name: string;
  readonly cost: number;
  readonly color: number;
  readonly accent: number;
}

export const EGGS: readonly EggDefinition[] = [
  { slot: 1, name: 'Meadow Egg', cost: 1_000, color: 0x8fe07a, accent: 0xfff27a },
  { slot: 2, name: 'Mystery Egg', cost: 60_000, color: 0x9d7aff, accent: 0x3de0ff },
  { slot: 3, name: 'Jungle Egg', cost: 40_000_000, color: 0x2f9e44, accent: 0xffb13d },
  { slot: 4, name: 'Desert Egg', cost: 150_000_000, color: 0xf2d27a, accent: 0xc7702a },
  { slot: 5, name: 'Ocean Egg', cost: 8_000_000_000, color: 0x3aa8ff, accent: 0xe8fbff },
];

/**
 * THE pet table. Chances 60 / 28 / 10 / 2 in every egg; each egg's common pet
 * out-boosts the previous egg's legendary on food, so a new egg is always an
 * upgrade for the player who can afford it.
 *
 * Bonuses ADD across the three equipped pets (1 + the sum of each bonus), so
 * the very best trio - three Krakens - is x43 food and x19.5 wins. The better
 * FOODS are the main food ladder; pets are a boost on top of it, never a
 * replacement for it.
 */
export const PETS: readonly PetDefinition[] = [
  { id: 'bunny', name: 'Bunny', egg: 1, rarity: 'Common', chance: 60, food: 1.1, wins: 1.05, body: 'bunny', color: 0xf5f5f4, accent: 0xff9ecf },
  { id: 'chick', name: 'Chick', egg: 1, rarity: 'Uncommon', chance: 28, food: 1.2, wins: 1.1, body: 'bird', color: 0xffe14d, accent: 0xff9a3d },
  { id: 'lamb', name: 'Lamb', egg: 1, rarity: 'Rare', chance: 10, food: 1.35, wins: 1.15, body: 'blob', color: 0xfff7f0, accent: 0x3b4252 },
  { id: 'golden_fox', name: 'Golden Fox', egg: 1, rarity: 'Legendary', chance: 2, food: 1.6, wins: 1.3, body: 'cat', color: 0xffc933, accent: 0xffffff },

  { id: 'cat', name: 'Cat', egg: 2, rarity: 'Common', chance: 60, food: 1.7, wins: 1.35, body: 'cat', color: 0xff9a3d, accent: 0xffffff },
  { id: 'owl', name: 'Owl', egg: 2, rarity: 'Uncommon', chance: 28, food: 1.9, wins: 1.45, body: 'bird', color: 0x8a5a2b, accent: 0xffe14d },
  { id: 'ghost_cat', name: 'Ghost Cat', egg: 2, rarity: 'Epic', chance: 10, food: 2.2, wins: 1.6, body: 'cat', color: 0xdfe8ff, accent: 0x9d7aff },
  { id: 'mystic_dragon', name: 'Mystic Dragon', egg: 2, rarity: 'Legendary', chance: 2, food: 2.8, wins: 1.9, body: 'dragon', color: 0x9d7aff, accent: 0x3de0ff },

  { id: 'monkey', name: 'Monkey', egg: 3, rarity: 'Common', chance: 60, food: 3, wins: 2, body: 'monkey', color: 0x8a5a2b, accent: 0xf2c98a },
  { id: 'parrot', name: 'Parrot', egg: 3, rarity: 'Uncommon', chance: 28, food: 3.4, wins: 2.2, body: 'bird', color: 0xe8313a, accent: 0x3aa8ff },
  { id: 'tiger', name: 'Tiger', egg: 3, rarity: 'Epic', chance: 10, food: 4, wins: 2.5, body: 'cat', color: 0xff8a1f, accent: 0x14161c },
  { id: 'jungle_king', name: 'Jungle King', egg: 3, rarity: 'Legendary', chance: 2, food: 5, wins: 3, body: 'monkey', color: 0x3b4252, accent: 0xffc933 },

  { id: 'camel', name: 'Camel', egg: 4, rarity: 'Common', chance: 60, food: 5.2, wins: 3.1, body: 'blob', color: 0xd9a55a, accent: 0x8a5a2b },
  { id: 'scorpion', name: 'Scorpion', egg: 4, rarity: 'Uncommon', chance: 28, food: 5.8, wins: 3.4, body: 'bug', color: 0xc7702a, accent: 0x3b2a1a },
  { id: 'sphinx_cat', name: 'Sphinx Cat', egg: 4, rarity: 'Epic', chance: 10, food: 6.8, wins: 3.8, body: 'cat', color: 0xf2d27a, accent: 0x3aa8ff },
  { id: 'sand_dragon', name: 'Sand Dragon', egg: 4, rarity: 'Legendary', chance: 2, food: 8.5, wins: 4.5, body: 'dragon', color: 0xe8c26a, accent: 0xd6452a },

  { id: 'crab', name: 'Crab', egg: 5, rarity: 'Common', chance: 60, food: 9, wins: 4.7, body: 'bug', color: 0xe8313a, accent: 0xffd1c2 },
  { id: 'dolphin', name: 'Dolphin', egg: 5, rarity: 'Uncommon', chance: 28, food: 10, wins: 5.2, body: 'fish', color: 0x6b9ed6, accent: 0xe8fbff },
  { id: 'shark', name: 'Shark', egg: 5, rarity: 'Epic', chance: 10, food: 12, wins: 6, body: 'fish', color: 0x5c636b, accent: 0xffffff },
  { id: 'kraken', name: 'Kraken', egg: 5, rarity: 'Legendary', chance: 2, food: 15, wins: 7.5, body: 'dragon', color: 0x7b2bd6, accent: 0x3de0ff },
];

export const PET_LIMITS = {
  /** Most pets one player may own. */
  maxOwned: 40,
  /** Most pets one player may have equipped. */
  maxEquipped: 3,
} as const;

export const eggBySlot = (slot: number): EggDefinition | undefined =>
  EGGS.find((egg) => egg.slot === Math.floor(slot));

export const petById = (id: string): PetDefinition | undefined => PETS.find((pet) => pet.id === id);

export const petsInEgg = (slot: number): readonly PetDefinition[] => PETS.filter((pet) => pet.egg === Math.floor(slot));

/**
 * Roll one pet from an egg. `random` returns [0, 1): the server passes
 * `Math.random`, the tests pass fixed values.
 */
export const rollPet = (slot: number, random: () => number): PetDefinition | undefined => {
  const pool = petsInEgg(slot);
  const total = pool.reduce((sum, pet) => sum + pet.chance, 0);
  const value = random();
  let roll = (Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999) : 0) * total;
  for (const pet of pool) {
    roll -= pet.chance;
    if (roll < 0) return pet;
  }
  return pool[pool.length - 1];
};

/** One inventory entry. */
export interface OwnedPet {
  readonly id: string;
  readonly equipped: boolean;
}

/**
 * The pet inventory travels as ONE string, e.g. `"cat*,bunny,cat*"` (`*` marks
 * equipped; duplicates are separate pets). A single replicated field changes
 * the player's own onChange, where a nested schema array would not, and it
 * persists as-is.
 */
export const parsePets = (encoded: string): OwnedPet[] => {
  if (typeof encoded !== 'string' || encoded.length === 0) return [];
  const out: OwnedPet[] = [];
  for (const part of encoded.split(',')) {
    const equipped = part.endsWith('*');
    const id = equipped ? part.slice(0, -1) : part;
    if (!petById(id) || out.length >= PET_LIMITS.maxOwned) continue;
    out.push({ id, equipped });
  }
  // Never more equipped than allowed, whatever the source string said.
  let equippedCount = 0;
  return out.map((pet) => {
    if (!pet.equipped) return pet;
    equippedCount += 1;
    return equippedCount <= PET_LIMITS.maxEquipped ? pet : { id: pet.id, equipped: false };
  });
};

export const encodePets = (pets: readonly OwnedPet[]): string =>
  pets.map((pet) => `${pet.id}${pet.equipped ? '*' : ''}`).join(',');

/** Ids of the equipped pets, in inventory order. */
export const equippedPetIds = (encoded: string): string[] =>
  parsePets(encoded)
    .filter((pet) => pet.equipped)
    .map((pet) => pet.id);

const sumBonus = (encoded: string, pick: (pet: PetDefinition) => number): number =>
  1 +
  parsePets(encoded).reduce((sum, owned) => {
    const pet = owned.equipped ? petById(owned.id) : undefined;
    return sum + (pet ? Math.max(0, pick(pet) - 1) : 0);
  }, 0);

/** Food multiplier of the equipped pets: 1 + the sum of each pet's bonus. */
export const petFoodMultiplier = (encoded: string): number => sumBonus(encoded, (pet) => pet.food);

/** Wins multiplier of the equipped pets. */
export const petWinsMultiplier = (encoded: string): number => sumBonus(encoded, (pet) => pet.wins);

/** How pets are ranked for Equip Best: food first, wins breaks ties. */
const score = (id: string): number => {
  const pet = petById(id);
  return pet ? pet.food * 1000 + pet.wins : 0;
};

/** Equip the best `PET_LIMITS.maxEquipped` pets, unequip the rest. */
export const equipBestPets = (pets: readonly OwnedPet[]): OwnedPet[] => {
  const ranked = pets
    .map((pet, index) => ({ index, score: score(pet.id) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, PET_LIMITS.maxEquipped)
    .map((entry) => entry.index);
  return pets.map((pet, index) => ({ id: pet.id, equipped: ranked.includes(index) }));
};

/** Fill every free equip slot with unequipped pets, in inventory order. */
export const equipAllPets = (pets: readonly OwnedPet[]): OwnedPet[] => {
  let free = PET_LIMITS.maxEquipped - pets.filter((pet) => pet.equipped).length;
  return pets.map((pet) => {
    if (pet.equipped || free <= 0) return pet;
    free -= 1;
    return { id: pet.id, equipped: true };
  });
};

/** THE win reward calculation: base pad value times the equipped pets, saturated. */
export const resolveWinReward = (base: number, pets: string): number => {
  const value = Number.isFinite(base) ? Math.max(0, Math.floor(base)) : 0;
  return Math.min(Math.floor(value * petWinsMultiplier(pets)), MAX_WINS);
};
