# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page interactive 3D visualizer for **Generalized Möbius–Listing (GML) bodies** — toroidal surfaces whose cross-section is a regular m-gon rotating n/m times per revolution. The app supports cutting the body in three modes (center / offcenter / point-to-point), animating the resulting connected components, and a "sound" mode that drives both visuals and Web Audio output from polygon-derived waveforms (Chapman, ISSBG 2023).

There is no build pipeline. The page loads React 18, Three.js r128, and Babel Standalone from CDNs and transpiles the embedded JSX in the browser at runtime.

## Running

Open `index.html` directly, or serve the directory statically (e.g. `python3 -m http.server` from the repo root) and visit `http://localhost:8000/`. There is no test suite, no lint config, and no build step.

The `pyproject.toml` is a stub created by PyCharm — there is no Python code in this project. Ignore it unless you're adding tooling.

## Source layout — the two-file mirror

The JSX exists in two places that must be kept in sync:

- **`index.html`** — the runnable artifact. The full JSX lives inside a `<script type="text/babel">` block (lines ~42–2841). `ReactDOM.createRoot(...).render(<GMLBody />)` is at the bottom.
- **`gml_body.jsx`** — a near-identical copy with proper ES `import` statements at the top. It is *not* loaded by `index.html`; it appears to exist for editor tooling / standalone reading.

When editing logic, change both files. The contents diverge only in the first 3 lines (imports vs. the inline `const { useRef, useEffect, useState } = React;` destructuring) and a single trailing comment delimiter — everything else is byte-identical. The runtime is `index.html`.

## Code architecture

All logic lives in one ~2800-line module organized as layered concerns. Reading order top-to-bottom roughly matches the dependency order.

**Math layer (pure, no Three.js):**
- `gradientMod`, `applyGradient`, `addFlatColors` — θ-based vertex-color shading.
- `polygonWaveform`, `sampleWaveformPhase` — convert an m-gon into a 2048-sample waveform; same buffer drives audio (`AudioContext` + `AudioBufferSourceNode`) and the visual color sweep.
- `polygonBoundary`, `localToWorld`, `getPolygonVertices` — parametric m-gon cross-section and its embedding into the rotating frame `R(α)`, where `α = (n/m)·θ`.
- `clipPolygonByHalfPlane`, `clipPolygonToStrip`, `polygonArea`, `findAllRegions` — Sutherland–Hodgman polygon clipping used to compute the connected pieces produced by chord cuts.
- `getCutInfo`, `computeOrbitsCyclic`, `getParallelOrbits`, `offCenterChords`, `pointToPointChords` — orbit/component counting under the wedge-shift induced by `n/m`. **The "piece count" displayed in the UI comes from these functions** — `K_cuts = m / gcd(2n, m)`, orbits = `gcd(wedgeShift, numWedges)`.

**Geometry builders (return `THREE.BufferGeometry`):**
- `buildWholeGeometry` — uncut body.
- `buildWedgeGeometry` — one pie-slice between two chord cuts (used for `cutMode = 'center'`).
- `buildStripGeometry` — used for parallel-chord slabs.
- `buildRegionGeometry` — generic builder that takes an arbitrary clipped 2D region polygon plus `cutTags` (which edges came from cuts vs. the outer boundary) and extrudes it along θ with the rotating frame. Used by `offcenter` and `p2p` modes.
- `buildRidgeLines` — outline edges along m-gon vertices.
- `bladePoint`, `deformPolygon`, `sampleProfile` — apply blade-shape deformations (straight / curved / zigzag / custom-profile) to chord cuts before extrusion.

**Component layer (React):**
- `GMLBody` (line ~822) — the only stateful component. Holds all sliders/toggles in `useState`, owns the Three.js scene via a single `useEffect` that runs once on mount, and uses `stateRef` as a mutable bag for non-React-reactive scene data (group, materials per orbit, current `objects[]`, sound buffers). The effect builds the scene, sets up pointer/wheel/raycaster picking with click-vs-drag detection, and starts the rAF tick loop.
- `stateRef.current.rebuild(...)` is the central re-geometry function — it disposes prior meshes, dispatches on `cutMode`, calls the appropriate builder per region, and registers `orbitIdx` on each mesh for the highlight/solo system.
- `applyHighlight()` toggles per-orbit material opacity (`orbitMats`) for the click-to-solo / hover-to-highlight UI.
- Smaller presentational components below `GMLBody`: `Slider`, `Toggle`, `WaveformDisplay`, `PieceDots`, `BladeProfileEditor`, `CrossSection2D`. `CrossSection2D` is its own SVG-based 2D editor — keep its chord/region math consistent with the 3D side (both call `findAllRegions`, `offCenterChords`, `pointToPointChords`).

**Picking and interaction:**
A single `THREE.Raycaster` resolves pointer events to `userData.orbitIdx`. Click-vs-drag is distinguished by `CLICK_THRESHOLD` pixels of total movement. Pinch-to-zoom is implemented manually via `pointers` Map; mouse wheel uses exponential zoom on `stateRef.current.zoom`.

**Sound mode:**
When enabled, the rAF loop samples `polygonWave` per vertex using `(p·θ + q·φ − phase)` and writes a cool-to-warm diverging colormap into the per-orbit material's vertex colors. The audio side feeds the same waveform into a looping `AudioBufferSource` at `waveFreq` Hz.

**Hint layer:**
A `HoverHintProvider` near the top of `<GMLBody>`'s JSX and a `<HintPopover>` portal-mounted at document level handle hover-revealed parameter explanations. Each control row is wrapped with `<HintRow hint={HINTS.<id>}>`; the centralized `HINTS` object near the top of the script block is the single source of truth for hint copy. Mode-button rows and toggle rows pass `modeButton` for tap-and-hold-350ms semantics on mobile (with `onClickCapture` suppressing the post-hold synthetic click); slider rows use tap-on-label. `<FirstRunHint>` is a once-per-session muted line at the bottom of the main palette and mobile drawer, gated by `sessionStorage['gml.hint.seen']`.

## Conventions to preserve

- The geometric constants `R = 2.3` (major radius) and `r = 0.78` (cross-section circumradius) are repeated in several places (`rebuild`, the `offCenterInfo` / `p2pInfo` derivations inside `GMLBody`). If you change one, change all.
- `PROFILE_N = 41` is intentionally odd so the chord midpoint lands exactly on a sample.
- `PIECE_PALETTE` is sized for robustness — diametric cuts mathematically produce ≤2 orbits, but extra entries exist for future cut modes.
- Comments in this file lean explanatory because the math is non-obvious; preserve the "why" comments when refactoring (e.g. the cosine seam-symmetry note, the m=2 degenerate-rectangle handling).
