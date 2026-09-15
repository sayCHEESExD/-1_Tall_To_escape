/**
 * Every asset the game loads at runtime by PATH actually exists. A bundler
 * cannot check a URL string, so a rename would otherwise 404 at load.
 *
 * Run with `npm run verify:assets`.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('../assets', import.meta.url));

const REQUIRED = [
  'audio/fall.mp3',
  'player/player.fbx',
  'player/green.png',
  'ui/trophy.png',
  'ui/rebirth.png',
  'ui/trail.png',
  'ui/inventory.png',
  'ui/shop.png',
  'audio/background.mp3',
  'audio/jump.mp3',
];

/** Present but pruned from the build by vite.config.ts. */
const UNSHIPPED = ['player/base_rig.fbx'];

let failures = 0;
console.log('\nrequired assets\n');
for (const relative of REQUIRED) {
  const path = join(assets, relative);
  if (!existsSync(path) || statSync(path).size === 0) {
    failures += 1;
    console.error(`  MISSING  ${relative}`);
    continue;
  }
  console.log(`  ok       ${relative}  (${(statSync(path).size / 1024).toFixed(1)} kB)`);
}
console.log('\nnot shipped\n');
for (const relative of UNSHIPPED) {
  console.log(`  ${existsSync(join(assets, relative)) ? 'ok  ' : 'note'}     ${relative} (pruned from the build)`);
}
console.log(`\n${failures === 0 ? 'assets verified' : `${failures} MISSING`}\n`);
process.exit(failures === 0 ? 0 : 1);
