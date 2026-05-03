# Path-shape variants for the GML body

**Status:** Design approved 2026-05-03
**Scope:** Extend the visualizer so the polygon cross-section can be swept along center curves other than a circle.

## Goal

Today the body is a circle of radius `R = 2.3` (in the xy-plane) with a regular `m`-gon cross-section that rotates `n/m` times per revolution. The user wants to choose alternative *toroidal* shapes — closed-loop center curves like ellipses, lemniscates, and torus knots — without changing how the cross-section, cuts, orbits, or sound mode behave.

## Non-goals

- Varying the cross-section (cross-section stays a regular `m`-gon).
- A free-form path editor (Bezier / drag-the-control-points UI).
- Camera auto-fit per shape (user keeps manual zoom).
- Animating progression along the path.
- Cleaning up unrelated parts of the codebase.

## Architecture

### `pathSpec` abstraction

Introduce a small object describing the center curve:

```
pathSpec = {
  kind:    'circle' | 'ellipse' | 'torusKnot' | 'lemniscate',
  params:  { ...shape-specific },
  period:  2 * Math.PI                  // θ range that closes the loop
}
```

A pure helper `makePathFrame(pathSpec, K = 1024)` returns a sampled frame table:

```
{
  C: Float32Array[K * 3],   // center positions C(θ_i)
  N: Float32Array[K * 3],   // first cross-section axis
  B: Float32Array[K * 3],   // second cross-section axis (B = T × N for non-planar)
  K, period
}
```

`pathFrame.eval(theta)` linearly interpolates the table by index. The table is rebuilt only when `pathShape` or its parameters change.

### Embedding change

Replace:

```js
function localToWorld(theta, uL, vL, R, m, n) {
  const cx = R * Math.cos(theta), cy = R * Math.sin(theta);
  const Nx = Math.cos(theta),     Ny = Math.sin(theta);
  const alpha = (n / m) * theta;
  const cA = Math.cos(alpha), sA = Math.sin(alpha);
  const aN = uL * cA - vL * sA;
  const aB = uL * sA + vL * cA;
  return [cx + aN * Nx, cy + aN * Ny, aB];     // B is implicitly ẑ
}
```

with:

```js
function localToWorld(pathFrame, theta, uL, vL, m, n) {
  const [cx, cy, cz] = pathFrame.C(theta);
  const [Nx, Ny, Nz] = pathFrame.N(theta);
  const [Bx, By, Bz] = pathFrame.B(theta);
  const alpha = (n / m) * theta;
  const cA = Math.cos(alpha), sA = Math.sin(alpha);
  const aN = uL * cA - vL * sA;
  const aB = uL * sA + vL * cA;
  return [
    cx + aN * Nx + aB * Bx,
    cy + aN * Ny + aB * By,
    cz + aN * Nz + aB * Bz,
  ];
}
```

The `α = (n/m)·θ` rotation that controls cross-section twist is unchanged. It still operates inside the local `(N, B)` frame, so the meaning of `m` and `n` is preserved on every shape.

### Builders

`buildWholeGeometry`, `buildWedgeGeometry`, `buildStripGeometry`, `buildRegionGeometry`, and `buildRidgeLines` currently each accept `R` and call `localToWorld(theta, ..., R, m, n)`. Their signatures change to accept a `pathFrame` instead of `R`, and they pass it to the new `localToWorld`. No other logic in these functions changes.

### What does *not* change

- `getPolygonVertices`, `polygonBoundary`, `clipPolygonByHalfPlane`, `clipPolygonToStrip`, `polygonArea`, `findAllRegions` — all in the local 2D frame.
- `getCutInfo`, `computeOrbitsCyclic`, `getParallelOrbits`, `offCenterChords`, `pointToPointChords` — depend only on `m`, `n`, `r`, and chord geometry; path-independent.
- `polygonWaveform`, `sampleWaveformPhase`, the audio path, the `(p·θ + q·φ − phase)` color sweep — path-independent.
- `CrossSection2D` — purely 2D, unaffected.
- Picking (`THREE.Raycaster`, `userData.orbitIdx`), highlight/solo (`applyHighlight`, `orbitMats`) — operate on rendered meshes regardless of the path.

## Preset shapes

### circle (default — preserves current rendering)

