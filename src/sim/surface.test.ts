import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  createSurfaceField,
  resetSurfaceTube,
  splashAt,
  stepSurfaceField,
  SURFACE_SAMPLES,
} from './surface';

describe('surface field', () => {
  it('initializes flat with zero velocity', () => {
    const f = createSurfaceField(3);
    for (let i = 0; i < f.heights.length; i++) {
      assert.equal(f.heights[i], 0);
      assert.equal(f.velocities[i], 0);
    }
  });

  // Float32 stores 0.6 as ~0.60000002; use a tolerance comparator.
  const close = (a: number, b: number, eps = 1e-5) =>
    assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b} (eps ${eps})`);

  it('splash at center applies negative velocity with neighbor spread', () => {
    const f = createSurfaceField(1);
    splashAt(f, 0, 12, 1);
    close(f.velocities[12]!, -1);
    close(f.velocities[11]!, -0.6);
    close(f.velocities[13]!, -0.6);
    close(f.velocities[10]!, -0.3);
    close(f.velocities[14]!, -0.3);
  });

  it('splash near a wall does not write out of bounds', () => {
    const f = createSurfaceField(1);
    splashAt(f, 0, 0, 1);
    close(f.velocities[0]!, -1);
    close(f.velocities[1]!, -0.6);
    splashAt(f, 0, SURFACE_SAMPLES - 1, 1);
    close(f.velocities[SURFACE_SAMPLES - 1]!, -1);
    // Only the second splash's neighbor lands at [N-2]; the first splash
    // at col 0 spread only as far as col +2.
    close(f.velocities[SURFACE_SAMPLES - 2]!, -0.6);
  });

  it('damps to rest after enough steps', () => {
    const f = createSurfaceField(1);
    splashAt(f, 0, 12, 0.4);
    const STEP = 1 / 240;
    for (let i = 0; i < 240 * 4; i++) stepSurfaceField(f, STEP);
    let maxAbsH = 0;
    for (let i = 0; i < f.heights.length; i++) {
      if (Math.abs(f.heights[i]!) > maxAbsH) maxAbsH = Math.abs(f.heights[i]!);
    }
    // After 4 seconds with damping 4.0, residual should be tiny.
    assert.ok(maxAbsH < 0.001, `expected near-rest, got ${maxAbsH}`);
  });

  it('per-tube reset clears only that tube', () => {
    const f = createSurfaceField(3);
    splashAt(f, 0, 5, 1);
    splashAt(f, 1, 5, 1);
    splashAt(f, 2, 5, 1);
    resetSurfaceTube(f, 1);
    close(f.velocities[0 * SURFACE_SAMPLES + 5]!, -1);
    close(f.velocities[1 * SURFACE_SAMPLES + 5]!, 0);
    close(f.velocities[2 * SURFACE_SAMPLES + 5]!, -1);
  });
});
