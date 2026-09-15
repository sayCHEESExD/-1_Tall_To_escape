/**
 * The world, checked as data and by SIMULATION.
 *
 * The course is generated from tables, so its failure modes are silent: a
 * stair that collides and lifts the feet, a level gate sneaking back in, a win
 * pad off the edge of its step, a shop on the wrong side of the hub. This suite
 * checks the layout rules and then runs the real shared `stepPlayer` against
 * the real collision model to prove a level-1 player walks the whole staircase
 * on the floor, and that each pad is reached by legs at its recommended level.
 *
 * Run with `npm run verify:course`.
 */
import {
  BODY_RADIUS,
  CHAIR_OFFSETS,
  COURSE_END_Z,
  COURSE_SOLIDS,
  DINING,
  DINING_TIERS,
  EGG_SHOP,
  FOOD_SHOP,
  FOOD_TIERS,
  HUB,
  JUMP_HEIGHT,
  MAX_WINS,
  MOVEMENT,
  SCOREBOARD,
  SPAWN_POSITION,
  STAIRS,
  STAIR_START_Z,
  STEPS,
  STEP_WINS,
  TALL_LINE_Z,
  WALL_CLEARANCE,
  WIN_PADS,
  WorldCollision,
  canJumpAt,
  createMotion,
  createMovementInput,
  createSimEvents,
  diningSeatAt,
  foodPadAt,
  foodPadCentre,
  inHatchZone,
  isPastTallLine,
  legReach,
  resolveJumpPhysics,
  stepPlayer,
  winPadAt,
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

const JUMP = resolveJumpPhysics(JUMP_HEIGHT);
/** Legs taller than every step: the body never meets a stair face. */
const PARAMS = { jumpVelocity: JUMP.velocity, gravity: JUMP.gravity, legReach: 1e6 };
const withReach = (legReach) => ({ ...PARAMS, legReach });

console.log('\nthe staircase\n');

check('48 steps', STEPS.length === STAIRS.count && STAIRS.count === 48);
check('the first step starts at the hub edge', STEPS[0]?.minZ === STAIR_START_Z);
check('steps are one continuous stair, no gaps', STEPS.every((s, i) => i === 0 || Math.abs(s.minZ - STEPS[i - 1].maxZ) < 1e-9));
check('every step is the same width', STEPS.every((s) => s.maxX - s.minX === STAIRS.width));
check('every step is higher than the last', increasing(STEPS.map((s) => s.top)));
check(
  'recommended levels are 5, 25, 50, 75, 100, 125, 150, 175',
  [5, 25, 50, 75, 100, 125, 150, 175].every((level, i) => STEPS[i]?.recommendedLevel === level),
);
check('and climb by 25 a step all the way up', STEPS.every((s, i) => i < 2 || s.recommendedLevel - STEPS[i - 1].recommendedLevel === 25));
check('a step is reached by the legs at its recommended level', STEPS.every((s) => legReach(s.recommendedLevel) >= s.top));
check('and is roughly that tall (within 10%)', STEPS.every((s) => s.top >= legReach(s.recommendedLevel) * 0.9));

console.log('\nstair faces stop the BODY, the legs pass through, no level gates\n');

check('every step is a body-only solid from the floor to its top', STEPS.every((s) => COURSE_SOLIDS.some((c) => c.kind === 'step' && c.minZ === s.minZ && c.maxY === s.top && c.minY === 0)));
check('there are no pits or pad solids', COURSE_SOLIDS.every((s) => s.kind !== 'pit' && s.kind !== 'winPad'));
check('the walkway floor runs under the whole staircase', COURSE_SOLIDS.some((s) => s.kind === 'stairFloor' && s.minZ <= STAIR_START_Z && s.maxZ >= COURSE_END_Z && s.maxY === 0));
check('no solid carries a level', COURSE_SOLIDS.every((s) => !('requiredLevel' in s)));

const collision = new WorldCollision();
{
  // Legs taller than every step carry the body over the whole staircase.
  const motion = createMotion();
  motion.x = -8;
  const events = createSimEvents();
  const input = { moveX: 0, moveZ: 1, jump: false, cameraYaw: 0 };
  let highest = 0;
  let airborne = 0;
  // The end wall stops the body WALL_CLEARANCE from its face.
  const end = COURSE_END_Z - WALL_CLEARANCE - 0.01;
  for (let frame = 0; frame < 60 * 60 && motion.z < end; frame += 1) {
    stepPlayer(motion, input, PARAMS, 1 / 60, collision, events);
    highest = Math.max(highest, motion.y);
    if (!motion.grounded) airborne += 1;
  }
  check('legs taller than every step carry the body over the ENTIRE staircase, to the end wall', motion.z >= end, `stopped at z=${motion.z.toFixed(1)}`);
  check('the stairs never raise the feet', highest === 0, `highest ${highest}`);
  check('and the feet never leave the floor walking under them', airborne === 0, `${airborne} airborne frames`);
}
{
  // Jumping under the stairs is the ordinary jump: up and back down to the floor.
  const motion = createMotion();
  motion.z = STEPS[10].minZ + 5;
  const events = createSimEvents();
  const input = { moveX: 0, moveZ: 1, jump: false, cameraYaw: 0 };
  let peak = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    input.jump = frame < 3;
    stepPlayer(motion, input, PARAMS, 1 / 60, collision, events);
    peak = Math.max(peak, motion.y);
  }
  check('there is no jumping on the map: a press under the stairs does nothing', peak === 0 && motion.y === 0 && motion.grounded && motion.jumpCount === 0, `peak ${peak.toFixed(2)}`);
}
{
  // In the spawn area jumping works as usual.
  const motion = createMotion();
  const events = createSimEvents();
  const input = { moveX: 0, moveZ: 0, jump: false, cameraYaw: 0 };
  let peak = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    input.jump = frame < 3;
    stepPlayer(motion, input, PARAMS, 1 / 60, collision, events);
    peak = Math.max(peak, motion.y);
  }
  check('in the spawn area a jump rises the jump height and lands', Math.abs(peak - JUMP_HEIGHT) < 0.6 && motion.y === 0 && motion.grounded, `peak ${peak.toFixed(2)}`);
  check('jumping stops at the tall line', canJumpAt(TALL_LINE_Z - 0.01) && !canJumpAt(TALL_LINE_Z));
}

