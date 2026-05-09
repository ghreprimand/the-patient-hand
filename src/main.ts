/**
 * The Patient Hand — entry point.
 *
 * Day 3 scope: full apothecary scene.  Three-pass pipeline.
 *
 *   Pass 1 (FBO target):  apothecary backdrop — wall, leaded window,
 *                         walnut shelf, brass strip, oil lamp pool.
 *   Pass 2 (FBO target):  drop shadows under each tube (multiply blend).
 *   Pass 3 (canvas):      multi-tube scene shader; samples the FBO for
 *                         backdrop refraction, evaluates up to MAX_TUBES
 *                         glass+liquid SDFs.
 *
 * The 240Hz fixed-step accumulator is kept wired but unused; Day 5 fills
 * in the pour state machine.
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
import { MAX_TUBES, SCENE_FRAG, SCENE_VERT } from '@/render/shaders/scene';
import { SHADOW_FRAG, SHADOW_VERT } from '@/render/shaders/shadow';

/** 240 Hz internal sim step, per design doc surface-sim spec. */
const FIXED_STEP = 1 / 240;

interface Frame {
  t0: number;
  prevMs: number;
  acc: number;
}

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

/**
 * One tube's runtime state for rendering.  Day 4 will derive these from
 * the pure game state (`Tube` arrays of LiquidId).
 */
interface TubeView {
  /** Center in tube-space: x ∈ [-aspect, +aspect], y ∈ [-1, +1]. */
  cx: number;
  cy: number;
  /** Fill ratio [0..1]. */
  fill: number;
  /** RGB in 0..1 per channel. */
  color: [number, number, number];
  /** Emissive bonus 0..1. */
  glow: number;
}

// ---- Liquid palette (subset of the design doc's 12-liquid table) -----------
// Day 11 promotes this to liquids.json.  Hex values come straight from the
// design doc Liquid Personality Table.
const LIQUID = {
  cinnabar:    rgb('#c8312a'),
  lapis:       rgb('#1c46a8'),
  verdigris:   rgb('#3d8a6e'),
  saffron:     rgb('#e0a02c'),
  amethyst:    rgb('#7c3a8d'),
  quicksilver: rgb('#9aa0a8'),
} as const;

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

// Shared tube geometry.  All tubes the same size in v1.
const TUBE_RADIUS = 0.115;
const TUBE_HEIGHT = 0.42;
const WALL_THICKNESS = 0.018;

// Place six tubes on the shelf.  Tube-space y of the shelf top:
//   v_uv y = SHELF_Y  →  tube-space y = SHELF_Y * 2 - 1 = -0.36
// A tube whose center sits at (cx, -0.36 + TUBE_HEIGHT) has its rounded
// base resting *on* the shelf horizon.  Slight bonus to embed the curve.
const SHELF_TOP_TS = SHELF_Y * 2 - 1; // ≈ -0.36
const TUBE_CY = SHELF_TOP_TS + TUBE_HEIGHT - 0.01;

/**
 * Tube X centers in tube-space.  Spacing chosen so 6 tubes fit comfortably
 * at common aspect ratios (≥ 1.2).  Phone-portrait aspect (≈ 0.5) will
 * compress; layout responsiveness is a Day 8 concern.
 */
const TUBE_SPACING = TUBE_RADIUS * 2.7;
const TUBE_CXS = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((k) => k * TUBE_SPACING);

/** Day 3 demo arrangement showing off the palette and varied fills. */
const TUBES: TubeView[] = [
  { cx: TUBE_CXS[0]!, cy: TUBE_CY, fill: 0.92, color: LIQUID.cinnabar,    glow: 0.18 },
  { cx: TUBE_CXS[1]!, cy: TUBE_CY, fill: 0.55, color: LIQUID.lapis,       glow: 0.22 },
  { cx: TUBE_CXS[2]!, cy: TUBE_CY, fill: 0.74, color: LIQUID.verdigris,   glow: 0.20 },
  { cx: TUBE_CXS[3]!, cy: TUBE_CY, fill: 0.30, color: LIQUID.saffron,     glow: 0.30 },
  { cx: TUBE_CXS[4]!, cy: TUBE_CY, fill: 0.00, color: LIQUID.quicksilver, glow: 0.00 }, // empty
  { cx: TUBE_CXS[5]!, cy: TUBE_CY, fill: 0.62, color: LIQUID.amethyst,    glow: 0.24 },
];

