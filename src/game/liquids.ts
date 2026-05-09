/**
 * Liquid palette — id → display color (and other future personality data).
 *
 * Day 4 ships only the 6 colors the early test levels need.  Day 11
 * promotes this to a full 12-liquid table (per design doc) loaded from
 * `liquids.json`.  Until then this in-code map is the source of truth.
 *
 * Hex values trace back to the design doc Liquid Personality Table:
 *   cinnabar    #c8312a — fiery red, "ember"
 *   lapis       #1c46a8 — deep blue, "deep"
 *   verdigris   #3d8a6e — patina green, "moss"
 *   saffron     #e0a02c — golden, "spice"
 *   amethyst    #7c3a8d — violet, "dusk"
 *   quicksilver #9aa0a8 — silver, "cool"
 */

import type { LiquidId } from './state';

export interface LiquidVisual {
  /** RGB triple in 0..1 per channel. */
  color: readonly [number, number, number];
  /** Emissive boost when this color is on top.  Day 13 animates this. */
  glow: number;
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [
    ((v >> 16) & 0xff) / 255,
    ((v >> 8) & 0xff) / 255,
    (v & 0xff) / 255,
  ];
}

const TABLE: Readonly<Record<string, LiquidVisual>> = {
  cinnabar:    { color: rgb('#c8312a'), glow: 0.20 },
  lapis:       { color: rgb('#1c46a8'), glow: 0.22 },
  verdigris:   { color: rgb('#3d8a6e'), glow: 0.18 },
  saffron:     { color: rgb('#e0a02c'), glow: 0.30 },
  amethyst:    { color: rgb('#7c3a8d'), glow: 0.24 },
  quicksilver: { color: rgb('#9aa0a8'), glow: 0.10 },
};

const FALLBACK: LiquidVisual = { color: [0.5, 0.5, 0.5], glow: 0 };

export function liquidVisual(id: LiquidId): LiquidVisual {
  return TABLE[id] ?? FALLBACK;
}

/** Useful for tests + the level editor: enumerate all known liquid ids. */
export function knownLiquidIds(): readonly LiquidId[] {
  return Object.keys(TABLE);
}
