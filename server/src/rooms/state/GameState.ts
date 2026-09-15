import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import { LEADERBOARD_SIZE } from '@highjump/shared';
import { PlayerState } from './PlayerState.js';

export class LeaderEntry extends Schema {
  @type('string') handle = '';
  @type('float64') value = 0;
}

/**
 * The three boards in the hub: Most Wins, Most Height, Most Time.
 *
 * FIXED-LENGTH arrays written in place, so a rebuild sends only the rows that
 * actually moved.
 */
export class LeaderboardState extends Schema {
  @type([LeaderEntry]) wins = rows();
  @type([LeaderEntry]) height = rows();
  @type([LeaderEntry]) time = rows();
}

const rows = (): ArraySchema<LeaderEntry> => {
  const list = new ArraySchema<LeaderEntry>();
  for (let i = 0; i < LEADERBOARD_SIZE; i += 1) list.push(new LeaderEntry());
  return list;
};

export class GameState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type(LeaderboardState) leaderboard = new LeaderboardState();
}
