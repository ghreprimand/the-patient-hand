/**
 * Scene shader — renders all tubes in one fullscreen pass on top of the
 * backdrop FBO.  Up to MAX_TUBES tubes per level.
 *
 * Architecture:
 *   1. Find the closest tube SDF for this fragment.
 *   2. If we're outside any tube band, sample the backdrop directly.
 *   3. Otherwise apply the glass + liquid shading (refracts the backdrop).
 *
 * This is the natural scaling of Day 2's single-tube shader.  Per-tube
 * quads remain a future optimization — for ≤16 tubes filling the screen,
 * the fullscreen pass is cheaper than batching draw calls.
 */

export const MAX_TUBES = 16;

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

#define MAX_TUBES ${MAX_TUBES}

uniform sampler2D u_backdrop;
uniform float u_aspect;

// Shared geometry — all tubes are the same size in v1.  Pour-tilt comes Day 5.
uniform float u_tubeRadius;
uniform float u_tubeHeight;
uniform float u_wallThickness;

// Per-tube state.  u_tubeCount controls how many entries are valid.
uniform int   u_tubeCount;
uniform vec2  u_tubeCenter[MAX_TUBES];
uniform float u_fillLevel[MAX_TUBES];
uniform vec3  u_liquidColor[MAX_TUBES];
uniform float u_liquidGlow[MAX_TUBES];

// ----------------------------------------------------------------------------
// SDF for one tube centered at \`center\`.  Same construction as Day 2:
// rounded bottom, cylindrical body, flat top.
// ----------------------------------------------------------------------------
float tubeSDF(vec2 p, vec2 center) {
  p -= center;
  float h = u_tubeHeight;
  float y = clamp(p.y, -h, h);
  float d = length(vec2(p.x, p.y - y)) - u_tubeRadius;
  d = max(d, p.y - h);
  return d;
}

// Numerical normal of an SDF at point p with given center.
vec2 tubeNormalAt(vec2 p, vec2 center) {
  vec2 e = vec2(0.001, 0.0);
  float dx = tubeSDF(p + e.xy, center) - tubeSDF(p - e.xy, center);
  float dy = tubeSDF(p + e.yx, center) - tubeSDF(p - e.yx, center);
  return normalize(vec2(dx, dy));
}

// ----------------------------------------------------------------------------
// main
// ----------------------------------------------------------------------------
void main() {
  // Aspect-correct centered space; same convention as Day 2.
  vec2 p = (v_uv * 2.0 - 1.0) * vec2(u_aspect, 1.0);

  // Find nearest tube.  GLSL ES 3.0 allows constant-bounded for-loops with
  // dynamic break, which is what we want here.
  int nearestIdx = -1;
  float nearestSdf = 1e9;
  vec2  nearestCenter = vec2(0.0);
  for (int i = 0; i < MAX_TUBES; i++) {
    if (i >= u_tubeCount) break;
    vec2 c = u_tubeCenter[i];
    float d = tubeSDF(p, c);
    if (d < nearestSdf) {
      nearestSdf = d;
      nearestIdx = i;
      nearestCenter = c;
    }
  }

  vec3 col = texture(u_backdrop, v_uv).rgb;

  if (nearestIdx >= 0) {
    float d = nearestSdf;
    float aa = max(fwidth(d), 1e-5);

    if (d < aa) {
      vec2 N = tubeNormalAt(p, nearestCenter);
      vec2 Nuv = vec2(N.x / u_aspect, N.y) * 0.5;

      vec3 liquidColor = u_liquidColor[nearestIdx];
      float fillLevel  = u_fillLevel[nearestIdx];
      float glow       = u_liquidGlow[nearestIdx];

      vec3 shaded;

      if (d > -u_wallThickness) {
        // Glass band — refract the backdrop, add rim + spec.
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

        // AA the silhouette over the backdrop.
        float edgeAlpha = 1.0 - smoothstep(-aa, aa, d);
        shaded = mix(col, shaded, edgeAlpha);
      } else {
        // Tube interior.
        float yLocal = (p.y - nearestCenter.y) / u_tubeHeight; // -1..+1
        float fillTop = -1.0 + fillLevel * 2.0;

        float sideX = abs((p.x - nearestCenter.x) / u_tubeRadius);
        float curveShade = mix(1.0, 0.78, smoothstep(0.55, 1.0, sideX));

        if (fillLevel > 0.0 && yLocal < fillTop) {
          // Liquid.
          float depthFromSurface = clamp(fillTop - yLocal, 0.0, 2.0);
          vec3 liq = liquidColor;
          liq *= (1.0 - depthFromSurface * 0.40);

          // Glow boost (animated complete-state will multiply this later).
          liq += liquidColor * glow * (1.0 - depthFromSurface * 0.5);

          float meniscus = smoothstep(0.05, 0.0, abs(yLocal - fillTop));
          liq += vec3(1.0, 0.92, 0.72) * meniscus * (0.18 + 0.35 * glow);

          float bottomShade = smoothstep(-0.95, -1.05, yLocal);
          liq *= mix(1.0, 0.55, bottomShade);

          liq *= curveShade;
          shaded = liq;
        } else {
          // Air pocket.
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

  // Filmic-ish tonemap to keep highlights from clipping.
  col = col / (col + vec3(0.55));
  col = pow(col, vec3(1.0 / 2.2));
  col = mix(col, col * vec3(1.04, 0.99, 0.92), 0.35);

  frag = vec4(col, 1.0);
}
`;
