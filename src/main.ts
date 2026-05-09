/**
 * The Patient Hand — entry point.
 *
 * Day 1 scope: bring up the WebGL2 context, run a fixed-step render loop
 * with an accumulator, and draw a placeholder warm-lamplight gradient so
 * we can prove the pipeline works end-to-end before the glass shader
 * arrives on Day 2.
 *
 * Strict separation per the design doc:
 *   game/  — pure logic, no rendering
 *   sim/   — visual physics (height field, particles, pour state machine)
 *   render/— GPU work
 *   audio/ — Web Audio mixer
 *   ui/    — HTML/CSS overlay
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
import { SCAFFOLD_FRAG, SCAFFOLD_VERT } from '@/render/shaders/scaffold';

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

const FIXED_STEP = 1 / 240; // 240 Hz internal sim, per design doc surface sim spec

function setupRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = createContext(canvas);
  const { gl } = ctx;

  const program = createProgram(gl, SCAFFOLD_VERT, SCAFFOLD_FRAG, 'scaffold');
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

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(r.program);
  gl.uniform1f(r.uniforms.loc('u_time'), timeS);
  gl.uniform2f(r.uniforms.loc('u_resolution'), width, height);

  gl.bindVertexArray(r.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (!canvas) throw new Error('Canvas #stage missing from DOM');

  const renderer = setupRenderer(canvas);

  const frame: Frame = { t0: performance.now(), prevMs: performance.now(), acc: 0 };

  // Surface the sim step to future code without committing to a payload yet.
  void FIXED_STEP;

  function loop(nowMs: number): void {
    const dt = Math.min(0.1, (nowMs - frame.prevMs) / 1000); // clamp to 100ms
    frame.prevMs = nowMs;

    // Day 1 has no sim; the accumulator is wired up so day 5 can step.
    frame.acc += dt;
    while (frame.acc >= FIXED_STEP) {
      frame.acc -= FIXED_STEP;
      // step(FIXED_STEP)  — to be filled in on Day 5.
    }

    const timeS = (nowMs - frame.t0) / 1000;
    render(renderer, timeS);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  // Pause-on-hide hook for the future. Today it just resets the prev timestamp
  // so the next frame doesn't see a multi-second dt.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) frame.prevMs = performance.now();
  });
}

// Surface bootstrap errors visibly. A blank black screen is the worst
// possible failure mode; turn it into a parchment with the error text.
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
