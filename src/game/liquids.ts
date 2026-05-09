/**
 * Liquid palette — id → display color, glow, viscosity, density.
 *
 * Day 4 ships only the 6 colors the early test levels need.  Day 11
 * promotes this to a full 12-liquid table loaded from `liquids.json`.
 *
 * Hex values trace back to the design doc Liquid Personality Table:
 *   cinnabar    #c8312a — fiery red,    fast pour    (low viscosity)
 *   lapis       #1c46a8 — deep blue,    medium pour  (mid)
 *   verdigris   #3d8a6e — patina green, medium pour
 *   saffron     #e0a02c — golden,       slow pour    (high viscosity)
 *   amethyst    #7c3a8d — violet,       medium pour
 *   quicksilver #9aa0a8 — silver,       very fast    (very low viscosity)
 *
 * Viscosity is a unit-less multiplier applied to the per-token drain
 * duration: dur = baseDur * viscosity.  Quicksilver (0.55) pours twice
 * as fast as saffron (1.30).
 */

import type { LiquidId } from './state';

export interface LiquidVisual {
  /** RGB triple in 0..1 per channel. */
  color: readonly [number, number, number];
  /** Emissive boost when this color is on top.  Day 13 animates this. */
  glow: number;
  /** Pour-rate multiplier applied to drain duration.  Higher = slower. */
  viscosity: number;
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
  cinnabar:    { color: rgb('#d4352c'), glow: 0.25, viscosity: 0.85 },
  lapis:       { color: rgb('#2c50cc'), glow: 0.28, viscosity: 1.00 },
  verdigris:   { color: rgb('#40b098'), glow: 0.22, viscosity: 1.00 },
  saffron:     { color: rgb('#f0b828'), glow: 0.35, viscosity: 1.30 },
  amethyst:    { color: rgb('#8c42b8'), glow: 0.28, viscosity: 1.05 },
  quicksilver: { color: rgb('#b8bcc8'), glow: 0.15, viscosity: 0.55 },
};

const FALLBACK: LiquidVisual = { color: [0.5, 0.5, 0.5], glow: 0, viscosity: 1 };

export function liquidVisual(id: LiquidId): LiquidVisual {
  return TABLE[id] ?? FALLBACK;
}

/** Useful for tests + the level editor: enumerate all known liquid ids. */
export function knownLiquidIds(): readonly LiquidId[] {
  return Object.keys(TABLE);
}
