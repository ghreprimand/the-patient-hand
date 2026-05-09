/**
 * Day 2 — glass + liquid shader prototype.
 *
 * One full-screen pass that renders both the apothecary backdrop (still
 * procedural; promoted to a real texture on Day 3) and a single test tube
 * over it.  The tube is defined by an SDF and shaded entirely in the
 * fragment shader: a refractive glass band, a rim highlight, a specular
 * hotspot from an upper-left key light, and a stratified-color liquid fill
 * with a meniscus.
 *
 * What this is *not* yet:
 *   - Multi-tube (Day 3 splits into a backdrop FBO + per-tube quads).
 *   - Wave / surface sim (Day 7 wires the height field into the meniscus).
 *   - Tilt for pours (Day 5 adds a tilt uniform).
 *   - Multi-layer stack (Day 4 adds the layer array).
 *
 * Acceptance criterion (from the build plan): "a single tube on screen
 * looks unmistakably like glass with liquid in it."  If the refraction
 * doesn't sell it, the design doc keeps a fallback (gradient + rim, no
 * refraction) reachable by lowering REFRACT_STRENGTH below ~0.05.
 */

export const GLASS_VERT = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const GLASS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 frag;

uniform float u_time;
uniform float u_aspect;          // canvas width / height

// Tube parameters expressed in aspect-corrected space:
//   x in [-aspect, +aspect], y in [-1, +1].
uniform vec2  u_tubeCenter;      // tube center
uniform float u_tubeRadius;      // half-width of the cylindrical body
uniform float u_tubeHeight;      // half-height of the straight body section
uniform float u_wallThickness;   // glass band thickness (inside the SDF)
uniform float u_fillLevel;       // 0..1, fraction of inner volume filled
uniform vec3  u_liquidColor;     // base liquid hex
uniform float u_liquidGlow;      // emissive boost (0..1)

// ----------------------------------------------------------------------------
// Backdrop — procedural Day 2 stand-in for the apothecary scene.  Returns the
// color the canvas would have at uv01 (0..1) if no tubes were present.  Gets
// sampled twice on glass fragments: once at the original UV (outside),
// once at a refracted UV (through the glass).
// ----------------------------------------------------------------------------
vec3 backdrop(vec2 uv01) {
  // Vertical walnut gradient, a warm lamp pool from upper-left, faint wood
  // grain, and a horizontal shelf line a third of the way up.  None of this
  // is final art — Day 3 swaps the whole function for an FBO sample.
  vec3 top    = vec3(0.106, 0.071, 0.039); // #1b1209
  vec3 bottom = vec3(0.180, 0.128, 0.078); // #2e2114
  vec3 col    = mix(top, bottom, smoothstep(0.0, 1.0, uv01.y));

  // Lamp pool, slow breathing pulse.
  float pulse = 0.92 + 0.08 * sin(u_time * 0.6);
  vec2  lampPos = vec2(0.22, 0.78);
  float dl = distance(uv01, lampPos);
  float lamp = smoothstep(0.55, 0.05, dl) * 0.55 * pulse;
  col += lamp * vec3(1.0, 0.83, 0.60);

  // Wood grain — only really visible after refraction, which is the point.
  float grain = sin(uv01.y * 90.0 + sin(uv01.x * 5.0) * 1.7);
  col += vec3(0.045, 0.030, 0.018) * grain;

  // Shelf line.
  float shelfBand = smoothstep(0.305, 0.290, uv01.y) -
                    smoothstep(0.290, 0.260, uv01.y);
  col = mix(col, vec3(0.06, 0.040, 0.018), shelfBand * 0.85);

  // Vignette to focus the eye centrally.
  float vig = smoothstep(1.05, 0.45, distance(uv01, vec2(0.5, 0.5)));
  col *= mix(0.78, 1.0, vig);

  return col;
}

// ----------------------------------------------------------------------------
// Tube SDF: cylindrical body with a hemispherical bottom and a flat top.
//
// The construction:
//   - Pick the nearest body-axis point at (0, clamp(p.y, -h, +h)).
//   - Distance to that point minus radius gives a capsule (rounded both ends).
//   - max(d, p.y - h) cuts the top with a horizontal half-plane, replacing
//     the rounded top with a flat one.  That's the open mouth of the tube.
// Returns a signed distance (negative inside).
// ----------------------------------------------------------------------------
float tubeSDF(vec2 p) {
  p -= u_tubeCenter;
  float h = u_tubeHeight;
  float y = clamp(p.y, -h, h);
  float d = length(vec2(p.x, p.y - y)) - u_tubeRadius;
  d = max(d, p.y - h);
  return d;
}

// Numerical gradient of the SDF gives the surface normal.  Plenty of accuracy
// for shading purposes; the analytic normal isn't worth the maintenance cost.
vec2 tubeNormal(vec2 p) {
  vec2 e = vec2(0.001, 0.0);
  float dx = tubeSDF(p + e.xy) - tubeSDF(p - e.xy);
  float dy = tubeSDF(p + e.yx) - tubeSDF(p - e.yx);
  return normalize(vec2(dx, dy));
}