{
  // Walk straight into every step's front face, jumping the whole way, with
  // legs a little shorter than the step: the body must stop AT the face, the
  // feet on the floor. With legs as tall as the step, the body passes over it.
  let leaked = 0;
  let badStop = 0;
  let lifted = 0;
  let stuck = 0;
  let legsNotThrough = 0;
  for (const step of STEPS) {
    const prev = STEPS[step.index - 1];
    const startZ = prev ? prev.maxZ - 6 : STAIR_START_Z - 6;
    const walk = (legReach, jump) => {
      const motion = createMotion();
      motion.x = -8;
      motion.z = startZ;
      const events = createSimEvents();
      const input = { moveX: 0, moveZ: 1, jump: false, cameraYaw: 0 };
      let maxY = 0;
      // There is only one jump, so any height above a single jump could only
      // have come from the stairs.
      const params = withReach(legReach);
      for (let frame = 0; frame < 60 * 2; frame += 1) {
        input.jump = jump && frame % 24 < 2;
        stepPlayer(motion, input, params, 1 / 60, collision, events);
        maxY = Math.max(maxY, motion.y);
      }
      // Let a last jump land.
      input.jump = false;
      for (let frame = 0; frame < 60; frame += 1) stepPlayer(motion, input, withReach(legReach), 1 / 60, collision, events);
      return { motion, maxY };
    };
    const short = step.top - 0.5;
    for (const jump of [false, true]) {
      const { motion, maxY } = walk(short, jump);
      if (motion.z > step.minZ - BODY_RADIUS + 0.01) leaked += 1;
      else if (motion.z < step.minZ - BODY_RADIUS - 0.01) badStop += 1;
      if (motion.y !== 0 || !motion.grounded || maxY > JUMP_HEIGHT + 0.6) lifted += 1;
      // Stopped at this face, standing under the step before it: the legs, as
      // tall as `short`, run up through that lower step.
      if (prev && !(motion.z > prev.minZ && short > prev.top)) legsNotThrough += 1;
    }
    const { motion } = walk(step.top, false);
    if (motion.z < step.minZ + 2) stuck += 1;
  }
  check('legs shorter than a step: the body stops at its front face and never passes, walking or jumping', leaked === 0, `${leaked} passed a face`);
  check('and it stops exactly AT the face, not short of it', badStop === 0, `${badStop} stopped early`);
  check('the feet stay on the floor at the face (no stepping up the stair)', lifted === 0, `${lifted} lifted`);
  check('while stopped, the legs run up through the step below', legsNotThrough === 0, `${legsNotThrough}`);
  check('legs as tall as a step carry the body over its face', stuck === 0, `${stuck} stuck`);
}
{
  // Level-1 legs meet the first step's face, the same for everyone: no level
  // is checked, only where the body is.
  const motion = createMotion();
  const events = createSimEvents();
  const input = { moveX: 0, moveZ: 1, jump: false, cameraYaw: 0 };
  for (let frame = 0; frame < 60 * 4; frame += 1) stepPlayer(motion, input, withReach(legReach(1)), 1 / 60, collision, events);
  check('level-1 legs: the body stops at the first step face', Math.abs(motion.z - (STEPS[0].minZ - BODY_RADIUS)) < 0.01 && motion.y === 0, `z=${motion.z}`);
  const side = createMotion();
  side.z = STEPS[0].minZ - BODY_RADIUS;
  input.moveX = -1;
  input.moveZ = 0;
  for (let frame = 0; frame < 60; frame += 1) stepPlayer(side, input, withReach(legReach(1)), 1 / 60, collision, events);
  check('sliding sideways along a stair face is free (no sticking or shove)', side.x > 20 && Math.abs(side.z - (STEPS[0].minZ - BODY_RADIUS)) < 0.01, `x=${side.x.toFixed(2)} z=${side.z}`);
}

