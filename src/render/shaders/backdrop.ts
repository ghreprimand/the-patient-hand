/**
 * Apothecary backdrop — procedural fragment shader.
 *
 * The design doc reserves the option to swap this for AI-generated +
 * hand-finished art later (Day 3 / Day 13).  For now this is the entire
 * backdrop: walnut shelf, plaster back wall, oil lamp pool, leaded window,
 * brass fittings, vignette.  Renders to an FBO once per frame; the tube
 * shader samples it for refraction.
 *
 * Conventions:
 *   v_uv ∈ [0..1]   bottom-left to top-right
 *   y up
 *   Shelf surface horizon is at y ≈ SHELF_Y.  Tubes will be positioned to
 *   stand on this line.
 */

export const BACKDROP_VERT = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const BACKDROP_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 frag;

uniform float u_time;
uniform float u_aspect; // canvas width / height

// ----------------------------------------------------------------------------
// Cheap value-noise helpers.  These are visual noise, not crypto-quality —
// trig-based hashes are fine for the apothecary ambience.
// ----------------------------------------------------------------------------
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p *= 2.05;
    a *= 0.5;
  }
  return v;
}

// ----------------------------------------------------------------------------
// Constants — kept here so the tube layout code (in TS) can use the same
// shelf horizon.  Mirror these in src/render/scene.ts.
// ----------------------------------------------------------------------------
const float SHELF_Y      = 0.32;  // top of shelf surface, in v_uv space
const float SHELF_DEPTH  = 0.10;  // shelf board thickness
const float WALL_TOP     = 1.00;
const vec3  WALL_DEEP    = vec3(0.075, 0.054, 0.038);  // upper plaster
const vec3  WALL_SHALLOW = vec3(0.142, 0.099, 0.066);  // lower plaster, lit
const vec3  WOOD_LIGHT   = vec3(0.225, 0.140, 0.075);  // shelf top lit
const vec3  WOOD_DARK    = vec3(0.110, 0.062, 0.030);  // shelf shadow
const vec3  WOOD_DEEP    = vec3(0.060, 0.032, 0.014);  // under-shelf
const vec3  BRASS        = vec3(0.788, 0.633, 0.353);
const vec3  LAMP_WARM    = vec3(1.0, 0.83, 0.60);

// ----------------------------------------------------------------------------
// Wall: aged plaster with a vertical gradient and faint brushwork noise.
// ----------------------------------------------------------------------------
vec3 wallColor(vec2 uv) {
  // Vertical gradient: darker high, slightly warmer low.
  float t = smoothstep(SHELF_Y, WALL_TOP, uv.y);
  vec3 base = mix(WALL_SHALLOW, WALL_DEEP, t);

  // Plaster texture — large-scale fbm to break up flatness.
  float n = fbm(uv * vec2(2.5, 4.0)) * 0.6 + fbm(uv * vec2(12.0, 18.0)) * 0.10;
  base *= mix(0.85, 1.20, n);

  // Subtle horizontal water-stains low on the wall.
  float stainBand = smoothstep(0.55, 0.40, uv.y) * smoothstep(0.30, 0.34, uv.y);
  base = mix(base, base * vec3(0.85, 0.78, 0.65), stainBand * 0.35);

  return base;
}

// ----------------------------------------------------------------------------
// Leaded window — upper-right.  A grid of small panes with cool moonlight
// behind it, slight bow in the lead caming.
// ----------------------------------------------------------------------------
vec3 windowColor(vec2 uv, vec3 base) {
  // Window bounds in uv space.
  vec2 lo = vec2(0.62, 0.55);
  vec2 hi = vec2(0.95, 0.95);
  vec2 wuv = (uv - lo) / (hi - lo);
  if (wuv.x < 0.0 || wuv.x > 1.0 || wuv.y < 0.0 || wuv.y > 1.0) return base;

  // Cool foggy moonlight behind the panes — gradient + noise.
  vec3 sky = mix(vec3(0.085, 0.110, 0.155), vec3(0.140, 0.165, 0.205), wuv.y);
  sky += vec3(0.040, 0.035, 0.020) * fbm(wuv * 6.0);

  // Pane grid — 4 panes wide, 5 tall.
  vec2 grid = wuv * vec2(4.0, 5.0);
  vec2 gf = fract(grid);
  float caming = smoothstep(0.06, 0.02, min(gf.x, 1.0 - gf.x)) +
                 smoothstep(0.06, 0.02, min(gf.y, 1.0 - gf.y));
  caming = clamp(caming, 0.0, 1.0);

  // Window frame border.
  float frameDist = min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y));
  float frameMask = smoothstep(0.04, 0.02, frameDist);

  vec3 leadColor = vec3(0.040, 0.037, 0.035);
  vec3 frameColor = vec3(0.080, 0.058, 0.038);

  vec3 col = sky;
  col = mix(col, leadColor, caming);
  col = mix(col, frameColor, frameMask);

  // Soft cool spill onto the wall just inside the window.
  // We only return col for fragments inside the window — caller blends.
  return col;
}

