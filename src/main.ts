/**
 * The Patient Hand — entry point.
 *
 * Day 5: pour animation now drives between game-state snapshots.  When
 * the player chooses a (legal) pour, a PourAnim takes over: src tube
 * tilts up, drains layer-by-layer into dst, returns upright; then the
 * pure GameState commits via applyPour().  Input is locked while a
 * pour is in flight — only one pour at a time per the design doc.
 *
 * Pipeline (unchanged structurally):
 *   Pass 1 (FBO):    apothecary backdrop (procedural).
 *   Pass 2 (FBO):    drop shadows under each tube (multiply blend).
 *   Pass 3 (canvas): scene shader — multi-tube layered liquid + glass,
 *                    samples backdrop FBO for refraction.  Now reads
 *                    a per-tube tilt uniform.
 */

import {
  createContext,
  createProgram,
  createStaticBuffer,
  FULLSCREEN_TRI,
  resize,
  UniformCache,
  type GLContext,
} from '@/render/gl';
import {
  bindCanvasTarget,
  bindFboTarget,
  createFbo,
  resizeFbo,
  type Fbo,
} from '@/render/fbo';
import { BACKDROP_FRAG, BACKDROP_VERT, SHELF_Y } from '@/render/shaders/backdrop';
import {
  MAX_CAPACITY,
  MAX_TUBES,
  SCENE_FRAG,
  SCENE_VERT,
} from '@/render/shaders/scene';
import { SHADOW_FRAG, SHADOW_VERT } from '@/render/shaders/shadow';

import { applyPour, canPour, pourAmount, topOf } from '@/game/rules';
import { type GameState, type LiquidId } from '@/game/state';
import { loadLevel, type Level } from '@/game/level';
import { liquidVisual } from '@/game/liquids';

import {
  type PourAnim,
  pourDstLayers,
  pourLiftSrc,
  pourSrcLayers,
  pourTilt,
  startPour,
  stepPour,
} from '@/sim/pour';

import level001 from '../levels/001.json';

// ---------------------------------------------------------------------------
// Tube layout
// ---------------------------------------------------------------------------

/** 240 Hz internal sim step. */
const FIXED_STEP = 1 / 240;

/** Shared tube geometry (tube-space units; aspect-corrected). */
const TUBE_RADIUS = 0.115;
const TUBE_HEIGHT = 0.42;
const WALL_THICKNESS = 0.018;

/** Tube-space y of the shelf top. */
const SHELF_TOP_TS = SHELF_Y * 2 - 1; // ≈ -0.36
const TUBE_BASE_CY = SHELF_TOP_TS + TUBE_HEIGHT - 0.01;

/** Lift applied to the cy of the currently selected tube. */
const LIFT_AMOUNT = 0.06;

/** Glow boost on the selected tube's topmost layer. */
const SELECTION_GLOW_BOOST = 0.18;

/**
 * Compute X centers for N tubes, evenly spaced and centered around x=0.
 * Spacing scales with TUBE_RADIUS so layouts are visually consistent.
 */
function tubeCenterXs(n: number): number[] {
  const spacing = TUBE_RADIUS * 2.7;
  const start = -((n - 1) / 2) * spacing;
  return Array.from({ length: n }, (_, i) => start + i * spacing);
}

// ---------------------------------------------------------------------------
// GL pipeline scaffolding (mostly unchanged from Day 3)
// ---------------------------------------------------------------------------

interface ProgramRec {
  program: WebGLProgram;
  uniforms: UniformCache;
  vao: WebGLVertexArrayObject;
}

interface Pipeline {
  ctx: GLContext;
  buf: WebGLBuffer;
  backdrop: ProgramRec;
  shadow: ProgramRec;
  scene: ProgramRec;
  fbo: Fbo;
}

function makeProgram(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
  label: string,
  buf: WebGLBuffer,
): ProgramRec {
  const program = createProgram(gl, vs, fs, label);
  const uniforms = new UniformCache(gl, program);
  const vao = gl.createVertexArray();
  if (!vao) throw new Error(`Failed to allocate VAO (${label})`);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { program, uniforms, vao };
}

function setupPipeline(canvas: HTMLCanvasElement): Pipeline {
  const ctx = createContext(canvas);
  const { gl } = ctx;
  const buf = createStaticBuffer(gl, FULLSCREEN_TRI);
  const backdrop = makeProgram(gl, BACKDROP_VERT, BACKDROP_FRAG, 'backdrop', buf);
  const shadow = makeProgram(gl, SHADOW_VERT, SHADOW_FRAG, 'shadow', buf);
  const scene = makeProgram(gl, SCENE_VERT, SCENE_FRAG, 'scene', buf);
  const fbo = createFbo(gl, canvas.width, canvas.height);
  return { ctx, buf, backdrop, shadow, scene, fbo };
}

