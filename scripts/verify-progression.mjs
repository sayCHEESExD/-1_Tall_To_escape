/**
 * The progression tables and curves, checked without a server.
 *
 * What these get wrong is never a crash - it is a price off by a zero, a
 * height curve that no longer says level 73 is 3.6K, a pet chance table that
 * sums to 99. This suite pins every figure the design specifies.
 *
 * Run with `npm run verify:progression`.
 */
import {
  DINING_TIERS,
  EGGS,
  FOOD_TIERS,
  JUMP_HEIGHT,
  MAX_WINS,
  PETS,
  PET_LIMITS,
  REBIRTH,
  STEP_WINS,
  TRAIL_TIERS,
  bestOwnedFood,
  canRebirth,
  diningRate,
  encodePets,
  equipAllPets,
  equipBestPets,
  equippedPetIds,
  foodForNextLevel,
  foodMask,
  foodPerStepFor,
  formatNumber,
  isFoodOwned,
  legReach,
  parsePets,
  petFoodMultiplier,
  petWinsMultiplier,
  petsInEgg,
  rebirthCostMultiplier,
  rebirthHeightMultiplier,
  rebirthRequiredLevel,
  resolveFoodRate,
  resolveHeight,
  resolveJumpPhysics,
  resolveWinReward,
  rollPet,
  spendFood,
} from '../shared/dist/index.js';

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
};
const increasing = (list) => list.every((value, i) => i === 0 || value > list[i - 1]);

console.log('\nheight, food and levels\n');

check('level 73 = 3.6K height', formatNumber(resolveHeight(73)) === '3.6K', `${resolveHeight(73)}`);
check('level 74 = 3.7K height', formatNumber(resolveHeight(74)) === '3.7K', `${resolveHeight(74)}`);
check('height rises every level', increasing(Array.from({ length: 1300 }, (_, i) => resolveHeight(i + 1))));
check('level 73 needs 210 food for the next level', foodForNextLevel(73, 0) === 210, `${foodForNextLevel(73, 0)}`);
check('level 74 needs 222 food', foodForNextLevel(74, 0) === 222, `${foodForNextLevel(74, 0)}`);
check('level cost never falls', Array.from({ length: 1300 }, (_, i) => foodForNextLevel(i + 1, 0)).every((v, i, a) => i === 0 || v >= a[i - 1]));
check('level cost rises every level from 20 on', increasing(Array.from({ length: 1200 }, (_, i) => foodForNextLevel(i + 20, 0))));
check('the rebirth multiplier scales the whole cost', foodForNextLevel(73, 1) === Math.round((73 + 137) * 1.5));
{
  const cost = foodForNextLevel(1, 0) + foodForNextLevel(2, 0);
  const result = spendFood(1, cost + 1, 0);
  check('banked food is spent on as many levels as it covers', result.level === 3 && result.food === 1, JSON.stringify(result));
  check('short of a level, nothing is spent', spendFood(90, 1, 0).level === 90 && spendFood(90, 1, 0).food === 1);
}
check('leg reach grows with level', increasing(Array.from({ length: 1300 }, (_, i) => legReach(i + 1))));
check('level-1 legs are already much taller than the body', legReach(1) > 5);

console.log('\njump\n');
{
  const physics = resolveJumpPhysics(JUMP_HEIGHT);
  const apex = (physics.velocity * physics.velocity) / (2 * physics.gravity);
  check(`a jump peaks at exactly ${JUMP_HEIGHT}`, Math.abs(apex - JUMP_HEIGHT) < 1e-6, `apex ${apex}`);
}

console.log('\nrebirth\n');

check('food cost multiplier x1, x1.5, x2, x2.5', [1, 1.5, 2, 2.5].every((m, r) => rebirthCostMultiplier(r) === m));
check('and +0.5 per rebirth after that', rebirthCostMultiplier(10) === 6);
check('rebirth grants no jumps (there is no jump-count progression)', !Object.keys(REBIRTH).some((key) => /jump/i.test(key)));
check('the rebirth level requirement never falls', Array.from({ length: 30 }, (_, r) => rebirthRequiredLevel(r)).every((v, i, a) => i === 0 || v >= a[i - 1]));
check(
  'rebirth requirements climb 25, 50, 75, 100, 125 (1st to 5th rebirth)',
  [25, 50, 75, 100, 125].every((level, done) => rebirthRequiredLevel(done) === level),
  [0, 1, 2, 3, 4].map(rebirthRequiredLevel).join(', '),
);
check('every rebirth asks for more than the last', Array.from({ length: 50 }, (_, r) => rebirthRequiredLevel(r)).every((v, i, a) => i === 0 || v > a[i - 1]));
check('refused below the requirement, allowed at it', !canRebirth(24, 0) && canRebirth(25, 0));
check('height multiplier x1, x1.5, x2, x2.5 per rebirth', [1, 1.5, 2, 2.5].every((m, r) => rebirthHeightMultiplier(r) === m));
check('a rebirth multiplies the height figure', resolveHeight(73, 1) === Math.round(3599.8 * 1.5) || Math.abs(resolveHeight(73, 1) - 5400) <= 1, `${resolveHeight(73, 1)}`);
check('and the leg reach', Math.abs(legReach(50, 2) - legReach(50) * 2) < 1e-9);

