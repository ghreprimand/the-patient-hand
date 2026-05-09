/**
 * Tiny WebGL2 wrapper.
 *
 * Goals:
 *  - Throw early and clearly when GL state is wrong (no silent NaN frames).
 *  - Stay small. We need precise control over the glass shader; an abstraction
 *    that hides uniforms or shader sources fights us.
 *  - No state-tracking magic. Caller is responsible for ordering bind/draw,
 *    we just bundle the verbose calls into ergonomic helpers.
 */

export type GL = WebGL2RenderingContext;

export interface GLContext {
  readonly canvas: HTMLCanvasElement;
  readonly gl: GL;
  /** Logical CSS pixels (matches canvas client size). */
  width: number;
  /** Logical CSS pixels. */
  height: number;
  /** Device pixel ratio actually applied to the drawing buffer. */
  dpr: number;
}

/**
 * Acquire a WebGL2 context, fail loudly if unsupported.
 *
 * The design doc declares WebGL2 as a hard prerequisite (no WebGL1 fallback),
 * so an unsupported browser is a load-time error, not a degradation path.
 */
export function createContext(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    // Don't fail context creation on integrated GPUs; we tolerate them.
    failIfMajorPerformanceCaveat: false,
  }) as GL | null;

  if (!gl) {
    throw new Error(
      'WebGL2 is required by The Patient Hand. ' +
        'Your browser or device does not provide a WebGL2 context.',
    );
  }

  const ctx: GLContext = {
    canvas,
    gl,
    width: canvas.clientWidth || 1,
    height: canvas.clientHeight || 1,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };

  resize(ctx);
  return ctx;
}

/**
 * Resync drawing buffer size with CSS size + device pixel ratio.
 *
 * Cap DPR at 2 to avoid 4x-pixel-density iPads burning fillrate for no
 * perceptible benefit. The design doc's perf budget assumes this cap.
 */
export function resize(ctx: GLContext): boolean {
  const { canvas, gl } = ctx;
  const cssW = Math.max(1, canvas.clientWidth);
  const cssH = Math.max(1, canvas.clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetW = Math.round(cssW * dpr);
  const targetH = Math.round(cssH * dpr);

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
    ctx.width = cssW;
    ctx.height = cssH;
    ctx.dpr = dpr;
    gl.viewport(0, 0, targetW, targetH);
    return true;
  }

  return false;
}

/** Compile + link a single program. Throws with a useful message on failure. */
export function createProgram(
  gl: GL,
  vertexSrc: string,
  fragmentSrc: string,
  label = 'program',
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc, `${label}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc, `${label}.frag`);
  const prog = gl.createProgram();
  if (!prog) throw new Error(`Failed to allocate program (${label})`);

  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  // Shaders can be detached + deleted once linked; the program retains them.
  gl.detachShader(prog, vs);
  gl.detachShader(prog, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog) ?? '(no log)';
    gl.deleteProgram(prog);
    throw new Error(`Link failed for ${label}:\n${info}`);
  }

  return prog;
}

function compileShader(
  gl: GL,
  type: number,
  src: string,
  label: string,
): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error(`Failed to allocate shader (${label})`);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh) ?? '(no log)';
    gl.deleteShader(sh);
    throw new Error(`Compile failed for ${label}:\n${info}\n--- source ---\n${numberLines(src)}`);
  }
  return sh;
}

function numberLines(src: string): string {
  return src
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(3, ' ')}  ${line}`)
    .join('\n');
}

/**
 * Cache uniform locations on first lookup. The map key is the uniform name.
 * Locations can be -1 for uniforms the GLSL compiler optimized out; we
 * propagate that without throwing so callers can set unused uniforms cheaply.
 */
export class UniformCache {
  private readonly locs = new Map<string, WebGLUniformLocation | null>();
  constructor(
    private readonly gl: GL,
    private readonly prog: WebGLProgram,
  ) {}

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name);
      this.locs.set(name, l);
    }
    return l;
  }
}

/**
 * Create a static buffer from a Float32Array of vertex data, for `STATIC_DRAW`
 * geometry that doesn't change frame-to-frame (e.g. a fullscreen quad).
 */
export function createStaticBuffer(gl: GL, data: Float32Array): WebGLBuffer {
  const buf = gl.createBuffer();
  if (!buf) throw new Error('Failed to allocate buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buf;
}

/** Geometry for a fullscreen triangle (NDC coords). Three vertices. */
export const FULLSCREEN_TRI = new Float32Array([
  -1, -1, // bottom-left
  3, -1, // bottom-right (oversized)
  -1, 3, // top-left   (oversized)
]);