// ---------------------------------------------------------------------------
// Scene state (mutable runtime data, kept distinct from pure GameState)
// ---------------------------------------------------------------------------

interface AppState {
  game: GameState;
  /** Index of currently-selected tube, or null. */
  selected: number | null;
  /** X centers in tube-space; same length as game.tubes. */
  centerXs: readonly number[];
  /** Active pour animation, or null when idle. */
  pour: PourAnim | null;
}

function makeAppState(level: Level): AppState {
  const game = loadLevel(level);
  return {
    game,
    selected: null,
    centerXs: tubeCenterXs(game.tubes.length),
    pour: null,
  };
}

// ---------------------------------------------------------------------------
// Per-frame uniform packing
// ---------------------------------------------------------------------------

interface PackedTubes {
  /** vec2 per slot, MAX_TUBES total. */
  centers: Float32Array;
  /** int per slot, MAX_TUBES total. */
  layerCounts: Int32Array;
  /** float per slot, MAX_TUBES total. */
  glows: Float32Array;
  /** float per slot — radians, MAX_TUBES total. */
  tilts: Float32Array;
  /** vec3 per (tube, layer) — flat MAX_TUBES * MAX_CAPACITY. */
  layerColors: Float32Array;
  count: number;
}

function packTubeUniforms(app: AppState): PackedTubes {
  const centers = new Float32Array(MAX_TUBES * 2);
  const layerCounts = new Int32Array(MAX_TUBES);
  const glows = new Float32Array(MAX_TUBES);
  const tilts = new Float32Array(MAX_TUBES);
  const layerColors = new Float32Array(MAX_TUBES * MAX_CAPACITY * 3);

  const tubes = app.game.tubes;
  const pour = app.pour;

  // Pre-compute pour overrides if active.  Source loses layers from the
  // top; dest gains them at the top.  The dest's *new* top is the
  // pouring liquid (`pour.liquid`), so we override that color slot.
  let pourSrcLayers_ = -1;
  let pourDstLayers_ = -1;
  if (pour) {
    pourSrcLayers_ = pourSrcLayers(pour);
    pourDstLayers_ = pourDstLayers(pour);
  }

  for (let t = 0; t < tubes.length; t++) {
    const tube = tubes[t]!;
    const cx = app.centerXs[t]!;
    let cy = TUBE_BASE_CY;
    let glow = 0;
    let tilt = 0;
    let renderedLayerCount = tube.tokens.length;

    // Selection lift only applies when no pour is active.
    if (!pour && app.selected === t) {
      cy += LIFT_AMOUNT;
      glow += SELECTION_GLOW_BOOST;
    }

    if (pour && pour.src === t) {
      cy += pourLiftSrc(pour);
      tilt = pourTilt(pour);
      renderedLayerCount = pourSrcLayers_;
    } else if (pour && pour.dst === t) {
      renderedLayerCount = pourDstLayers_;
    }

    centers[t * 2] = cx;
    centers[t * 2 + 1] = cy;
    layerCounts[t] = renderedLayerCount;
    tilts[t] = tilt;

    // Pack layer colors from the *current GameState*; for the dst tube
    // during a pour we additionally fill the in-flight layers with the
    // pouring color so the fill animation renders correctly.
    for (let i = 0; i < tube.tokens.length; i++) {
      const id = tube.tokens[i]!;
      const c = liquidVisual(id).color;
      const off = (t * MAX_CAPACITY + i) * 3;
      layerColors[off] = c[0];
      layerColors[off + 1] = c[1];
      layerColors[off + 2] = c[2];
    }
    if (pour && pour.dst === t) {
      const c = liquidVisual(pour.liquid).color;
      // Layers already in the dst from pre-pour state are at indices
      // [0 .. pour.dstLayersAtStart-1].  In-flight tokens land at
      // [dstLayersAtStart .. renderedLayerCount-1].
      for (let i = pour.dstLayersAtStart; i < renderedLayerCount; i++) {
        const off = (t * MAX_CAPACITY + i) * 3;
        layerColors[off] = c[0];
        layerColors[off + 1] = c[1];
        layerColors[off + 2] = c[2];
      }
    }

    // Top-layer glow.  Selection bonus already applied above.
    const topRendered = renderedLayerCount > 0
      ? (pour && pour.dst === t && renderedLayerCount > pour.dstLayersAtStart
        ? pour.liquid
        : (tube.tokens.length > 0 && renderedLayerCount > 0
          ? tube.tokens[Math.min(renderedLayerCount, tube.tokens.length) - 1]!
          : null))
      : null;
    if (topRendered) glow += liquidVisual(topRendered).glow * 0.5;
    glows[t] = glow;
  }

  return { centers, layerCounts, glows, tilts, layerColors, count: tubes.length };
}

