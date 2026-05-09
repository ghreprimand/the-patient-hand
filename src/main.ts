/**
 * The Patient Hand — entry point.
 *
 * Day 2 scope: replace the placeholder gradient with the glass-tube shader
 * prototype.  A single fragment-shader-driven tube sits in the middle of
 * the apothecary backdrop.  Refraction, rim, specular, liquid, meniscus —
 * all evaluated per-fragment.  Days 3+ split this into a backdrop FBO +
 * per-tube quads, but the shader logic carries over.
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
import { GLASS_FRAG, GLASS_VERT } from '@/render/shaders/glass';

interface Frame {
  /** Wall-clock ms at boot. */
  t0: number;
  /** Last requestAnimationFrame timestamp in ms. */
  prevMs: number;
  /** Accumulator for the fixed-step physics tick (Day 5+). */
  acc: number;
}

interface Renderer {
  ctx: GLContext;
  program: WebGLProgram;
  uniforms: UniformCache;
  vao: WebGLVertexArrayObject;
}

/** 240 Hz internal sim step, per design doc surface-sim spec. */
const FIXED_STEP = 1 / 240;

/**
 * Day 2 fixed scene: a single tube, half-full of cinnabar, centered.
 * Day 4 makes these per-tube data driven by game state.
 */
const SCENE = {
  tubeCenter: [0, -0.05] as [number, number],
  tubeRadius: 0.16,
  tubeHeight: 0.55,
  wallThickness: 0.018,
  fillLevel: 0.62,
  // Cinnabar from the design doc liquid table (#c8312a)
  liquidColor: [0xc8 / 255, 0x31 / 255, 0x2a / 255] as [number, number, number],
  liquidGlow: 0.22,
};

function setupRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = createContext(canvas);
  const { gl } = ctx;

  const program = createProgram(gl, GLASS_VERT, GLASS_FRAG, 'glass');
  const uniforms = new UniformCache(gl, program);
  const buf = createStaticBuffer(gl, FULLSCREEN_TRI);

  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Failed to allocate VAO');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return { ctx, program, uniforms, vao };
}

function render(r: Renderer, timeS: number): void {
  const { gl, width, height } = r.ctx;
  resize(r.ctx);

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(r.program);
  const aspect = width / height;

  gl.uniform1f(r.uniforms.loc('u_time'), timeS);
  gl.uniform1f(r.uniforms.loc('u_aspect'), aspect);
  gl.uniform2f(
    r.uniforms.loc('u_tubeCenter'),
    SCENE.tubeCenter[0],
    SCENE.tubeCenter[1],
  );
  gl.uniform1f(r.uniforms.loc('u_tubeRadius'), SCENE.tubeRadius);
  gl.uniform1f(r.uniforms.loc('u_tubeHeight'), SCENE.tubeHeight);
  gl.uniform1f(r.uniforms.loc('u_wallThickness'), SCENE.wallThickness);
  gl.uniform1f(r.uniforms.loc('u_fillLevel'), SCENE.fillLevel);
  gl.uniform3f(
    r.uniforms.loc('u_liquidColor'),
    SCENE.liquidColor[0],
    SCENE.liquidColor[1],
    SCENE.liquidColor[2],
  );
  gl.uniform1f(r.uniforms.loc('u_liquidGlow'), SCENE.liquidGlow);

  gl.bindVertexArray(r.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) throw new Error('Canvas #stage missing from DOM');

  const renderer = setupRenderer(canvas);

  const frame: Frame = { t0: performance.now(), prevMs: performance.now(), acc: 0 };
  void FIXED_STEP;

  function loop(nowMs: number): void {
    const dt = Math.min(0.1, (nowMs - frame.prevMs) / 1000);
    frame.prevMs = nowMs;

    frame.acc += dt;
    while (frame.acc >= FIXED_STEP) {
      frame.acc -= FIXED_STEP;
      // step(FIXED_STEP) — Day 5 wires this up.
    }

    const timeS = (nowMs - frame.t0) / 1000;
    render(renderer, timeS);
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
