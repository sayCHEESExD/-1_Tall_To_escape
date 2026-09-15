/**
 * The server's decisions, exercised without a server.
 *
 * Every rule here is about somebody's Wins, food or pets, and the failure mode
 * of getting one wrong is a player paid twice, charged twice, or granted
 * something from across the map. The REJECTION paths are tested as carefully
 * as the happy ones.
 *
 * Run with `npm run verify:services`.
 */
import {
  DINING,
  EGGS,
  EGG_SHOP,
  FOOD_TIERS,
  PETS,
  PET_LIMITS,
  STEPS,
  TRAIL_TIERS,
  WIN_PADS,
  foodPadCentre,
  legReach,
  resolveHeight,
} from '../shared/dist/index.js';
import { CosmeticService, TRAIL_BINDING } from '../server/dist/progression/CosmeticService.js';
import { FoodService } from '../server/dist/progression/FoodService.js';
import { FoodShopService } from '../server/dist/progression/FoodShopService.js';
import { PetService } from '../server/dist/progression/PetService.js';
import { RebirthService } from '../server/dist/progression/RebirthService.js';
import { wallet } from '../server/dist/progression/Wallet.js';
import { WinService } from '../server/dist/progression/WinService.js';

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
};

/** A stand-in for the replicated schema: the services only read and write fields. */
const makePlayer = (over = {}) => ({
  sessionId: `p${Math.random()}`,
  x: 0, y: 0, z: -8, grounded: true, dining: 0, jumpCount: 0,
  level: 1, food: 0, lifetimeFood: 0, rebirths: 0, wins: 0,
  height: 10, legReach: 8, jumpVelocity: 40, gravity: 100, foodPerStep: 1,
  ownedFoods: 1, ownedTrails: 0, trailSlot: 0, pets: '',
  ...over,
});

const food = new FoodService();
const zone = EGG_SHOP.zone;
const atHatchery = { x: (zone.minX + zone.maxX) / 2, y: 0, z: (zone.minZ + zone.maxZ) / 2 };

console.log('\nwin pads: once per attempt\n');
{
  const wins = new WinService();
  const pad = WIN_PADS[3];
  // The feet on the floor under the step, the legs as tall as the step recommends.
  const onPad = { x: (pad.minX + pad.maxX) / 2, y: 0, z: (pad.minZ + pad.maxZ) / 2, legReach: legReach(STEPS[3].recommendedLevel) };
  const player = makePlayer();

  check('a claim from spawn is refused', wins.claim(player, 4, 0).reason === 'not-on-pad');
  Object.assign(player, onPad);
  check('a claim for a different step is refused', wins.claim(player, 5, 0).reason === 'not-on-pad');
  check('an unknown step is refused', wins.claim(player, 99, 0).reason === 'unknown-step');
  check('a fractional step is refused', wins.claim(player, 4.5, 0).reason === 'unknown-step');
  const short = makePlayer({ ...onPad, legReach: 8 });
  check('standing under the pad with legs too short to reach it is refused', wins.claim(short, 4, 0).reason === 'not-on-pad' && short.wins === 0);
  const jumping = makePlayer({ ...onPad, grounded: false });
  check('a claim mid-air is refused', wins.claim(jumping, 4, 0).reason === 'not-on-pad');
  check('and nothing was paid', player.wins === 0);

  const paid = wins.claim(player, 4, 10_000);
  check('standing on the pad pays', paid.granted === true);
  check(`step 4 pays exactly ${STEPS[3].wins}`, player.wins === STEPS[3].wins, `wins=${player.wins}`);
  check('standing on it again pays nothing (already claimed this attempt)', wins.claim(player, 4, 60_000).reason === 'already-claimed');
  check('and pays nothing', player.wins === STEPS[3].wins);

  const next = WIN_PADS[4];
  Object.assign(player, { x: (next.minX + next.maxX) / 2, y: 0, z: (next.minZ + next.maxZ) / 2, legReach: legReach(STEPS[4].recommendedLevel) });
  check('a second pad inside the cooldown is refused', wins.claim(player, 5, 10_500).reason === 'cooldown');

  wins.startAttempt(player.sessionId);
  Object.assign(player, onPad);
  check('a new attempt (placed at spawn) can claim the pad again', wins.claim(player, 4, 70_000).granted === true);
  check('and it pays again, once', player.wins === STEPS[3].wins * 2);

  const lucky = makePlayer({ ...onPad, pets: 'golden_fox*' });
  new WinService().claim(lucky, 4, 0);
  check('equipped pets multiply the reward', lucky.wins === Math.floor(STEPS[3].wins * 1.3), `wins=${lucky.wins}`);
  const lazy = makePlayer({ ...onPad, pets: 'golden_fox' });
  new WinService().claim(lazy, 4, 0);
  check('an unequipped pet multiplies nothing', lazy.wins === STEPS[3].wins);
}

