import { resolveWinReward, stepByNumber, winPadAt } from '@highjump/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { wallet } from './Wallet.js';

/** Milliseconds between two paid wins for one player. Spam protection only. */
const WIN_COOLDOWN_MS = 1500;

export type WinRefusal = 'unknown-step' | 'not-on-pad' | 'already-claimed' | 'cooldown';

export interface WinResult {
  readonly granted: boolean;
  readonly wins: number;
  readonly reason?: WinRefusal;
}

/**
 * Server authority over win pads - one on every step. Wins are EARNED in
 * exactly one place: here.
 *
 * A claim is validated against the position the SERVER simulated and the leg
 * reach the SERVER derived: the player must be standing on the floor inside
 * the pad's footprint with the top of their legs at or above the pad. Every
 * pad pays at most ONCE per attempt: the steps claimed since the player was
 * last placed at spawn are remembered, and a paid claim sends the player back
 * to spawn (which starts the next attempt). The cooldown only stops a burst of
 * requests in one tick.
 */
export class WinService {
  private readonly lastWin = new Map<string, number>();
  private readonly claimed = new Map<string, Set<number>>();

  forget(sessionId: string): void {
    this.lastWin.delete(sessionId);
    this.claimed.delete(sessionId);
  }

  /** A new attempt: called whenever the player is placed at spawn. */
  startAttempt(sessionId: string): void {
    this.claimed.get(sessionId)?.clear();
  }

  claim(player: PlayerState, stepNumber: number, nowMs: number): WinResult {
    const step = stepByNumber(Number(stepNumber));
    if (!step) return { granted: false, wins: 0, reason: 'unknown-step' };
    if (!player.grounded || winPadAt(player.x, player.y, player.z, player.legReach) !== step.number) {
      return { granted: false, wins: 0, reason: 'not-on-pad' };
    }
    let claimed = this.claimed.get(player.sessionId);
    if (!claimed) {
      claimed = new Set();
      this.claimed.set(player.sessionId, claimed);
    }
    if (claimed.has(step.number)) return { granted: false, wins: 0, reason: 'already-claimed' };
    const last = this.lastWin.get(player.sessionId) ?? -Infinity;
    if (nowMs - last < WIN_COOLDOWN_MS) return { granted: false, wins: 0, reason: 'cooldown' };

    this.lastWin.set(player.sessionId, nowMs);
    claimed.add(step.number);
    const paid = wallet.add(player, resolveWinReward(step.wins, player.pets));
    return { granted: true, wins: paid };
  }
}
