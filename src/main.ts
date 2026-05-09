/**
 * The Patient Hand — entry point.
 *
 * Day 7: height-field surface sim, splash impulse on pour impact, and
 * CPU particle splash droplets rendered as GL POINTS.
 *
 * Pipeline:
 *   Pass 1 (FBO):    apothecary backdrop (procedural).
 *   Pass 2 (FBO):    drop shadows under each tube (multiply blend).
 *   Pass 3 (canvas): scene shader — multi-tube layered liquid + glass,
 *                    samples backdrop FBO for refraction.  Meniscus
 *                    perturbed by the per-tube wave height field.
 *   Pass 4 (canvas): pour stream — Bezier curve, premult-alpha blend.
 *   Pass 5 (canvas): particles — GL POINTS, premult-alpha blend.
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
  SURFACE_SAMPLES,
} from '@/render/shaders/scene';
import { SHADOW_FRAG, SHADOW_VERT } from '@/render/shaders/shadow';
import { STREAM_FRAG, STREAM_VERT } from '@/render/shaders/stream';
import { PARTICLE_FRAG, PARTICLE_VERT } from '@/render/shaders/particles';

import { applyPour, canPour, pourAmount, topOf } from '@/game/rules';
import { type GameState, type LiquidId } from '@/game/state';
import { loadLevel, type Level } from '@/game/level';
import { liquidVisual } from '@/game/liquids';

import {
  type PourAnim,
  pourDstLayers,
  pourLiftSrc,
  pourSrcLayers,
  pourStreamOpacity,
  pourTilt,
  startPour,
  stepPour,
} from '@/sim/pour';

import {
  type SurfaceField,
  clampSurfaceField,
  createSurfaceField,
  resetSurfaceField,
  splashAt,
  stepSurfaceField,
} from '@/sim/surface';

import {
  type Particles,
  MAX_PARTICLES,
  createParticles,
  clearParticles,
  spawnSplash,
  stepParticles,
} from '@/sim/particles';

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

/** GL resources for the particle point-sprite pass. */
interface ParticleGl {
  program: WebGLProgram;
  uniforms: UniformCache;
  vao: WebGLVertexArrayObject;
  /** Dynamic STREAM_DRAW buffer: 6 floats/particle (x y r g b alpha). */
  buf: WebGLBuffer;
  /** CPU-side staging array, reused each frame. */
  staging: Float32Array;
}

interface Pipeline {
  ctx: GLContext;
  buf: WebGLBuffer;
  backdrop: ProgramRec;
  shadow: ProgramRec;
  scene: ProgramRec;
  stream: ProgramRec;
  particleGl: ParticleGl;
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

/** Build VAO + dynamic buffer for particle point-sprites. */
function setupParticleGl(gl: WebGL2RenderingContext): ParticleGl {
  const program = createProgram(gl, PARTICLE_VERT, PARTICLE_FRAG, 'particles');
  const uniforms = new UniformCache(gl, program);

  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Failed to allocate VAO (particles)');
  const buf = gl.createBuffer();
  if (!buf) throw new Error('Failed to allocate buffer (particles)');

  // 6 floats per vertex: posX posY r g b alpha
  const STRIDE = 6 * 4; // bytes
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // Pre-allocate for MAX_PARTICLES; data uploaded each frame.
  gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * STRIDE, gl.STREAM_DRAW);

  // layout(location = 0) in vec2 a_pos
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);
  // layout(location = 1) in vec3 a_color
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 2 * 4);
  // layout(location = 2) in float a_alpha
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 5 * 4);

  gl.bindVertexArray(null);

  return {
    program,
    uniforms,
    vao,
    buf,
    staging: new Float32Array(MAX_PARTICLES * 6),
  };
}

