/**
 * Scene shader — renders all tubes in one fullscreen pass on top of the
 * backdrop FBO.  Up to MAX_TUBES tubes per level, each with up to
 * MAX_CAPACITY stacked liquid layers.
 *
 * Architecture:
 *   1. Find the closest tube SDF for this fragment.
 *   2. If we're outside any tube band, sample the backdrop directly.
 *   3. Otherwise apply glass + per-layer liquid shading.
 *
 * Layer stacking convention matches game/state.ts: tokens are stored
 * bottom-up.  Layer 0 is the rounded base; layer N-1 is the top, the one
 * pouring out next.  Layer y-extent in tube-local space:
 *
 *     layerH = 2.0 / capacity
 *     layer i occupies y ∈ [-1 + i*layerH, -1 + (i+1)*layerH]
 *
 * The topmost layer's surface gets the bright meniscus highlight; layer
 * boundaries between filled layers get a thin darker hairline so distinct
 * colors read as discrete bands.  Bottom shadow band still applies to
 * layer 0.  Day 7 wires per-tube wave heights into the meniscus.
 */

export const MAX_TUBES = 16;
export const MAX_CAPACITY = 8;
/** Mirror of SURFACE_SAMPLES from sim/surface.ts. Keep in sync. */
export const SURFACE_SAMPLES = 24;

export const SCENE_VERT = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const SCENE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 frag;

#define MAX_TUBES        ${MAX_TUBES}
#define MAX_CAPACITY     ${MAX_CAPACITY}
#define SURFACE_SAMPLES  ${SURFACE_SAMPLES}

uniform sampler2D u_backdrop;
uniform float u_aspect;

// Shared geometry — all tubes are the same size in v1.
uniform float u_tubeRadius;
uniform float u_tubeHeight;
uniform float u_wallThickness;

// Shared logical capacity (how many layers a full tube has).
uniform int   u_capacity;

// Per-tube state.  u_tubeCount controls how many entries are valid.
uniform int   u_tubeCount;
uniform vec2  u_tubeCenter[MAX_TUBES];
uniform int   u_layerCount[MAX_TUBES];
uniform float u_glow[MAX_TUBES];
// Per-tube tilt in radians.  Rotation pivots around the tube's
// hemispherical base so the tube tips like a real beaker.
uniform float u_tubeTilt[MAX_TUBES];

// Flat array of per-layer colors.  Layer i of tube t lives at index
// (t * MAX_CAPACITY + i).  Unused slots are unread (any value is fine).
uniform vec3  u_layerColor[MAX_TUBES * MAX_CAPACITY];

// Surface heights from sim/surface.ts.  Each tube has SURFACE_SAMPLES
// samples in tube-local y units.  Day 7: meniscus perturbed by these.
uniform float u_surfaceHeights[MAX_TUBES * SURFACE_SAMPLES];

/** Tube-y scale applied to the unitless surface height field. */
const float SURFACE_AMPLITUDE = 0.20;

// ----------------------------------------------------------------------------
// SDF for an upright tube centered at the origin.
//   - Hemispherical bottom at y = -h
//   - Cylindrical body
//   - Flat open top at y = +h
// ----------------------------------------------------------------------------
float tubeSdfUpright(vec2 p) {
  float h = u_tubeHeight;
  float y = clamp(p.y, -h, h);
  float d = length(vec2(p.x, p.y - y)) - u_tubeRadius;
  d = max(d, p.y - h);
  return d;
}

// Map a world-space point into the tube's local frame.  The pivot of
// rotation is the tube's hemispherical base; this matches the
// physical mental model of a beaker tipping forward.
//
// Steps:
//   1. Translate so pivot (center.x, center.y - h) is the origin.
//   2. Rotate by -tilt to undo the tube's rotation.
//   3. Translate so the tube's center maps back to (0, 0) — that is,
//      shift up by h.
vec2 toTubeLocal(vec2 p, vec2 center, float tilt) {
  vec2 pivot = vec2(center.x, center.y - u_tubeHeight);
  float ct = cos(tilt), st = sin(tilt);
  // R(-tilt) in column-major mat2: columns (cos, -sin), (sin, cos).
  mat2 R = mat2(ct, -st, st, ct);
  vec2 q = R * (p - pivot);
  return q - vec2(0.0, u_tubeHeight);
}

