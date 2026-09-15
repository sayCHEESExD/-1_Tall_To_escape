import { Group } from 'three';
import {
  AIRBORNE,
  EAT,
  IDLE,
  JUMP_ANIMATION,
  JUMP_START,
  LANDING,
  LOCOMOTION,
  SIT,
  TALL_ANIM,
  TIP_PIVOT_HEIGHT,
  TRANSITIONS,
} from '../config/animationConfig.js';
import type { AnimationInput } from './AnimationInput.js';
import { LocomotionCycle } from './LocomotionCycle.js';
import { PoseBuffer } from './PoseBuffer.js';
import { BONE_INDEX, type BoneName } from './rig/boneNames.js';
import type { PlayerRig } from './rig/PlayerRig.js';

export type AnimationState = 'idle' | 'run' | 'sit' | 'jumpStart' | 'airborne' | 'landing';

/** The states that make up "the jump", played at `JUMP_ANIMATION.playbackRate`. */
const JUMP_STATES: ReadonlySet<AnimationState> = new Set(['jumpStart', 'airborne', 'landing']);

/** States the eating arm is layered over. */
const EATING_STATES: ReadonlySet<AnimationState> = new Set(['idle', 'run', 'sit']);

const LEG_BONES: readonly BoneName[] = ['LegL1', 'LegR1', 'LegL2', 'LegR2'];

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * The player animation state machine: walk, sit and eat, the one jump, and
 * land. There is no death animation - a fall simply returns the player to
 * spawn - and no air jump.
 *
 * Writes ONLY to bones (via `PlayerRig`), the tip pivot and the visual bob
 * node. It never touches the physics root.
 *
 * The jump states run on a scaled clock (`JUMP_ANIMATION.playbackRate`): their
 * timers, cross-fades and rise/fall blend all advance slower, while the
 * physics that moves the player is unchanged.
 */
export class PlayerAnimator {
  private readonly locomotion = new LocomotionCycle();

  private readonly target = new PoseBuffer();
  private readonly from = new PoseBuffer();
  private readonly output = new PoseBuffer();

  private state: AnimationState = 'idle';
  private stateTime = 0;
  private blendTime = 0;
  private blendDuration = 0;
  private idleTime = 0;
  private wasGrounded = true;
  /** Eased rise (1) / fall (0) weight for the airborne pose. */
  private airWeight = 1;
  /** Clock of the eating cycle, and how strongly the eating arm is applied. */
  private eatTime = 0;
  private eatWeight = 0;

  constructor(
    private rig: PlayerRig,
    private readonly tipPivot: Group,
    private readonly visual: Group,
  ) {
    this.tipPivot.position.y = TIP_PIVOT_HEIGHT;
    this.visual.position.y = -TIP_PIVOT_HEIGHT;
  }

  get currentState(): AnimationState {
    return this.state;
  }

  /**
   * Drive a different body (a Bloxity avatar swap). The pose buffers are left
   * alone, so the current animation continues on the new rig next frame.
   */
  setRig(rig: PlayerRig): void {
    this.rig = rig;
  }

  reset(): void {
    this.state = 'idle';
    this.stateTime = 0;
    this.blendDuration = 0;
    this.wasGrounded = true;
    this.airWeight = 1;
    this.eatWeight = 0;
    this.target.reset();
    this.from.reset();
    this.output.reset();
    this.rig.resetToBindPose();
    this.tipPivot.quaternion.identity();
    this.visual.position.y = -TIP_PIVOT_HEIGHT;
  }

  update(delta: number, input: AnimationInput): void {
    const dt = Math.max(0, delta);
    const jumpDt = dt * JUMP_ANIMATION.playbackRate;
    this.stateTime += JUMP_STATES.has(this.state) ? jumpDt : dt;
    this.resolveState(input);
    this.writePose(dt, jumpDt, input);
    this.writeEating(dt, input);
    this.dampLegs(input.legExtra);
    this.apply(JUMP_STATES.has(this.state) ? jumpDt : dt);
  }

  private resolveState(input: AnimationInput): void {
    if (input.landed || (input.grounded && !this.wasGrounded)) {
      this.wasGrounded = true;
      this.setState('landing', TRANSITIONS.toLanding);
      return;
    }
    this.wasGrounded = input.grounded;

    if (input.jumpStarted) {
      this.airWeight = 1;
      this.setState('jumpStart', TRANSITIONS.toJumpStart);
      return;
    }

    if (!input.grounded) {
      if (this.state === 'jumpStart' && this.stateTime < JUMP_START.duration) return;
      this.setState('airborne', TRANSITIONS.toAirborne);
      return;
    }

    if (this.state === 'landing' && this.stateTime < LANDING.duration) return;
    if (input.seated && input.horizontalSpeed < SIT.maxSpeed) {
      this.setState('sit', TRANSITIONS.toSit);
      return;
    }
    this.setState(
      input.horizontalSpeed < LOCOMOTION.idleSpeed ? 'idle' : 'run',
      TRANSITIONS.toLocomotion,
    );
  }