function setupPipeline(canvas: HTMLCanvasElement): Pipeline {
  const ctx = createContext(canvas);
  const { gl } = ctx;
  const buf = createStaticBuffer(gl, FULLSCREEN_TRI);
  const backdrop = makeProgram(gl, BACKDROP_VERT, BACKDROP_FRAG, 'backdrop', buf);
  const shadow = makeProgram(gl, SHADOW_VERT, SHADOW_FRAG, 'shadow', buf);
  const scene = makeProgram(gl, SCENE_VERT, SCENE_FRAG, 'scene', buf);
  const stream = makeProgram(gl, STREAM_VERT, STREAM_FRAG, 'stream', buf);
  const particleGl = setupParticleGl(gl);
  const fbo = createFbo(gl, canvas.width, canvas.height);
  return { ctx, buf, backdrop, shadow, scene, stream, particleGl, fbo };
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
  /** Per-tube wave height field for the meniscus. */
  surface: SurfaceField;
  /** CPU particle pool for splash droplets. */
  particles: Particles;
  /** Accumulator: frames since last splash spawn (throttle to ~30 Hz). */
  splashSpawnAcc: number;
}

function makeAppState(level: Level): AppState {
  const game = loadLevel(level);
  return {
    game,
    selected: null,
    centerXs: tubeCenterXs(game.tubes.length),
    pour: null,
    surface: createSurfaceField(game.tubes.length),
    particles: createParticles(),
    splashSpawnAcc: 0,
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
  /** float per (tube, sample) — flat MAX_TUBES * SURFACE_SAMPLES. */
  surfaceHeights: Float32Array;
  count: number;
}

function packTubeUniforms(app: AppState): PackedTubes {
  const centers = new Float32Array(MAX_TUBES * 2);
  const layerCounts = new Int32Array(MAX_TUBES);
  const glows = new Float32Array(MAX_TUBES);
  const tilts = new Float32Array(MAX_TUBES);
  const layerColors = new Float32Array(MAX_TUBES * MAX_CAPACITY * 3);
  const surfaceHeights = new Float32Array(MAX_TUBES * SURFACE_SAMPLES);
  // Copy current sim heights into the (potentially larger) uniform array.
  surfaceHeights.set(app.surface.heights);

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

  return {
    centers,
    layerCounts,
    glows,
    tilts,
    layerColors,
    surfaceHeights,
    count: tubes.length,
  };
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
  gl.uniform1fv(scene.uniforms.loc('u_surfaceHeights'), packed.surfaceHeights);

  gl.bindVertexArray(scene.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

// ---------------------------------------------------------------------------
// Stream rendering
// ---------------------------------------------------------------------------

/**
 * Inverse of the shader's toTubeLocal: given a point expressed in the
 * tube's upright local frame (origin at center, y up), return its
 * world position taking the tube's tilt + base-pivot rotation.
 */
function localToWorld(
  local: { x: number; y: number },
  centerX: number,
  centerY: number,
  tilt: number,
): { x: number; y: number } {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  // Pivot is (centerX, centerY - TUBE_HEIGHT).  Local point in the
  // pivot-relative frame is local + (0, +TUBE_HEIGHT).
  const lx = local.x;
  const ly = local.y + TUBE_HEIGHT;
  // R(+tilt): (cx*x - s*y, s*x + c*y).
  const wx = c * lx - s * ly;
  const wy = s * lx + c * ly;
  return { x: centerX + wx, y: centerY - TUBE_HEIGHT + wy };
}

interface StreamPoints {
  /** Source lip in world (tube-space). */
  p0x: number;
  p0y: number;
  /** Bezier control point. */
  p1x: number;
  p1y: number;
  /** Dst impact in world (tube-space). */
  p2x: number;
  p2y: number;
}

/** Compute Bezier control points for the active pour stream. */
function streamPoints(app: AppState, pour: PourAnim, timeS: number): StreamPoints {
  const srcCx = app.centerXs[pour.src]!;
  const dstCx = app.centerXs[pour.dst]!;
  const tilt = pourTilt(pour);
  const lift = pourLiftSrc(pour);
  // Source lip is on the side of the tube facing dst.  In upright local
  // frame, that's at x = -tiltSign * TUBE_RADIUS (see PourAnim.tiltSign).
  const lipLocal = { x: -pour.tiltSign * TUBE_RADIUS, y: TUBE_HEIGHT };
  const lipWorld = localToWorld(lipLocal, srcCx, TUBE_BASE_CY + lift, tilt);

  // Impact: top of dst's current liquid level.  Dst stays upright.
  const dstLayers = pourDstLayers(pour);
  const layerH = (2 * TUBE_HEIGHT) / app.game.capacity;
  const impactY = TUBE_BASE_CY - TUBE_HEIGHT + dstLayers * layerH;
  const impactX = dstCx;

  // Control point: midway between p0 and p2, lifted slightly above
  // the higher of the two endpoints, plus a small time-varying wobble.
  const midX = (lipWorld.x + impactX) * 0.5;
  const midY = Math.max(lipWorld.y, impactY) + 0.07;
  const wobble = 0.012 * Math.sin(timeS * 6.5);
  return {
    p0x: lipWorld.x,
    p0y: lipWorld.y,
    p1x: midX + wobble,
    p1y: midY,
    p2x: impactX,
    p2y: impactY,
  };
}

function drawStream(pipe: Pipeline, app: AppState, timeS: number): void {
  const pour = app.pour;
  if (!pour) return;
  const opacity = pourStreamOpacity(pour);
  if (opacity <= 0) return;

  const { gl } = pipe.ctx;
  const { stream } = pipe;
  const pts = streamPoints(app, pour, timeS);
  const visual = liquidVisual(pour.liquid);

  // Premultiplied-alpha blend so the stream brightens the scene where it
  // crosses high-luminance fragments without blowing out.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  gl.useProgram(stream.program);
  gl.uniform1f(stream.uniforms.loc('u_time'), timeS);
  gl.uniform1f(stream.uniforms.loc('u_aspect'), pipe.ctx.width / pipe.ctx.height);
  gl.uniform2f(stream.uniforms.loc('u_p0'), pts.p0x, pts.p0y);
  gl.uniform2f(stream.uniforms.loc('u_p1'), pts.p1x, pts.p1y);
  gl.uniform2f(stream.uniforms.loc('u_p2'), pts.p2x, pts.p2y);
  gl.uniform3f(
    stream.uniforms.loc('u_streamColor'),
    visual.color[0],
    visual.color[1],
    visual.color[2],
  );
  gl.uniform1f(stream.uniforms.loc('u_streamOpacity'), opacity);
  // Slightly thicker at source, thinner at impact.
  gl.uniform1f(stream.uniforms.loc('u_streamWidth0'), 0.014);
  gl.uniform1f(stream.uniforms.loc('u_streamWidth1'), 0.009);

  gl.bindVertexArray(stream.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);

  gl.disable(gl.BLEND);
}

// ---------------------------------------------------------------------------
// Particle rendering
// ---------------------------------------------------------------------------

/** Pack alive particles into the staging buffer; return vertex count. */
function packParticles(particles: Particles, staging: Float32Array): number {
  const FIELDS = 6; // posX posY velX velY age ttl — in the sim's flat array
  let count = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const off = i * FIELDS;
    const ttl = particles.data[off + 5] ?? 0;
    if (ttl === 0) continue;
    const age = particles.data[off + 4] ?? 0;
    if (age >= ttl) continue;

    const x = particles.data[off + 0] ?? 0;
    const y = particles.data[off + 1] ?? 0;
    const r = particles.colors[i * 3 + 0] ?? 0;
    const g = particles.colors[i * 3 + 1] ?? 0;
    const b = particles.colors[i * 3 + 2] ?? 0;

    // Alpha: fade in quickly, fade out over last 40% of life.
    const life = age / ttl;
    const alpha = life < 0.1 ? life / 0.1 : 1.0 - Math.max(0, (life - 0.6) / 0.4);

    const s = count * 6;
    staging[s + 0] = x;
    staging[s + 1] = y;
    staging[s + 2] = r;
    staging[s + 3] = g;
    staging[s + 4] = b;
    staging[s + 5] = Math.max(0, alpha);
    count++;
  }
  return count;
}

function drawParticles(pipe: Pipeline, app: AppState): void {
  if (app.particles.alive === 0) return;

  const { gl } = pipe.ctx;
  const pg = pipe.particleGl;

  const count = packParticles(app.particles, pg.staging);
  if (count === 0) return;

  // Upload only the live portion of the staging buffer.
  gl.bindBuffer(gl.ARRAY_BUFFER, pg.buf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, pg.staging.subarray(0, count * 6));

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  gl.useProgram(pg.program);
  gl.uniform1f(pg.uniforms.loc('u_aspect'), pipe.ctx.width / pipe.ctx.height);
  // Point size in pixels — scale with canvas height so droplets are
  // proportionally sized on all displays.  Clamped to a sensible range.
  const pxSize = Math.max(3, Math.min(12, pipe.ctx.canvas.height * 0.012));
  gl.uniform1f(pg.uniforms.loc('u_pointSize'), pxSize);

  gl.bindVertexArray(pg.vao);
  gl.drawArrays(gl.POINTS, 0, count);
  gl.bindVertexArray(null);

  gl.disable(gl.BLEND);
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
    // Tube must tip *toward* dst.  See PourAnim.tiltSign docstring for
    // why dst-on-the-right means a negative-signed tilt angle.
    const tiltSign = dstX >= srcX ? -1 : 1;
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
  drawStream(pipe, app, timeS);
  drawParticles(pipe, app);
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
    if (e.key === ' ') {
      // Spacebar: nudge a small splash on every tube, for testing the
      // surface sim independently of pours.
      for (let t = 0; t < app.surface.tubeCount; t++) {
        splashAt(app.surface, t, SURFACE_SAMPLES * 0.5, 0.3);
      }
    }
  });

  void resetSurfaceField; // used in makeAppState path; suppress unused lint
  void clearParticles;    // available for level-reset; suppress unused lint

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
      // Sim step (240 Hz):
      //   1. Pour state machine.
      //   2. Surface wave field per tube.
      //   3. Splash impulses + particle spawns on the dst tube during DRAIN.
      //   4. Particle physics.
      if (app.pour) {
        const finished = stepPour(app.pour, FIXED_STEP);

        // Splash impulse on the destination during drain phase.  Splash
        // column maps the impact x to a surface sample index.  Power
        // scales with how rapidly the level is rising (drain rate).
        if (app.pour.phase === 'drain') {
          const impactCol = (SURFACE_SAMPLES - 1) * 0.5; // dst is upright; impact at center
          // Roughly one impulse per drain tick — modulate so we don't
          // over-spike the field.  power magnitude tuned by smoke runs.
          const power = 0.5 * FIXED_STEP * 60;
          splashAt(app.surface, app.pour.dst, impactCol, power);

          // Spawn splash particles at ~30 Hz (every 8th sim step).
          app.splashSpawnAcc += FIXED_STEP;
          const SPLASH_INTERVAL = 1 / 30;
          if (app.splashSpawnAcc >= SPLASH_INTERVAL) {
            app.splashSpawnAcc -= SPLASH_INTERVAL;
            const dstCx = app.centerXs[app.pour.dst]!;
            const dstLayers = pourDstLayers(app.pour);
            const layerH = (2 * TUBE_HEIGHT) / app.game.capacity;
            const impactY = TUBE_BASE_CY - TUBE_HEIGHT + dstLayers * layerH;
            const visual = liquidVisual(app.pour.liquid);
            // 2–4 particles per burst — small but visible.
            const burstCount = 2 + Math.floor(Math.random() * 3);
            spawnSplash(app.particles, dstCx, impactY, visual.color, burstCount);
          }
        }

        if (finished) {
          // Commit the pour to the pure GameState; the visible layer
          // counts of src/dst now match the actual GameState content.
          const next = applyPour(app.game, app.pour.src, app.pour.dst);
          app = { ...app, game: next, pour: null, splashSpawnAcc: 0 };
        }
      }

      // Step surface waves.
      stepSurfaceField(app.surface, FIXED_STEP);
      clampSurfaceField(app.surface, 0.6);

      // Step particles (gravity + aging).
      stepParticles(app.particles, FIXED_STEP);
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