float tubeSdfTilted(vec2 p, vec2 center, float tilt) {
  return tubeSdfUpright(toTubeLocal(p, center, tilt));
}

// Numerical normal in *local* (upright) frame; rotated back to world for
// shading and refraction sampling.
vec2 tubeNormalAtTilted(vec2 p, vec2 center, float tilt) {
  vec2 local = toTubeLocal(p, center, tilt);
  vec2 e = vec2(0.001, 0.0);
  float dx = tubeSdfUpright(local + e.xy) - tubeSdfUpright(local - e.xy);
  float dy = tubeSdfUpright(local + e.yx) - tubeSdfUpright(local - e.yx);
  vec2 N_local = normalize(vec2(dx, dy));
  // Rotate normal back to world frame: R(+tilt) * N_local.
  float ct = cos(tilt), st = sin(tilt);
  mat2 Rfwd = mat2(ct, st, -st, ct);
  return Rfwd * N_local;
}

// Indexed array access that GLSL ES 3.0 allows when the index is a
// constant expression in some places but not others.  WebGL2 supports
// dynamic indexing of uniform arrays, so this is fine.
vec3 layerColorAt(int tube, int layer) {
  return u_layerColor[tube * MAX_CAPACITY + layer];
}

// Linearly interpolate the surface height for a fragment at tube-local
// xNorm ∈ [-1..+1].  Inside the meniscus we add this (scaled) to fillTop.
float surfaceAt(int tube, float xNorm) {
  float fcol = (xNorm * 0.5 + 0.5) * float(SURFACE_SAMPLES - 1);
  fcol = clamp(fcol, 0.0, float(SURFACE_SAMPLES - 1));
  int i0 = int(floor(fcol));
  int i1 = min(i0 + 1, SURFACE_SAMPLES - 1);
  float t = fcol - float(i0);
  float h0 = u_surfaceHeights[tube * SURFACE_SAMPLES + i0];
  float h1 = u_surfaceHeights[tube * SURFACE_SAMPLES + i1];
  return mix(h0, h1, t) * SURFACE_AMPLITUDE;
}

