import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const clientRoot = fileURLToPath(new URL('.', import.meta.url));
const repoAssets = fileURLToPath(new URL('../assets', import.meta.url));

/**
 * Files in `assets/` that are never loaded at runtime. `base_rig.fbx` is
 * byte-identical to `player.fbx`; shipping both would double the largest model.
 */
const UNSHIPPED_ASSETS = [
  'player/base_rig.fbx',
  // The previous game's shop icon and biome board pictures: this game has neither.
  'ui/equipment.png',
  ...[
    'Grassland', 'Forest', 'Ocean', 'Crystal', 'Desert', 'High Mountain', 'Snow Peak', 'Volcano',
    'Cloud Kingdom', 'Aurora Sky', 'Candy Heaven', 'Stratosphere', 'Outer Space', 'Galaxy Core',
  ].map((name) => `ui/${name}.png`),
];

const pruneUnusedAssets = (): Plugin => ({
  name: 'highjump:prune-unused-assets',
  apply: 'build',
  async closeBundle() {
    for (const relativePath of UNSHIPPED_ASSETS) {
      await rm(join(clientRoot, 'dist', relativePath), { force: true });
    }
  },
});

export default defineConfig({
  plugins: [pruneUnusedAssets()],
  root: clientRoot,
  /** The repo-level `assets/` is the public root: `/player/*`, `/ui/*`, `/audio/*`. */
  publicDir: repoAssets,
  server: {
    // Not 5173-5176: the previous games in this series use those.
    port: 5177,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 4177,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          net: ['colyseus.js'],
        },
      },
    },
  },
});
