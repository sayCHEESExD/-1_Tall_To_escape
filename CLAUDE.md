# CLAUDE.md — +1 Tall Escape

Permanent project rules. Read before changing anything.

## What this is

A production browser multiplayer staircase obby, the next game in the series
after `+1 Backflip Obby Escape`, `+1 Speed Animal Escape`, `+1 Speed Broom Escape`,
`+1 Speed Moonwalk Escape` and `+1 High Jump Power Escape` (this repo started as a
copy of the last one). It reuses their architecture: npm workspaces (`shared`,
`server`, `client` — the package scope is still `@highjump/*`), Three.js + Vite
client, Colyseus server, server-authoritative movement with client prediction and
reconciliation.

The gameplay: **Food → Level → Height**. Walking while holding food eats it and
banks food; food buys levels; the level sets the player's **height** figure and
their **leg reach**. Past the tall line the legs grow to that reach. The player
walks along the floor UNDER one clean staircase (+Z); the legs lift the body up
to the step heights, and a step's win pad is claimed when the legs reach it.

## Hard constraints

- Client build under **12 MB** (`npm run size:client`).
- Progression, rewards, purchases, hatching and inventories are
  **server-authoritative**. The client only sends input and requests.
- Desktop and mobile are both first-class.
- Ports **2571** (server) and **5177** (Vite): the earlier games use 2567-2570 and
  5173-5176 on the same machine.
- Rooms hold `MAX_PLAYERS_PER_ROOM` (15); `onAuth` re-checks it; `autoDispose` is
  explicit so an empty room closes.

## Movement, legs and steps

- `stepPlayer` in `shared/src/sim/PlayerSim.ts` is THE simulation, run by the server
  and by client prediction. Never add a second physics implementation.
- **The tall line** is `TALL_LINE_Z`, 3 units in front of the first step's face.
  `isPastTallLine(x, z)` (past the line AND within the staircase width) is where the
  legs are long: drawn `legReach(level)` long.
- **Boundary walls always stop the body.** `clampToBounds` keeps the player
  `WALL_CLEARANCE` (the half-width of the drawn body, arms, stilts and shoes) from the
  hub walls, the walkway side walls and the far end wall, every substep, on the server
  and in prediction. The hub front wall solids are aligned to the same clearance. The
  walls are LOW on purpose (hub 26, walkway 24, as in the reference look) - a tall body
  shows above them, but the clamp still holds it inside. Stilts stay thin enough to fit
  the clearance, and pets are clamped inside the walls.
- **Stair faces stop the BODY; the legs pass through.** Each step is a `step` solid
  from the floor to its top that collides with the body only. The body's base is
  `bodyBaseAt(x, z, legReach)` = the top of the legs past the tall line (0 behind it),
  independent of jumping. `resolveAxis` stops the body at any step whose top is above
  that base; steps are never stood on, never raise the feet, and never touch the legs.
  A `stairFloor` solid runs under the whole staircase at y = 0 and the feet stay on it.
  `SimParams.legReach` carries the server's reach. Never make the whole player ignore
  the stairs, and never add a step-up.
- **There are NO level gates.** Nothing checks a level. A step's `recommendedLevel`
  (5, then 25 per step) is a sign; what stops a body is only where the body is.
  `verify-course` walks into every step face, walking and jumping.
- Step tops are `legReach(recommendedLevel) * STAIRS.reachFraction`, so legs at the
  recommended level just reach the step.
- **There is exactly ONE jump.** A fixed `JUMP_HEIGHT` (not progression), from the
  ground or coyote time only - no air jumps, no double jump, no jump count, no backflip.
  Nothing (rebirth, level, height, pets) grants another. It works ONLY in the spawn area
  (`canJumpAt`: behind the tall line), enforced in `stepPlayer`. On the map a press does
  nothing and the touch jump button hides (`hj-no-jump`). Never reintroduce `maxJumps`.
- Horizontal speed is NOT a progression axis. `MOVEMENT.moveSpeed` is the only speed;
  there is no sprint (Shift is unbound).
- `LANDING_TOLERANCE` equals the step height in use (`canLandOn` takes it).
- Replicated positions are **float32**; `resolveAxis` treats overlap within
  `CONTACT_EPSILON` as touching (the shop-counter shake). `verify-course` asserts it.
- Because the feet never leave the floor on the stairs, there is no vertical snapping
  to smooth; the leg length itself is eased in `PlayerCharacter`.