// ----------------------------------------------------------------------------
// main
// ----------------------------------------------------------------------------
void main() {
  vec2 p = (v_uv * 2.0 - 1.0) * vec2(u_aspect, 1.0);

  // Pick nearest tube.
  int   nearestIdx    = -1;
  float nearestSdf    = 1e9;
  vec2  nearestCenter = vec2(0.0);
  float nearestTilt   = 0.0;
  for (int i = 0; i < MAX_TUBES; i++) {
    if (i >= u_tubeCount) break;
    vec2 c = u_tubeCenter[i];
    float t = u_tubeTilt[i];
    float d = tubeSdfTilted(p, c, t);
    if (d < nearestSdf) {
      nearestSdf = d;
      nearestIdx = i;
      nearestCenter = c;
      nearestTilt = t;
    }
  }

  vec3 col = texture(u_backdrop, v_uv).rgb;

  if (nearestIdx >= 0) {
    float d = nearestSdf;
    float aa = max(fwidth(d), 1e-5);

    if (d < aa) {
      vec2 N = tubeNormalAtTilted(p, nearestCenter, nearestTilt);
      vec2 Nuv = vec2(N.x / u_aspect, N.y) * 0.5;

      int   layerCount = u_layerCount[nearestIdx];
      float glow       = u_glow[nearestIdx];

      vec3 shaded;

      if (d > -u_wallThickness) {
        // Glass band — refract the backdrop, add rim + spec + fill kiss.
        const float REFRACT = 0.55;
        vec2 refractUv = v_uv - Nuv * u_wallThickness * REFRACT;
        vec3 bg = texture(u_backdrop, refractUv).rgb;
        bg = mix(bg, bg * vec3(0.93, 0.96, 1.02), 0.25);

        float rim = smoothstep(-u_wallThickness, 0.0, d);
        rim = pow(rim, 1.6);

        vec2 L  = normalize(vec2(-0.55, 0.83));
        float ndotl = max(dot(N, L), 0.0);
        float spec  = pow(ndotl, 28.0) * 0.95;

        vec2 Lf = normalize(vec2(0.45, -0.4));
        float fill = pow(max(dot(N, Lf), 0.0), 6.0) * 0.18;

        vec3 rimColor  = vec3(0.92, 0.82, 0.58);
        vec3 specColor = vec3(1.00, 0.94, 0.82);
        vec3 fillColor = vec3(0.40, 0.55, 0.78);

        shaded = bg + rim * rimColor * 0.75 + spec * specColor + fill * fillColor;

        float edgeAlpha = 1.0 - smoothstep(-aa, aa, d);
        shaded = mix(col, shaded, edgeAlpha);
      } else {
        // Tube interior — work in tube-local frame so tilt rotates
        // the layer math along with the SDF.  Layers therefore stay
        // parallel to the tube's body — a cheap visual cheat that
        // reads fine at TILT_MAX = 18°.
        vec2 local = toTubeLocal(p, nearestCenter, nearestTilt);
        float yLocal  = local.y / u_tubeHeight; // -1..+1
        float layerH  = 2.0 / float(u_capacity);
        float fillTop = -1.0 + float(layerCount) * layerH;

        // Sample the wavy surface from the height field; perturb fillTop
        // only — internal layer boundaries stay flat.
        float xNorm   = local.x / u_tubeRadius;
        float surfH   = surfaceAt(nearestIdx, xNorm);
        float fillTopWavy = fillTop + surfH;

        float sideX = abs(xNorm);
        float curveShade = mix(1.0, 0.78, smoothstep(0.55, 1.0, sideX));

        if (layerCount > 0 && yLocal < fillTopWavy) {
          // Liquid: pick the layer this fragment belongs to.  Use the
          // *flat* fillTop for layer indexing — the wavy crest above it
          // is part of the topmost layer.
          int layerIdx = int(floor((yLocal + 1.0) / layerH));
          layerIdx = clamp(layerIdx, 0, layerCount - 1);
          vec3 liq = layerColorAt(nearestIdx, layerIdx);

          // Depth shading from the wavy surface.
          float depthFromSurface = clamp(fillTopWavy - yLocal, 0.0, 2.0);
          liq *= (1.0 - depthFromSurface * 0.32);

          // Glow only on the topmost layer (subtle) — avoids the whole
          // stack pulsing.  Day 13 will replace with a per-completion
          // u_complete[i] uniform.
          if (layerIdx == layerCount - 1) {
            liq += layerColorAt(nearestIdx, layerIdx) * glow *
                   (1.0 - depthFromSurface * 0.5);
          }

          // Meniscus on the topmost layer's wavy surface.
          float meniscus = smoothstep(0.05, 0.0, abs(yLocal - fillTopWavy));
          liq += vec3(1.0, 0.92, 0.72) * meniscus * (0.18 + 0.35 * glow);

          // Hairline darkening at internal layer boundaries.  Skip the
          // surface (top of topmost) and the floor (bottom of layer 0).
          if (layerIdx > 0) {
            float boundaryY = -1.0 + float(layerIdx) * layerH;
            float hair = smoothstep(0.012, 0.0, abs(yLocal - boundaryY));
            liq *= mix(1.0, 0.78, hair);
          }

          // Floor shadow at the rounded base.
          float bottomShade = smoothstep(-0.95, -1.05, yLocal);
          liq *= mix(1.0, 0.55, bottomShade);

          liq *= curveShade;
          shaded = liq;
        } else {
          // Air pocket above the liquid.
          vec2 refractUv = v_uv - Nuv * 0.012;
          vec3 bg = texture(u_backdrop, refractUv).rgb;
          bg = mix(bg, bg * vec3(0.92, 0.96, 1.02), 0.30) * 0.88;
          bg *= curveShade;

          float innerRim = smoothstep(-u_wallThickness * 2.5,
                                      -u_wallThickness, d);
          innerRim = 1.0 - innerRim;
          bg += vec3(0.55, 0.50, 0.38) * innerRim * 0.10;

          shaded = bg;
        }
      }

      col = shaded;
    }
  }

  // Filmic-ish tonemap.
  col = col / (col + vec3(0.55));
  col = pow(col, vec3(1.0 / 2.2));
  col = mix(col, col * vec3(1.04, 0.99, 0.92), 0.35);

  frag = vec4(col, 1.0);
}
`;
