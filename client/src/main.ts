import { clientConfig } from './config/clientConfig.js';
import { Game } from './core/Game.js';
import { GameLoop } from './core/GameLoop.js';
import { startPortal } from './portal/Portal.js';
import { logger } from './util/logger.js';

const SCOPE = 'main';

const boot = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');

const setBootStatus = (text: string): void => {
  if (bootStatus) bootStatus.textContent = text;
};

const main = async (): Promise<void> => {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app container missing from index.html');

  const game = new Game(container);
  // Bloxity first: the portal's loading screen is fed by loadingStep and has to
  // be listening before there is anything to report.
  game.startBloxity();
  const step = (text: string): void => {
    setBootStatus(text);
    game.loadingStep(text);
  };

  step('Building the staircase...');
  await game.initialise();

  step('Connecting to server...');
  let online = true;
  try {
    await game.connect();
  } catch (error) {
    // Rendering and local movement still work offline, but nothing progresses,
    // so the player is told rather than left to find a dead economy.
    online = false;
    showOfflineNotice(error);
  }

  game.start();
  const loop = new GameLoop((delta) => game.update(delta));
  loop.start();
  startPortal();

  if (clientConfig.debug) {
    (window as Window & { __tallescape?: { game: Game; loop: GameLoop } }).__tallescape = { game, loop };
  }
  if (boot && online) boot.hidden = true;
  logger.info(SCOPE, 'running');
};

const showOfflineNotice = (error: unknown): void => {
  const detail = error instanceof Error ? error.message : String(error);
  logger.error(SCOPE, `offline: ${detail}`);
  if (bootStatus) {
    bootStatus.className = 'err';
    bootStatus.textContent = clientConfig.serverUrl
      ? `Not connected to the game server (${clientConfig.serverUrl}).\n` +
        'Playing offline: food, levels, Wins, pets and shops are server-owned and will not progress.'
      : 'This build has no game server configured (VITE_SERVER_URL was not set when it was built).';
  }
  boot?.classList.add('notice');
};

if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(SCOPE, message, error);
  if (bootStatus) {
    bootStatus.className = 'err';
    bootStatus.textContent = `Failed to start:\n${message}`;
  }
});