// ---------------------------------------------------------------------------
// Pass execution
// ---------------------------------------------------------------------------

function drawBackdrop(pipe: Pipeline, timeS: number): void {
  const { gl } = pipe.ctx;
  const { backdrop } = pipe;
  bindFboTarget(gl, pipe.fbo);
  gl.disable(gl.BLEND);
  gl.useProgram(backdrop.program);
  gl.uniform1f(backdrop.uniforms.loc('u_time'), timeS);
  gl.uniform1f(backdrop.uniforms.loc('u_aspect'), pipe.ctx.width / pipe.ctx.height);
  gl.bindVertexArray(backdrop.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

function drawShadows(pipe: Pipeline, packed: PackedTubes): void {
  const { gl } = pipe.ctx;
  const { shadow } = pipe;
  bindFboTarget(gl, pipe.fbo);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.DST_COLOR, gl.ZERO);
  gl.useProgram(shadow.program);
  gl.uniform1f(shadow.uniforms.loc('u_aspect'), pipe.ctx.width / pipe.ctx.height);
  gl.uniform1f(shadow.uniforms.loc('u_tubeRadius'), TUBE_RADIUS);
  gl.uniform1f(shadow.uniforms.loc('u_tubeHeight'), TUBE_HEIGHT);
  gl.uniform1i(shadow.uniforms.loc('u_tubeCount'), packed.count);
  gl.uniform2fv(shadow.uniforms.loc('u_tubeCenter'), packed.centers);
  gl.bindVertexArray(shadow.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
}

function drawScene(pipe: Pipeline, packed: PackedTubes, capacity: number): void {
  const { gl } = pipe.ctx;
  const { scene } = pipe;
  bindCanvasTarget(pipe.ctx);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(scene.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pipe.fbo.texture);
  gl.uniform1i(scene.uniforms.loc('u_backdrop'), 0);

  gl.uniform1f(scene.uniforms.loc('u_aspect'), pipe.ctx.width / pipe.ctx.height);
  gl.uniform1f(scene.uniforms.loc('u_tubeRadius'), TUBE_RADIUS);
  gl.uniform1f(scene.uniforms.loc('u_tubeHeight'), TUBE_HEIGHT);
  gl.uniform1f(scene.uniforms.loc('u_wallThickness'), WALL_THICKNESS);
  gl.uniform1i(scene.uniforms.loc('u_capacity'), capacity);
  gl.uniform1i(scene.uniforms.loc('u_tubeCount'), packed.count);
  gl.uniform2fv(scene.uniforms.loc('u_tubeCenter'), packed.centers);
  gl.uniform1iv(scene.uniforms.loc('u_layerCount'), packed.layerCounts);
  gl.uniform1fv(scene.uniforms.loc('u_glow'), packed.glows);
  gl.uniform1fv(scene.uniforms.loc('u_tubeTilt'), packed.tilts);
  gl.uniform3fv(scene.uniforms.loc('u_layerColor'), packed.layerColors);

  gl.bindVertexArray(scene.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

// ---------------------------------------------------------------------------
// Pointer input
// ---------------------------------------------------------------------------

/**
 * Convert a clientX/clientY pair to tube-space.  The mapping mirrors the
 * scene shader: NDC = uv*2-1, multiplied by (aspect, 1).  y is flipped
 * since DOM y grows downward.
 */
function clientToTubeSpace(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const u = (clientX - rect.left) / rect.width;
  const v = 1 - (clientY - rect.top) / rect.height;
  const aspect = rect.width / rect.height;
  return { x: (u * 2 - 1) * aspect, y: v * 2 - 1 };
}

/**
 * Tube hit test in tube-space.  Returns the tube index whose body
 * contains the point, or -1.  (Inflated very slightly so finger-tap
 * targets exceed glass silhouette by a touch — important for mobile.)
 */
function pickTube(app: AppState, p: { x: number; y: number }): number {
  const TAP_INFLATE = 0.012;
  for (let i = 0; i < app.game.tubes.length; i++) {
    const cx = app.centerXs[i]!;
    let cy = TUBE_BASE_CY;
    if (app.selected === i) cy += LIFT_AMOUNT;
    // Capsule with flat top, hemispherical bottom — same SDF as the shader.
    const localX = p.x - cx;
    const localY = p.y - cy;
    const yClamped = Math.max(-TUBE_HEIGHT, Math.min(TUBE_HEIGHT, localY));
    const dx = localX;
    const dy = localY - yClamped;
    const d = Math.hypot(dx, dy) - TUBE_RADIUS;
    const dTop = localY - TUBE_HEIGHT;
    const sdf = Math.max(d, dTop);
    if (sdf < TAP_INFLATE) return i;
  }
  return -1;
}

function handleTubeClick(app: AppState, idx: number): AppState {
  // Lock input during an active pour.
  if (app.pour) return app;

  if (idx < 0) {
    return { ...app, selected: null };
  }
  if (app.selected === null) {
    // Don't bother selecting an empty tube — there's nothing to pour.
    if (app.game.tubes[idx]!.tokens.length === 0) return app;
    return { ...app, selected: idx };
  }
  if (app.selected === idx) {
    return { ...app, selected: null };
  }
  // Two distinct tubes — try to start a pour animation.
  if (canPour(app.game, app.selected, idx)) {
    const src = app.game.tubes[app.selected]!;
    const dst = app.game.tubes[idx]!;
    const liquid = topOf(src)!;
    const amount = pourAmount(app.game, app.selected, idx);
    const srcX = app.centerXs[app.selected]!;
    const dstX = app.centerXs[idx]!;
    const tiltSign = dstX >= srcX ? 1 : -1;
    const visc = liquidVisual(liquid).viscosity;
    const pour = startPour({
      src: app.selected,
      dst: idx,
      amount,
      liquid,
      srcLayers: src.tokens.length,
      dstLayers: dst.tokens.length,
      tiltSign,
      viscosity: visc,
    });
    return { ...app, pour, selected: null };
  }
  // Illegal pour: move selection to the new tube.
  return { ...app, selected: idx };
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

function render(pipe: Pipeline, app: AppState, timeS: number): void {
  const { gl, canvas } = pipe.ctx;
  resize(pipe.ctx);
  resizeFbo(gl, pipe.fbo, canvas.width, canvas.height);
  const packed = packTubeUniforms(app);
  drawBackdrop(pipe, timeS);
  drawShadows(pipe, packed);
  drawScene(pipe, packed, app.game.capacity);
}

function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) throw new Error('Canvas #stage missing from DOM');

  const pipe = setupPipeline(canvas);
  let app = makeAppState(level001 as Level);

  canvas.addEventListener('pointerdown', (e) => {
    const p = clientToTubeSpace(canvas, e.clientX, e.clientY);
    const idx = pickTube(app, p);
    app = handleTubeClick(app, idx);
  });

  // Keyboard nudge — Day 14 polishes this; here as a freebie for testing.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') app = { ...app, selected: null };
    if (e.key === 'r' || e.key === 'R') {
      app = makeAppState(level001 as Level);
    }
  });

  const t0 = performance.now();
  let prevMs = t0;
  let acc = 0;
  void FIXED_STEP;

  function loop(nowMs: number): void {
    const dt = Math.min(0.1, (nowMs - prevMs) / 1000);
    prevMs = nowMs;
    acc += dt;
    while (acc >= FIXED_STEP) {
      acc -= FIXED_STEP;
      // Sim step.  Currently only the pour state machine; Day 7 adds
      // the surface height field per tube.
      if (app.pour) {
        const finished = stepPour(app.pour, FIXED_STEP);
        if (finished) {
          // Commit the pour to the pure GameState now that the
          // animation has finished.
          const next = applyPour(app.game, app.pour.src, app.pour.dst);
          app = { ...app, game: next, pour: null };
        }
      }
    }
    const timeS = (nowMs - t0) / 1000;
    render(pipe, app, timeS);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) prevMs = performance.now();
  });
}

try {
  start();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  const overlay = document.createElement('pre');
  overlay.style.cssText =
    'position:fixed;inset:0;margin:auto;padding:2rem;max-width:50ch;height:fit-content;' +
    'background:#ead7b4;color:#2a1a0e;font-family:Garamond,serif;font-size:18px;' +
    'border:1px solid #c9a25a;white-space:pre-wrap;line-height:1.4;z-index:9999';
  overlay.textContent = `The Patient Hand could not start.\n\n${msg}`;
  document.body.appendChild(overlay);
  console.error(err);
}
