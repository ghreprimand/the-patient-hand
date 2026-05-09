/**
 * Soft drop-shadow pass.
 *
 * Renders into the backdrop FBO *after* the backdrop is painted but
 * *before* the tubes are drawn.  For each tube position we accumulate a
 * darkening factor based on distance to a flattened ellipse just below
 * the tube's base.  The result is composed onto the FBO via blendFunc
 * (DST_COLOR, ZERO) — a multiply — so dark areas literally darken the
 * shelf wood without bleeding light.
 *
 * Up to MAX_TUBES shadows per frame, matching the scene shader.
 */

import { MAX_TUBES } from './scene';

export const SHADOW_VERT = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const SHADOW_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 frag;

#define MAX_TUBES ${MAX_TUBES}

uniform float u_aspect;
uniform float u_tubeRadius;
uniform float u_tubeHeight;

uniform int  u_tubeCount;
uniform vec2 u_tubeCenter[MAX_TUBES];

void main() {
  vec2 p = (v_uv * 2.0 - 1.0) * vec2(u_aspect, 1.0);

  // Accumulate maximum shadow darkness across all tubes — a tube can only
  // shade so much, but two tubes near each other can shade slightly more.
  float darkness = 0.0;
  for (int i = 0; i < MAX_TUBES; i++) {
    if (i >= u_tubeCount) break;
    vec2 c = u_tubeCenter[i];
    // Shadow center sits just below the tube's hemispherical base.
    vec2 shadowCenter = vec2(c.x, c.y - u_tubeHeight - u_tubeRadius * 0.55);
    // Flattened ellipse — wider than tube radius, very short vertically.
    vec2 d = (p - shadowCenter) / vec2(u_tubeRadius * 1.45, u_tubeRadius * 0.42);
    float r = length(d);
    // Soft falloff with a sharper umbra in the middle.
    float k = exp(-r * r * 1.6);
    // Hide shadows entirely above the tube base — shelf-top only.
    float belowBase = smoothstep(c.y - u_tubeHeight, c.y - u_tubeHeight - 0.04, p.y);
    darkness = max(darkness, k * belowBase * 0.55);
  }

  // Output a multiply factor in [some-dark .. 1.0].  We blend with
  // (DST_COLOR, ZERO), so the FBO becomes \`backdrop * frag.rgb\`.
  vec3 mul = vec3(1.0 - darkness * 0.65,
                  1.0 - darkness * 0.70,
                  1.0 - darkness * 0.78);

  frag = vec4(mul, 1.0);
}
`;
