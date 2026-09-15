import { GUEST_NAME, LEADERBOARD_SIZE, resolveHeight } from '@highjump/shared';
import type { LeaderEntry, LeaderboardState } from '../rooms/state/GameState.js';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { profileStore } from './ProfileStore.js';

const REFRESH_SECONDS = 2;

interface Candidate {
  /** The Bloxity display name shown on the board. Never an internal id. */
  readonly name: string;
  readonly avatarUrl: string;
  readonly time: number;
  readonly wins: number;
  readonly height: number;
  readonly rebirths: number;
}

/**
 * The Most Wins, Most Height and Most Time boards. Every figure is the
 * server's: stored profiles merged with live state (live figures where both
 * exist). Height is derived from the stored level, never stored itself.
 * Rows show each player's Bloxity display name and avatar thumbnail - the
 * live ones for players in the room, the last saved ones for everyone else.
 * Rebuilt on a slow timer - nobody reads a board twenty times a second.
 */
export class LeaderboardService {
  private timer = 0;

  update(
    delta: number,
    board: LeaderboardState,
    live: Iterable<[string, PlayerState]>,
    playerIds: ReadonlyMap<string, string>,
  ): void {
    this.timer -= delta;
    if (this.timer > 0) return;
    this.timer = REFRESH_SECONDS;

    const byId = new Map<string, Candidate>();
    for (const [id, profile] of profileStore.entries()) {
      byId.set(id, {
        name: profile.displayName || GUEST_NAME,
        avatarUrl: profile.avatarUrl,
        time: profile.playSeconds,
        wins: profile.wins,
        height: resolveHeight(profile.level, profile.rebirths),
        rebirths: profile.rebirths,
      });
    }
    for (const [sessionId, player] of live) {
      const id = playerIds.get(sessionId);
      if (!id) continue;
      byId.set(id, {
        name: player.displayName || GUEST_NAME,
        avatarUrl: player.avatarUrl,
        time: player.playSeconds,
        wins: player.wins,
        height: player.height,
        rebirths: player.rebirths,
      });
    }

    const all = [...byId.values()];
    fill(board.wins, all, (c) => c.wins, 1);
    // Height ties break on rebirths, which is the harder-won figure.
    fill(board.height, all, (c) => c.height, 1, (c) => c.rebirths);
    fill(board.time, all, (c) => c.time, 60);
  }
}

const fill = (
  into: ArrayLike<LeaderEntry>,
  all: readonly Candidate[],
  pick: (candidate: Candidate) => number,
  minimum: number,
  tieBreak: (candidate: Candidate) => number = () => 0,
): void => {
  const ranked = all
    .filter((candidate) => pick(candidate) >= minimum)
    .sort((a, b) => pick(b) - pick(a) || tieBreak(b) - tieBreak(a))
    .slice(0, LEADERBOARD_SIZE);

  for (let i = 0; i < LEADERBOARD_SIZE; i += 1) {
    const entry = into[i];
    if (!entry) continue;
    const candidate = ranked[i];
    const name = candidate ? candidate.name : '';
    const avatarUrl = candidate ? candidate.avatarUrl : '';
    const value = candidate ? Math.floor(pick(candidate)) : 0;
    if (entry.name !== name) entry.name = name;
    if (entry.avatarUrl !== avatarUrl) entry.avatarUrl = avatarUrl;
    if (entry.value !== value) entry.value = value;
  }
};

export const leaderboardService = new LeaderboardService();