## World

- `shared/src/config/course.ts` generates `STEPS`, `WIN_PADS` and `COURSE_SOLIDS`
  from `STAIRS`. The renderer and the collision read the same arrays.
- The stair map is ONE clean continuous stair (translucent stone blocks, studded tops)
  between low orange brick walls with grass and big trees outside, and a far end wall.
  Do not raise the walls. There are no biomes: no
  biome signs, themes, platforms or themed decor. Do not add any.
- Player's LEFT is **+X**, RIGHT is **-X**. Food Shop pedestals left (three rows of
  five), scoreboards right, Dining Hall at the back (-Z), Egg Shop stall just before
  the staircase on the right, tall line across the stair mouth.
- **Every step has its own win pad** (on its top, left side, `STEP_WINS`: 1, 3, 8, 20,
  50, 120, 200, 400 ...). `winPadAt(x, feetY, z, legReach)` is reached when the player
  stands on the floor inside the pad's footprint and `feetY + legReach` is at or above
  the pad. `WinService` also requires `grounded`, pays each pad at most once per
  attempt (`startAttempt` on every `placeAt`), then sends the player to spawn.
- The **Recommended Level** signs sit on each riser at the RIGHT edge (-X), clear of the
  walking line and the pads. Level and pad labels are one `SignAtlas` (one texture, one
  draw call). Steps, pads, glows and pools are merged. Keep it that way.
- **Rebirth signs** float over each dining set, facing spawn: "Locked" (while locked),
  "xN Height Power" in the tier's colour, "Rebirth N", over a coloured mat. The dining
  table payout is the only rebirth-gated mechanic.
- There is no death mechanic and no fall rule.
- The only non-voluntary placement is `isOutOfWorld`. Do not reintroduce a fall rule.
- **There are no checkpoints.** `GameRoom.placeAt` takes no position.
- The jump animations play at `JUMP_ANIMATION.playbackRate` (0.5), visual only.
- Long legs are `LegStilts` columns hung off the shin bones; `PlayerCharacter` lifts
  the body by the (smoothed) extra length. The animator damps leg swing with length.
  Seated players play `SIT`; eating
  layers `EAT` on the right arm. The held food (`HeldFood`) hangs off `ArmR2`.
- The camera and fog pull back with the drawn leg length (`setLegExtra`).
- Equipped pets follow their owner (`PetCompanions`, world space, local AND remote).
- The landing impact (`LandingDebris`, `impact` sound, camera `shake`) is local only.
- Eating loops `assets/audio/eat.mp3` while the local player eats (`AudioManager.setEating`,
  faded in and out); the synthesised chomp only covers the moment before it decodes.
- World textures are drawn on canvases (`WorldTextures`). Food models, pets, tables
  and eggs are primitives. The only image files are the player texture and the HUD
  icons in `assets/ui/`; the food icon is inline SVG. The old biome pictures and
  `equipment.png` are pruned from the build (`vite.config.ts`).
- A win plays `TrophyBurst` around the local player.

## Progression

- **Food** is granted only by `FoodService`: the distance between authoritative
  positions while walking (capped, so a teleport pays nothing), or time seated at an
  unlocked dining table. Standing still or jumping in place pays nothing. A "step" is
  `FOOD.strideDistance` (20) units of walking - a little over one a second - and a table
  eats `DINING.eatStepsPerSecond` (1.5); these pace levelling without touching the
  per-step food figures or the level costs.
  `spendFood` spends it on levels; nothing else raises a level.
- Food per step = `resolveFoodRate`: best owned food's stated value (`FOOD_TIERS`) ×
  worn trail × equipped pets' food multiplier - and NOTHING else. At a table a second
  eats `eatStepsPerSecond` steps × the table's Height Power (1x/3x/5x/7x at 0/2/5/10
  rebirths). Level, height and rebirths never multiply food. The server logs every rate
  change with its breakdown (`describeFoodRate`), and the HUD shows the replicated
  `foodPerStep`. Pet food bonuses are modest (best trio, 3 Krakens, = x43); foods are
  the main food ladder.
- Height = `resolveHeight(level)` (level 73 = 3.6K, 74 = 3.7K). Level cost =
  `foodForNextLevel` (73 = 210, 74 = 222) × rebirth cost multiplier.