console.log('\nfood shop\n');
{
  const shop = new FoodShopService();
  const player = makePlayer({ wins: 100 });
  food.initialise(player);
  check('food cannot be bought from spawn', shop.claim(player, 2, food) === 'not-on-pad');
  check('and nothing is deducted', player.wins === 100);
  check('Lettuce is already owned', shop.claim(player, 1, food) === 'already-owned');

  const pad3 = foodPadCentre(3);
  Object.assign(player, { x: pad3.x, y: 0.35, z: pad3.z });
  check('standing on pad 3 does not buy food 2', shop.claim(player, 2, food) === 'not-on-pad');
  player.wins = 5;
  check('food cannot be bought without the Wins', shop.claim(player, 3, food) === 'too-poor');
  check('and nothing is deducted', player.wins === 5);
  player.wins = 20;
  check('on the pad with the Wins, it sells', shop.claim(player, 3, food) === null);
  check('the price is deducted exactly once', player.wins === 20 - FOOD_TIERS[2].cost);
  check("food per step becomes the food's", player.foodPerStep === FOOD_TIERS[2].foodPerStep);
  check('the same food cannot be bought twice', shop.claim(player, 3, food) === 'already-owned');
}

console.log('\ntrails\n');
{
  const trails = new CosmeticService(TRAIL_BINDING);
  const player = makePlayer({ wins: 29 });
  food.initialise(player);
  check('a trail cannot be bought short of its price', trails.buy(player, 1, food) === false && player.wins === 29);
  player.wins = 1000;
  check('a trail can be bought', trails.buy(player, 1, food) === true);
  check('its price is deducted', player.wins === 1000 - TRAIL_TIERS[0].cost);
  check('it is worn immediately', player.trailSlot === 1);
  check('it multiplies food per step', player.foodPerStep === TRAIL_TIERS[0].multiplier);
  check('an unowned trail cannot be worn', trails.equip(player, 3, food) === false && player.trailSlot === 1);
  check('taking it off is allowed', trails.equip(player, 0, food) === true && player.foodPerStep === 1);
}

console.log('\neggs and pets\n');
{
  let roll = 0;
  const pets = new PetService(() => roll);
  const player = makePlayer({ wins: 100_000 });
  food.initialise(player);

  check('eggs cannot be hatched away from the Egg Shop', pets.hatch(player, 1, food).reason === 'not-at-shop');
  Object.assign(player, atHatchery);
  check('an unknown egg is refused', pets.hatch(player, 9, food).reason === 'unknown-egg');
  player.wins = 999;
  check('an egg cannot be hatched without the Wins', pets.hatch(player, 1, food).reason === 'too-poor' && player.wins === 999);
  player.wins = 100_000;

  const first = pets.hatch(player, 1, food);
  check('a hatch rolls a pet from that egg', first.pet?.id === 'bunny');
  check('its price is deducted', player.wins === 100_000 - EGGS[0].cost);
  check('the new pet is equipped while there is room', player.pets === 'bunny*');
  check('and multiplies food per step', Math.abs(player.foodPerStep - 1.1) < 1e-9, `${player.foodPerStep}`);

  roll = 0.9999;
  check('a lucky roll hatches the legendary', pets.hatch(player, 1, food).pet?.id === 'golden_fox');
  roll = 0.7;
  pets.hatch(player, 1, food);
  roll = 0.1;
  pets.hatch(player, 1, food);
  check('a fourth pet is kept but not equipped', player.pets.split(',').length === 4 && player.pets.split('*').length - 1 === PET_LIMITS.maxEquipped, player.pets);
  check('equipping past three is refused', pets.toggle(player, 3, food) === 'equip-limit');
  check('a pet can be unequipped', pets.toggle(player, 0, food) === null && !player.pets.startsWith('bunny*'));
  check('Equip All fills the free slot', (pets.equipAll(player, food), player.pets.split('*').length - 1 === 3));
  check('Equip Best wears the strongest', (pets.equipBest(player, food), player.pets.includes('golden_fox*')));
  const before = player.foodPerStep;
  check('a pet can be deleted', pets.remove(player, 1, food) === null && player.pets.split(',').length === 3);
  check('deleting an equipped pet lowers the food rate', player.foodPerStep < before);
  check('deleting a missing index is refused', pets.remove(player, 12, food) === 'bad-index');

  const full = makePlayer({ ...atHatchery, wins: 1e9, pets: Array.from({ length: PET_LIMITS.maxOwned }, () => 'cat').join(',') });
  check('a full inventory refuses and charges nothing', pets.hatch(full, 1, food).reason === 'inventory-full' && full.wins === 1e9);
  check('every pet in the table can be parsed back', PETS.every((pet) => makePlayer({ pets: `${pet.id}*` }).pets.length > 0));
}

