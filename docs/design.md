# The Patient Hand — design doc & build plan

## Elevator pitch

The water-sort puzzle genre — top-30 globally on mobile, hundreds of millions of installs — has been built and rebuilt by ad-revenue studios that all ship the same flat colored rectangles in cartoon outline tubes. The mechanic is proven, the audience is proven, the itch is proven. **Nobody has bothered to make it look like anything.**

*The Patient Hand* is the version that should have existed. Same loop — tap a tube, tap another, pour the top color, sort every tube to one color — wrapped in a real-time fluid surface simulation, hand-built glass refraction shader, and a warm apothecary frame. Liquids slosh, splash, ripple, settle. Glass refracts the lamplit shelf behind it. Each named liquid (cinnabar, lapis, verdigris, quicksilver) has its own subtle physical personality. Completing a tube emits a soft glow and chime. The whole game looks like a slow-motion bartending video filmed on a foggy autumn evening in a 17th-century herbalist's shop.

The bet: in a genre defined by spreadsheet-grade visuals, the prettiest version wins by default.

## Why this wins

- **Proven loop, zero teaching.** Tap two tubes. A five-year-old gets it in three seconds. Onboarding is a non-problem — the first level *is* the tutorial. We get to spend 100% of design budget on craft.
- **Visible chops.** A real height-field surface sim, custom GLSL glass refraction, particle splashes, and a stratified-liquid renderer that runs at 60fps in a browser tab. The tech is the differentiator — it's the entire reason this version exists.
- **Built-in clip.** A tilted tube pours a tapered ruby stream that arcs under gravity, splashes into a pale gold pool, ripples outward, settles, then the tube *glows* as it completes. That five-second loop is a Twitter scroll-stopper. Every level produces several of them.
- **Genre-shaped distribution.** "Water sort but actually beautiful" is a one-sentence pitch that lands instantly with anyone who's ever played a casual mobile puzzle. The reference is everyone's own past phone-time.
- **OSS-forkable soul.** Every level is a JSON file. Every named liquid is a JSON entry with color + density + viscosity + glow params. Community PRs new levels and seasonal liquid sets. The repo becomes a curated gallery of puzzles.
- **Honest scope.** Two-week solo build. No multiplayer, no accounts, no IAP. Static deploy to any CDN.

## The 30-second hook

1. Page loads. Warm lamplight on a dark walnut shelf. Three tubes already on a rack, gently glowing — they're solving themselves in an attract loop. Soft fire crackle, distant wind, occasional faint *clink* of glass settling.
2. Title fades in over the scene: **THE PATIENT HAND** in a thin serif. A single button: **BEGIN**.
3. Click. Camera glides forward. Shelf clears. Four tubes appear — two filled with stacked layers of *cinnabar* and *lapis*, two empty. No text, no tutorial.
4. Player taps a tube. It lifts ¾cm, casts a longer shadow, glows faintly. Player taps an empty tube. The first tube tilts, a ruby stream arcs out, splashes into the empty tube, ripples. *glug*.
5. Player taps another tube. Pours. The destination becomes a pure column of cinnabar — flashes of warm light from inside, particles rise like fireflies, soft chime. The tube *stays* glowing.
6. Player understands the entire game. They've played for 25 seconds. Level 2 slides in.

## Core mechanic (formalized)

