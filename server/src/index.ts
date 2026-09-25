import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@highjump/shared';
import { serverConfig } from './config/serverConfig.js';
import { createHttpServer } from './httpServer.js';
import { GameRoom } from './rooms/GameRoom.js';
import { persistence, profileService } from './runtime.js';
import { logger } from './util/logger.js';

const SCOPE = 'server';

/** The longest shutdown waits for queued profile writes to land. */
const FLUSH_ON_SHUTDOWN_MS = 15_000;

// Storage was opened when `runtime` loaded. It never throws at boot: with the
// database down, /health still answers (or Legion restart-loops the pod) and
// joins are refused cleanly until it is back. The leaderboard cache fills in
// the background.
profileService.startBoardRefresh();

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createHttpServer() }),
  greet: false,
});

gameServer.define(ROOM_NAME, GameRoom);

gameServer
  .listen(serverConfig.port, serverConfig.host)
  .then(() => {
    logger.info(
      SCOPE,
      `listening on ${serverConfig.host}:${serverConfig.port} room="${ROOM_NAME}" health=/health ` +
        `storage=${persistence.profiles.kind}`,
    );
  })
  .catch((error: unknown) => {
    logger.error(SCOPE, 'failed to start', error);
    process.exit(1);
  });

let shuttingDown = false;

/**
 * Drain rooms WITHOUT exiting (`gracefullyShutdown(false)` - with no argument
 * Colyseus exits before anything after it runs), so every room's final save is
 * queued; then wait for storage to land those writes, and close it.
 */
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(SCOPE, `received ${signal}, shutting down`);
  try {
    await gameServer.gracefullyShutdown(false);
  } catch (error) {
    logger.error(SCOPE, 'room shutdown failed:', error);
  }
  profileService.stopBoardRefresh();
  try {
    await persistence.profiles.flush(FLUSH_ON_SHUTDOWN_MS);
    await persistence.profiles.close();
    logger.info(SCOPE, 'profiles persisted');
  } catch (error) {
    logger.error(SCOPE, 'final profile flush failed:', error);
  }
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
// Last resort where nothing asynchronous can run (JSON store only).
process.on('exit', () => persistence.flushSync());
process.on('unhandledRejection', (reason) => logger.error(SCOPE, 'UNHANDLED REJECTION:', reason));