// ----------------------------------------------------------------------------
// Pipeline setup
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// Per-pass uniform setters
// ----------------------------------------------------------------------------

function packTubeArrays(): {
  centers: Float32Array;
  fills: Float32Array;
  colors: Float32Array;
  glows: Float32Array;
  count: number;
} {
  const centers = new Float32Array(MAX_TUBES * 2);
  const fills = new Float32Array(MAX_TUBES);
  const colors = new Float32Array(MAX_TUBES * 3);
  const glows = new Float32Array(MAX_TUBES);
  for (let i = 0; i < TUBES.length; i++) {
    const t = TUBES[i]!;
    centers[i * 2] = t.cx;
    centers[i * 2 + 1] = t.cy;
    fills[i] = t.fill;
    colors[i * 3] = t.color[0];
    colors[i * 3 + 1] = t.color[1];
    colors[i * 3 + 2] = t.color[2];
    glows[i] = t.glow;
  }
  return { centers, fills, colors, glows, count: TUBES.length };
}

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

function drawShadows(pipe: Pipeline, packed: ReturnType<typeof packTubeArrays>): void {
  const { gl } = pipe.ctx;
  const { shadow } = pipe;

  bindFboTarget(gl, pipe.fbo);
  // Multiply blend: dst = dst * src.
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

function drawScene(pipe: Pipeline, packed: ReturnType<typeof packTubeArrays>): void {
  const { gl } = pipe.ctx;
  const { scene } = pipe;

  bindCanvasTarget(pipe.ctx);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(scene.program);

  // Backdrop FBO at texture unit 0.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pipe.fbo.texture);
  gl.uniform1i(scene.uniforms.loc('u_backdrop'), 0);

  gl.uniform1f(scene.uniforms.loc('u_aspect'), pipe.ctx.width / pipe.ctx.height);
  gl.uniform1f(scene.uniforms.loc('u_tubeRadius'), TUBE_RADIUS);
  gl.uniform1f(scene.uniforms.loc('u_tubeHeight'), TUBE_HEIGHT);
  gl.uniform1f(scene.uniforms.loc('u_wallThickness'), WALL_THICKNESS);
  gl.uniform1i(scene.uniforms.loc('u_tubeCount'), packed.count);
  gl.uniform2fv(scene.uniforms.loc('u_tubeCenter'), packed.centers);
  gl.uniform1fv(scene.uniforms.loc('u_fillLevel'), packed.fills);
  gl.uniform3fv(scene.uniforms.loc('u_liquidColor'), packed.colors);
  gl.uniform1fv(scene.uniforms.loc('u_liquidGlow'), packed.glows);

  gl.bindVertexArray(scene.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

// ----------------------------------------------------------------------------
// Frame loop
// ----------------------------------------------------------------------------

function render(pipe: Pipeline, timeS: number): void {
  const { gl, canvas } = pipe.ctx;
  resize(pipe.ctx);
  resizeFbo(gl, pipe.fbo, canvas.width, canvas.height);

  const packed = packTubeArrays();
  drawBackdrop(pipe, timeS);
  drawShadows(pipe, packed);
  drawScene(pipe, packed);
}

function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) throw new Error('Canvas #stage missing from DOM');

  const pipe = setupPipeline(canvas);

  const frame: Frame = { t0: performance.now(), prevMs: performance.now(), acc: 0 };
  void FIXED_STEP;

  function loop(nowMs: number): void {
    const dt = Math.min(0.1, (nowMs - frame.prevMs) / 1000);
    frame.prevMs = nowMs;

    frame.acc += dt;
    while (frame.acc >= FIXED_STEP) {
      frame.acc -= FIXED_STEP;
      // step(FIXED_STEP) — Day 5+ wires this.
    }

    const timeS = (nowMs - frame.t0) / 1000;
    render(pipe, timeS);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) frame.prevMs = performance.now();
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