console.log('\nwin pads: one on EVERY step, reached by leg height\n');

check('one pad per step', WIN_PADS.length === STEPS.length && STEP_WINS.length === STEPS.length);
check('rewards start 1, 3, 8, 20, 50, 120, 200, 400', [1, 3, 8, 20, 50, 120, 200, 400].every((wins, i) => WIN_PADS[i]?.wins === wins));
check('rewards strictly increase', increasing(WIN_PADS.map((p) => p.wins)));
check('every reward is an exact integer', WIN_PADS.every((p) => Number.isSafeInteger(p.wins) && p.wins <= MAX_WINS));
{
  let badPlace = 0;
  let unreachable = 0;
  let tooEasy = 0;
  for (const pad of WIN_PADS) {
    const step = STEPS[pad.step - 1];
    const inside = pad.minX >= step.minX && pad.maxX <= step.maxX && pad.minZ >= step.minZ && pad.maxZ <= step.maxZ;
    const left = (pad.minX + pad.maxX) / 2 > 0;
    if (!inside || !left || pad.minY !== step.top) badPlace += 1;
    const cx = (pad.minX + pad.maxX) / 2;
    const cz = (pad.minZ + pad.maxZ) / 2;
    if (winPadAt(cx, 0, cz, legReach(step.recommendedLevel)) !== pad.step) unreachable += 1;
    if (winPadAt(cx, 0, cz, step.top * 0.5) !== 0) tooEasy += 1;
  }
  check("every pad sits on its own step's top, on the player's left (+X)", badPlace === 0, `${badPlace} bad`);
  check('standing under a pad with legs at its recommended level reaches it', unreachable === 0, `${unreachable} not`);
  check('legs well short of a pad do not reach it', tooEasy === 0, `${tooEasy} reached`);
}
check('taller legs still reach a low pad (reaching = at or above)', winPadAt(24, 0, (WIN_PADS[0].minZ + WIN_PADS[0].maxZ) / 2, 500) === 1);
check('the walking line down the right is never a pad', STEPS.every((s) => winPadAt(-8, 0, (s.minZ + s.maxZ) / 2, 1e6) === 0));
check('the hub has no pads', winPadAt(24, 0, SPAWN_POSITION.z, 1e6) === 0);

console.log("\nhub layout (the player's left is +X)\n");