console.log('\nfoods\n');

const FOOD_SPEC = [
  ['Lettuce', 1, 0], ['Bread', 3, 2], ['Apple', 10, 8], ['Lollipop', 35, 40], ['Sandwich', 125, 125],
  ['Hot Dog', 400, 600], ['Steak', 1_500, 2_500], ['Chocolate Bar', 5_000, 8_000], ['Cupcake', 18_000, 30_000],
  ['Pizza', 60_000, 100_000], ['Cake', 200_000, 400_000], ['Diamond Donut', 750_000, 1_500_000],
  ['Golden Apple', 3_000_000, 6_000_000], ['Rainbow Ice Cream', 12_000_000, 25_000_000], ['Galaxy Burger', 50_000_000, 100_000_000],
];
check('fifteen foods', FOOD_TIERS.length === FOOD_SPEC.length);
check(
  'names, food per step and prices match the spec',
  FOOD_SPEC.every(([name, perStep, cost], i) => FOOD_TIERS[i]?.name === name && FOOD_TIERS[i]?.foodPerStep === perStep && FOOD_TIERS[i]?.cost === cost),
);
check('Lettuce is owned from the start', isFoodOwned(0, 1) && bestOwnedFood(0).name === 'Lettuce' && foodPerStepFor(0) === 1);
check('the best owned food is held', bestOwnedFood(foodMask(2) | foodMask(7)).name === 'Steak');
check('food per step follows the held food', foodPerStepFor(foodMask(5)) === 125);

console.log('\ndining tables\n');

check('4 tables: 1x / 3x / 5x / 7x', [1, 3, 5, 7].every((m, i) => DINING_TIERS[i]?.multiplier === m));
check('unlocked at 0 / 2 / 5 / 10 rebirths', [0, 2, 5, 10].every((r, i) => DINING_TIERS[i]?.rebirthsRequired === r));
check('a locked table pays nothing', diningRate(2, 1) === 0 && diningRate(4, 9) === 0);
check('an unlocked table pays its multiplier', diningRate(2, 2) === 3 && diningRate(4, 10) === 7);
check('the names say Height Power', DINING_TIERS.every((t) => t.name === `${t.multiplier}x Height Power`));

console.log('\ntrails (food multiplier)\n');

const TRAIL_SPEC = [
  ['Green', 30], ['Blue', 350], ['Purple', 1_500], ['White', 8_500], ['Black', 45_000], ['Gold', 350_000],
  ['Rainbow', 1_500_000], ['Hacker', 25_000_000], ['Heaven', 500_000_000], ['Universe', 4_500_000_000],
  ['Music', 800_000_000_000],
];
check('eleven trails', TRAIL_TIERS.length === TRAIL_SPEC.length);
check('names and prices kept', TRAIL_SPEC.every(([name, cost], i) => TRAIL_TIERS[i]?.name.startsWith(name) && TRAIL_TIERS[i]?.cost === cost));
check('multipliers climb', increasing(TRAIL_TIERS.map((t) => t.multiplier)));

console.log('\neggs and pets\n');

