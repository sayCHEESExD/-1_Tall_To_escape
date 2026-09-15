import { createServer, type IncomingMessage, type Server } from 'node:http';
import { matchMaker } from '@colyseus/core';
import { ROOM_NAME } from '@highjump/shared';
import { buxGrants } from './bloxity/buxGrantsStore.js';
import { BUX_WEBHOOK_PATH, processBuxWebhook } from './bloxity/buxWebhook.js';
import { serverConfig } from './config/serverConfig.js';
import { logger } from './util/logger.js';

const SCOPE = 'http';

/** Read a body with a ceiling, so a stuck socket cannot grow without bound. */
const readBody = async (request: IncomingMessage): Promise<string | null> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 64 * 1024) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * A plain HTTP server for Colyseus to attach to.
 *
 * Two routes. `/health` reports the matchmaker's own tally of rooms and
 * players, which is what makes the 15-player cap and the empty-room rule
 * checkable from outside the process (`npm run verify:capacity`).
 * `/bloxity/bux` is Bloxity's server-to-server Bux fulfilment webhook - the
 * ONLY way a purchase becomes Wins; nothing the client reports is trusted.
 */
export const createHttpServer = (): Server =>
  createServer((request, response) => {
    const url = (request.url ?? '').split('?')[0];

    if (url === '/health') {
      void matchMaker
        .query({ name: ROOM_NAME })
        .then((rooms) => {
          const players = rooms.reduce((sum, room) => sum + room.clients, 0);
          response.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          response.end(JSON.stringify({ ok: true, room: ROOM_NAME, rooms: rooms.length, players }));
        })
        .catch(() => {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ ok: true, room: ROOM_NAME }));
        });
      return;
    }

    if (url === BUX_WEBHOOK_PATH && request.method === 'POST') {
      void readBody(request).then((raw) => {
        const secret = request.headers['x-legion-webhook-secret'];
        const result =
          raw === null
            ? { status: 413, body: { ok: false, error: 'payload too large' } }
            : processBuxWebhook(typeof secret === 'string' ? secret : undefined, raw, buxGrants, {
                secret: serverConfig.buxWebhookSecret,
                allowUnsigned: serverConfig.buxAllowUnsigned,
              });
        if (result.status >= 400) logger.warn(SCOPE, `bux webhook refused: ${result.status} ${String(result.body['error'])}`);
        response.writeHead(result.status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(result.body));
      });
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  });
