/**
 * Particle shader — renders CPU-sim'd splash droplets as soft point sprites.
 *
 * Each alive particle uploads 6 floats per vertex: posX, posY, r, g, b, alpha.
 * The vertex shader maps tube-space positions to clip space; the fragment
 * shader draws a soft radial circle with premultiplied-alpha output so
 * droplets additively brighten the scene.
 *
 * Blended with (ONE, ONE_MINUS_SRC_ALPHA) — same as the stream pass.
 */

export const PARTICLE_VERT = /* glsl */ `#version 300 es
// Per-vertex attributes (interleaved: x y r g b alpha)
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec3 a_color;
layout(location = 2) in float a_alpha;

uniform float u_aspect;
uniform float u_pointSize;

out vec3 v_color;
out float v_alpha;

void main() {
  // tube-space → clip-space: same mapping as scene/stream shaders.
  vec2 clip = vec2(a_pos.x / u_aspect, a_pos.y);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = u_pointSize;
  v_color = a_color;
  v_alpha = a_alpha;
}
`;

export const PARTICLE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_color;
in float v_alpha;
out vec4 frag;

void main() {
  // gl_PointCoord: (0,0) at top-left of point sprite, (1,1) at bottom-right.
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float r = dot(pc, pc);

  // Soft circle: full alpha at center, fading to 0 at edge.
  float circle = 1.0 - smoothstep(0.3, 1.0, r);
  if (circle <= 0.0) discard;

  // Brighten the core slightly for a liquid-droplet glint.
  float core = 1.0 - smoothstep(0.0, 0.4, r);
  vec3 col = v_color * (0.9 + core * 0.5);

  // Premultiplied-alpha output.
  float a = circle * v_alpha;
  frag = vec4(col * a, a);
}
`;