- Rebirth resets level and food and raises the HEIGHT multiplier
  (`rebirthHeightMultiplier`: x1, x1.5, x2 ... applied to `resolveHeight` and `legReach`),
  and the food cost multiplier. It grants no jumps. Wins, foods, trails and pets are kept. The
  next rebirth needs `rebirthRequiredLevel(rebirths)` = 25, 50, 75, 100 ... (+25 each),
  read by the server for eligibility and by the rebirth screen from the replicated
  rebirth count. The screen shows Before/After height, the level bar and ONE Rebirth
  button. There is no skip (no paid or free way around the requirement).
- **Wins move only through `Wallet`.** Added by `WinService` and Bux grants; spent by
  foods, trails and eggs. Wins are `float64`; `MAX_WINS` is the largest exact integer.
- Foods: walk onto a pedestal holding the Wins; the best owned food is always held.
  Lettuce is always owned.
- Pets: hatched at the Egg Shop (`PetService`, server roll), 4 pets per egg with
  60/28/10/2 chances. Max `PET_LIMITS.maxOwned` owned, 3 equipped. Equipped bonuses
  ADD (1 + Σ(m − 1)). Pets multiply food and wins. The inventory is one replicated
  string (`"cat*,bunny"`), because a nested schema array would not trigger onChange.
- Trails multiply food per step. There are no auras, boots or equipment.
- Only deriving facts are persisted. Height, leg reach, jump physics and rates are
  recomputed on load.

## Persistence and accounts

Progress survives restarts, scale-to-zero and deploys, and a SIGNED-IN player's progress
belongs to their Bloxity ACCOUNT on every browser and device. Guests keep the browser
behaviour. These rules are load-bearing; `npm run verify:persistence` checks them.

- **Storage.** `MONGODB_URI` set (Legion injects it: a managed database isolated to this
  game + channel; the database is the one named in the URI) -> MongoDB, collections
  `profiles` and `bux_grants`. Unset -> JSON files in `HIGHJUMP_DATA_DIR` (development).
  `persistence/index.ts` is the only place a concrete store is named.
- **The contract is PER KEY** (`ProfileStorage`: get / put / insertIfAbsent / loadAll /
  flush), one document per player. Several pods share one database: nothing ever writes
  a whole-map snapshot, and a JOIN reads its profile from storage, never from a cache.
  The only cache is the leaderboards' (`ProfileService`: loaded at boot, re-read every
  60 s, newer `updatedAt` wins).
- **A failed read is never "no profile".** `get()` throws; `onAuth` then REFUSES the join
  (code 4503) and the client's backoff retries. Letting someone in on an empty profile
  would autosave it over their real one.
- **Writes** queue the latest snapshot per key, write `updateOne($set, upsert)` (idempotent),
  retry with backoff and are never dropped. A write `$set`s only `WRITTEN_FIELDS` and
  `$unset`s only `CLEARABLE_FIELDS` (empty today), so fields this build does not know
  survive. A newer queued snapshot never loses a queued migration marker.
- **The Mongo driver's first connect is special:** if it fails, that client stays closed
  ("Topology is closed") until `connect()` is called again. Every operation goes through
  `MongoProfileStorage.ensureConnected()` (grants too), or a pod that booted with the
  database down would never recover.
- **Boot never fails on storage.** `/health` always answers 200 (with `storage` and
  `storageOk`) or Legion restart-loops the pod; joins fail cleanly instead. Shutdown is
  `gracefullyShutdown(false)` then `await flush()` and `close()` - without `false` Colyseus
  exits before the flush runs.
- **JSON store:** atomic temp + fsync + rename; a leftover `.tmp` is recovered (newer
  `updatedAt` per key wins); a file that will not parse is MOVED ASIDE
  (`.corrupt-<time>`), never overwritten. The loader keeps every field.
- **Legacy import:** with MongoDB, `profiles.json` and `bux-grants.json` in the data dir
  are imported on every boot with `$setOnInsert` - insert-only, never replace.