console.log('\nfood and levels\n');
{
  const player = makePlayer();
  food.initialise(player);
  food.credit(player.sessionId, player, 1 / 60);
  check('the first credit only takes a baseline', player.food === 0);

  player.z += 0.5;
  food.credit(player.sessionId, player, 1 / 60);
  check('walking with food pays', player.food > 0, `food=${player.food}`);

  const still = player.lifetimeFood;
  for (let i = 0; i < 30; i += 1) food.credit(player.sessionId, player, 1 / 60);
  check('standing still pays nothing', player.lifetimeFood === still);

  player.jumpCount += 1;
  food.credit(player.sessionId, player, 1 / 60);
  check('jumping on the spot pays nothing', player.lifetimeFood === still);

  player.z += 400;
  food.credit(player.sessionId, player, 1 / 60);
  check('a teleport pays nothing', player.lifetimeFood === still);

  food.grant(player, 1_000_000);
  check('banked food is spent on levels automatically', player.level > 50, `level ${player.level}`);
  check('height follows the level', player.height === resolveHeight(player.level));
  check('leg reach follows the level', Math.abs(player.legReach - legReach(player.level)) < 1e-4);

  const table = (index, rebirths) => {
    const x = DINING.xs[index - 1] - DINING.chairOffsetX;
    const diner = makePlayer({ x, y: 0, z: DINING.centerZ - DINING.chairOffsetZ, dining: index, rebirths });
    food.initialise(diner);
    food.credit(diner.sessionId, diner, 1 / 60);
    food.credit(diner.sessionId, diner, 1 / 60);
    return diner.lifetimeFood;
  };
  check('the 1x table pays while seated, standing still', table(1, 0) > 0);
  check('a locked table pays nothing', table(4, 0) === 0);
  check('the 7x table pays x7 the 1x table', Math.abs(table(4, 10) - table(1, 10) * 7) < 1e-9, `${table(4, 10)} vs ${table(1, 10)}`);

  // The reported bug: Lollipop (35/step) paying ~1.3K. A full stride with the
  // food alone pays exactly 35, whatever the level, height or rebirths.
  const lollipop = FOOD_TIERS.find((f) => f.name === 'Lollipop');
  const stride = (over) => {
    const walker = makePlayer({ ownedFoods: 2 ** lollipop.slot - 1, ...over });
    food.initialise(walker);
    food.credit(walker.sessionId, walker, 1 / 60);
    for (let i = 0; i < 20; i += 1) {
      walker.z += 1;
      food.credit(walker.sessionId, walker, 0.1);
    }
    return walker.lifetimeFood;
  };
  check('Lollipop pays exactly 35 per step with no bonuses', Math.abs(stride({}) - 35) < 1e-9, `${stride({})}`);
  check('level 105 and 3 rebirths do not multiply food', Math.abs(stride({ level: 105, rebirths: 3, height: 1e5, legReach: 900 }) - 35) < 1e-9);
  check('only the equipped pets multiply it (Cat + Owl + Crab = x10.6)', Math.abs(stride({ pets: 'cat*,owl*,crab*', rebirths: 3 }) - 35 * 10.6) < 1e-9);
}

console.log('\nrebirth\n');
{
  const rebirths = new RebirthService();
  const player = makePlayer({ wins: 500, ownedFoods: 7, pets: 'cat*', level: 24 });
  food.initialise(player);
  check('refused below the required level', rebirths.rebirth(player, food) === false && player.rebirths === 0);
  player.level = 25;
  player.food = 40;
  const rateBefore = player.foodPerStep;
  check('allowed at it', rebirths.rebirth(player, food) === true);
  check('level and food reset', player.level === 1 && player.food === 0);
  check('no jump is granted (there is no jump count)', !('maxJumps' in player));
  check('the food rate is unchanged by rebirth', player.foodPerStep === rateBefore, `${rateBefore} -> ${player.foodPerStep}`);
  check('height and legs reset with the level, now x1.5 taller', player.height === resolveHeight(1, 1) && Math.abs(player.legReach - legReach(1) * 1.5) < 1e-4);
  player.level = 49;
  check('the second rebirth is refused at level 49 (it needs 50)', rebirths.rebirth(player, food) === false && player.rebirths === 1);
  player.level = 50;
  check('and allowed at level 50', rebirths.rebirth(player, food) === true && player.rebirths === 2 && player.level === 1);
  player.level = 74;
  check('the third needs 75', rebirths.rebirth(player, food) === false && ((player.level = 75), rebirths.rebirth(player, food)) === true && player.rebirths === 3);
  check('wins, foods and pets are kept', player.wins === 500 && player.ownedFoods === 7 && player.pets === 'cat*');
}

console.log('\nthe wallet\n');
{
  const player = makePlayer({ wins: 10 });
  check('spend what you have', wallet.spend(player, 10) === true && player.wins === 0);
  check('cannot spend what you do not have', wallet.spend(player, 1) === false && player.wins === 0);
  wallet.add(player, Number.NaN);
  wallet.add(player, -5);
  check('bad credits are ignored', player.wins === 0);
  player.wins = Number.MAX_SAFE_INTEGER - 5;
  wallet.add(player, 1e12);
  check('a huge award saturates', player.wins === Number.MAX_SAFE_INTEGER);
}

console.log(`\n${failures === 0 ? 'services verified' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
