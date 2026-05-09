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
uniform float u_time;

// Cheap value-noise for glass caustic sparkle.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

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
        // ============================================================
        // GLASS BAND — Fresnel rim, refraction, dual specular, tint.
        // ============================================================
        const float REFRACT = 1.2;
        vec2 refractUv = v_uv - Nuv * u_wallThickness * REFRACT;
        vec3 bg = texture(u_backdrop, refractUv).rgb;
        // Slight blue-green glass tint.
        bg = mix(bg, bg * vec3(0.88, 0.95, 1.06), 0.35);

        // Fresnel-like rim: glass edges are more opaque/reflective,
        // center is more see-through.  Based on distance through the
        // glass wall (d goes from 0 at outer edge to -wallThickness).
        float wallT = clamp(-d / u_wallThickness, 0.0, 1.0); // 0=outer 1=inner
        float fresnel = pow(1.0 - wallT, 2.5);  // bright at outer edge

        // Key light specular — warm, from upper-left (oil lamp).
        vec2 L  = normalize(vec2(-0.55, 0.83));
        float ndotl = max(dot(N, L), 0.0);
        float spec  = pow(ndotl, 42.0) * 1.8;  // tighter, brighter hot spot

        // Fill light specular — cool, from window side.
        vec2 Lf = normalize(vec2(0.50, -0.35));
        float fill = pow(max(dot(N, Lf), 0.0), 16.0) * 0.30;

        // Thin bright line at the outer rim of the glass (catches the light).
        float outerRim = smoothstep(aa * 2.0, -aa, d);

        vec3 rimColor  = vec3(1.0, 0.90, 0.65);
        vec3 specColor = vec3(1.0, 0.95, 0.82);
        vec3 fillColor = vec3(0.50, 0.65, 0.90);

        shaded = bg * (0.75 + 0.25 * wallT);  // center more transparent
        shaded += rimColor  * fresnel * 0.65;
        shaded += specColor * spec;
        shaded += fillColor * fill;
        shaded += rimColor  * outerRim * 0.50;

        // Subtle caustic sparkle on the glass — animated micro-noise.
        float sparkle = vnoise(v_uv * vec2(180.0, 220.0) + u_time * 0.3);
        sparkle = smoothstep(0.82, 0.97, sparkle) * fresnel;
        shaded += vec3(1.0, 0.95, 0.85) * sparkle * 0.25;

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
          // ============================================================
          // LIQUID — rich, translucent, jewel-tone rendering.
          // ============================================================
          int layerIdx = int(floor((yLocal + 1.0) / layerH));
          layerIdx = clamp(layerIdx, 0, layerCount - 1);
          vec3 liq = layerColorAt(nearestIdx, layerIdx);

          // --- Depth attenuation ---
          // Deeper liquid is darker, simulating absorption.  More
          // aggressive than before to give real depth.
          float depthFromSurface = clamp(fillTopWavy - yLocal, 0.0, 2.0);
          float depthDarken = 1.0 - depthFromSurface * 0.55;
          liq *= depthDarken;

          // --- Translucency / subsurface scattering fake ---
          // Near the glass edges, light passes through less liquid,
          // so the color is brighter (like looking through the thin
          // edge of a colored glass).  Near center it's deeper/richer.
          float edgeBright = smoothstep(0.5, 1.0, sideX) * 0.35;
          liq *= (1.0 + edgeBright);

          // --- Inner caustic at liquid-glass junction ---
          // A bright warm line where liquid meets the glass wall.
          float causticEdge = smoothstep(0.92, 1.0, sideX);
          vec3 causticColor = liq * 1.8 + vec3(0.15, 0.12, 0.06);
          liq = mix(liq, causticColor, causticEdge * 0.40);

          // --- Top-layer glow ---
          if (layerIdx == layerCount - 1) {
            // Subsurface glow near the surface — liquid seems to
            // emit light from within.
            float surfGlow = exp(-depthFromSurface * 3.0);
            liq += layerColorAt(nearestIdx, layerIdx) * glow *
                   surfGlow * 1.4;
          }

          // --- Meniscus highlight ---
          // Bright, prominent meniscus that curves up at the edges
          // (where liquid meets glass wall).
          float meniscusDist = abs(yLocal - fillTopWavy);
          float meniscus = smoothstep(0.08, 0.0, meniscusDist);
          // Meniscus curves up at edges (concave meniscus).
          float edgeLift = smoothstep(0.5, 1.0, sideX) * 0.04;
          float meniscusEdge = smoothstep(0.06, 0.0,
                               abs(yLocal - (fillTopWavy + edgeLift)));
          meniscus = max(meniscus, meniscusEdge);
          // Warm highlight, boosted for visibility.
          vec3 meniscusColor = vec3(1.0, 0.92, 0.72);
          liq += meniscusColor * meniscus * (0.45 + 0.40 * glow);

          // --- Layer boundary hairlines ---
          if (layerIdx > 0) {
            float boundaryY = -1.0 + float(layerIdx) * layerH;
            float hair = smoothstep(0.014, 0.0, abs(yLocal - boundaryY));
            liq *= mix(1.0, 0.68, hair);
          }

          // --- Floor shadow at the rounded base ---
          float bottomShade = smoothstep(-0.90, -1.08, yLocal);
          liq *= mix(1.0, 0.40, bottomShade);

          // --- Cylindrical shading (curvature) ---
          liq *= curveShade;

          // --- Specular highlight on the liquid surface ---
          // A small bright spot from the lamp reflecting on the
          // liquid's surface, near the top.
          if (layerIdx == layerCount - 1 && depthFromSurface < 0.15) {
            float liqSpec = smoothstep(0.15, 0.0, depthFromSurface);
            liqSpec *= smoothstep(0.4, 0.0, abs(sideX - 0.25));
            liq += vec3(1.0, 0.90, 0.70) * liqSpec * 0.30;
          }

          shaded = liq;
        } else {
          // Air pocket above the liquid — subtly refracts backdrop.
          vec2 refractUv = v_uv - Nuv * 0.018;
          vec3 bg = texture(u_backdrop, refractUv).rgb;
          // Glass-interior tint — everything seen through the tube is
          // slightly blue-shifted and dimmed.
          bg = mix(bg, bg * vec3(0.88, 0.93, 1.05), 0.35) * 0.82;
          bg *= curveShade;

          // Inner wall reflection — subtle bright band near the inner
          // glass surface (total internal reflection at grazing angles).
          float innerRim = smoothstep(-u_wallThickness * 3.0,
                                      -u_wallThickness, d);
          innerRim = 1.0 - innerRim;
          bg += vec3(0.65, 0.58, 0.42) * innerRim * 0.18;

          // Faint reflection of the lamp on the inside of the glass.
          float innerSpec = pow(max(dot(N, normalize(vec2(-0.5, 0.8))), 0.0),
                                20.0) * 0.12;
          bg += vec3(1.0, 0.88, 0.60) * innerSpec;

          shaded = bg;
        }
      }

      col = shaded;
    }
  }

  // Filmic tonemap — higher denominator preserves saturation of the
  // jewel-tone liquids against the dark backdrop.  Warm amber grade
  // reinforces the oil-lamp atmosphere.
  col = col / (col + vec3(0.72));
  col = pow(col, vec3(1.0 / 2.2));
  // Warm amber color grade — consistent with candlelit apothecary.
  col = mix(col, col * vec3(1.08, 0.98, 0.88), 0.40);

  frag = vec4(col, 1.0);
}
`;