// ----------------------------------------------------------------------------
// main
// ----------------------------------------------------------------------------
void main() {
  // Aspect-correct centered coordinate.  x ranges over [-aspect, +aspect],
  // y over [-1, +1], y up.  Tube space is in this coordinate system.
  vec2 p = (v_uv * 2.0 - 1.0) * vec2(u_aspect, 1.0);

  vec3 col = backdrop(v_uv);

  float d = tubeSDF(p);

  // Anti-aliasing pixel size in tube-space units.
  // dFdx/dFdy give per-fragment derivatives; the magnitude approximates a
  // pixel's footprint along the SDF.
  float aa = max(fwidth(d), 1e-5);

  if (d < aa) {
    vec2 N = tubeNormal(p);

    // Convert tube-space normal to UV-space offset for backdrop refraction.
    // UV space spans 1.0 in y across [-1..+1] tube-y, but only 1/aspect in x
    // across [-aspect..+aspect] tube-x — undo that.
    vec2 Nuv = vec2(N.x / u_aspect, N.y) * 0.5;

    // Glass band: between SDF=0 and SDF=-wallThickness.
    if (d > -u_wallThickness) {
      // Refract the backdrop.  Negative offset bends the apparent backdrop
      // inward toward the tube axis, matching how a convex glass cylinder
      // distorts what's behind it.
      const float REFRACT_STRENGTH = 0.55;
      vec2 refractUv = v_uv - Nuv * u_wallThickness * REFRACT_STRENGTH;
      vec3 bg = backdrop(refractUv);

      // Very faint cool glass tint.
      bg = mix(bg, bg * vec3(0.93, 0.96, 1.02), 0.25);

      // Rim highlight — strongest right at the silhouette (d ~ 0).
      // Falls off as we go inward through the glass.
      float rim = smoothstep(-u_wallThickness, 0.0, d);
      rim = pow(rim, 1.6);

      // Specular hotspot from upper-left key light.  Light direction is
      // expressed in tube-space; dot with the surface normal sharpens it.
      vec2 L = normalize(vec2(-0.55, 0.83));
      float ndotl = max(dot(N, L), 0.0);
      float spec = pow(ndotl, 28.0) * 0.95;

      // Backlight kiss from the lower-right fill.
      vec2 Lf = normalize(vec2(0.45, -0.4));
      float fill = pow(max(dot(N, Lf), 0.0), 6.0) * 0.18;

      vec3 rimColor = vec3(0.92, 0.82, 0.58); // warm lamp-tinted rim
      vec3 specColor = vec3(1.00, 0.94, 0.82);
      vec3 fillColor = vec3(0.40, 0.55, 0.78);

      col = bg + rim * rimColor * 0.75 + spec * specColor + fill * fillColor;

      // Smooth the silhouette edge with the AA band: outside the glass we
      // already have backdrop; here we blend the glass color over it as
      // we cross d=0.
      float edgeAlpha = 1.0 - smoothstep(-aa, aa, d);
      col = mix(backdrop(v_uv), col, edgeAlpha);
    } else {
      // Inside the tube interior.  Two regions: liquid below the fill line,
      // air above it (sees the back wall of glass + backdrop).
      float yLocal = (p.y - u_tubeCenter.y) / u_tubeHeight; // -1..+1
      float fillTop = -1.0 + u_fillLevel * 2.0;

      // Side-curvature shading: the back wall of the tube is closer to
      // grazing as we move toward the silhouette, so the interior darkens
      // slightly at the sides.  This is what reads as "glass cylinder" not
      // "flat colored rectangle."
      float sideX = abs((p.x - u_tubeCenter.x) / u_tubeRadius);
      float curveShade = mix(1.0, 0.78, smoothstep(0.55, 1.0, sideX));

      if (yLocal < fillTop) {
        // Liquid.  Simple stratified shading: darker as we go down (deeper
        // liquid absorbs more light), brighter near the meniscus.
        float depthFromSurface = clamp(fillTop - yLocal, 0.0, 2.0);
        vec3 liq = u_liquidColor;
        liq *= (1.0 - depthFromSurface * 0.40);

        // Glow contribution — for completed tubes this will animate up.
        liq += u_liquidColor * u_liquidGlow *
               (1.0 - depthFromSurface * 0.5);

        // Meniscus: bright thin band where liquid meets glass.  Slightly
        // brighter on the warm-light side to hint at directional lighting.
        float meniscus = smoothstep(0.05, 0.0, abs(yLocal - fillTop));
        vec3 meniscusColor = vec3(1.0, 0.92, 0.72);
        liq += meniscusColor * meniscus * (0.18 + 0.35 * u_liquidGlow);

        // Bottom shadow band — the liquid pools darker at the rounded base.
        float bottomShade = smoothstep(-0.95, -1.05, yLocal);
        liq *= mix(1.0, 0.55, bottomShade);

        liq *= curveShade;

        col = liq;
      } else {
        // Air pocket above the liquid.  Read backdrop with a *much* smaller
        // refraction (the back wall only) and a slight cool tint.
        vec2 refractUv = v_uv - Nuv * 0.012;
        vec3 bg = backdrop(refractUv);
        bg = mix(bg, bg * vec3(0.92, 0.96, 1.02), 0.30) * 0.88;
        bg *= curveShade;

        // Inner rim where air meets glass — a soft inner halo on the wall.
        float innerRim = smoothstep(-u_wallThickness * 2.5,
                                    -u_wallThickness, d);
        innerRim = 1.0 - innerRim;
        bg += vec3(0.55, 0.50, 0.38) * innerRim * 0.10;

        col = bg;
      }
    }
  }

  // Final tonemap-ish: subtle filmic compression so highlights don't clip.
  col = col / (col + vec3(0.55));
  col = pow(col, vec3(1.0 / 2.2));

  // Re-saturate toward apothecary warmth slightly to recover from tonemap.
  col = mix(col, col * vec3(1.04, 0.99, 0.92), 0.35);

  frag = vec4(col, 1.0);
}
`;
