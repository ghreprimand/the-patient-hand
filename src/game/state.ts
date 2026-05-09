/**
 * Pure game state types and constructors.
 *
 * Strict invariant: this module imports nothing from `render/`, `sim/`,
 * `audio/`, or `ui/`.  Pure functions only.  Every state-mutating helper
 * returns a new state.  Tests live in state.test.ts.
 *
 * Capacity:
 *   - Each tube holds up to `capacity` tokens.
 *   - tokens are stored bottom-up: tokens[0] is at the rounded base, the
 *     last entry is the top of the stack — the one that pours first.
 *
 * Color identity:
 *   - LiquidId is a string key into the liquid table (Day 11 promotes
 *     this to liquids.json).  The state module is agnostic about what
 *     a LiquidId resolves to visually; rendering does the lookup.
 */

export type LiquidId = string;

export interface Tube {
  /** Bottom-up stack of liquid IDs.  tokens.length ≤ capacity. */
  readonly tokens: readonly LiquidId[];
}

export interface Move {
  readonly src: number;
  readonly dst: number;
  /** How many tokens were transferred (≥1, ≤ capacity). */
  readonly amount: number;
  /** The liquid color that was poured. */
  readonly liquid: LiquidId;
}

export interface GameState {
  readonly capacity: number;
  readonly tubes: readonly Tube[];
  /** Append-only record of moves.  Undo pops the last entry. */
  readonly history: readonly Move[];
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function makeTube(tokens: readonly LiquidId[] = []): Tube {
  return { tokens: tokens.slice() };
}

export function makeState(capacity: number, tubes: readonly Tube[]): GameState {
  return { capacity, tubes: tubes.slice(), history: [] };
}

// ---------------------------------------------------------------------------
// Pure queries
// ---------------------------------------------------------------------------

/** The color at the top of the stack, or null when the tube is empty. */
export function topOf(tube: Tube): LiquidId | null {
  const n = tube.tokens.length;
  if (n === 0) return null;
  return tube.tokens[n - 1]!;
}

/**
 * How many consecutive top tokens share the same color.
 * Empty tube → 0.  A solid-color tube of N tokens → N.
 */
export function topRunLength(tube: Tube): number {
  const t = tube.tokens;
  if (t.length === 0) return 0;
  const top = t[t.length - 1]!;
  let n = 1;
  for (let i = t.length - 2; i >= 0; i--) {
    if (t[i] === top) n++;
    else break;
  }
  return n;
}

export function isEmpty(tube: Tube): boolean {
  return tube.tokens.length === 0;
}

export function isFull(state: GameState, tube: Tube): boolean {
  return tube.tokens.length >= state.capacity;
}

/** A tube is "solved" if it is empty or full of a single color. */
export function isSolvedTube(state: GameState, tube: Tube): boolean {
  if (isEmpty(tube)) return true;
  if (tube.tokens.length !== state.capacity) return false;
  return topRunLength(tube) === state.capacity;
}
