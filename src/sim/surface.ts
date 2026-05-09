/**
 * 1D height-field surface sim per tube.
 *
 * Each tube tracks SURFACE_SAMPLES horizontal samples h[i] across the
 * liquid surface, plus their velocities v[i].  Discrete wave equation
 * with viscous damping is integrated at 240 Hz fixed-step:
 *
 *     a[i] = WAVE_C2 * (h[i-1] + h[i+1] - 2*h[i]) - DAMPING * v[i]
 *     v[i] += a[i] * dt
 *     h[i] += v[i] * dt
 *
 * Boundary conditions: clamped (h[-1] = h[N] = 0) — the meniscus touches
 * the glass, no slosh past the walls.
 *
 * Wave constants per design doc:
 *   c²        ≈ 1500   (high enough that ripples cross the tube quickly)
 *   damping   ≈ 4.0    (settle in ~1.5s after impulse)
 *
 * No allocation on the hot path: caller-provided Float32Arrays.  Module
 * is sim-pure; no DOM, no GL.
 */

export const SURFACE_SAMPLES = 24;

const WAVE_C2 = 1500;
const DAMPING = 4.0;

export interface SurfaceField {
  /** Per-tube heights, packed flat: [t0_h0, t0_h1, ..., t1_h0, ...] */
  heights: Float32Array;
  /** Per-tube velocities, same layout. */
  velocities: Float32Array;
  /** Number of tubes the field tracks. */
  tubeCount: number;
}

export function createSurfaceField(tubeCount: number): SurfaceField {
  return {
    heights: new Float32Array(tubeCount * SURFACE_SAMPLES),
    velocities: new Float32Array(tubeCount * SURFACE_SAMPLES),
    tubeCount,
  };
}

/** Reset to flat surface — call when a tube's contents change discretely. */
export function resetSurfaceTube(field: SurfaceField, tubeIdx: number): void {
  const off = tubeIdx * SURFACE_SAMPLES;
  for (let i = 0; i < SURFACE_SAMPLES; i++) {
    field.heights[off + i] = 0;
    field.velocities[off + i] = 0;
  }
}

/** Reset all tubes to a flat surface. */
export function resetSurfaceField(field: SurfaceField): void {
  field.heights.fill(0);
  field.velocities.fill(0);
}

/**
 * Apply a downward velocity impulse at column `col` (0..SURFACE_SAMPLES-1)
 * with magnitude `power`.  Spreads slightly to neighbors so a single
 * impact creates a small splash crown rather than a single Dirac dip.
 */
export function splashAt(
  field: SurfaceField,
  tubeIdx: number,
  col: number,
  power: number,
): void {
  const off = tubeIdx * SURFACE_SAMPLES;
  // Normalize col to integer in [0, N-1]
  const c = Math.max(0, Math.min(SURFACE_SAMPLES - 1, Math.round(col)));
  // Push down: negative velocity (interpreted as a depression in the
  // meniscus).  Spread: 1 in the center, 0.6 one column out, 0.3 two out.
  // noUncheckedIndexedAccess makes Float32Array reads `number | undefined`
  // for TS-only purposes (the runtime is fine).  Read-then-write avoids
  // the !-assertion noise.
  const v = field.velocities;
  v[off + c] = (v[off + c] ?? 0) - power;
  if (c - 1 >= 0) v[off + c - 1] = (v[off + c - 1] ?? 0) - power * 0.6;
  if (c + 1 < SURFACE_SAMPLES) v[off + c + 1] = (v[off + c + 1] ?? 0) - power * 0.6;
  if (c - 2 >= 0) v[off + c - 2] = (v[off + c - 2] ?? 0) - power * 0.3;
  if (c + 2 < SURFACE_SAMPLES) v[off + c + 2] = (v[off + c + 2] ?? 0) - power * 0.3;
}

/**
 * Step the surface sim forward by `dt` seconds.  Caller is responsible
 * for using the fixed 240 Hz step from the main accumulator.
 */
export function stepSurfaceField(field: SurfaceField, dt: number): void {
  const N = SURFACE_SAMPLES;
  const h = field.heights;
  const v = field.velocities;
  for (let t = 0; t < field.tubeCount; t++) {
    const off = t * N;
    // Two-pass: compute accelerations + update velocities, then update
    // positions.  Simple semi-implicit Euler; stable at our timescales.
    for (let i = 0; i < N; i++) {
      const left = i === 0 ? 0 : h[off + i - 1] ?? 0;
      const right = i === N - 1 ? 0 : h[off + i + 1] ?? 0;
      const here = h[off + i] ?? 0;
      const a = WAVE_C2 * (left + right - 2 * here) - DAMPING * (v[off + i] ?? 0);
      v[off + i] = (v[off + i] ?? 0) + a * dt;
    }
    for (let i = 0; i < N; i++) {
      h[off + i] = (h[off + i] ?? 0) + (v[off + i] ?? 0) * dt;
    }
  }
}

/**
 * Apply an artistic clamp on extreme heights so the meniscus never
 * exceeds a sensible visual range.  Called once per visible frame.
 */
export function clampSurfaceField(field: SurfaceField, maxAbs: number): void {
  const h = field.heights;
  const v = field.velocities;
  for (let i = 0; i < h.length; i++) {
    const hi = h[i] ?? 0;
    const vi = v[i] ?? 0;
    if (hi > maxAbs) {
      h[i] = maxAbs;
      if (vi > 0) v[i] = 0;
    } else if (hi < -maxAbs) {
      h[i] = -maxAbs;
      if (vi < 0) v[i] = 0;
    }
  }
}
