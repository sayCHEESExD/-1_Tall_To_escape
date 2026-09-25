# +1 Tall Escape

A browser multiplayer staircase obby in the +1 Escape series. Walk around holding
food to eat it, spend the food on levels, and grow taller: every level raises your
**height** and the length of your legs. Cross the tall line at the foot of the
staircase and your legs stretch to walk straight up the 14 biomes of Steps to
Heaven - as far as your level allows (step 1 needs level 5, then 25, 50, 75 ...).
Every step has its own win pad. Spend Wins on better food, trails and pet eggs,
sit at the dining tables to eat on the spot, and rebirth for taller legs and
better tables.

Three.js + TypeScript + Vite on the client, Colyseus + Node on the server, and a
framework-free `shared/` package both sides simulate with. Gameplay is
server-authoritative, rooms hold 15 players, and an empty room closes itself.

## Run it

```bash
npm install
```

```bash
npm run dev
```

The client is on http://localhost:5177 and the server on ws://localhost:2571
(the previous games in the series use 5173-5176 and 2567-2570).

## Checks

```bash
npm run typecheck
```

```bash
npm run verify
```

`verify` runs five suites: `verify:assets` (every runtime asset exists),
`verify:course` (biome table, layout sides, a win pad on every step, the tall line,
and a real simulation that every step is climbable on tall legs at exactly its
level and NOT one level below), `verify:progression` (height and food curves,
foods, dining tables, eggs, pet chances and bonuses, rebirth), `verify:services`
(the server's win, food shop, trail, hatching, pet inventory, food and rebirth
decisions, including rejection paths), and `verify:bloxity` (the Bux webhook).

```bash
npm run build:client
```

```bash
npm run build:server
```

```bash
npm run size:client
```

`size:client` enforces the 12 MB budget. With the server running,
`npm run verify:capacity` checks the 15-player cap, overflow routing and that empty
rooms close.

`npm run verify:persistence` (not part of `verify`; it spawns processes and takes a
few minutes) runs the BUILT server with only Bloxity's token-verify URL stubbed, joins
with real colyseus.js clients and reads storage directly: guest restore, first-login
migration, sign-in/out mid-session, cross-browser accounts, forged tokens and ids,
purchases across a restart, Bloxity unavailable, server restarts and corrupt files.
JSON store always; MongoDB too when given one:

```bash
MONGOD_BIN=/path/to/mongod npm run verify:persistence
```

With `MONGOD_BIN` the script starts its own `mongod` (fixed port, temp data) and also
runs the outage tests - database down at a join, at boot, during a sign-out and
during a save. `MONGODB_URI=...` runs against that database instead and **drops it**,
so only ever point it at a throwaway test database. A `mongod` binary can be had
without adding anything to this repo, e.g. by installing `mongodb-memory-server`
in another folder.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Walk (and eat) | WASD / arrows (mouse aims the camera) | left stick |
| Zoom | mouse wheel (up = in, down = out) | - |
| Jump (spawn area only) | Space | jump button |
| Rebirth / Trail / Pets / Mute | R / T / P / M | left rail tiles |
| Buy food | walk onto its pedestal with the Wins | same |
| Hatch eggs | walk up to the Egg Shop | same |
| Eat at a table | stand on a dining chair | same |
| Free the cursor | Esc | - |

## Tuning

Every gameplay number lives in `shared/src/config/`:

| File | What it holds |
| --- | --- |
| `course.ts` | `BIOMES` (steps, rise, depth, width, gap), step level requirements, `STEP_WINS`, the tall line and the hub layout |
| `progression.ts` | food per step, level cost curve, height per level, leg reach per level, jump height |
| `rebirth.ts` | height and food cost multipliers, rebirth level requirement |
| `foodRate.ts` | THE food per step: food x trail x pets (no level/rebirth factor) |
| `movement.ts` | walk speed, air control, how jump height becomes velocity and gravity |
| `foods.ts` | the 15 Food Shop foods |
| `trails.ts` | the trail ladder and its food multipliers |
| `dining.ts` | the four dining tables (Height Power, rebirths) and their layout |
| `pets.ts` | eggs, the pets in each, chances, bonuses and inventory limits |

## Deploy

The same split as the previous games: the client is static files, the server is a
long-lived Node process.

- **Server:** `Dockerfile` at the repo root. Set `PORT` (defaults to 2571).
  `/health` reports rooms, players and whether storage answers.