// ----------------------------------------------------------------------------
// Wood grain for the shelf top + edge.
// ----------------------------------------------------------------------------
vec3 woodColor(vec2 uv, bool isTop) {
  // Grain runs horizontally; perturb y by a slow x-varying offset.
  float warpY = uv.y + sin(uv.x * 4.0 + 1.3) * 0.015 +
                sin(uv.x * 11.0 + 2.7) * 0.006;
  float grain = sin(warpY * 380.0 + fbm(uv * vec2(40.0, 8.0)) * 8.0);
  grain = grain * 0.5 + 0.5;
  // Knot-style darker patches.
  float knots = smoothstep(0.6, 0.95, fbm(uv * vec2(8.0, 30.0)));

  vec3 col = mix(WOOD_DARK, WOOD_LIGHT, grain);
  col = mix(col, WOOD_DEEP, knots * 0.45);

  // Top of shelf catches more lamplight than the front edge.
  if (isTop) {
    col *= 1.20;
  } else {
    col *= 0.78;
  }
  return col;
}

// ----------------------------------------------------------------------------
// Brass strip running along the front edge of the shelf.
// ----------------------------------------------------------------------------
vec3 brassEdge(vec2 uv) {
  // Vertical position relative to brass band: just above SHELF_Y - DEPTH.
  float bandY = SHELF_Y - SHELF_DEPTH * 0.15;
  float bandHalfH = 0.012;
  float dy = abs(uv.y - bandY);
  float mask = smoothstep(bandHalfH, bandHalfH * 0.5, dy);
  // Subtle highlight stripe within the band.
  float hi = smoothstep(0.005, 0.0, dy) * 0.8;
  vec3 col = BRASS * (0.7 + 0.3 * sin(uv.x * 80.0));
  col += hi * vec3(1.0, 0.92, 0.78);
  return col * mask;
}

// ----------------------------------------------------------------------------
// main
// ----------------------------------------------------------------------------
void main() {
  vec2 uv = v_uv;

  // 1. Pick base layer: wall above shelf, wood top of shelf, wood front below.
  vec3 col;
  if (uv.y > SHELF_Y) {
    col = wallColor(uv);

    // Composite the leaded window where it sits.
    if (uv.x > 0.62 && uv.x < 0.95 && uv.y > 0.55 && uv.y < 0.95) {
      vec3 w = windowColor(uv, col);
      col = w;
    }
  } else if (uv.y > SHELF_Y - SHELF_DEPTH) {
    col = woodColor(uv, true); // shelf top (under tubes)
  } else {
    col = woodColor(uv, false); // shelf front face
  }

  // 2. Brass strip along the leading edge.
  vec3 brass = brassEdge(uv);
  col += brass * 0.85;

  // 3. Oil lamp pool — warm radial gradient from upper-left, slow breathing.
  float pulse = 0.94 + 0.06 * sin(u_time * 0.45);
  vec2 lampPos = vec2(0.18, 0.78);
  float dl = distance(uv * vec2(u_aspect, 1.0), lampPos * vec2(u_aspect, 1.0));
  float lamp = exp(-dl * 2.4) * pulse;
  col += LAMP_WARM * lamp * 0.55;
  // Lamp halo bleeding onto shelf top
  float shelfLamp = smoothstep(SHELF_Y, SHELF_Y - 0.05, uv.y) *
                    smoothstep(0.65, 0.10, distance(uv.x, lampPos.x));
  col += LAMP_WARM * shelfLamp * 0.10 * pulse;

  // 4. Cool moonlight spill from the window onto the right wall + shelf.
  vec2 winCenter = vec2(0.78, 0.74);
  float dw = distance(uv * vec2(u_aspect, 1.0), winCenter * vec2(u_aspect, 1.0));
  float winSpill = exp(-dw * 2.8) * 0.20;
  col += vec3(0.55, 0.65, 0.85) * winSpill;

  // 5. Slight horizontal "ground shadow" right under the shelf overhang.
  if (uv.y < SHELF_Y && uv.y > SHELF_Y - 0.04) {
    col *= mix(0.55, 1.0, smoothstep(SHELF_Y - 0.04, SHELF_Y - 0.02, uv.y));
  }

  // 6. Vignette.
  float vig = smoothstep(1.10, 0.40, distance(uv, vec2(0.5, 0.5)));
  col *= mix(0.75, 1.0, vig);

  frag = vec4(col, 1.0);
}
`;

/** Shelf top horizon in v_uv space.  Mirrors SHELF_Y in the fragment shader. */
export const SHELF_Y = 0.32;
