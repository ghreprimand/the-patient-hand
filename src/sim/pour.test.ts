import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  pourDrained,
  pourDstLayers,
  pourLiftSrc,
  pourSrcLayers,
  pourTilt,
  startPour,
  stepPour,
  TILT_MAX,
} from './pour';

function newAnim() {
  return startPour({
    src: 0,
    dst: 1,
    amount: 3,
    liquid: 'cinnabar',
    srcLayers: 4,
    dstLayers: 0,
    tiltSign: 1,
    viscosity: 1,
  });
}

describe('pour state machine', () => {
  it('starts in tilt-up phase with no progress', () => {
    const p = newAnim();
    assert.equal(p.phase, 'tilt-up');
    assert.equal(pourDrained(p), 0);
    assert.equal(pourSrcLayers(p), 4);
    assert.equal(pourDstLayers(p), 0);
    assert.equal(pourTilt(p), 0);
    assert.equal(pourLiftSrc(p), 0);
  });

  it('reaches max tilt + lift midway through tilt-up at half duration', () => {
    const p = newAnim();
    stepPour(p, 0.09); // half of tilt-up
    // Smoothstep at 0.5 = 0.5; tilt halfway in eased terms
    assert.ok(pourTilt(p) > 0);
    assert.ok(pourTilt(p) < TILT_MAX);
    assert.ok(pourLiftSrc(p) > 0);
  });

  it('progresses to drain after tilt-up completes', () => {
    const p = newAnim();
    stepPour(p, 0.18); // complete tilt-up
    assert.equal(p.phase, 'drain');
    assert.equal(pourTilt(p), TILT_MAX);
  });

  it('drains tokens one at a time during drain', () => {
    const p = newAnim();
    stepPour(p, 0.18); // → drain
    // drainDur = BASE_TOKEN_DUR * viscosity * amount = 0.16 * 1 * 3 = 0.48
    // First token completes at t = 0.16
    stepPour(p, 0.16);
    assert.equal(pourDrained(p), 1);
    assert.equal(pourSrcLayers(p), 3);
    assert.equal(pourDstLayers(p), 1);
    stepPour(p, 0.16);
    assert.equal(pourDrained(p), 2);
    stepPour(p, 0.16);
    // Drain phase complete; should have transitioned to tilt-down.
    assert.equal(p.phase, 'tilt-down');
    assert.equal(pourSrcLayers(p), 1);
    assert.equal(pourDstLayers(p), 3);
  });

  it('finishes after tilt-down', () => {
    const p = newAnim();
    let done = false;
    // Run for 0.18 + 0.48 + 0.18 = 0.84s in 0.05s steps.
    for (let i = 0; i < 30; i++) {
      done = stepPour(p, 0.04) || done;
    }
    assert.equal(p.phase, 'done');
    assert.equal(done, true);
  });

  it('viscosity scales drain duration', () => {
    const fast = startPour({
      src: 0, dst: 1, amount: 2, liquid: 'q', srcLayers: 2, dstLayers: 0,
      tiltSign: 1, viscosity: 0.5,
    });
    const slow = startPour({
      src: 0, dst: 1, amount: 2, liquid: 'q', srcLayers: 2, dstLayers: 0,
      tiltSign: 1, viscosity: 2.0,
    });
    assert.ok(slow.drainDur > fast.drainDur);
    assert.ok(Math.abs(slow.drainDur / fast.drainDur - 4) < 1e-6);
  });

  it('tilt sign matches direction', () => {
    const r = startPour({
      src: 0, dst: 1, amount: 1, liquid: 'q', srcLayers: 1, dstLayers: 0,
      tiltSign: 1, viscosity: 1,
    });
    const l = startPour({
      src: 1, dst: 0, amount: 1, liquid: 'q', srcLayers: 1, dstLayers: 0,
      tiltSign: -1, viscosity: 1,
    });
    stepPour(r, 0.18);
    stepPour(l, 0.18);
    assert.ok(pourTilt(r) > 0);
    assert.ok(pourTilt(l) < 0);
  });
});
