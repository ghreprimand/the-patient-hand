/**
 * Pour stream — quadratic Bezier from source-tube-lip to dst-impact.
 *
 * Renders as a fullscreen pass after the scene with additive (or
 * premultiplied-alpha) blending.  The fragment shader computes a 2D SDF
 * to the Bezier curve via a 16-segment linear approximation (closed-form
 * Bezier-distance is not worth the cubic root math at this resolution),
 * then alpha-fades within a tapered width band.  The width tapers from
 * thicker near the source lip to thinner at the impact point.
 *
 * Visibility: u_streamOpacity drives a fade-in/out window at the start
 * and end of the drain phase so the stream doesn't pop on/off.
 *
 * Wobble: the control point is offset by a small Perlin-ish sin in time,
 * giving the stream a subtle organic shimmy without needing real noise.
 */

export const STREAM_VERT = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const STREAM_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 frag;

uniform float u_time;
uniform float u_aspect;

// Bezier control points in tube-space (aspect-corrected):
//   u_p0 = source lip
//   u_p1 = arc control (mid + small lift, possibly wobbled)
//   u_p2 = dst impact point
uniform vec2 u_p0;
uniform vec2 u_p1;
uniform vec2 u_p2;

uniform vec3  u_streamColor;
uniform float u_streamOpacity;     // 0..1
uniform float u_streamWidth0;      // thickness near source
uniform float u_streamWidth1;      // thickness near dst

// Quadratic Bezier sample.  Standard de-Casteljau.
vec2 bezier(vec2 a, vec2 b, vec2 c, float t) {
  return mix(mix(a, b, t), mix(b, c, t), t);
}

// Distance from point p to a quadratic Bezier (a, b, c) using a
// 16-segment linear approximation.  Also returns the "approximate" t
// along the curve as the .y component (0..1) for taper control.
vec2 bezierDistAndT(vec2 p, vec2 a, vec2 b, vec2 c) {
  const int N = 16;
  vec2 prev = a;
  float minD = 1e9;
  float minT = 0.0;
  for (int i = 1; i <= N; i++) {
    float t = float(i) / float(N);
    vec2 cur = bezier(a, b, c, t);
    vec2 pa = p - prev;
    vec2 ba = cur - prev;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    vec2 closest = prev + ba * h;
    float d = length(p - closest);
    if (d < minD) {
      minD = d;
      // Reproject h onto [t-1/N, t] in global curve space.
      minT = (float(i - 1) + h) / float(N);
    }
    prev = cur;
  }
  return vec2(minD, minT);
}

void main() {
  if (u_streamOpacity <= 0.0) {
    frag = vec4(0.0);
    return;
  }

  // Aspect-corrected centered space — same convention as the scene shader.
  vec2 p = (v_uv * 2.0 - 1.0) * vec2(u_aspect, 1.0);

  vec2 dt = bezierDistAndT(p, u_p0, u_p1, u_p2);
  float d  = dt.x;
  float t  = dt.y;

  // Width tapers from p0 to p2.  Add a small time-varying wobble so the
  // stream isn't a perfectly geometric ribbon.
  float wobble = 0.0006 * sin(t * 18.0 + u_time * 14.0);
  float w = mix(u_streamWidth0, u_streamWidth1, t) + wobble;

  // Soft alpha edge.  Outside the band it's transparent; inside it's
  // a smooth bell so highlights along the centerline read brighter.
  float alpha = smoothstep(w, w * 0.45, d);
  if (alpha <= 0.0) {
    frag = vec4(0.0);
    return;
  }

  // Add a brighter centerline highlight — the eye reads this as the
  // glassy surface of a falling stream.
  float core = smoothstep(w * 0.35, 0.0, d);

  // Fade the stream out at the very tip — masks the geometric end of
  // the curve so it doesn't look chopped off.
  float endFade = smoothstep(0.96, 1.0, t);
  alpha *= 1.0 - endFade * 0.55;

  vec3 col = u_streamColor * (0.92 + core * 0.6);

  // Premultiplied-alpha output.  Blend with (ONE, ONE_MINUS_SRC_ALPHA).
  float a = alpha * u_streamOpacity;
  frag = vec4(col * a, a);
}
`;