- **Auth.** The client sends the portal TOKEN (never an account id) on join and in the
  identity message whenever the login changes; the server verifies it in async `onAuth`
  (`BloxityVerifier`) exactly as Bloxity's SDK does: `POST https://api.bloxity.io
  /v1/auth/game-token/verify`, `Bearer <token>`, `{ gameSlug }` with THIS server's
  `BLOXITY_GAME_ID` - never a client-supplied slug. The host is a CONSTANT. FAIL CLOSED:
  only a 2xx whose user has a string `_id` is verified. Three outcomes: verified /
  rejected (guest) / unavailable (timeout, network, 5xx, 429: guest for now, re-verified
  on a backoff, never a permanent demotion). Verified answers are cached up to 5 min and
  never past the token's `exp`; rejected ones 30 s; unavailable never. The cache key is a
  hash of the token. The token is never verified locally: `JWT_SECRET` is the game's own
  secret, not Bloxity's signing key.
- **Keys** (`profileKeys.ts`): account `bloxity:<verified id>`; guest = the browser id.
  A browser id using the reserved prefix is REFUSED (4401), or a guest could name
  themselves into an account.
- **First login** (`AccountResolver.ts`): an account's existing profile always wins and is
  never touched by browser data. Only if it has none AND this browser's guest profile has
  real progress (`hasProgress`; time alone is not) is the guest progress inserted with
  `insertIfAbsent` + `migratedFrom`; only AFTER that succeeds is the guest copy marked
  `migratedTo` (data kept as a recovery copy - a crash in between duplicates, never
  loses). A lost insert race loads the winner. A `migratedTo` guest is never restored,
  migrated again or ranked; that browser signed out plays fresh and UNSAVED, so the
  recovery copy is never overwritten and one browser cannot seed a second account.
- **Mid-session sign-in / sign-out** is a message on the LIVE session, never a reconnect
  (a reconnect can reach another pod before the last write lands). While switching, the
  session's autosaves are blocked; the profile being LEFT is saved from live state and
  waited for; the new one is resolved (sign-in from a guest migrates the LIVE state, newer
  than any autosave); then `FoodService.initialise`, pending grants, a place at spawn
  (`'account'`), a save. If storage fails, the session STAYS on its current profile. Only
  the newest login counts; one that arrives mid-switch is queued.
- **Purchases** (`GrantStore`): the webhook answers 2xx only once the grant is DURABLE;
  the transaction id is the unique key (pays out once across pods, retries, restarts);
  `drain` claims atomically (pending -> applied) so two pods can never both apply one;
  grants are drained ONLY against the session's verified account, on this pod at once
  (`grantEvents`) and from other pods by a 10 s poll. SKU values are unchanged.

## Architecture rules

- No god files. `shared/` never imports three, colyseus or the DOM. The client touches
  colyseus.js only in `client/src/net/`.
- Animators write only bones and their own pivot nodes (`tipPivot`, `visual`), never the physics root.
- Remote animation is derived from monotonic counters against a first-sight baseline.
- Only the local player makes sound. Music is streamed and paused when muted.
- Portal (Unblocked City) integration is build-time env only (`portalConfig.ts`) and
  must never block play.

## Bloxity

- The SDK (`window.Legion.SDK`) loads from `https://sdk.bloxity.io/legion-sdk.min.js` in
  `client/index.html`. **Only `client/src/bloxity/Bloxity.ts` touches it**, and every call
  is guarded: a blocked CDN must never stop play. Slug: `BLOXITY_GAME_ID`
  (`tall-to-escape`, the id the deploy workflow publishes to; `VITE_BLOXITY_GAME_ID`
  overrides it at build time, and the server reads the same id from its own env).
- There is exactly ONE `auth.onUserChanged` subscription (in `Bloxity`); UI fans out from
  it. The user object is never cached.
- Bux purchases pass a SKU only. Wins are granted by the SERVER when Bloxity's webhook
  hits `POST /bloxity/bux` (secret header `x-legion-webhook-secret`, env
  `BLOXITY_WEBHOOK_SECRET`; without it every delivery is refused). The SKU -> Wins table
  is `server/src/bloxity/BuxGrants.ts`; grants are recorded durably (MongoDB
  `bux_grants`, or the JSON file) before the webhook answers, then applied through
  `wallet.add` to a session holding the account the server VERIFIED (see Persistence).
