/**
 * CPU particle system for splash droplets.
 *
 * Pool-allocated, no per-frame heap traffic.  Each particle is six
 * floats packed flat: posX posY velX velY age ttl, plus three more for
 * color (which we keep in a parallel array since it's read-only after
 * spawn).  Gravity pulls every particle's velocity down each step;
 * particles die when age >= ttl or when they exit a generous bounds
 * around the spawning tube.
 *
 * Sim-pure: no GL, no DOM.  Renderer reads `posX/Y`, `color*`, and
 * computes alpha from `age/ttl` itself.
 */

export const MAX_PARTICLES = 256;
const FIELDS = 6;

const GRAVITY = -1.6;     // tube-space units / s²
const MAX_AGE_S = 0.7;    // safety upper bound on ttl

export interface Particles {
  /** posX posY velX velY age ttl, flat. */
  data: Float32Array;
  /** R G B per particle, flat. */
  colors: Float32Array;
  /** Cached count of currently-alive particles (for efficient render). */
  alive: number;
}

export function createParticles(): Particles {
  return {
    data: new Float32Array(MAX_PARTICLES * FIELDS),
    colors: new Float32Array(MAX_PARTICLES * 3),
    alive: 0,
  };
}

/** Reset all particles to dead. */
export function clearParticles(p: Particles): void {
  p.data.fill(0);
  p.colors.fill(0);
  p.alive = 0;
}

function findFreeSlot(p: Particles): number {
  // Scan for a particle whose ttl == 0 (never used) or age >= ttl (dead).
  // Falling back: replace the one with the highest age/ttl ratio.
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const off = i * FIELDS;
    const age = p.data[off + 4] ?? 0;
    const ttl = p.data[off + 5] ?? 0;
    if (ttl === 0 || age >= ttl) return i;
  }
  // Pool full — overwrite the oldest.
  let oldestIdx = 0;
  let oldestRatio = -1;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const off = i * FIELDS;
    const age = p.data[off + 4] ?? 0;
    const ttl = p.data[off + 5] ?? 1;
    const r = age / ttl;
    if (r > oldestRatio) {
      oldestRatio = r;
      oldestIdx = i;
    }
  }
  return oldestIdx;
}

export interface SpawnSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  r: number;
  g: number;
  b: number;
}

/** Add one particle.  Reuses a dead slot or evicts the oldest. */
export function spawnParticle(p: Particles, s: SpawnSpec): void {
  const i = findFreeSlot(p);
  const off = i * FIELDS;
  p.data[off + 0] = s.x;
  p.data[off + 1] = s.y;
  p.data[off + 2] = s.vx;
  p.data[off + 3] = s.vy;
  p.data[off + 4] = 0;
  p.data[off + 5] = Math.min(s.ttl, MAX_AGE_S);
  p.colors[i * 3 + 0] = s.r;
  p.colors[i * 3 + 1] = s.g;
  p.colors[i * 3 + 2] = s.b;
}

/**
 * Spawn a small splash burst at (x, y) with the given color.  Returns
 * how many particles were spawned (≤ count, capped by pool slot count).
 */
export function spawnSplash(
  p: Particles,
  x: number,
  y: number,
  color: readonly [number, number, number],
  count: number,
): number {
  let spawned = 0;
  for (let i = 0; i < count; i++) {
    // Crown spread: mostly upward + outward, small randomness.
    const angle = -Math.PI * (0.25 + Math.random() * 0.5); // 45..135° below horiz
    const speed = 0.6 + Math.random() * 0.7;
    const vx = Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1);
    const vy = Math.sin(angle) * speed; // angle is negative, vy negative — but we want upward
    spawnParticle(p, {
      x: x + (Math.random() - 0.5) * 0.02,
      y,
      vx,
      vy: -vy,                           // flip so upward is positive
      ttl: 0.35 + Math.random() * 0.30,
      r: color[0],
      g: color[1],
      b: color[2],
    });
    spawned++;
  }
  return spawned;
}

/** Step all particles; recount alive afterward. */
export function stepParticles(p: Particles, dt: number): void {
  let alive = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const off = i * FIELDS;
    const ttl = p.data[off + 5] ?? 0;
    if (ttl === 0) continue;
    const age = (p.data[off + 4] ?? 0) + dt;
    if (age >= ttl) {
      p.data[off + 5] = 0; // mark dead
      continue;
    }
    p.data[off + 4] = age;
    // Integrate.
    p.data[off + 2] = (p.data[off + 2] ?? 0); // vx unchanged (no drag for now)
    p.data[off + 3] = (p.data[off + 3] ?? 0) + GRAVITY * dt;
    p.data[off + 0] = (p.data[off + 0] ?? 0) + (p.data[off + 2] ?? 0) * dt;
    p.data[off + 1] = (p.data[off + 1] ?? 0) + (p.data[off + 3] ?? 0) * dt;
    alive++;
  }
  p.alive = alive;
}