check('spawn is inside the hub', SPAWN_POSITION.z > HUB.minZ && SPAWN_POSITION.z < HUB.maxZ);
check('15 foods, three rows of five', FOOD_TIERS.length === 15 && FOOD_SHOP.perRow === 5 && FOOD_SHOP.rowXs.length === 3);
check('the Food Shop is on the LEFT side', FOOD_TIERS.every((tier) => foodPadCentre(tier.slot).x > 20));
check(
  'every food pad is found where it is drawn',
  FOOD_TIERS.every((tier) => {
    const c = foodPadCentre(tier.slot);
    return foodPadAt(c.x, FOOD_SHOP.padTop, c.z) === tier.slot;
  }),
);
check('the scoreboards are on the RIGHT side', SCOREBOARD.x < -20 && SCOREBOARD.zs.length === 3);
check('the Dining Hall is at the BACK', DINING.centerZ < SPAWN_POSITION.z - 30);
check(
  'four dining tables: x1, x3, x5, x7 Height Power at 0, 2, 5, 10 rebirths',
  DINING_TIERS.length === 4 &&
    [0, 2, 5, 10].every((r, i) => DINING_TIERS[i].rebirthsRequired === r) &&
    [1, 3, 5, 7].every((m, i) => DINING_TIERS[i].multiplier === m),
);
check(
  'every chair is a seat of its own table',
  DINING.xs.every((x, table) => CHAIR_OFFSETS.every((c) => diningSeatAt(x + c.x, 0, DINING.centerZ + c.z) === table + 1)),
);
check('the dining mats do not overlap', DINING.xs.every((x, i) => i === 0 || Math.abs(DINING.xs[i - 1] - x) > DINING.matWidth + 2));
const zone = EGG_SHOP.zone;
check('the Egg Shop stands just before the staircase', zone.maxZ < STAIR_START_Z && zone.minZ > SPAWN_POSITION.z);
check('the hatch zone is detected', inHatchZone((zone.minX + zone.maxX) / 2, 0, (zone.minZ + zone.maxZ) / 2));
check('spawn is not in the hatch zone', !inHatchZone(SPAWN_POSITION.x, 0, SPAWN_POSITION.z));
check('the tall line is just in front of the first step face, so a body stopped there stands on long legs', TALL_LINE_Z < STAIR_START_Z - BODY_RADIUS && TALL_LINE_Z > STAIR_START_Z - 5 && SPAWN_POSITION.z < TALL_LINE_Z);
check('legs stay normal beside the stair mouth, in the hub', !isPastTallLine(STAIRS.width / 2 + 2, STAIR_START_Z - 1) && isPastTallLine(0, STAIR_START_Z - 1));
check('leg reach grows every level', increasing(Array.from({ length: 1300 }, (_, i) => legReach(i + 1))));

console.log('\nboundary walls\n');

check('the drawn player fits inside its wall clearance', WALL_CLEARANCE > BODY_RADIUS && WALL_CLEARANCE >= 1.3);
{
  // Walk, jump and push into every boundary for a long time, at any level:
  // the body must stop at the wall and stay there - never pass it.
  const runs = [
    { label: 'the left walkway wall', start: { x: 0, z: 200 }, move: { moveX: -1, moveZ: 0 }, ok: (m) => m.x <= STAIRS.width / 2 - WALL_CLEARANCE + 1e-6 && m.x >= STAIRS.width / 2 - WALL_CLEARANCE - 0.01 },
    { label: 'the right walkway wall', start: { x: 0, z: 600 }, move: { moveX: 1, moveZ: 0 }, ok: (m) => m.x >= -(STAIRS.width / 2 - WALL_CLEARANCE) - 1e-6 && m.x <= -(STAIRS.width / 2 - WALL_CLEARANCE) + 0.01 },
    { label: 'the far end wall', start: { x: 0, z: COURSE_END_Z - 30 }, move: { moveX: 0, moveZ: 1 }, ok: (m) => m.z <= COURSE_END_Z - WALL_CLEARANCE + 1e-6 && m.z >= COURSE_END_Z - WALL_CLEARANCE - 0.01 },
    { label: 'the hub side wall', start: { x: 50, z: -20 }, move: { moveX: -1, moveZ: 0 }, ok: (m) => m.x <= HUB.halfWidth - WALL_CLEARANCE + 1e-6 && m.x >= HUB.halfWidth - WALL_CLEARANCE - 0.01 },
    { label: 'the hub back wall', start: { x: 0, z: -60 }, move: { moveX: 0, moveZ: -1 }, ok: (m) => m.z >= HUB.minZ + WALL_CLEARANCE - 1e-6 && m.z <= HUB.minZ + WALL_CLEARANCE + 0.01 },
  ];
  for (const run of runs) {
    const motion = createMotion();
    motion.x = run.start.x;
    motion.z = run.start.z;
    const events = createSimEvents();
    const input = { moveX: run.move.moveX, moveZ: run.move.moveZ, jump: false, cameraYaw: 0 };
    let escaped = false;
    for (let frame = 0; frame < 60 * 8; frame += 1) {
      input.jump = frame % 30 < 2;
      stepPlayer(motion, input, PARAMS, 1 / 60, collision, events);
      if (Math.abs(motion.x) > HUB.halfWidth - WALL_CLEARANCE + 1e-6 || (motion.z >= STAIR_START_Z && Math.abs(motion.x) > STAIRS.width / 2 - WALL_CLEARANCE + 1e-6)) escaped = true;
      if (motion.z > COURSE_END_Z - WALL_CLEARANCE + 1e-6 || motion.z < HUB.minZ + WALL_CLEARANCE - 1e-6) escaped = true;
    }
    check(`${run.label}: the body stops at the wall and never passes it, walking or jumping`, !escaped && run.ok(motion), `x=${motion.x.toFixed(3)} z=${motion.z.toFixed(3)}`);
  }
  // A hub corner run into the stair mouth: no shove where the width changes.
  const motion = createMotion();
  motion.x = STAIRS.width / 2 - WALL_CLEARANCE;
  motion.z = STAIR_START_Z - 6;
  const events = createSimEvents();
  const input = { moveX: 0, moveZ: 1, jump: false, cameraYaw: 0 };
  let minX = motion.x;
  for (let frame = 0; frame < 60; frame += 1) {
    stepPlayer(motion, input, PARAMS, 1 / 60, collision, events);
    minX = Math.min(minX, motion.x);
  }
  check('walking along the hub front into the stair mouth is not shoved sideways', motion.z > STAIR_START_Z + 5 && STAIRS.width / 2 - WALL_CLEARANCE - minX < 0.01, `minX ${minX}`);
}