- Params: `R` (default 2.3).
- `C(θ) = (R cosθ, R sinθ, 0)`.
- Frame: `N = (cosθ, sinθ, 0)`, `B = (0, 0, 1)` (analytic; matches today's hard-coded behavior exactly).

### ellipse

- Params: `a` (default 2.3), `b` (default 1.5).
- `C(θ) = (a cosθ, b sinθ, 0)`.
- Tangent `T(θ) ∝ (−a sinθ, b cosθ, 0)`. Planar in-plane normal `N` is `T` rotated −90° in xy and renormalized; `B = (0, 0, 1)`.

### (p, q)-torus knot

- Params: `R` (default 2.0, major), `r_path` (default 0.6, knot-tube offset — distinct from cross-section circumradius `r = 0.78`), integer `p` (default 2), integer `q` (default 3).
- `C(θ) = ((R + r_path cos qθ) cos pθ, (R + r_path cos qθ) sin pθ, r_path sin qθ)`.
- Period `2π`; for `gcd(p, q) = 1` this single revolution traces the full knot.
- Non-planar — frame is computed by **rotation-minimizing parallel transport** (discrete RMF via Wang et al. 2008's double-reflection method) propagated over the `K` samples. Initial `N₀` is chosen perpendicular to the initial tangent in the xy-plane.
- UI constrains `(p, q)` to coprime pairs by snapping the most recently moved slider away when the pair becomes non-coprime.

### lemniscate (Bernoulli figure-eight)

- Params: `a` (default 2.3).
- `C(θ) = (a cosθ / (1 + sin²θ), a sinθ cosθ / (1 + sin²θ), 0)`.
- Planar in-plane frame as for the ellipse; `B = (0, 0, 1)`.
- The body self-intersects at the origin. This is intended — it visualizes the figure-eight topology and is geometrically meaningful for GML bodies.

## Frame closure

Parallel transport along a closed loop generally accumulates a residual *holonomy* twist `Δ` at `θ = 2π` even when the curve closes geometrically. To keep the cross-section closure independent of path shape (and to keep `n = 0` rendering free of twist on knotted paths), `makePathFrame`:

1. Builds the discrete frame `(N_i, B_i)` for `i = 0…K-1` by RMF.
2. Measures `Δ = signed angle between (N_K, B_K) and (N_0, B_0)` in the plane perpendicular to `T_K`.
3. Rotates each `(N_i, B_i)` by `−Δ · (i / K)` so the table closes.

The visible cross-section twist is then driven only by `α = (n/m)·θ` from `localToWorld`, exactly as today on the circle.

## State + UI

New React state in `GMLBody`:

```
pathShape:    'circle' | 'ellipse' | 'torusKnot' | 'lemniscate'   // default 'circle'
circleR:      number (default 2.3)
ellipseA:     number (default 2.3)
ellipseB:     number (default 1.5)
knotR:        number (default 2.0)
knotr:        number (default 0.6)
knotP:        integer (default 2)
knotQ:        integer (default 3)
lemA:         number (default 2.3)
```

UI placement (mirroring the existing `cutMode` picker pattern):

- A button row labeled **shape** with four buttons (circle / ellipse / knot / lemniscate), placed in the controls drawer just above the `m`/`n` sliders.
- Below the row: the contextual sliders for the currently selected shape and only that shape (e.g. selecting *ellipse* shows `a` and `b`, hides the others).

`makePathFrame` is memoized on `(pathShape, ...pathParams)` and the resulting `pathFrame` is passed into `stateRef.current.rebuild(...)`. Switching shapes triggers exactly one rebuild.

The hard-coded `R = 2.3, r = 0.78` in `rebuild` is split: `R` becomes the path-derived radius (only used for camera/zoom heuristics if any; cross-section math uses `r` only and does not change).

## Edge cases

- **Lemniscate self-intersection.** Allowed; documented as expected.
- **Non-coprime knot `(p, q)`.** Snap to the nearest coprime pair on the most-recently-moved axis. Avoids degenerate lower-order torus links.
- **Knot `q = 0` or `p = 0`.** Degenerates to a circle; treat the same way (snap or show no extra twist).
- **`m = 2` (degenerate rectangle cross-section).** Path-independent; works on every shape.
- **Cut math (`getCutInfo`, region counts).** Path-independent; piece counts displayed in the UI remain correct on any shape.
- **Sound mode.** The `(p·θ + q·φ − phase)` color sweep is parametrized by θ, not by world coordinates, so it works unchanged on knotted bodies.

## Two-file mirror

Per `CLAUDE.md`, every change applies identically to:

- `index.html` (the runtime, with the JSX inside `<script type="text/babel">`)
- `gml_body.jsx` (the mirror copy used by editor tooling)

The two files diverge only in their first three lines (imports vs. `const { useRef, useEffect, useState } = React;`) and a trailing comment delimiter; everything else is byte-identical and must remain so.

## Verification

There is no test suite. Verification is manual:

1. With `pathShape = 'circle'` and default params, rendering is visually identical to the pre-change version (regression check).
2. Each preset renders without console errors and without NaN geometry.
3. Cuts (`center`, `offcenter`, `p2p`) continue to produce the displayed piece counts on every preset.
4. Sound mode color sweep + audio still drive correctly with `pathShape = 'torusKnot'`.
5. Switching shapes does not leak THREE.js geometries (memory; verify via the existing `dispose` path in `rebuild`).

## Files touched

- `index.html`
- `gml_body.jsx`

No new files in source. New documentation file is this spec.
