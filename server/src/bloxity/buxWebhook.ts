import { timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { logger } from '../util/logger.js';
import type { GrantStore } from './BuxGrants.js';

/**
 * `recorded` (accountId) fires on THIS pod once a grant is durable, so a room
 * holding that account applies it at once instead of on its next poll. Rooms on
 * other pods find it by polling storage.
 */
export const grantEvents = new EventEmitter();

/** Where Bloxity delivers a paid purchase (register `<backend>/bloxity/bux` as the webhook). */
export const BUX_WEBHOOK_PATH = '/bloxity/bux';

export interface WebhookResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface WebhookOptions {
  /** The shared secret configured on bloxity.io, or '' if none. */
  readonly secret: string;
  /** Accept an unsigned webhook when no secret is configured. Local development only. */
  readonly allowUnsigned: boolean;
}

/**
 * Decide what to do with one fulfilment webhook. Pure apart from `grants`, so
 * it is tested without a socket.
 *
 * ANSWERING 2xx IS THE CONTRACT: Bloxity refunds a purchase whose webhook did
 * not succeed. So a 2xx is sent only once the grant is DURABLY recorded -
 * including a SKU this build does not know (recorded as seen). The non-2xx
 * answers are the cases where a retry or refund is correct: a bad secret, an
 * unrecordable body, storage that cannot take the grant right now (503), or a
 * server with no secret configured at all, which would otherwise grant Wins to
 * anyone who found the URL.
 */
export const processBuxWebhook = async (
  suppliedSecret: string | undefined,
  rawBody: string,
  grants: GrantStore,
  options: WebhookOptions,
): Promise<WebhookResult> => {
  if (options.secret) {
    if (!suppliedSecret || !safeEqual(suppliedSecret, options.secret)) {
      return { status: 401, body: { ok: false, error: 'bad secret' } };
    }
  } else if (!options.allowUnsigned) {
    return { status: 503, body: { ok: false, error: 'webhook secret not configured' } };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { ok: false, error: 'malformed payload' } };
  }

  const transactionId = payload['transactionId'];
  const userId = payload['userId'];
  const sku = payload['sku'];
  if (
    typeof transactionId !== 'string' ||
    !transactionId ||
    typeof userId !== 'string' ||
    !userId ||
    typeof sku !== 'string' ||
    !sku
  ) {
    return { status: 400, body: { ok: false, error: 'missing transactionId, userId or sku' } };
  }

  let outcome;
  try {
    outcome = await grants.record(userId, transactionId, sku);
  } catch (error) {
    logger.error('bux', `could not record ${transactionId} (${String(error)}) - answering 503 so Bloxity retries`);
    return { status: 503, body: { ok: false, error: 'storage unavailable' } };
  }
  if (outcome === 'recorded') grantEvents.emit('recorded', userId);
  return { status: 200, body: { ok: true, transactionId, outcome } };
};

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