console.log('\npushing into a wall is stable\n');
{
  // Positions reach the client as float32, so a player stopped against a face
  // arrives a hair INSIDE it. Replaying input from there must keep them pressed
  // against the face - not shove them sideways along it (the shop-counter shake).
  const R = BODY_RADIUS;
  const stall = EGG_SHOP;
  const stallMinX = stall.x - stall.width / 2;
  const stallMaxX = stall.x + stall.width / 2;
  const stallMinZ = stall.z - stall.depth / 2;
  const stallMaxZ = stall.z + stall.depth / 2;
  const tableMinZ = DINING.centerZ - DINING.tableDepth / 2;
  const tableX = DINING.xs[1];
  const wallX = STAIRS.width / 2 + 10;
  void R;
  const cases = [
    { label: 'the egg counter, front', x: stall.x, z: stallMinZ - R, moveX: 0, moveZ: 1, axis: 'z', limit: (v) => v <= stallMinZ - R + 0.01 },
    { label: 'the egg counter, back', x: stall.x, z: stallMaxZ + R, moveX: 0, moveZ: -1, axis: 'z', limit: (v) => v >= stallMaxZ + R - 0.01 },
    { label: 'the egg counter, left end', x: stallMaxX + R, z: stall.z, moveX: 1, moveZ: 0, axis: 'x', limit: (v) => v >= stallMaxX + R - 0.01 },
    { label: 'the egg counter, right end', x: stallMinX - R, z: stall.z, moveX: -1, moveZ: 0, axis: 'x', limit: (v) => v <= stallMinX - R + 0.01 },
    { label: 'a dining table', x: tableX + 1.3, z: tableMinZ - R, moveX: 0, moveZ: 1, axis: 'z', limit: (v) => v <= tableMinZ - R + 0.01 },
    { label: 'the hub front wall', x: wallX, z: HUB.maxZ - R, moveX: 0, moveZ: 1, axis: 'z', limit: (v) => v <= HUB.maxZ - R + 0.01 },
  ];
  for (const c of cases) {
    const motion = createMotion();
    // Exactly what the client decodes from the replicated schema.
    motion.x = Math.fround(c.x);
    motion.z = Math.fround(c.z);
    motion.y = 0;
    motion.grounded = true;
    const input = createMovementInput();
    // moveX is the player's RIGHT (-X), so +X is pushed with moveX = -1.
    input.moveX = -c.moveX;
    input.moveZ = c.moveZ;
    const events = createSimEvents();
    const tangent = c.axis === 'z' ? 'x' : 'z';
    const start = motion[tangent];
    let drift = 0;
    let inside = false;
    for (let i = 0; i < 60; i += 1) {
      stepPlayer(motion, input, PARAMS, 1 / 60, collision, events);
      drift = Math.max(drift, Math.abs(motion[tangent] - start));
      if (!c.limit(motion[c.axis])) inside = true;
      // Re-quantise every step, as if each were a fresh server patch.
      motion.x = Math.fround(motion.x);
      motion.z = Math.fround(motion.z);
    }
    check(`${c.label}: no sideways shove`, drift < 0.05, `drifted ${drift.toFixed(3)} along ${tangent}`);
    check(`${c.label}: stays outside`, !inside, `${c.axis}=${motion[c.axis]}`);
  }
}

console.log('\n  step   top   recommended level   leg reach');
for (const step of STEPS.filter((s, i) => i % 6 === 0 || i === STEPS.length - 1)) {
  console.log(`  ${String(step.number).padStart(4)}  ${step.top.toFixed(1).padStart(6)}   ${String(step.recommendedLevel).padStart(6)}   ${legReach(step.recommendedLevel).toFixed(1).padStart(7)}`);
}
void MOVEMENT;

console.log(`\n${failures === 0 ? 'course verified' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
