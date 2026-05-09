/**
 * Level schema + validation + loader.  Pure functions; no IO.
 *
 * The JSON files in /levels/ are loaded elsewhere; this module just
 * validates the shape and turns it into a starting GameState.
 */

import { type GameState, type LiquidId, type Tube, makeState } from './state';

export interface Level {
  /** Three-digit zero-padded id, e.g. "001". */
  id: string;
  chapter: number;
  name: string;
  /** Tokens per tube. */
  capacity: number;
  /** Bottom-up token arrays.  Empty arrays denote empty tubes. */
  tubes: LiquidId[][];
  /** Move count an optimal player would take.  Optional; the BFS solver
   * fills this in on Day 10. */
  optimalMoves?: number;
  author: string;
}

/**
 * Validate a level and throw with a descriptive message on failure.
 *
 * Rules (matches the design doc):
 *   1. capacity ≥ 2.
 *   2. Every tube has tokens.length ≤ capacity.
 *   3. Every color present appears exactly `capacity` times across all
 *      tubes.  This is the "canonical fill" rule — by the time a level
 *      is solved, each color fills exactly one tube.
 *   4. At least one empty or partially-filled tube must exist (otherwise
 *      no pours are possible).
 */
export function validateLevel(L: Level): void {
  if (typeof L.capacity !== 'number' || L.capacity < 2) {
    throw new Error(`Level ${L.id}: capacity must be ≥ 2`);
  }
  if (!Array.isArray(L.tubes) || L.tubes.length < 2) {
    throw new Error(`Level ${L.id}: need at least 2 tubes`);
  }

  const colorCount = new Map<LiquidId, number>();
  let hasFreeSlot = false;

  for (let i = 0; i < L.tubes.length; i++) {
    const t = L.tubes[i]!;
    if (t.length > L.capacity) {
      throw new Error(
        `Level ${L.id}: tube ${i} has ${t.length} tokens, capacity is ${L.capacity}`,
      );
    }
    if (t.length < L.capacity) hasFreeSlot = true;
    for (const c of t) {
      if (typeof c !== 'string' || c.length === 0) {
        throw new Error(`Level ${L.id}: tube ${i} contains non-string token`);
      }
      colorCount.set(c, (colorCount.get(c) ?? 0) + 1);
    }
  }

  if (!hasFreeSlot) {
    throw new Error(
      `Level ${L.id}: every tube is full — there is no room to make any move`,
    );
  }

  for (const [color, n] of colorCount) {
    if (n !== L.capacity) {
      throw new Error(
        `Level ${L.id}: color "${color}" appears ${n} times but capacity is ${L.capacity}`,
      );
    }
  }
}

/** Validate and convert to an initial GameState. */
export function loadLevel(L: Level): GameState {
  validateLevel(L);
  const tubes: Tube[] = L.tubes.map((tokens) => ({ tokens: tokens.slice() }));
  return makeState(L.capacity, tubes);
}
