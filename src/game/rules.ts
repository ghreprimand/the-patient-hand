/**
 * Pour rules and win condition.  Pure functions over GameState.
 *
 * The pour rule (matches the design doc and is genre-standard):
 *   1. src and dst must be different tubes.
 *   2. src must not be empty.
 *   3. dst must not be full.
 *   4. dst must be empty OR top(src) === top(dst).
 *   5. The transferred amount equals min(topRunLength(src),
 *      capacity - dst.tokens.length).
 *
 * applyPour is atomic: rule satisfied → entire run moves at once,
 * recorded as a single Move in history.
 */

import {
  type GameState,
  type LiquidId,
  type Move,
  type Tube,
  topOf,
  topRunLength,
  isEmpty,
  isFull,
  isSolvedTube,
} from './state';

/** True iff a pour from src→dst is legal under current state. */
export function canPour(state: GameState, srcIdx: number, dstIdx: number): boolean {
  if (srcIdx === dstIdx) return false;
  const src = state.tubes[srcIdx];
  const dst = state.tubes[dstIdx];
  if (!src || !dst) return false;
  if (isEmpty(src)) return false;
  if (isFull(state, dst)) return false;
  const top = topOf(src);
  const dstTop = topOf(dst);
  if (dstTop !== null && dstTop !== top) return false;
  return true;
}

/**
 * Returns the size of the pour that would happen if (src, dst) is legal,
 * or 0 if it isn't.  Useful for UI hints / particle volume.
 */
export function pourAmount(state: GameState, srcIdx: number, dstIdx: number): number {
  if (!canPour(state, srcIdx, dstIdx)) return 0;
  const src = state.tubes[srcIdx]!;
  const dst = state.tubes[dstIdx]!;
  const slack = state.capacity - dst.tokens.length;
  return Math.min(topRunLength(src), slack);
}

/**
 * Apply a pour, returning the new GameState.  Throws if the pour is
 * illegal — callers should have checked canPour first.
 */
export function applyPour(state: GameState, srcIdx: number, dstIdx: number): GameState {
  if (!canPour(state, srcIdx, dstIdx)) {
    throw new Error(`Illegal pour: ${srcIdx} → ${dstIdx}`);
  }
  const src = state.tubes[srcIdx]!;
  const dst = state.tubes[dstIdx]!;
  const top = topOf(src)!;
  const slack = state.capacity - dst.tokens.length;
  const amount = Math.min(topRunLength(src), slack);

  const newSrcTokens = src.tokens.slice(0, src.tokens.length - amount);
  const dstTokens = dst.tokens.slice();
  for (let i = 0; i < amount; i++) dstTokens.push(top);

  const newTubes: Tube[] = state.tubes.slice();
  newTubes[srcIdx] = { tokens: newSrcTokens };
  newTubes[dstIdx] = { tokens: dstTokens };

  const move: Move = { src: srcIdx, dst: dstIdx, amount, liquid: top };
  return {
    capacity: state.capacity,
    tubes: newTubes,
    history: [...state.history, move],
  };
}

/**
 * Undo the most recent move.  Returns null if there's no move to undo.
 * Reverses by re-pushing the moved tokens onto src and popping them off dst.
 * (We don't replay the whole history — undo is O(amount).)
 */
export function undo(state: GameState): GameState | null {
  if (state.history.length === 0) return null;
  const m = state.history[state.history.length - 1]!;
  const src = state.tubes[m.src]!;
  const dst = state.tubes[m.dst]!;
  const dstTokens = dst.tokens.slice(0, dst.tokens.length - m.amount);
  const srcTokens = src.tokens.slice();
  for (let i = 0; i < m.amount; i++) srcTokens.push(m.liquid);
  const newTubes: Tube[] = state.tubes.slice();
  newTubes[m.src] = { tokens: srcTokens };
  newTubes[m.dst] = { tokens: dstTokens };
  return {
    capacity: state.capacity,
    tubes: newTubes,
    history: state.history.slice(0, -1),
  };
}

/** A puzzle is won when every tube is either empty or full of one color. */
export function isWin(state: GameState): boolean {
  for (const t of state.tubes) {
    if (!isSolvedTube(state, t)) return false;
  }
  return true;
}

/**
 * Is the position dead — no legal pours remain?  Useful for "stuck" UX.
 * (Doesn't imply unwinnable — just unreachable from here without undo.)
 */
export function isStuck(state: GameState): boolean {
  if (isWin(state)) return false;
  const n = state.tubes.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && canPour(state, i, j)) return false;
    }
  }
  return true;
}

// Re-export commonly used queries for convenience.
export { isEmpty, isFull, isSolvedTube, topOf, topRunLength };
export type { GameState, LiquidId };
