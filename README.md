# The Patient Hand

A water-sort puzzle wrapped in hand-blown glass.

The water-sort genre is proven — top-30 globally on mobile, hundreds of millions of installs — but every version ships the same flat colored rectangles inside cartoon outline tubes. *The Patient Hand* is the version that should have existed: the same satisfying loop, rendered with real-time fluid simulation, custom glass refraction shaders, and a warm 17th-century apothecary atmosphere.

Tap a tube, tap another, pour. Sort every tube to a single color. Liquids slosh, splash, and settle. Glass refracts the lamplit shelf behind it. Each liquid — cinnabar, lapis, verdigris, quicksilver — has its own subtle physical personality.

## Play

> **Status:** early development. Not yet deployed.

```bash
git clone https://github.com/ghreprimand/the-patient-hand.git
cd the-patient-hand
npm install
npm run dev
```

Open `http://localhost:5173` in any browser with WebGL2 support.

## Tech

- **Rendering:** Custom WebGL2 pipeline — no Three.js, no Pixi. Procedural GLSL shaders for the backdrop, glass tubes, liquid layers, pour stream, and splash particles. Everything is generated in the shader; no raster art assets.
- **Simulation:** 1D height-field wave equation per tube for liquid surface dynamics. CPU particle system for splash droplets. Pour state machine with tilt, drain, and stream animation.
- **Stack:** Vite + TypeScript. Zero runtime dependencies. HTML/CSS overlay for UI. Web Audio for sound.
- **Bundle:** < 200KB gzipped total.

## Design

The full design document — covering render pipeline, shader architecture, game rules, level taxonomy, audio design, and the 14-day build plan — lives at [`docs/design.md`](./docs/design.md).

## License

Code: [MIT](./LICENSE). All visual output is procedurally generated (no external art assets to license).
