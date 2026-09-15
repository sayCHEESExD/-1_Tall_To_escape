/**
 * The gameplay signals the animator consumes each frame. It reads these and
 * never writes back: it cannot move the player or decide an outcome.
 *
 * The local player fills it from its own prediction and every remote player
 * from replicated state, so both run the exact same animation code.
 */
export interface AnimationInput {
  grounded: boolean;
  /** Horizontal speed. */
  horizontalSpeed: number;
  verticalVelocity: number;
  /** True on the frame the jump starts. */
  jumpStarted: boolean;
  landed: boolean;
  /** Seated at an unlocked dining table: sit and eat. */
  seated: boolean;
  /** Eating from the held food (walking with it, or seated). */
  eating: boolean;
  /** Extra leg length in world units (0 with normal legs). Damps the stride and the flip. */
  legExtra: number;
}

export const createAnimationInput = (): AnimationInput => ({
  grounded: true,
  horizontalSpeed: 0,
  verticalVelocity: 0,
  jumpStarted: false,
  landed: false,
  seated: false,
  eating: false,
  legExtra: 0,
});