- **Player names and avatars come from Bloxity, and only Bloxity.** There is no identity
  system of this game's own and no generated handle. The server sets `displayName` and
  `avatarUrl` on `PlayerState` by ONE rule, `resolveShownName`: what the server VERIFIED
  with Bloxity, else what Bloxity's SDK reported to that client (display-only `name` and
  `avatarUrl` on the identity message), else `GUEST_NAME`. The reported name is not
  tidiness: the portal hands an embedded game its user object whether or not it also hands
  it a token, and a signed-in player must never show as "Guest" for want of one. A guest
  reports no name, which is what shows them as `GUEST_NAME` - never Bloxity's random guest
  name. Verification still runs and still WINS: an in-game token is a GAME CAPABILITY the
  account routes refuse, so it goes to `POST /v1/auth/game-token/verify` with the slug (the
  client's `gameSlug`, then `BLOXITY_GAME_ID`), and only then to `/v1/social/profile` and
  `/v1/auth/me`. Only a VERIFIED token grants the Bloxity id Bux is paid against - nothing a
  client reports ever can. `sanitizeDisplayName` and `normalizeAvatarUrl`
  (static.bloxity.io only) clean both. The name tag over every character (`NameTag`,
  local and remote), the scoreboards ([avatar] Name) and every name UI read those
  replicated fields. Profiles keep the last name and thumbnail for offline board rows.
  Internal ids (browser player id, Bloxity account id, session id) are never shown.
  Thumbnails load once per URL with CORS (`avatarImages.ts`) and draw into canvases.
- **A player's avatar is BLOXITY'S, including the default one.** With any Bloxity
  profile (signed in or guest) the character is Bloxity's `player.glb` through
  `BloxityAvatar`/`PlayerCharacter.setModel`, wearing the equipped skin or Bloxity's
  `DEFAULT_SKIN_ID` when none: nothing equipped means Bloxity's DEFAULT AVATAR, not the
  bundled `player.fbx`. Parts swap into the GLB, hats/back hang on bones, proportions
  scale bones. The bundled body and its `green.png` are the fallback for exactly one
  case - no avatar data at all (no SDK, or the GLB will not load) - and nothing re-applies
  them afterwards.
- **An avatar is applied the way Bloxity's own renderer applies it** (the reference page
  at bloxity.io/test-game.html), and EVERY player's is their own. Height stretches the
  model, arm length scales the arm bones, head scale scales `Neck1` (undoing the height
  stretch on it), and `Neck_Offset` carries `(height - headScale) * rest` plus the
  neck-height slider. Torso width, shoulder width and leg spread are NOT bone scale -
  children inherit that, which smeared heads, arms and hats - they are applied to the
  SKINNING MATRICES in `patchSkeleton`: the torso's own matrices are scaled and the bones
  above it are shifted by `(bindX - spine1X) * (value - 1) * COUNTER_SCALE`. Each body's
  skeletons are patched with a closure over THAT avatar's proportions; there is no shared
  state. Hats and back items hang in BONE space at scale 1 (`HAT_LIFT` 0.8) on a Bloxity
  body, as the reference hangs them; only the bundled body needs world-scale compensation.
  **Texture `flipY` differs by asset kind and must not be unified:** a SKIN comes from the
  GLB and is authored for glTF's UV convention (`flipY` false), while a HAT or BACK item is
  an OBJ authored for three.js' own default (`flipY` true). Flipping an item's atlas turns a
  helmet into a mottled blob - which is precisely what it looked like.
- **Nothing is shared between two players' bodies.** Each body is its own clone with its
  own material, and each body part is retargeted onto THAT body's skeleton
  (`retarget`, marked `bloxityPart` so `setModel` frees it). The factory caches only
  DOWNLOADS - a part's geometry as authored plus its rig's bone names - never a geometry
  already bound to some player's skeleton. A late-arriving body is dropped unless its
  `bodyToken` is still current, so a slow load cannot land on a newer look.
- The look is REPLICATED, so remotes are dressed too: the client encodes its equipped ids
  and proportions (`encodeAvatarLook`), sends them with the identity message, the server
  cleans them (`sanitizeAvatarLook`: id pattern, Bloxity's proportion ranges) into
  `PlayerState.avatar`, and `RemotePlayer` wears `parseAvatarLook`. '' means no Bloxity
  data - the only bundled-body case.
- The account chip has NO Log out button: signing out is the portal's business. Nothing in
  this game calls `auth.logout()`.

## Verification

Do not claim something works without running it: `npm run typecheck`,
`npm run verify`, `npm run build:client`, `npm run build:server`,
`npm run size:client`, and a real browser for behaviour.

Anything touching accounts, profiles, storage or purchases also runs
`npm run verify:persistence` (built server, only Bloxity's verify URL stubbed via
`node --import`; no test switches in production code), and with a real `mongod`
(`MONGOD_BIN=...`) for the outage tests. `MONGODB_URI=...` DROPS that database.
