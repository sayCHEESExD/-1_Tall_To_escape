import { CAMERA } from '@highjump/shared';
import { PerspectiveCamera, Vector3 } from 'three';

/**
 * Extra distance the camera starts a respawn from, in world units.
 *
 * A DELIBERATE effect, and not the artefact it replaces. Easing the follow
 * point across a respawn gap drags the camera through every position between
 * where the player died and where they came back; this moves only the DISTANCE
 * along the camera's own axis, so the shot is framed correctly throughout and
 * simply pulls in. Set to 0 to remove it.
 */
const RESPAWN_ZOOM_DISTANCE = 10;

/** Landing shake: how long it lasts, how far it moves at full strength, how fast it jitters. */
const SHAKE_DURATION = 0.4;
/** Sideways/vertical jitter at full strength, in world units. */
const SHAKE_AMPLITUDE = 0.9;
const SHAKE_FREQUENCY = 48;
/** How far the camera drops on impact and springs back, in world units. */
const SHAKE_DIP = 1.1;
/** Roll kick at full strength, in radians (about 1.7 degrees). */
const SHAKE_ROLL = 0.03;
/** Field-of-view punch at full strength, in degrees. */
const SHAKE_FOV = 5;
/** Every real landing shakes at least this much, so none are invisible. */
const SHAKE_MIN_STRENGTH = 0.45;

/** Wheel zoom limits, as multiples of the default distance, and its feel. */
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3;
const ZOOM_PER_PIXEL = 0.0012;
const ZOOM_EASE = 12;

/** How fast that extra distance is given up. Higher is snappier. */
const RESPAWN_ZOOM_RATE = 6.5;

/**
 * How much further the far plane reaches per world unit of extra leg length.
 * The ONLY thing the legs change about the camera: the body rides high above
 * the course, and scenery below it would otherwise drop out of view.
 */
const TALL_FAR_PER_UNIT = 5;

const FORWARD = new Vector3();
const LOOK_TARGET = new Vector3();
const OFFSET = new Vector3();

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Third-person chase camera.
 *
 * The camera owns its OWN yaw and pitch, supplied by the mouse, and the mount
 * supplies only a position to orbit. That separation is the whole point: a
 * camera that trails the character's facing means pressing A turns the animal,
 * which turns the camera, which redefines what "forward" means - the classic
 * feedback loop where the movement keys end up steering the view.
 *
 * The simulation rotates its stick input by `yaw`, so the camera is the single
 * source of "which way is forward" and the animal's facing follows where it is
 * actually going.
 *
 * At speed it pulls back and widens. Late game runs at hundreds of units a
 * second, and a fixed camera makes the next gap arrive with no warning - the
 * dynamic framing is what buys the reaction time the obby needs.
 */
export class ThirdPersonCamera {
  readonly camera: PerspectiveCamera;

  private readonly target = new Vector3();
  /** Smoothed point the camera orbits. The only thing that is smoothed. */
  private readonly followed = new Vector3();

  private orbitYaw = 0;
  private orbitPitch = 0.2;
  private initialised = false;

  /** Extra distance still to be given up by the respawn dolly. */
  private zoomOffset = 0;

  /** Eased 0..1 speed factor driving the dynamic distance and FOV. */
  private rush = 0;

  /** The subject's extra leg length, in world units. */
  private legExtra = 0;

  /**
   * Half-width of a walled corridor the camera must stay inside, or 0 for none.
   * On the staircase the camera orbits far out with the long legs, and would
   * otherwise swing through the side walls.
   */
  private corridorHalfWidth = 0;

  private aspect = 1;

  /** Seconds of landing shake left, and how strong the current shake is. */
  private shakeTime = 0;
  private shakeStrength = 0;
  private shakeClock = 0;
  private readonly reducedMotion =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /**
   * A short landing shake. `strength` is 0..1. A stronger impact while a shake
   * is running takes over; a weaker one never cuts a big one short.
   */
  shake(strength: number): void {
    if (!(strength > 0)) return;
    const clamped = Math.min(strength, 1);
    const s = (SHAKE_MIN_STRENGTH + (1 - SHAKE_MIN_STRENGTH) * clamped) * (this.reducedMotion ? 0.35 : 1);
    const remaining = this.shakeStrength * (this.shakeTime / SHAKE_DURATION);
    if (s < remaining) return;
    this.shakeStrength = s;
    this.shakeTime = SHAKE_DURATION;
  }

  /** Mouse-wheel zoom, as a multiple of the default distance. Eased toward its target. */
  private zoom = 1;
  private zoomTarget = 1;

  /**
   * Zoom by a wheel delta in pixels. Scrolling up (negative) zooms IN, down
   * zooms out. Exponential, so every notch feels the same at any distance.
   */
  addZoom(deltaPixels: number): void {
    if (!Number.isFinite(deltaPixels)) return;
    this.zoomTarget = clamp(this.zoomTarget * Math.exp(deltaPixels * ZOOM_PER_PIXEL), ZOOM_MIN, ZOOM_MAX);
  }