const EGG_SPEC = [['Meadow Egg', 1_000], ['Mystery Egg', 60_000], ['Jungle Egg', 40_000_000], ['Desert Egg', 150_000_000], ['Ocean Egg', 8_000_000_000]];
check('five eggs with the spec names and prices', EGGS.length === 5 && EGG_SPEC.every(([name, cost], i) => EGGS[i]?.name === name && EGGS[i]?.cost === cost));
check('every egg holds four pets', EGGS.every((egg) => petsInEgg(egg.slot).length === 4));
check('every egg\'s chances sum to 100', EGGS.every((egg) => petsInEgg(egg.slot).reduce((s, p) => s + p.chance, 0) === 100));
check(
  'rarer pets are less likely and stronger',
  EGGS.every((egg) => {
    const pool = petsInEgg(egg.slot);
    return pool.every((p, i) => i === 0 || (p.chance < pool[i - 1].chance && p.food > pool[i - 1].food && p.wins >= pool[i - 1].wins));
  }),
);
check(
  "each egg's common pet beats the previous egg's legendary on food",
  EGGS.every((egg, i) => i === 0 || petsInEgg(egg.slot)[0].food > petsInEgg(EGGS[i - 1].slot)[3].food),
);
check('pet ids are unique', new Set(PETS.map((p) => p.id)).size === PETS.length);
check('a low roll hatches the common pet', rollPet(1, () => 0)?.rarity === 'Common');
check('a top roll hatches the legendary', rollPet(1, () => 0.9999)?.rarity === 'Legendary');
{
  const counts = new Map();
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 20_000; i += 1) {
    const pet = rollPet(2, random);
    counts.set(pet.rarity, (counts.get(pet.rarity) ?? 0) + 1);
  }
  const share = (rarity) => (counts.get(rarity) ?? 0) / 20_000;
  check('rolls follow the chance table (60/28/10/2 within 2%)', Math.abs(share('Common') - 0.6) < 0.02 && Math.abs(share('Legendary') - 0.02) < 0.01, JSON.stringify([...counts]));
}
check('3 pets equipped at most', PET_LIMITS.maxEquipped === 3);
{
  const pets = parsePets('cat*,bunny*,owl*,tiger*,kraken');
  check('parsing never equips more than three', pets.filter((p) => p.equipped).length === 3);
  check('encoding round-trips', encodePets(parsePets('cat*,bunny')) === 'cat*,bunny');
  check('unknown pets are dropped', parsePets('nope*,cat').length === 1);
  check('duplicates are separate pets', parsePets('cat,cat,cat').length === 3);
  check('bonuses of equipped pets add up', Math.abs(petFoodMultiplier('cat*,cat*') - (1 + 0.7 * 2)) < 1e-9);
  check('the best possible pets (3 Krakens) stay a modest boost: x43 food', Math.abs(petFoodMultiplier('kraken*,kraken*,kraken*') - 43) < 1e-9);
  const lollipop = FOOD_TIERS.find((f) => f.name === 'Lollipop');
  check('Lollipop with no pets or trail pays exactly its stated 35 per step', resolveFoodRate(foodMask(lollipop.slot), 0, 0, '').perStep === 35 && lollipop.foodPerStep === 35);
  check('Lollipop + Cat, Owl, Crab = 35 x 10.6 (pets are the only multiplier)', Math.abs(resolveFoodRate(foodMask(lollipop.slot), 0, 0, 'cat*,owl*,crab*').perStep - 35 * 10.6) < 1e-9);
  check('level and rebirths cannot reach the food rate (it takes no such inputs)', resolveFoodRate.length === 4);
  check('unequipped pets add nothing', petFoodMultiplier('kraken') === 1 && petWinsMultiplier('kraken') === 1);
  check('Equip Best wears the three strongest', equippedPetIds(encodePets(equipBestPets(parsePets('bunny,kraken,cat,shark,chick')))).sort().join() === 'cat,kraken,shark');
  check('Equip All fills the free slots only', encodePets(equipAllPets(parsePets('bunny*,cat,owl,tiger'))) === 'bunny*,cat*,owl*,tiger');
  check('the pets multiply win rewards', resolveWinReward(20, 'golden_fox*') === Math.floor(20 * 1.3));
  check('a win reward saturates at MAX_WINS', resolveWinReward(MAX_WINS, 'kraken*,kraken*,kraken*') === MAX_WINS);
}

console.log('\nstep rewards\n');

check('step rewards start 1, 3, 8, 20, 50, 120, 200, 400', [1, 3, 8, 20, 50, 120, 200, 400].every((w, i) => STEP_WINS[i] === w));
check('step rewards strictly increase', increasing(STEP_WINS));
check('the top step pays enough to make the Ocean Egg a goal', STEP_WINS.at(-1) >= 1_000_000_000 && STEP_WINS.at(-1) < EGGS[4].cost);

console.log('\nformatting\n');

check('formatNumber', formatNumber(940) === '940' && formatNumber(1500) === '1.5K' && formatNumber(800e9) === '800B' && formatNumber(1e12) === '1T',
  [940, 1500, 800e9, 1e12].map(formatNumber).join(' '));

console.log(`\n${failures === 0 ? 'progression verified' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
