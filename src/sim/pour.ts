/**
 * Pour animation state machine.
 *
 * A pour has three phases (per design doc):
 *
 *   tilt-up   — 180ms.  Source lifts and rotates toward dest.
 *   drain     — variable.  Tokens transfer one at a time, src layer count
 *               ticks down, dst ticks up.  Per-token duration scales with
 *               viscosity: dur = BASE_TOKEN_DUR * viscosity.
 *   tilt-down — 180ms.  Source returns to upright + base position.
 *
 * The state machine here only describes *visual* progress.  The actual
 * GameState.applyPour commit happens once on completion (in main.ts) so
 * undo/redo sees a single move.  Layer counts the renderer reads during
 * the animation come from this object, not the GameState.
 *
 * Strict invariant: this module is sim-pure — no GL, no DOM.  It owns
 * timing logic and reads viscosity from a passed-in liquid visual.
 */

import type { LiquidId } from '../game/state';

export type PourPhase = 'tilt-up' | 'drain' | 'tilt-down' | 'done';

const TILT_UP_DUR = 0.18;     // seconds
const TILT_DOWN_DUR = 0.18;   // seconds
const BASE_TOKEN_DUR = 0.16;  // seconds per token at viscosity 1.0

/**
 * Maximum tilt angle in radians.  Kept moderate so the simple
 * "layers parallel to tube" rendering shortcut still reads cleanly.
 * Day 7 surface sim relaxes this if needed.
 */
export const TILT_MAX = 0.32; // ~18°

/** Extra cy lift applied to the source tube during the pour. */
export const POUR_LIFT = 0.12;

export interface PourAnim {
  src: number;
  dst: number;
  /** Total tokens to transfer over the drain phase. */
  amount: number;
  /** Color being poured (top of src at start). */
  liquid: LiquidId;
  /** Initial layer counts at pour start, captured for renderer math. */
  srcLayersAtStart: number;
  dstLayersAtStart: number;
  /**
   * Sign multiplier on the tilt angle.  In our scene convention y is up
   * and rotations are mathematically CCW-positive.  To physically pour
   * toward dst on the right, the top of the tube must swing right
   * (clockwise = negative angle).  So when dst is to the right of src,
   * the caller passes tiltSign = -1; for dst to the left, +1.
   */
  tiltSign: number;

  // Internal phase machinery
  phase: PourPhase;
  tInPhase: number;
  drainDur: number;
}

export interface PourParams {
  src: number;
  dst: number;
  amount: number;
  liquid: LiquidId;
  srcLayers: number;
  dstLayers: number;
  /** Tilt-angle sign, see PourAnim.tiltSign for full semantics. */
  tiltSign: number;
  /** Viscosity multiplier from liquidVisual(liquid).viscosity. */
  viscosity: number;
}

export function startPour(p: PourParams): PourAnim {
  return {
    src: p.src,
    dst: p.dst,
    amount: p.amount,
    liquid: p.liquid,
    srcLayersAtStart: p.srcLayers,
    dstLayersAtStart: p.dstLayers,
    tiltSign: p.tiltSign,
    phase: 'tilt-up',
    tInPhase: 0,
    drainDur: Math.max(0.01, BASE_TOKEN_DUR * p.viscosity * p.amount),
  };
}

/**
 * Advance the animation by `dt` seconds.  Mutates `p`.
 * Returns true exactly when the pour finishes this step.
 */
export function stepPour(p: PourAnim, dt: number): boolean {
  if (p.phase === 'done') return false;
  p.tInPhase += dt;

  if (p.phase === 'tilt-up') {
    if (p.tInPhase >= TILT_UP_DUR) {
      p.tInPhase -= TILT_UP_DUR;
      p.phase = 'drain';
    }
  } else if (p.phase === 'drain') {
    if (p.tInPhase >= p.drainDur) {
      p.tInPhase -= p.drainDur;
      p.phase = 'tilt-down';
    }
  } else if (p.phase === 'tilt-down') {
    if (p.tInPhase >= TILT_DOWN_DUR) {
      p.phase = 'done';
      p.tInPhase = 0;
      return true;
    }
  }
  return false;
}

/** Smoothstep helper. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Current tilt angle (signed) of the source tube in radians.
 * Eased so the start/end are smooth; midpoint = TILT_MAX * tiltSign.
 */
export function pourTilt(p: PourAnim): number {
  switch (p.phase) {
    case 'tilt-up': {
      const k = smoothstep(0, TILT_UP_DUR, p.tInPhase);
      return p.tiltSign * TILT_MAX * k;
    }
    case 'drain':
      return p.tiltSign * TILT_MAX;
    case 'tilt-down': {
      const k = smoothstep(0, TILT_DOWN_DUR, p.tInPhase);
      return p.tiltSign * TILT_MAX * (1 - k);
    }
    case 'done':
    default:
      return 0;
  }
}

/**
 * Cy lift offset on the source tube.  Smoothly raises during tilt-up,
 * stays raised during drain, drops during tilt-down.
 */
export function pourLiftSrc(p: PourAnim): number {
  switch (p.phase) {
    case 'tilt-up':
      return POUR_LIFT * smoothstep(0, TILT_UP_DUR, p.tInPhase);
    case 'drain':
      return POUR_LIFT;
    case 'tilt-down':
      return POUR_LIFT * (1 - smoothstep(0, TILT_DOWN_DUR, p.tInPhase));
    case 'done':
    default:
      return 0;
  }
}

/**
 * How many tokens have visibly drained from src so far (0..amount, integer).
 *
 * Tokens drain one-at-a-time.  The k-th token finishes at time
 * k * (drainDur / amount).  We round so layer counts stay integer.
 */
export function pourDrained(p: PourAnim): number {
  if (p.phase === 'tilt-up') return 0;
  if (p.phase === 'tilt-down' || p.phase === 'done') return p.amount;
  // drain phase: linear progress, floored to keep discrete layers
  const progress = p.tInPhase / p.drainDur;
  return Math.min(p.amount, Math.floor(progress * p.amount + 1e-6));
}

/** Source's current rendered layer count. */
export function pourSrcLayers(p: PourAnim): number {
  return p.srcLayersAtStart - pourDrained(p);
}

/** Destination's current rendered layer count. */
export function pourDstLayers(p: PourAnim): number {
  return p.dstLayersAtStart + pourDrained(p);
}

/**
 * Stream visibility window — only during drain, with a small fade-in
 * at the start and fade-out at the end so it doesn't pop.  Returns 0..1.
 */
export function pourStreamOpacity(p: PourAnim): number {
  if (p.phase !== 'drain') return 0;
  const FADE = 0.06; // seconds
  if (p.tInPhase < FADE) return p.tInPhase / FADE;
  if (p.tInPhase > p.drainDur - FADE) {
    return Math.max(0, (p.drainDur - p.tInPhase) / FADE);
  }
  return 1;
}
