import { resolve } from 'node:path';
import { BLOXITY_GAME_ID, DEFAULT_SERVER_PORT, SERVER_TICK_RATE } from '@highjump/shared';

/** Runtime server configuration, overridable by environment variables. */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly tickRate: number;
  /** Milliseconds between state patches sent to clients. */
  readonly patchRateMs: number;
  /** Directory holding persisted player profiles. */
  readonly dataDir: string;
  /**
   * Shared secret Bloxity sends as `x-legion-webhook-secret`. Without one the
   * Bux webhook REFUSES every delivery (so Bloxity refunds), because an
   * unauthenticated endpoint would grant Wins to anybody who found it.
   */
  readonly buxWebhookSecret: string;
  /** Accept unsigned webhooks when no secret is set. Local development only. */
  readonly buxAllowUnsigned: boolean;
  /** Bloxity's API, for verifying player tokens. */
  readonly bloxityApiBase: string;
  /** This game's Bloxity id, which in-game tokens are verified against. Legion injects `BLOXITY_GAME_ID`. */
  readonly bloxityGameId: string;
}

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * `--port N` from the command line wins over `PORT`, and the dev script passes
 * it: a dev harness hosting the client often exports `PORT` for its own web
 * server. Managed hosts pass no argv, so `PORT` still wins in production.
 */
const portArgument = (): string | undefined => {
  const at = process.argv.indexOf('--port');
  return at >= 0 ? process.argv[at + 1] : undefined;
};

export const serverConfig: ServerConfig = {
  port: int(portArgument() ?? process.env['PORT'], DEFAULT_SERVER_PORT),
  host: process.env['HOST'] ?? '0.0.0.0',
  tickRate: SERVER_TICK_RATE,
  patchRateMs: 1000 / SERVER_TICK_RATE,
  dataDir: resolve(process.env['HIGHJUMP_DATA_DIR'] ?? 'data'),
  buxWebhookSecret: process.env['BLOXITY_WEBHOOK_SECRET'] ?? '',
  buxAllowUnsigned: process.env['BLOXITY_WEBHOOK_ALLOW_UNSIGNED'] === '1',
  bloxityApiBase: (process.env['BLOXITY_API_BASE'] ?? 'https://api.bloxity.io').replace(/\/+$/, ''),
  bloxityGameId: process.env['BLOXITY_GAME_ID']?.trim() || BLOXITY_GAME_ID,
};