  constructor() {
    this.camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, CAMERA.height, -CAMERA.distance);
  }

  /** Called by RendererManager whenever the drawing buffer changes size. */
  setViewport(width: number, height: number): void {
    this.aspect = width / Math.max(height, 1);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** The direction the camera faces. This is what "forward" means. */
  get yaw(): number {
    return this.orbitYaw;
  }

  /** Follow this position. The camera's own angles are unchanged. */
  setTarget(position: Vector3): void {
    this.target.copy(position);
  }

  /**
   * Arrive at a position instead of easing to it. Used for a PLACEMENT.
   *
   * The smoothing exists to absorb a player who MOVED; a respawn or a server
   * correction is a player who was PLACED, and easing across that gap is what
   * produces a camera sitting a whole stage behind a player who has already
   * arrived.
   *
   * @param zoomIn play the respawn dolly. TRUE only for a respawn; a network
   *               correction must arrive invisibly, not announce itself.
   */
  snapTo(position: Vector3, zoomIn = false): void {
    this.target.copy(position);
    this.followed.copy(position);
    this.initialised = true;
    this.zoomOffset = zoomIn ? RESPAWN_ZOOM_DISTANCE : 0;
  }

  /** How much longer than normal the followed player's legs are right now (already smoothed). */
  setLegExtra(extra: number): void {
    this.legExtra = Number.isFinite(extra) ? Math.max(0, extra) : 0;
  }

  /** Keep the camera within `halfWidth` of x = 0 (the staircase walkway), or 0 to lift the limit. */
  setCorridor(halfWidth: number): void {
    this.corridorHalfWidth = Number.isFinite(halfWidth) ? Math.max(0, halfWidth) : 0;
  }

  /** Aim the orbit. Called every frame from the look source. */
  setOrbit(yaw: number, pitch: number): void {
    this.orbitYaw = yaw;
    this.orbitPitch = pitch;
  }

  /**
   * @param speed the mount's horizontal speed, for the dynamic framing.
   */
  update(delta: number, speed: number): void {
    // ONE smoothing stage, applied to the point the camera follows.
    //
    // Smoothing the camera POSITION while taking the look target raw makes the
    // two disagree every frame, which is exactly what reads as vibration
    // however gentle the smoothing is. Deriving both from one smoothed point
    // means they cannot disagree.
    if (!this.initialised) {
      this.followed.copy(this.target);
      this.initialised = true;
    } else {
      // Frame-rate independent exponential smoothing.
      this.followed.lerp(this.target, 1 - Math.exp(-CAMERA.followLerp * delta));
    }

    if (this.zoomOffset > 0) {
      this.zoomOffset *= Math.exp(-RESPAWN_ZOOM_RATE * delta);
      if (this.zoomOffset < 0.01) this.zoomOffset = 0;
    }

    // The rush factor is eased hard: pulling back has to lag the speed change
    // or every landing would punch the camera in and out.
    const targetRush = clamp(speed / CAMERA.speedReference, 0, 1);
    this.rush += (targetRush - this.rush) * (1 - Math.exp(-CAMERA.speedEase * delta));

    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-ZOOM_EASE * delta));
    // The camera orbits the BODY, which the legs lift `legExtra` above the
    // feet. The legs move the pivot up with the body and nothing else: the
    // distance, the zoom and the framing are exactly those of a normal player.
    const bodyY = this.legExtra;
    const distance = (CAMERA.distance + CAMERA.speedDistance * this.rush) * this.zoom + this.zoomOffset;
    const far = CAMERA.far + bodyY * TALL_FAR_PER_UNIT;
    if (Math.abs(this.camera.far - far) > 1) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    const punch = this.shakeTime > 0 ? SHAKE_FOV * this.shakeStrength * (this.shakeTime / SHAKE_DURATION) ** 2 : 0;
    const fov = CAMERA.fov + CAMERA.speedFov * this.rush + punch;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Where the camera sits: back along its own yaw, lifted by its pitch. The
    // pitch shortens the horizontal reach as it rises, so the camera swings
    // over the mount rather than sliding away from it.
    const cosPitch = Math.cos(this.orbitPitch);
    const sinPitch = Math.sin(this.orbitPitch);

    FORWARD.set(
      Math.sin(this.orbitYaw) * cosPitch,
      0,
      Math.cos(this.orbitYaw) * cosPitch,
    );

    // Applied directly, not lerped again: the look angles must never lag the
    // mouse, and the follow point is already smooth.
    this.camera.position
      .copy(this.followed)
      .addScaledVector(FORWARD, -distance)
      .add(OFFSET.set(0, bodyY + CAMERA.height + sinPitch * distance, 0));
    if (this.corridorHalfWidth > 0) {
      this.camera.position.x = clamp(this.camera.position.x, -this.corridorHalfWidth, this.corridorHalfWidth);
    }

    LOOK_TARGET.copy(this.followed).add(OFFSET.set(0, bodyY + CAMERA.lookAtHeight, 0));
    this.camera.lookAt(LOOK_TARGET);

    // Landing shake, applied after the camera is aimed:
    //  - a DIP: the camera slams down and springs back, like the ground taking
    //    the weight - the part that reads as impact;
    //  - a fast jitter that dies away quadratically;
    //  - a small roll kick and a brief field-of-view punch (above).
    // Under half a second end to end, so it lands hard without lingering.
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - delta);
      this.shakeClock += delta;
      const decay = this.shakeTime / SHAKE_DURATION;
      const progress = 1 - decay;
      const strength = this.shakeStrength;
      // Down fast in the first ~15%, then back up with a slight overshoot.
      const dip =
        progress < 0.15
          ? -Math.sin((progress / 0.15) * (Math.PI / 2))
          : -Math.cos(((progress - 0.15) / 0.85) * Math.PI * 1.5) * (1 - progress);
      const jitter = SHAKE_AMPLITUDE * strength * decay * decay;
      const c = this.shakeClock * SHAKE_FREQUENCY;
      this.camera.position.x += Math.sin(c * 1.3) * jitter * 0.6;
      this.camera.position.y += Math.sin(c + 0.7) * jitter + dip * SHAKE_DIP * strength;
      this.camera.position.z += Math.cos(c * 0.9) * jitter * 0.35;
      this.camera.rotateZ(Math.sin(c * 0.8) * SHAKE_ROLL * strength * decay);
    } else {
      this.shakeClock = 0;
    }
  }
}
