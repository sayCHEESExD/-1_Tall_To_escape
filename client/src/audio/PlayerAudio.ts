import type { AudioManager } from './AudioManager.js';

/** World units between footfalls. */
const STRIDE = 4.2;
const MAX_STEPS_PER_SECOND = 7;
const MIN_AUDIBLE_SPEED = 2.5;

export interface PlayerAudioInput {
  readonly horizontalSpeed: number;
  readonly maxRunSpeed: number;
  readonly isGrounded: boolean;
  readonly justLanded: boolean;
  /** 0..1 strength of this frame's landing, 0 for none or a tiny drop. */
  readonly landingImpact: number;
  /** Seated at an unlocked dining table. */
  readonly atActiveTable: boolean;
  /** Eating this frame (walking with food, or seated). */
  readonly isEating: boolean;
}

/** Seconds between chomps while eating. */
const CHOMP_INTERVAL = 0.55;

/**
 * Decides WHEN the local player makes a sound; `AudioManager` knows HOW.
 * Only the local player is heard. There is no death sound - there is no death.
 */
export class PlayerAudio {
  private stride = 0;
  private sinceStep = 0;
  private sinceChomp = 0;

  constructor(private readonly audio: AudioManager) {}

  /** The (one) jump is reported as an event. */
  jumped(): void {
    this.audio.play('jump');
  }

  update(delta: number, player: PlayerAudioInput): void {
    // A real landing is a heavy impact; a small drop keeps the soft thud.
    if (player.justLanded) {
      if (player.landingImpact > 0) this.audio.play('impact', player.landingImpact);
      else this.audio.play('land', 0.3);
    }

    this.sinceChomp += delta;
    if (player.isEating && this.sinceChomp >= CHOMP_INTERVAL) {
      this.sinceChomp = 0;
      this.audio.play('eat', player.atActiveTable ? 0.8 : 0.5);
    }

    this.sinceStep += delta;
    const speed = player.atActiveTable ? 0 : player.horizontalSpeed;
    if (!player.isGrounded || speed < MIN_AUDIBLE_SPEED) {
      this.stride = 0;
      return;
    }
    this.stride += speed * delta;
    if (this.stride < STRIDE) return;
    this.stride = 0;
    if (this.sinceStep < 1 / MAX_STEPS_PER_SECOND) return;
    this.sinceStep = 0;
    this.audio.play('step', Math.min(speed / player.maxRunSpeed, 1));
  }
}