  private setState(next: AnimationState, duration: number): void {
    if (next === this.state) return;
    this.from.copyFrom(this.output);
    this.state = next;
    this.stateTime = 0;
    this.blendTime = 0;
    this.blendDuration = duration;
  }

  private writePose(dt: number, jumpDt: number, input: AnimationInput): void {
    switch (this.state) {
      case 'idle': {
        this.locomotion.settleTowardNeutral(dt);
        this.idleTime += dt;
        const breath = Math.sin(this.idleTime * IDLE.breathFrequency * Math.PI * 2);
        this.target.applyDefinition(IDLE.basePose);
        this.target.add('Spine1', breath * IDLE.breathAmount);
        this.target.add('Neck1', -breath * IDLE.breathAmount * 0.6);
        this.target.bobY = breath * IDLE.breathBob;
        break;
      }
      case 'sit': {
        this.locomotion.settleTowardNeutral(dt);
        this.idleTime += dt;
        const breath = Math.sin(this.idleTime * IDLE.breathFrequency * Math.PI * 2);
        this.target.applyDefinition(SIT.pose);
        this.target.add('Spine1', breath * IDLE.breathAmount);
        this.target.bobY = SIT.bobY;
        break;
      }
      case 'run':
        this.locomotion.advance(dt, input.horizontalSpeed);
        this.locomotion.writePose(this.target, input.horizontalSpeed);
        break;
      case 'jumpStart':
        this.target.applyDefinition(JUMP_START.pose);
        this.target.bobY = JUMP_START.bobY;
        break;
      case 'airborne':
        this.writeAirborne(jumpDt, input.verticalVelocity);
        break;
      case 'landing': {
        const depth = 1 - ease(clamp(this.stateTime / LANDING.duration, 0, 1));
        this.target.applyDefinition(LANDING.pose, depth);
        this.target.bobY = LANDING.bobY * depth;
        break;
      }
    }
  }

  private writeAirborne(jumpDt: number, verticalVelocity: number): void {
    const t = clamp(verticalVelocity / AIRBORNE.velocityReference, -1, 1);
    const targetWeight = (t + 1) * 0.5;
    // Eased on the jump clock, so the arms and legs swing from the rising pose
    // to the falling one at the slowed playback rate rather than snapping with
    // the velocity.
    this.airWeight += (targetWeight - this.airWeight) * (1 - Math.exp(-JUMP_ANIMATION.airBlendRate * jumpDt));
    this.target.applyDefinition(AIRBORNE.fall, 1 - this.airWeight);
    this.target.blendInDefinition(AIRBORNE.rise, this.airWeight);
    this.target.bobY = 0;
  }

  /** The right hand brings the food up to the mouth, over and over, while eating. */
  private writeEating(dt: number, input: AnimationInput): void {
    const active = input.eating && EATING_STATES.has(this.state);
    this.eatWeight += ((active ? 1 : 0) - this.eatWeight) * (1 - Math.exp(-8 * dt));
    if (active) this.eatTime += dt;
    if (this.eatWeight < 0.001) return;

    const phase = (this.eatTime % EAT.period) / EAT.period;
    const bite = phase < EAT.raise ? Math.sin((phase / EAT.raise) * Math.PI) : 0;
    const w = this.eatWeight * ease(clamp(bite * 1.25, 0, 1));
    this.blendBone('ArmR1', EAT.shoulder, 0, EAT.shoulderRoll, w);
    this.blendBone('ArmR2', EAT.elbow, 0, 0, w);
    this.target.add('Neck1', EAT.nod * w);
  }

  /** Long legs swing through a smaller angle. */
  private dampLegs(legExtra: number): void {
    if (!(legExtra > 0.01) || this.state === 'sit') return;
    const damp = 1 / (1 + legExtra * TALL_ANIM.dampPerUnit);
    const values = this.target.rotations;
    for (const bone of LEG_BONES) {
      const at = BONE_INDEX[bone] * 3;
      for (let i = at; i < at + 3; i += 1) values[i] = (values[i] ?? 0) * damp;
    }
  }

  private blendBone(bone: BoneName, x: number, y: number, z: number, weight: number): void {
    const values = this.target.rotations;
    const at = BONE_INDEX[bone] * 3;
    values[at] = (values[at] ?? 0) + (x - (values[at] ?? 0)) * weight;
    values[at + 1] = (values[at + 1] ?? 0) + (y - (values[at + 1] ?? 0)) * weight;
    values[at + 2] = (values[at + 2] ?? 0) + (z - (values[at + 2] ?? 0)) * weight;
  }

  private apply(blendDt: number): void {
    if (this.blendDuration > 0) {
      this.blendTime += blendDt;
      const t = clamp(this.blendTime / this.blendDuration, 0, 1);
      this.output.lerpBetween(this.from, this.target, ease(t));
      if (t >= 1) this.blendDuration = 0;
    } else {
      this.output.copyFrom(this.target);
    }

    this.rig.applyPose(this.output);
    this.visual.position.y = -TIP_PIVOT_HEIGHT + this.output.bobY;
  }
}