- **Player progress** lives in the managed MongoDB that Legion injects as
  `MONGODB_URI` (isolated to this game and channel), so it survives restarts,
  scale-to-zero and deploys. A **signed-in** Bloxity player's progress belongs to
  their ACCOUNT - any browser, any device; a **guest's** stays with their browser as
  before. The first time a guest signs in to an account that has no progress yet,
  their guest progress moves into it. Bux purchases are recorded in the same database
  and pay out exactly once. Without `MONGODB_URI` (local development) the server uses
  JSON files in `HIGHJUMP_DATA_DIR` instead - and when running the image elsewhere
  without Mongo, mount a volume there or a redeploy wipes progress.
- **Client:** `npm run build:client` and publish `client/dist` (`netlify.toml` is
  included). Set `VITE_SERVER_URL` at build time to the server's `wss://` address.

### Bloxity Hosting (GitHub Actions)

`.github/workflows/deploy.yml` deploys game id `tall-to-escape` on every push,
following [hosting.bloxity.io/docs](https://hosting.bloxity.io/docs):

| Branch | Channel | Backend (Colyseus) | Frontend |
| --- | --- | --- | --- |
| `dev` | `dev` | `wss://tall-to-escape.dev.host.bloxity.io` | `https://tall-to-escape.dev.play.bloxity.io` |
| `main` | `prod` | `wss://tall-to-escape.host.bloxity.io` | `https://tall-to-escape.play.bloxity.io` |

1. Typecheck and verify.
2. Build the server image, push `ghcr.io/<owner>/tall-to-escape-server:<channel>-<sha>`,
   and roll it with `POST https://legion.bloxity.io/v1/apps/tall-to-escape/deploy`
   (`version` = commit SHA, `seatCap` 15 = the room cap).
3. Build the client with that channel's `VITE_SERVER_URL` (and
   `VITE_BLOXITY_GAME_ID=tall-to-escape`), zip `client/dist` with `index.html` at the
   root, and upload the raw zip to
   `POST https://api.bloxity.io/v1/hosting/games/tall-to-escape/frontend?channel=<channel>&version=<sha>`.

The only secret is `LEGION_DEPLOY_TOKEN`. After the first push, make the GHCR package
public so Legion can pull it. The `tall-to-escape` game id must exist on Bloxity first.

### Bloxity SDK

Login, avatar, friends, portal settings, lifecycle and Bux are integrated in
`client/src/bloxity/` (one module, `Bloxity.ts`) with the account chip in
`client/src/ui/BloxityPanel.ts`. Bux fulfilment is server-side:

| Server env | Purpose |
| --- | --- |
| `BLOXITY_WEBHOOK_SECRET` | shared secret Bloxity sends as `x-legion-webhook-secret`; required, or `/bloxity/bux` refuses (and Bloxity refunds) |
| `BLOXITY_WEBHOOK_ALLOW_UNSIGNED` | `1` accepts unsigned webhooks - local development only |
| `MONGODB_URI` | injected by Legion: the managed database profiles and purchases live in (unset = JSON files) |
| `BLOXITY_GAME_ID` | injected by Legion: the game id player tokens are verified against |

The Bloxity API host used to verify player tokens is a constant
(`https://api.bloxity.io`), deliberately not configurable.

Register `https://<backend host>/bloxity/bux` as the game's webhook and create the SKUs
`wins_small` and `wins_large` in the Bloxity catalogue.

On `localhost` the SDK sends login and API calls to the page's own origin (its
documented behaviour), so logging in from `npm run dev` needs a Bloxity backend there.
To use the real one locally, build with `VITE_BLOXITY_API_URL=https://api.bloxity.io`
and `VITE_BLOXITY_PORTAL_URL=https://bloxity.io`. Deployed builds need neither.

### Unblocked City

The portal hooks are build-time configuration only, and nothing is hardcoded. With
none of these set, the game runs standalone:

| Variable | Purpose |
| --- | --- |
| `VITE_PORTAL_NAME` | label used in logs |
| `VITE_PORTAL_SDK_URL` | optional portal script, loaded after boot; failures are ignored |
| `VITE_PORTAL_ORIGINS` | comma-separated parent origins that receive a `game-ready` postMessage |

Wiring lives in `client/src/config/portalConfig.ts` and `client/src/portal/Portal.ts`.
