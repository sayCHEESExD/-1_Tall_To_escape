/**
 * Third-person chase camera tuning. In shared so gameplay can reason about
 * framing without importing the renderer.
 */
export interface CameraConfig {
  readonly distance: number;
  readonly height: number;
  readonly lookAtHeight: number;
  readonly followLerp: number;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly speedDistance: number;
  readonly speedFov: number;
  readonly speedReference: number;
  readonly speedEase: number;
}

/**
 * Pulled back and raised compared with the flat-course games: on a staircase
 * the player needs to see the NEXT step's edge and how far above them it is.
 */
export const CAMERA: CameraConfig = {
  distance: 13,
  height: 4.2,
  lookAtHeight: 2.6,
  followLerp: 10,
  fov: 70,
  near: 0.1,
  far: 3200,
  speedDistance: 2.5,
  speedFov: 6,
  speedReference: 30,
  speedEase: 2.2,
};
