import type { Scene } from 'three';
import type { NetPlayerState } from '../net/netTypes.js';
import { RemotePlayer } from './RemotePlayer.js';

/** Every other player in the room. Owns their lifetimes and nothing else. */
export class RemotePlayerManager {
  private readonly players = new Map<string, RemotePlayer>();

  constructor(private readonly scene: Scene) {}

  add(sessionId: string, state: NetPlayerState): void {
    if (this.players.has(sessionId)) return;
    const player = new RemotePlayer(state);
    this.players.set(sessionId, player);
    this.scene.add(player.character.root, player.character.worldRoot);
  }

  update(sessionId: string, state: NetPlayerState): void {
    this.players.get(sessionId)?.apply(state);
  }

  remove(sessionId: string): void {
    const player = this.players.get(sessionId);
    if (!player) return;
    player.dispose();
    this.players.delete(sessionId);
  }

  advance(delta: number): void {
    for (const player of this.players.values()) player.update(delta);
  }

  dispose(): void {
    for (const player of this.players.values()) player.dispose();
    this.players.clear();
  }
}