**State.** A level is a set of N tubes. Each tube has a fixed capacity C (typically 4, sometimes 5–6 for harder levels). Each tube holds a stack of color tokens, bottom to top, of length 0 to C. A level uses K distinct colors; each color appears exactly C times across all tubes (one tube's worth). N ≥ K + (slack), where slack is the number of empty/partial tubes (typically 1–3).

**Action.** A move is `pour(source, dest)`. Legal iff:
- `source ≠ dest`
- `source` is non-empty
- `dest` is non-full
- `dest` is empty OR top color of `source` equals top color of `dest`

**Effect.** Let `c` be the top color of `source`. Let `n` be the number of consecutive `c` tokens at the top of `source`. Let `r` be the remaining capacity of `dest`. Move `min(n, r)` tokens of `c` from top of `source` to top of `dest`.

**Win.** Every tube is either empty or filled with C of one color.

**Tools.**
- `undo` — reverts last move. Unlimited per level.
- `restart` — resets level to initial state.
- `hint` — highlights one provably-progressing move. Limited per session (3? regenerates daily) to preserve challenge.

**Stars.** Each level has a known optimal move count (computed at design time). 3★ = within 0–1 of optimal. 2★ = within 25%. 1★ = solved.

That's the entire game. The depth is in level design and presentation.

## Visual identity

**Frame: Apothecary.** A 17th-century herbalist's workshop. Dark walnut shelves, brass fittings, leaded glass windows hinting at fog beyond, an oil lamp casting warm pooled light from upper-left. A leather-bound recipe book sits at edge of frame. A quill rests on parchment that lists today's puzzle name. Tubes are hand-blown glass with visible thickness, tiny imperfections, brass collars at the rim. The rack is dark forged iron with subtle hammered texture.

**Palette.** Background dominated by deep walnut browns (#2a1a0e to #4a3320), brass highlights (#c9a25a), warm lamplight (#ffd49a). Liquids are saturated jewel tones that pop hard against the dark wood. The contrast ratio is the entire visual hook — bright glowing liquids in a moody dim room.

**Named liquids (V1: 12).** Each entry is `{id, name, hex, density, viscosity, glow, personality}`.

| Name | Hex | Density | Viscosity | Glow | Personality |
|---|---|---|---|---|---|
| Cinnabar | #c8312a | 1.4 | 1.0 | warm | Deep crimson, slight reddish glow |
| Lapis | #2c4ec9 | 1.3 | 1.0 | cool | Vivid royal blue, quiet |
| Verdigris | #4ab09a | 0.95 | 1.1 | none | Oxidized teal, heavier-feeling |
| Saffron | #f0b020 | 1.0 | 0.9 | warm | Golden yellow, glows softly |
| Amethyst | #8a3fb0 | 1.2 | 1.0 | cool | Rich purple, faint sparkle |
| Quicksilver | #c8c8d4 | 13.5 | 0.4 | mirror | Mercury — rolls fast, mirror-bright, refuses to mix visually |
| Bone | #f5ecd6 | 0.9 | 1.2 | none | Pale cream, slow viscous pour |
| Onyx | #1a1a22 | 1.6 | 0.8 | none | Near-black ink, dense, drinks light |
| Tourmaline | #e85088 | 1.0 | 1.0 | warm | Pink, cheerful |
| Malachite | #2a8030 | 1.1 | 1.0 | cool | Forest green |
| Honey | #d49030 | 1.2 | 1.6 | warm | Amber, *very* slow pour |
| Indigo | #2a2870 | 1.35 | 1.0 | cool | Deep violet-blue, almost-black |

(Note: density and viscosity are *visual personality* parameters — they affect pour speed and surface behavior, not puzzle logic. The discrete state is identical regardless. This preserves the sort-itch while giving each liquid a fingerprint.)

**Lighting.** Single warm key light from upper-left, dim cool fill from below-right, no other lights. Each liquid that has a `glow` parameter contributes a soft volumetric glow visible against the dark backdrop. Completed (pure) tubes upgrade their glow significantly — they become small lanterns on the shelf.

**Typography.** A single thin display serif (Cormorant Garamond or similar) for titles. Geometric sans (Inter) for HUD numbers. Hand-lettered ink-on-parchment style for the daily puzzle name.

## Tech stack

- **Vite + TypeScript.** Static build, no SSR, deploys anywhere.
- **WebGL2** for all in-game rendering, via a tiny custom wrapper (~300 LOC) — no Three.js, no PixiJS. We need precise control over the glass shader; a renderer abstraction would fight us.
- **HTML/CSS overlay** for all UI (menus, level select, HUD, win screen). DOM is the right tool for text and buttons. Pointer events flow through to the canvas via a transparent layer.
- **Web Audio API** directly for SFX + ambient. Tiny custom mixer (~150 LOC).
- **JSON files** for levels and liquid definitions, bundled at build time, also fetchable at runtime for the in-browser editor.
- **Zero runtime dependencies** beyond browser APIs. Vite is dev-only.

Total bundle target: < 200KB gzipped (excluding audio assets, which lazy-load).

## Architecture

```
src/
  main.ts                  # entry, scene graph, main loop
  game/
    state.ts               # discrete game state, pure functions
    rules.ts               # legal move check, apply move
    level.ts               # level loader, level definition
    daily.ts               # daily puzzle generator (seeded reverse process)
    progression.ts         # save state (localStorage), star tracking
  render/
    gl.ts                  # tiny WebGL2 wrapper (program, vbo, fbo, uniforms)
    shaders/               # .vert / .frag files, imported as strings
    tube.ts                # tube renderer (glass + stack + surface)
    stream.ts              # pour stream renderer
    splash.ts              # particle splash renderer
    backdrop.ts            # apothecary scene (single textured quad + decals)
    glow.ts                # bloom / glow post-pass for completed tubes
  sim/
    surface.ts             # 1D height-field per tube, wave equation
    pour.ts                # pour animation state machine
    particles.ts           # CPU particle system (small, ~1k particles)
  audio/
    mixer.ts               # Web Audio mixer
    sfx.ts                 # named SFX dispatch (glug, splash, chime, etc.)
    ambient.ts             # looping ambient bed
  ui/
    title.ts               # title screen
    select.ts              # level select grid
    hud.ts                 # in-game top bar
    win.ts                 # level complete modal
    editor.ts              # in-browser level editor (dev tool)
levels/
  001.json ... 050.json
liquids.json
```

Strict separation: `game/*` is pure functions over plain data, deterministic, no rendering. `render/*` reads game state and animates toward it. `sim/*` is the visual physics layer — it does not affect game logic.

## Rendering deep-dive

This is the part that matters. The thesis lives or dies here.

### Tube renderer

Each tube is a single fragment-shader-driven quad. The shader receives:

- **Tube shape uniforms:** width, height, wall thickness, neck radius, tilt angle (for pour animation).
- **Stack uniform:** a `vec4[8]` array of `(color.rgb, top_y)` — one per layer, stable-sorted bottom-up. Up to 8 layers (capacity max).
- **Surface uniform:** `float[24]` height samples across the tube width, one per sample column. The wave field.
- **Background sampler:** the rendered backdrop texture, for refraction sampling.
- **Lighting uniform:** key light direction, fill color, ambient.

For each fragment:
1. **Tube SDF.** Compute signed distance from the fragment to the tube outline (including curved bottom and slight bell at neck). Discard if outside.
2. **Inside/outside glass.** If within wall thickness of the SDF surface, this fragment is glass — compute glass color (next step). If interior, this fragment is liquid — compute liquid color (step after).
3. **Glass shading.** Glass is mostly transparent. Sample background texture at this UV, *offset* by a refraction vector computed from the surface normal of the SDF (analytic; SDF gradient gives normal for free). Add a thin rim highlight where normal is perpendicular to view (`1 - abs(dot(normal, viewDir))`). Add a small specular hotspot from the key light.
4. **Liquid shading.** Determine which layer this fragment falls into by its world-space y, accounting for tilt (a horizontal-in-world surface is tilted in tube-space if tube is tilted). The wave field perturbs the *top* of the topmost layer only — sample the height field at this fragment's x to get the actual surface y at this column. If the fragment is above that y, it's air (render glass + background). Otherwise, look up the layer color from the stack.
5. **Liquid lighting.** Tint by the layer color, apply soft directional shading (slightly darker at the bottom of each layer, slightly lighter near surface), add inner caustic from the meniscus where the surface meets the glass.
6. **Glow contribution.** If the tube is "complete" (handled by host code passing a `complete` uniform), boost emissive by an animated factor. This is what makes finished tubes light up the room.

The shader is the largest single piece of work in the project. Estimated 200–300 lines of GLSL. Risk: high. Mitigation: prototype day 2, with a pre-built fallback (gradient + flat liquid bands) ready on day 7 if the shader doesn't land.

### Surface (height field) simulation

Per tube, a 1D array of `(height, velocity)` pairs across the tube width. 24 samples is enough for visual richness without spending too much on it.

Update each frame at fixed 240 Hz internal step (rendered at 60fps via accumulator):

```
for i in 1..N-1:
  laplacian = h[i-1] - 2*h[i] + h[i+1]
  v[i] += c² * laplacian * dt
  v[i] -= damping * v[i] * dt
for i in 0..N-1:
  h[i] += v[i] * dt
boundary: reflect v at edges (Neumann condition)
```

Constants tuned empirically: `c² ≈ 1500`, `damping ≈ 4.0`, target settle time ~2 seconds.

Splash impulse: when a pour stream lands at column x with stream velocity v_stream and current volumetric rate r, add `v[x±2] -= k * r * v_stream * dt` for each frame the stream is landing.

Total CPU cost per frame: 16 tubes × 24 samples × ~10 ops = 3,840 ops. Trivial.

### Pour stream

A pour is a state machine with three phases:

1. **Tilt-up (180ms, ease-out).** Source tube rotates around its base. Internal liquid tilts with it (the shader handles this — surface y is computed in tilted-tube space). Toward the end of tilt, liquid begins approaching the lip.
2. **Stream (variable, 600ms–2400ms depending on volume).** A Bezier curve connects (lip world-position) to (destination surface world-position-at-impact). Render as a thin tapered quad along the curve, colored by source's top liquid, with slight transparency. Particle spray emitted at impact point. Volume drains from source stack at a rate scaled by liquid viscosity (honey is slow, quicksilver is fast); volume accumulates at destination at the same rate.
3. **Tilt-down (180ms, ease-in).** Source returns to upright. Stream cuts off mid-arc and finishes its journey under gravity in ~100ms.

Volume conservation is exact: the shader rounds layer heights to discrete tokens at the moment of pour-completion, snapping any sub-token rounding error away invisibly under cover of the splash.

### Splash particles

CPU particle system, ~50 particles per pour active at once, max ~500 across the whole scene. Each particle is a small textured point sprite (a soft circle gradient) colored by the source liquid. Emitted at impact point, initial velocity in a 60° upward cone biased away from impact direction, gravity-affected, despawn on hitting tube wall or after 600ms.

### Glow / bloom

When a tube completes, two things happen:
1. The tube's `complete` uniform animates from 0 to 1 over 400ms. The shader uses this to boost emissive output of the liquid (overrides normal shading).
2. The tube renders into a separate framebuffer that gets a 2-pass Gaussian blur (downsample → blur → upsample), then additively composited over the main scene. This is the "lantern" effect — completed tubes literally light their surroundings.

### Backdrop

Single high-res textured quad showing the apothecary scene: shelf, brass fittings, lamp, leaded window. Pre-baked lighting. Hand-painted (or AI-assisted then hand-finished) for v1. The tube rack and individual tube positions are decals composited on top so we can vary per-level.

## Audio design

**Ambient bed (loop, –30dB).** Layered:
- Low-frequency fire crackle (1.5kHz lowpassed, gentle pops every few seconds)
- Distant wind (pink noise, 200Hz lowpass, slow LFO modulation)
- Very occasional glass clink (every 12–20 seconds, randomized)
- Faint room tone (subtle reverb tail)

**SFX (each ~20–200ms, mixed –10 to –6dB):**
- `tube_lift` — soft glass-on-wood thunk
- `tube_set` — glass-on-wood place
- `pour_start` — initial liquid release, soft
- `glug_loop` — looping mid-pour gurgle, pitch modulated by remaining volume in source
- `splash_small` / `splash_med` / `splash_large` — pick by stream impact volume
- `surface_settle` — gentle slosh, plays when wave field damps below threshold
- `tube_complete` — soft chime (single bell tone, ~440Hz, 800ms decay) + sparkle
- `level_complete` — short harp arpeggio (4 notes, ~1.2s)
- `ui_click` — leather creak
- `ui_back` — paper rustle
- `invalid_pour` — soft *thunk*, tube sets back down without animating

All SFX synthesized or sourced from CC0 libraries (Freesound, BBC Sound Effects). Total audio asset budget: < 1MB compressed.

## Level design

### Taxonomy

Difficulty axes:
- **N** = tube count (4–16)
- **K** = color count (2–10)
- **C** = capacity (4, 5, 6)
- **slack** = empty tubes at start (typically N - K)
- **scramble depth** = how interleaved colors are at start (cosmetic — affects optimal move count)

### Difficulty curve (50-level v1 ship)

**Chapter 1: The Apprentice (levels 1–10).** N=4–6, K=2–3, C=4, slack=2. Optimal moves 2–8. Teaches the rules through play. Level 1 is two tubes of mixed cinnabar+lapis plus two empty — solvable in 2 moves. Level 10 introduces the third color.

**Chapter 2: The Journeyman (levels 11–25).** N=6–8, K=4–5, C=4, slack=2. Optimal 8–16. Player encounters their first "feels stuck" moment around level 13 and learns to use undo / scratch space.

**Chapter 3: The Herbalist (levels 26–40).** N=10–12, K=7–8, C=4, slack=2. Optimal 16–28. Capacity-5 starts appearing. Onyx and quicksilver introduced for visual variety.

**Chapter 4: The Master (levels 41–50).** N=12–16, K=8–10, C=5–6, slack=1. Optimal 28–50. Hard. Designed to be played slowly with many undos.

Each chapter ends on a designed showcase puzzle that's both hard and visually striking (e.g., a level using all 12 named liquids).

### Level format (JSON)

```json
{
  "id": "027",
  "chapter": 3,
  "name": "The Beekeeper's Order",
  "capacity": 4,
  "tubes": [
    ["honey", "saffron", "honey", "saffron"],
    ["bone", "honey", "bone", "saffron"],
    ["saffron", "bone", "honey", "bone"],
    [],
    []
  ],
  "optimal_moves": 14,
  "author": "joel"
}
```

The level loader validates: every color appears exactly `capacity` times, no tube exceeds capacity, at least one empty/partial tube exists.

### Level editor

In-browser tool reachable at `?editor=1`. Features:
- Click tube to add color from palette
- Right-click tube to remove top
- Add/remove tubes
- Solver button — runs BFS to find optimal solution, fills `optimal_moves` automatically
- Export JSON

This is a developer tool, not a player feature. Cuts level design time from ~15 min to ~3 min per level.

### Daily puzzle

Generator runs at build time (or on first daily-tab open, deterministically seeded by date). Algorithm:
1. Start from a *solved* state with K colors (each tube one pure color, plus 2 empty).
2. Apply M random *reverse* pours (tokens move from non-empty tube to other non-empty tube where top color matches OR is empty). Each reverse pour increases entropy.
3. After M reverse-pours (M = 12–25 depending on weekday), the state is the puzzle.
4. Optimal move count is at most M; usually exactly M (a reverse process is invertible).
5. Seed = `floor(date.UTC() / 86400000)`, ensuring everyone worldwide gets the same daily.

Daily UI: a separate tab with a parchment showing today's puzzle name (algorithmically generated from a word list — "The Quartermaster's Tincture", "Folio XII: Verdigris", etc.), today's date, and a single PLAY button. After completing, shows your move count vs. optimal, with a "Share" button that copies a text summary (no leaderboard in v1).

## Progression & save state

`localStorage` key `tph.progress` holds:
```json
{
  "version": 1,
  "campaign": {
    "001": { "stars": 3, "best_moves": 2 },
    "002": { "stars": 2, "best_moves": 5 },
    ...
  },
  "daily": {
    "2025-05-08": { "completed": true, "moves": 17 }
  },
  "settings": {
    "music_volume": 0.7,
    "sfx_volume": 1.0,
    "reduced_motion": false
  }
}
```

No accounts. No cloud sync. Lose your browser data, lose your progress. This is acceptable for a casual web game and trivializes our infrastructure.

## UI / screens

### Title screen
Full-bleed apothecary scene rendering live (the same engine running an attract-loop puzzle in the background). Logo: **THE PATIENT HAND** in thin serif, centered. Three buttons:
- **BEGIN** (primary, large, gold) — campaign mode
- **TODAY'S PUZZLE** (secondary, parchment-styled)
- **⚙** (small, top-right corner) — settings

### Level select
Grid of levels organized by chapter. Each level tile is a tiny rendered preview of the starting state (real geometry, just smaller). Locked levels show as silhouettes. Star ratings shown beneath. Scrollable. Chapter headers separate sections.

### In-game HUD
Minimal. Top bar:
- Left: chapter and level number, e.g., "III · 27"
- Center: level name, faintly drawn
- Right: undo (↶), restart (↻), menu (≡)

That's it. No move counter visible during play (it would induce stress). Move count appears on the win screen.

### Win screen
Tubes complete their glow animation. Camera slowly zooms in slightly. Modal slides up from the bottom of the screen on parchment:
- Level name in script
- Stars (1–3, large, gold, animated in sequentially)
- "Solved in **N** moves (optimal: **M**)"
- Buttons: NEXT (primary), REPLAY, MENU
- Tiny SHARE icon — copies a text summary to clipboard

### Settings
Modal. Volume sliders, reduced-motion toggle (disables splash particles, reduces wave amplitude, simplifies pour animation), color-blind palette toggle (alternate liquid hues with higher inter-distance), reset progress button.

## Juice catalog

Things that take 5 minutes each but compound into "this game is *expensive*":

- Tube lifts ¾cm with a soft easing curve when selected; settles back when deselected
- Selected tube has a faint golden rim glow (additive, not full bloom)
- Hovering a tube nudges it 2px upward (pre-selection affordance)
- Hover sound (very quiet wood creak)
- Invalid-pour attempt: source tube nods toward destination, then sets back down. *thunk*. No animation tilt.
- Pour stream has a subtle wobble (Perlin noise on Bezier control points, low amplitude)
- Stream color slightly translucent, gradient toward the lighter end
- Splash particles also rise from impact, not just fall — a few flecks of liquid jump up and arc back
- Surface ripples after pour, damped over ~2s
- Tube completion: brief flash from inside, particles rise like fireflies for 800ms, glow lingers
- Multi-tube completion in same move: chord of chimes (each tube's chime pitched a third apart for a triad)
- Win: all glowing tubes pulse once in unison, bloom briefly intensifies, harp plays
- Camera does NOT shake (this is a meditative game, not an action one)
- Background ambient occasionally swells: a longer, deeper wind gust under tense moves
- Title screen attract-loop never repeats — solver picks a random next puzzle each time

## Performance budget

Target: 60fps on a 5-year-old laptop (Intel UHD 620, no discrete GPU), 30fps acceptable on midrange phones.

- Render: one full-screen pass (backdrop) + N tube quads + bloom pass. ~17 draw calls for a 16-tube level. Trivial.
- Shader cost: tube fragment shader does ~30 ops + 1 texture sample + SDF gradient. Estimated 1.5ms per frame for 16 tubes at 1080p.
- Sim cost: 16 tubes × 24 samples × 240Hz × ~10 ops = ~1M ops/sec. Negligible.
- Bloom: 2-pass blur on a 512×512 framebuffer. Estimated 0.5ms.
- Total frame budget at 60fps: 16.6ms. Estimated usage: 4–6ms. 60% headroom.

If we miss target on low-end:
- First lever: reduce surface samples 24 → 12
- Second: skip bloom pass (completed tubes still emissive, just no light spill)
- Third: simpler glass shader (no refraction, just rim + gradient)

## Accessibility

- **Color blindness.** Alternate palette in settings shifts hues to maximize inter-color distance; in addition, every liquid has a distinct subtle pattern (ripple frequency, surface sheen) that aids identification. Unlike most water-sort apps, this version remains playable for all forms of color blindness.
- **Reduced motion.** Settings toggle removes splash particles, dampens surface waves, simplifies pour to a quick straight line.
- **Keyboard navigation.** Tubes are numbered 1–9, A–G via keyboard. Press source-key then dest-key to pour. Undo = U, restart = R.
- **Screen reader.** Each tube has a live ARIA description ("Tube 3: from bottom — cinnabar, cinnabar, lapis, empty"). Pour announces ("Poured cinnabar from tube 1 to tube 3"). Win announces.
- **No flashing.** No content flashes more than 2 times per second.

## Build plan

14 working days. Solo. ~6 hours/day = ~84 hours total.

### Week 1 — prove the visual thesis + core loop

**Day 1 — Setup + decisions.**
- Vite + TS project skeleton
- WebGL2 context, render loop scaffold, single colored quad on screen
- Decide: WebGL2 confirmed, no framework, JSON levels, localStorage progress
- First commit, Git remote, README stub
- Acceptance: dev server runs, blank canvas + one colored rect

**Day 2 — Glass shader prototype.** *Highest-risk day.*
- Single tube SDF in fragment shader
- Refraction sampling against a placeholder background
- Rim highlight, specular hotspot
- One liquid color, fixed level (no waves yet)
- Acceptance: a single tube on screen looks unmistakably like glass with liquid in it. If this day fails to land, we course-correct on day 3 (use a non-refraction look — gradient + rim only — and reclaim the day 6 polish slot).

**Day 3 — Multi-tube scene + backdrop.**
- Render N tubes side-by-side on a shelf
- First-pass apothecary backdrop (placeholder painted texture okay)
- Soft drop shadow under each tube
- Lighting consistency between backdrop and tubes
- Acceptance: 6 tubes on a shelf in a warm-lit scene. Screenshot-worthy.

**Day 4 — Game state + pours (no animation).**
- `game/state.ts`, `game/rules.ts`, `game/level.ts` — pure functions, fully tested
- Click input mapped to pour rule
- State changes snap-render (no animation yet)
- Manual JSON loading of 3 hand-written test levels
- Acceptance: game is technically playable from level 1 to level 3, ugly snaps and all

**Day 5 — Pour animation: tilt + drain + fill.**
- State machine for pour (tilt-up → stream → tilt-down)
- Tube tilt visible in shader (uniform passed through)
- Volume drains from source, fills destination (smoothly interpolated layer heights)
- No stream visual yet — liquid teleports between tubes
- Acceptance: pours look smooth even without the stream

**Day 6 — Pour stream visual.**
- Bezier curve from lip to destination surface
- Tapered quad rendered along curve
- Stream color from source liquid
- Liquid arrives at destination at correct moment to start filling
- Acceptance: pour looks complete and convincing

**Day 7 — Splash + height-field surface.**
- Surface sim per tube
- Splash impulse on stream impact
- Particle splash (CPU particles, point sprites)
- Tune wave damping, splash size, particle count to taste
- **End of Week 1 milestone:** a single pour, from beginning to end, looks **better than any water-sort game on the App Store**. This is the visual thesis proven. If this milestone is missed by more than a day, we reassess scope before continuing.

### Week 2 — content + polish

**Day 8 — UI screens.**
- Title screen with attract-loop background
- Level select grid
- In-game HUD (top bar + buttons)
- Win modal with star animation
- Settings modal
- All HTML/CSS overlay; pointer events transparently flow to canvas where appropriate
- Acceptance: game is navigable end-to-end with placeholder levels

**Day 9 — Audio.**
- Web Audio mixer
- Ambient bed (3 layered loops)
- All SFX wired (tube lift, glug, splash, chime, complete, ui clicks)
- Settings sliders work
- Acceptance: game sounds finished, not muted-development

**Day 10 — Level editor + first 20 levels.**
- In-browser editor at `?editor=1`
- Solver (BFS over state space, capped at 30k nodes)
- Design + commit levels 1–20 (Chapter 1 + start of Chapter 2)
- Acceptance: 20 playable levels with verified optimal move counts

**Day 11 — Levels 21–40 + finalize liquid set.**
- Design + commit levels 21–40 (rest of Chapter 2 + Chapter 3)
- Finalize liquid palette: pick the actual 12, tune hex values, density, viscosity
- Acceptance: 40 polished levels, palette locked

**Day 12 — Levels 41–50 + daily puzzle.**
- Design + commit levels 41–50 (Chapter 4)
- Daily puzzle generator (seeded reverse-process)
- Daily UI tab + share-text generator
- Acceptance: 50 levels + working daily puzzle

**Day 13 — Juice pass.**
- Tube hover/select feedback
- Completion glow + bloom pass
- Multi-tube-complete chord SFX
- Title screen polish
- Win screen polish (stars sequentially, parchment animation)
- Subtle ambient swells
- Pour stream wobble
- Acceptance: every interaction feels expensive

**Day 14 — Bug fix, perf, deploy.**
- FPS profiling on low-end target (Intel UHD)
- Fallback paths for missed perf budget
- Mobile responsive layout (functional, not optimized)
- Accessibility pass (keyboard nav, ARIA, reduced motion verification)
- Cross-browser smoke test (Chrome, Firefox, Safari)
- Static deploy to Cloudflare Pages or similar
- Acceptance: shippable build, public URL

### Buffer days

If any day slips, the buffer is taken from level count. Drop to 40 levels, then 30. Below 30 levels, redesign — but unlikely.

## Risks & mitigations

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Glass refraction shader doesn't look great | Medium | High | Day 2 is the prototype. Fallback (gradient + rim, no refraction) ready as plan B. Whole game still works without it, just less of a flex. |
| Pour animation feels off | Medium | High | Iterate on day 5–6. The state machine is simple; the feel is in easing curves and stream taper. Budget all of day 6 for tuning. |
| Audio feels generic / weak | Medium | Medium | Day 9 is dedicated. Source from CC0 + light synthesis. The chime on completion is the most important single sound — budget extra time for that one. |
| Level design takes longer than budgeted | High | Medium | Editor + solver on day 10 is the time-saver. Acceptable to ship 30 levels v1 with promise of more. |
| Performance on low-end is poor | Low | Medium | Three-tier fallback already designed. Even worst case is playable. |
| Game is "just water sort" perceptually | Medium | High | Visuals carry the differentiation. If visuals land, this risk is moot. The whole bet depends on visuals. |
| Solo developer burnout in week 2 | Medium | High | Days 13–14 are flexible polish; can absorb a recovery day. Buffer is real. |

## Out of scope (v1)

Explicitly NOT building, to keep scope honest:

- Multiplayer / async play
- User accounts / cloud save
- Monetization (ads, IAP, subscriptions)
- Level rating / community submissions UI (PRs to GitHub are the v1 community story)
- Procedural campaign levels (campaign is hand-crafted only)
- Mobile-native app (web only — works in mobile browsers but not optimized)
- Localization (English only)
- Achievements system
- Replays of past solutions
- More than 12 named liquids
- Tube types beyond the standard test tube (no flasks, beakers, retorts in v1)
- Heat / chemistry interactions (we are NOT the apothecary brewing pivot — that was rejected)

## Stretch goals (if days 13–14 come in early)

In priority order:

1. **Solution replay.** Save player's move sequence; offer a "watch" button on win screen that replays it on the same level at 2× speed.
2. **Time-lapse share.** Render a 4-second WebM of the player's solution, downloadable. The Twitter clip auto-generates.
3. **Seasonal liquid sets.** Halloween (witch's reagents — bat blood, swamp water, cauldron foam), Winter (frosted, icy palette). Drop-in JSON.
4. **"Brewing" achievements.** Solve 10 levels under optimal-moves+1: title bestowed ("Steady Pour"). Visible on title screen.
5. **Tube variety.** Beakers (wider, more capacity), retorts (s-curved, weird pour physics). Adds visual variety to late-chapter levels.
6. **Music.** A single ~3-minute looping piece — solo cello or hammered dulcimer, slow and warm.

## Locked decisions

- **Name.** *The Patient Hand*.
- **Backdrop art origination.** AI-generated for the rich apothecary scene + CC0-sourced decals + procedural/shader work for tubes and liquids. **No commissioned art.** Specific gaps surface during Day 3 (backdrop) and Day 8 (UI ornaments) and get re-generated targeted then.
- **Level count v1.** 50.
- **Platform priority.** Mobile and desktop are co-equal first-class. Graphics quality preserved on both. **Mobile floor:** iPhone X / iOS 15+, mid-range Android (Pixel 4a era) on Chrome, 2020+ devices. WebGL2 assumed unconditionally; no WebGL1 fallback path.
- **Daily puzzle + leaderboard.** Both ship in v1. Cloudflare Workers + KV (or equivalent free-tier serverless). Anti-cheat: client submits the full move sequence; server replays against the day's puzzle, verifies it solves, then stores `{name, moves, time_ms, date}`. Display top 100 + the player's row.
- **Display name.** One word, 12-character max, ASCII alphanumerics + underscores/hyphens, basic profanity filter (small wordlist). Stored once in `localStorage`; used for all daily-puzzle submissions.
- **License.** Code MIT. Art permissive (CC0 / CC-BY). The repo is public and source-available, satisfying the jam guideline.
