/**
 * Scaffold shaders used on Day 1 to prove the GL pipeline end-to-end.
 *
 * These are throwaway. The real glass shader lands on Day 2; this file is
 * a smoke-test that the wrapper compiles, links, and draws something.
 */

export const SCAFFOLD_VERT = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  // a_pos is in NDC; map to UV [0..1] for the fragment shader.
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const SCAFFOLD_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 frag;

uniform float u_time;       // seconds since boot
uniform vec2  u_resolution; // CSS pixels (not drawing-buffer pixels)

// Warm apothecary background palette, sampled vertically + a slow lamp pulse
// from the upper-left.  This is just a visual sanity check.
void main() {
  vec2 uv = v_uv;

  // Vertical gradient from deep walnut at top to a slightly warmer floor.
  vec3 top    = vec3(0.106, 0.071, 0.039); // #1b1209
  vec3 bottom = vec3(0.180, 0.128, 0.078); // #2e2114
  vec3 col    = mix(top, bottom, smoothstep(0.0, 1.0, uv.y));

  // Lamp pool: warm radial gradient from upper-left, slow breathing pulse.
  float pulse = 0.92 + 0.08 * sin(u_time * 0.6);
  vec2  lampPos = vec2(0.22, 0.78);
  float d = distance(uv, lampPos);
  float lamp = smoothstep(0.55, 0.05, d) * 0.55 * pulse;
  col += lamp * vec3(1.0, 0.83, 0.60);

  // Subtle vignette to push focus center.
  float vig = smoothstep(1.05, 0.45, distance(uv, vec2(0.5, 0.5)));
  col *= mix(0.78, 1.0, vig);

  frag = vec4(col, 1.0);
}
`;
