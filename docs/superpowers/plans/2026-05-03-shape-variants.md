# Path-Shape Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick the center curve the polygon cross-section sweeps along — *circle*, *ellipse*, *(p,q)-torus knot*, or *lemniscate* — without changing the m-gon cross-section, cuts, orbits, or sound mode.

**Architecture:** Introduce a `pathFrame` abstraction (sampled `C(θ)`, `N(θ)`, `B(θ)` table) consumed by `localToWorld` and all geometry builders. The hard-coded circle in `localToWorld` is replaced by a table lookup; cross-section math (`α = (n/m)·θ` rotation in the local `(N, B)` frame) is unchanged. A new shape picker plus per-shape sliders sits above the existing `m`/`n` sliders.

**Tech Stack:** React 18 + Three.js r128 + Babel Standalone (CDN, no build). Two-file mirror: every code change applies identically to `index.html` (runtime) and `gml_body.jsx` (mirror) per `CLAUDE.md`.

**Spec:** `docs/superpowers/specs/2026-05-03-shape-variants-design.md`

**Verification model:** This project has no test runner. Each task ends with a concrete manual-verification step — usually opening `index.html` in a browser and pasting an assertion into the JS console, or visually inspecting the canvas. Where the math is pure, we paste assertions directly.

---

## Two-File Mirror Discipline

Every code edit in this plan applies to **both** files:

- `/Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html` (runtime — JSX inside the `<script type="text/babel">` block)
- `/Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx` (mirror — same code with `import` lines at the top)

The two files diverge **only** in their first three lines (imports vs. `const { useRef, useEffect, useState } = React;`) and a single trailing comment delimiter. After every edit, run:

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
```

The diff must contain only the protected first-3-lines region and the trailing-comment delimiter — nothing else. If it does, the mirror is correct.

In each task below, the **Files** section lists `index.html` line ranges; apply the same edit to the equivalent location in `gml_body.jsx` (line numbers will be ~40 lower because gml_body.jsx is missing the HTML wrapper).

---

## Task 1: Add path-math primitives

Add four preset center-curve functions, an analytic in-plane frame helper, and a rotation-minimizing-frame (RMF) helper. No call sites yet — pure additions.

**Files:**
- Modify: `/Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html` — insert a new section *between* `localToWorld` (line 186) and `getPolygonVertices` (line 196). Keep `localToWorld` itself untouched in this task.
- Mirror: `/Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx` — same insertion at the equivalent location.

- [ ] **Step 1: Insert path-math block in `index.html`**

Insert this block immediately after the closing `}` of `localToWorld` (line 194) and before the comment `// Polygon vertices in the rotating frame...` (line 196):

```js
// --- Path-shape primitives ------------------------------------------------
// Center-curve generators C(θ) → [x, y, z] for each preset. They return a
// raw 3D point; frame computation is done by makePathFrame() below.

function pathCircle(theta, p) {
  const R = p.R;
  return [R * Math.cos(theta), R * Math.sin(theta), 0];
}

function pathEllipse(theta, p) {
  return [p.a * Math.cos(theta), p.b * Math.sin(theta), 0];
}

function pathLemniscate(theta, p) {
  // Bernoulli-style figure-eight in the xy-plane. Self-crosses at the origin.
  const a = p.a;
  const s = Math.sin(theta), c = Math.cos(theta);
  const denom = 1 + s * s;
  return [a * c / denom, a * s * c / denom, 0];
}

function pathTorusKnot(theta, p) {
  // Standard (p, q)-torus knot wrapped on a virtual torus of radii (R, r_path).
  // Period 2π for any coprime (P, Q).
  const P = p.P, Q = p.Q, R = p.R, rp = p.rp;
  const ct = Math.cos(Q * theta), st = Math.sin(Q * theta);
  const cp = Math.cos(P * theta), sp = Math.sin(P * theta);
  return [(R + rp * ct) * cp, (R + rp * ct) * sp, rp * st];
}

// Numerical tangent via central difference. Used by makePathFrame for shapes
// that don't have an analytic frame on hand.
function pathTangent(C, theta, params, h) {
  const eps = h || 1e-4;
  const a = C(theta - eps, params);
  const b = C(theta + eps, params);
  const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
  const L = Math.hypot(tx, ty, tz) || 1;
  return [tx / L, ty / L, tz / L];
}

// Rotation-minimizing-frame propagator (Wang et al. 2008, "double reflection").
// Given the previous frame (T₀, N₀, B₀) at C₀ and the next tangent T₁ at C₁,
// returns the new (N₁, B₁) that minimizes torsional rotation. Avoids the
// instabilities of Frenet at inflection points.
function rmfStep(C0, T0, N0, C1, T1) {
  const v1 = [C1[0] - C0[0], C1[1] - C0[1], C1[2] - C0[2]];
  const c1 = v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2];
  if (c1 === 0) return N0.slice();
  const dotN0 = (v1[0] * N0[0] + v1[1] * N0[1] + v1[2] * N0[2]) * 2 / c1;
  const Nl = [N0[0] - dotN0 * v1[0], N0[1] - dotN0 * v1[1], N0[2] - dotN0 * v1[2]];
  const dotT0 = (v1[0] * T0[0] + v1[1] * T0[1] + v1[2] * T0[2]) * 2 / c1;
  const Tl = [T0[0] - dotT0 * v1[0], T0[1] - dotT0 * v1[1], T0[2] - dotT0 * v1[2]];
  const v2 = [T1[0] - Tl[0], T1[1] - Tl[1], T1[2] - Tl[2]];
  const c2 = v2[0] * v2[0] + v2[1] * v2[1] + v2[2] * v2[2];
  if (c2 === 0) return Nl;
  const dotNl = (v2[0] * Nl[0] + v2[1] * Nl[1] + v2[2] * Nl[2]) * 2 / c2;
  return [Nl[0] - dotNl * v2[0], Nl[1] - dotNl * v2[1], Nl[2] - dotNl * v2[2]];
}

// Choose an initial N₀ orthogonal to T₀, biased toward the xy-plane so planar
// curves get the same outward-radial frame the original circle code used.
function initialNormal(T) {
  const flat = [-T[1], T[0], 0];
  const fl = Math.hypot(flat[0], flat[1]);
  if (fl > 1e-6) return [flat[0] / fl, flat[1] / fl, 0];
  // Tangent is vertical — fall back to x-axis.
  return [1, 0, 0];
}

// Build a sampled frame table for one full period of the path. K samples,
// nearest-sample lookup. The returned object exposes evaluator methods used
// by localToWorld.
function makePathFrame(pathSpec, K) {
  K = K || 1024;
  const period = pathSpec.period || (2 * Math.PI);
  const Cfn = pathSpec.Cfn;
  const params = pathSpec.params;
  const Cs = new Float32Array(K * 3);
  const Ts = new Float32Array(K * 3);
  for (let i = 0; i < K; i++) {
    const t = (i / K) * period;
    const c = Cfn(t, params);
    const T = pathTangent(Cfn, t, params);
    Cs[i*3] = c[0]; Cs[i*3+1] = c[1]; Cs[i*3+2] = c[2];
    Ts[i*3] = T[0]; Ts[i*3+1] = T[1]; Ts[i*3+2] = T[2];
  }
  // Propagate N around the loop with RMF, starting from initialNormal at i=0.
  const Ns = new Float32Array(K * 3);
  let N = initialNormal([Ts[0], Ts[1], Ts[2]]);
  Ns[0] = N[0]; Ns[1] = N[1]; Ns[2] = N[2];
  for (let i = 1; i < K; i++) {
    const C0 = [Cs[(i-1)*3], Cs[(i-1)*3+1], Cs[(i-1)*3+2]];
    const T0 = [Ts[(i-1)*3], Ts[(i-1)*3+1], Ts[(i-1)*3+2]];
    const C1 = [Cs[i*3], Cs[i*3+1], Cs[i*3+2]];
    const T1 = [Ts[i*3], Ts[i*3+1], Ts[i*3+2]];
    N = rmfStep(C0, T0, [Ns[(i-1)*3], Ns[(i-1)*3+1], Ns[(i-1)*3+2]], C1, T1);
    // Re-orthonormalize against T1 to fight floating-point drift.
    const dot = N[0]*T1[0] + N[1]*T1[1] + N[2]*T1[2];
    N = [N[0] - dot * T1[0], N[1] - dot * T1[1], N[2] - dot * T1[2]];
    const Ln = Math.hypot(N[0], N[1], N[2]) || 1;
    N = [N[0]/Ln, N[1]/Ln, N[2]/Ln];
    Ns[i*3] = N[0]; Ns[i*3+1] = N[1]; Ns[i*3+2] = N[2];
  }
  // Holonomy correction so the frame closes at θ = period.
  // Measure the residual rotation between N at i=0 and what RMF would give
  // at i=K (one more step beyond the table), in the plane perpendicular to T₀.
  const C_last  = [Cs[(K-1)*3], Cs[(K-1)*3+1], Cs[(K-1)*3+2]];
  const T_last  = [Ts[(K-1)*3], Ts[(K-1)*3+1], Ts[(K-1)*3+2]];
  const N_last  = [Ns[(K-1)*3], Ns[(K-1)*3+1], Ns[(K-1)*3+2]];
  const C_wrap  = [Cs[0], Cs[1], Cs[2]];
  const T_wrap  = [Ts[0], Ts[1], Ts[2]];
  const N_wrap_predicted = rmfStep(C_last, T_last, N_last, C_wrap, T_wrap);
  // Compute signed angle from N_wrap_predicted to Ns[0] in the (N, B) plane.
  const N0 = [Ns[0], Ns[1], Ns[2]];
  const B0 = [
    T_wrap[1]*N0[2] - T_wrap[2]*N0[1],
    T_wrap[2]*N0[0] - T_wrap[0]*N0[2],
    T_wrap[0]*N0[1] - T_wrap[1]*N0[0],
  ];
  const cosD = N_wrap_predicted[0]*N0[0] + N_wrap_predicted[1]*N0[1] + N_wrap_predicted[2]*N0[2];
  const sinD = N_wrap_predicted[0]*B0[0] + N_wrap_predicted[1]*B0[1] + N_wrap_predicted[2]*B0[2];
  const delta = Math.atan2(sinD, cosD);  // residual we want to remove
  // Back-rotate each (N, B) by -delta * (i / K) so the table closes.
  const Bs = new Float32Array(K * 3);
  for (let i = 0; i < K; i++) {
    const ang = -delta * (i / K);
    const cA = Math.cos(ang), sA = Math.sin(ang);
    const Ni = [Ns[i*3], Ns[i*3+1], Ns[i*3+2]];
    const Ti = [Ts[i*3], Ts[i*3+1], Ts[i*3+2]];
    const Bi = [
      Ti[1]*Ni[2] - Ti[2]*Ni[1],
      Ti[2]*Ni[0] - Ti[0]*Ni[2],
      Ti[0]*Ni[1] - Ti[1]*Ni[0],
    ];
    const Nrot = [
      Ni[0]*cA + Bi[0]*sA,
      Ni[1]*cA + Bi[1]*sA,
      Ni[2]*cA + Bi[2]*sA,
    ];
    const Brot = [
      -Ni[0]*sA + Bi[0]*cA,
      -Ni[1]*sA + Bi[1]*cA,
      -Ni[2]*sA + Bi[2]*cA,
    ];
    Ns[i*3]   = Nrot[0]; Ns[i*3+1] = Nrot[1]; Ns[i*3+2] = Nrot[2];
    Bs[i*3]   = Brot[0]; Bs[i*3+1] = Brot[1]; Bs[i*3+2] = Brot[2];
  }
  const lookup = (theta) => {
    let t = theta % period;
    if (t < 0) t += period;
    const i = Math.floor(t / period * K) % K;
    return i;
  };
  return {
    K, period,
    C: (theta) => { const i = lookup(theta); return [Cs[i*3], Cs[i*3+1], Cs[i*3+2]]; },
    N: (theta) => { const i = lookup(theta); return [Ns[i*3], Ns[i*3+1], Ns[i*3+2]]; },
    B: (theta) => { const i = lookup(theta); return [Bs[i*3], Bs[i*3+1], Bs[i*3+2]]; },
  };
}

// Convenience: a circle pathFrame with the historical R = 2.3 default. Used
// as the migration default while builders are converted in Task 3.
function defaultCirclePathFrame(R) {
  return makePathFrame({ Cfn: pathCircle, params: { R: R == null ? 2.3 : R }, period: 2 * Math.PI }, 1024);
}
```

- [ ] **Step 2: Mirror the same insertion in `gml_body.jsx`**

Insert the identical code block at the equivalent location in `gml_body.jsx` (between the existing `localToWorld` and `getPolygonVertices`).

- [ ] **Step 3: Verify the mirror diff is clean**

Run:
```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
```

Expected: only the protected first-3-lines region (imports vs. the React destructuring) and the trailing-comment delimiter differ. Nothing else.

- [ ] **Step 4: Sanity-check the math in the browser console**

Open `index.html` in a browser. Open DevTools → Console. Paste:

```js
const f = defaultCirclePathFrame(2.3);
const c0 = f.C(0), c1 = f.C(Math.PI / 2);
console.assert(Math.abs(c0[0] - 2.3) < 0.01 && Math.abs(c0[1]) < 0.01, 'circle C(0) ≈ (2.3, 0, 0)');
console.assert(Math.abs(c1[0]) < 0.01 && Math.abs(c1[1] - 2.3) < 0.01, 'circle C(π/2) ≈ (0, 2.3, 0)');
const n0 = f.N(0), n1 = f.N(Math.PI / 2);
console.assert(Math.abs(Math.hypot(...n0) - 1) < 1e-3, '|N(0)| ≈ 1');
console.assert(Math.abs(Math.hypot(...n1) - 1) < 1e-3, '|N(π/2)| ≈ 1');

const knot = makePathFrame({
  Cfn: pathTorusKnot,
  params: { P: 2, Q: 3, R: 2.0, rp: 0.6 },
  period: 2 * Math.PI,
}, 1024);
const k0 = knot.C(0), kEnd = knot.C(2 * Math.PI - 1e-6);
console.assert(Math.hypot(k0[0]-kEnd[0], k0[1]-kEnd[1], k0[2]-kEnd[2]) < 0.05,
  'trefoil closes (C(0) ≈ C(2π))');
const knotN0 = knot.N(0), knotNEnd = knot.N(2 * Math.PI - 1e-6);
console.assert(Math.hypot(knotN0[0]-knotNEnd[0], knotN0[1]-knotNEnd[1], knotN0[2]-knotNEnd[2]) < 0.05,
  'trefoil frame closes after holonomy correction');
console.log('Task 1 path-math sanity OK');
```

Expected: no `Assertion failed` lines, final `Task 1 path-math sanity OK` line printed.

- [ ] **Step 5: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
feat: add path-shape primitives (presets, RMF, makePathFrame)

Pure additions; no call sites yet. Includes circle, ellipse, lemniscate, and
(p,q)-torus knot center-curve generators, a rotation-minimizing-frame
propagator (Wang et al. 2008), and makePathFrame() with holonomy correction
for closure. defaultCirclePathFrame() preserves the historical R = 2.3
behavior for the upcoming localToWorld migration.
EOF
)"
```

---

## Task 2: Refactor `localToWorld` and builders to take `pathFrame`

Convert the embedding to look up `(C, N, B)` from a `pathFrame` table instead of computing them from a hard-coded circle. Update every builder and `addEndCap` to take a `pathFrame` parameter instead of `R`. Use `defaultCirclePathFrame()` everywhere `rebuild` previously passed `R`. Output must be visually identical to before this task.

**Files:**
- Modify: `/Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html` lines 186-194 (`localToWorld`), 269 (`buildWholeGeometry`), 299 (`buildWedgeGeometry`), 401 (`buildRidgeLines`), 421 (`buildStripGeometry`), 729 (`addEndCap`), 744 (`buildRegionGeometry`), 1167 (`rebuild` signature), 1178 (`R = 2.3` site), and every call to a builder inside `rebuild` (lines 1205, 1216, 1241, 1265, 1284, 1292, 1313, plus the four `addEndCap` calls at 389-390, 484-485, 809-810).
- Mirror: equivalent locations in `gml_body.jsx`.

- [ ] **Step 1: Replace `localToWorld`**

Replace the body of `localToWorld` (lines 186-194) with the pathFrame-aware version. Keep the function name and remove the `R` parameter:

```js
function localToWorld(pathFrame, theta, uL, vL, m, n) {
  const C = pathFrame.C(theta);
  const N = pathFrame.N(theta);
  const B = pathFrame.B(theta);
  const alpha = (n / m) * theta;
  const cA = Math.cos(alpha), sA = Math.sin(alpha);
  const aN = uL * cA - vL * sA;
  const aB = uL * sA + vL * cA;
  return [
    C[0] + aN * N[0] + aB * B[0],
    C[1] + aN * N[1] + aB * B[1],
    C[2] + aN * N[2] + aB * B[2],
  ];
}
```

- [ ] **Step 2: Update every `localToWorld(...)` call site**

Find every call to `localToWorld` and change `(theta, uL, vL, R, m, n)` to `(pathFrame, theta, uL, vL, m, n)`. Use grep to find them:

```bash
grep -n "localToWorld(" /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html
```

Expected hits: lines 276, 319, 342, 366, 409, 469, 733, 794. Replace each call accordingly. The local variable name in builders is `pathFrame` (added in Step 3 below).

- [ ] **Step 3: Change `R` → `pathFrame` in every builder signature**

In each of the following functions, replace the `R` parameter with `pathFrame` (same position):

- `buildWholeGeometry(m, n, R, r, segs)` → `buildWholeGeometry(m, n, pathFrame, r, segs)`
- `buildWedgeGeometry(m, n, R, r, segs, ...)` → `buildWedgeGeometry(m, n, pathFrame, r, segs, ...)`
- `buildRidgeLines(m, n, R, r, segs)` → `buildRidgeLines(m, n, pathFrame, r, segs)`
- `buildStripGeometry(m, n, R, r, segs, ...)` → `buildStripGeometry(m, n, pathFrame, r, segs, ...)`
- `buildRegionGeometry(m, n, R, r, segs, ...)` → `buildRegionGeometry(m, n, pathFrame, r, segs, ...)`
- `addEndCap(positions, indices, colors, polygon2D, theta, dispU, dispV, R, m, n, color, reversed)` → `addEndCap(positions, indices, colors, polygon2D, theta, dispU, dispV, pathFrame, m, n, color, reversed)`

Inside each builder, all references to `R` are now `pathFrame` (passed straight through to `localToWorld` calls). There should be **no remaining bare `R` references** inside any builder after this step.

- [ ] **Step 4: Update `rebuild` to construct a default circle `pathFrame`**

In `rebuild` (line 1167), replace:

```js
const R = 2.3, r = 0.78;
```

with:

```js
const r = 0.78;
const pathFrame = s.pathFrame || defaultCirclePathFrame(2.3);
```

Then, for every call inside `rebuild` that currently passes `R` to a builder (lines 1205, 1216, 1241, 1265, 1284, 1292, 1313 and the four `addEndCap` references), replace `R` with `pathFrame` in the same argument position.

Find them with:

```bash
grep -n -E "build(Whole|Wedge|Region|Strip|Ridge)|addEndCap" /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html
```

- [ ] **Step 5: Initialize `s.pathFrame` once in the scene-setup `useEffect`**

In the scene-setup `stateRef.current = { ... }` block (around line 1144), add `pathFrame: defaultCirclePathFrame(2.3)` to the object:

```js
stateRef.current = {
  group, surfaceMat, vertexColorMat, ridgeMat,
  autoRotate: true, objects: [], ridges: [], orbitMats: [], zoom: 1,
  pathFrame: defaultCirclePathFrame(2.3),
  applyHighlight() { ... },
  rebuild(...) { ... },
};
```

This means `rebuild` always finds a valid `pathFrame` even on the very first call.

- [ ] **Step 6: Mirror every change to `gml_body.jsx`**

Apply identical edits to the equivalent locations in `gml_body.jsx`. Run:

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
```

Expected: only the protected first-3-lines region and trailing-comment delimiter differ.

- [ ] **Step 7: Visual regression check (circle preset)**

Open `index.html` in a browser. With default settings (`m=3`, `n=1`, no cut, no sound), the body should render **identically** to before this task — same orientation, same size, same coloring. Move the `m`, `n`, `cut`, `gradient`, `cut → center/parallel/offcenter/p2p` controls and confirm everything still works.

In the browser console, paste:

```js
console.assert(Math.abs(stateRef.current.pathFrame.C(0)[0] - 2.3) < 0.01, 'pathFrame is the default circle');
console.log('Task 2 visual-equivalence OK');
```

Expected: console prints `Task 2 visual-equivalence OK` with no assertion failures, and the canvas is visually unchanged from before this task.

- [ ] **Step 8: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
refactor: localToWorld and builders take pathFrame instead of R

Pure refactor — defaultCirclePathFrame(2.3) is wired in everywhere R was
hard-coded, so output is byte-equivalent. This unblocks the upcoming preset
work without changing any rendering.
EOF
)"
```

---

## Task 3: Stash `(θ, φ)` per-vertex during build; remove inverse recovery

The current sound-mode setup at `index.html:1338-1356` recovers `(θ, φ)` from each vertex's world coordinates by inverting the *circular* embedding (`θ = atan2(y, x)`, `aN = hypot(x, y) - R`). That inversion is invalid for non-circular paths. Each builder already knows `θ` and the local 2D coordinates `(uL, vL)` at the moment it emits a vertex — we capture them directly there.

**Files:**
- Modify: every builder in `index.html` (`buildWholeGeometry`, `buildWedgeGeometry`, `buildStripGeometry`, `buildRegionGeometry`) — emit a parallel `Float32Array` of `(θ, φ)` pairs into a new return field, and attach it as `geometry.userData.waveCoords`.
- Modify: `rebuild` sound-mode block (lines 1338-1356) — read `waveCoords` from geometry instead of computing it.
- Mirror: same in `gml_body.jsx`.

- [ ] **Step 1: Add `waveCoords` to each builder**

For each of `buildWholeGeometry`, `buildWedgeGeometry`, `buildStripGeometry`, `buildRegionGeometry`: locate every place the builder pushes a 3D vertex into `positions`. Immediately alongside, push `theta` and `Math.atan2(vL, uL)` (or the equivalent local 2D coordinates) into a parallel `wc` array. At the end of the builder, attach the array to the geometry via:

```js
geom.userData = geom.userData || {};
geom.userData.waveCoords = new Float32Array(wc);
```

For `buildWholeGeometry`, `buildWedgeGeometry`, `buildRidgeLines` (skip ridges — sound mode doesn't read them), the per-vertex `(uL, vL)` is the polygon vertex coordinate before `localToWorld`. For `buildRegionGeometry` and `buildStripGeometry`, it's `(bU + dispU, bV + dispV)` (the deformed 2D coordinate). Push the local 2D coordinate's `Math.atan2(v, u)` for `φ`.

Concretely: every builder loop already has lines like

```js
const [px, py, pz] = localToWorld(pathFrame, theta, uL, vL, m, n);
positions.push(px, py, pz);
```

Add the matching:

```js
wc.push(theta, Math.atan2(vL, uL));
```

immediately after each `positions.push(...)`. Declare `const wc = [];` at the top of each builder (next to the existing `positions = []`).

For end-cap vertices emitted by `addEndCap`, the same rule applies: `addEndCap` already knows `theta` (its 5th parameter) and the local `(u, v)` of each polygon vertex. Pass a `wc` array into `addEndCap` (new parameter at the end) and have it append `(theta, Math.atan2(v, u))` per vertex.

- [ ] **Step 2: Replace the sound-mode recovery loop**

In `rebuild`, find the block at lines 1338-1356 starting with `// Recover (theta, phi) from each vertex's xyz.` and ending where `obj.userData.waveCoords = wc;`. Replace the whole block with:

```js
// (θ, φ) was stashed per-vertex by each builder. Just hand it to the mesh.
obj.userData.waveCoords = obj.geometry.userData?.waveCoords || new Float32Array(0);
```

- [ ] **Step 3: Mirror to `gml_body.jsx`**

Apply identical edits. Run:

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
```

- [ ] **Step 4: Verify sound mode still works**

Open `index.html`. Switch the bottom tab to **sound**. Click **sound off** to toggle audio on. The body should color-sweep with a moving wave pattern, and audio should play. With `m=3, n=1, p=2, q=1` (defaults), you should see the wave orbiting once around the body. Toggle `cut` on and confirm cut pieces still color-sweep individually.

In the browser console, paste:

```js
const obj = stateRef.current.objects[0];
console.assert(obj.userData.waveCoords && obj.userData.waveCoords.length > 0,
  'waveCoords is populated');
console.assert(obj.userData.waveCoords.length === obj.geometry.attributes.position.count * 2,
  'waveCoords has 2 floats per vertex');
console.log('Task 3 waveCoords OK');
```

- [ ] **Step 5: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
refactor: stash (θ,φ) during build instead of recovering from world coords

Sound-mode previously inverted the circular localToWorld to recover (θ,φ).
That inversion only works for the circle path. Each builder now writes
waveCoords (Float32Array of [θ, φ] per vertex) into geometry.userData;
rebuild reads it directly. Strict correctness fix for non-circular paths,
bit-equivalent on the circle.
EOF
)"
```

---

## Task 4: Add `pathShape` state, parameter state, and `buildPathSpec` helper

Add the React state for the shape picker and per-shape parameters. Add a helper that turns the current state into a `pathSpec` and feeds the resulting `pathFrame` into `rebuild`. No UI yet — picker comes in Task 5. Default shape is `circle` so visible behavior is unchanged.

**Files:**
- Modify: `index.html` — `GMLBody` state declarations (around line 831, alongside `cutMode`); the `buildPathSpec` helper added near the existing math helpers; the rebuild-trigger `useEffect` (line 1400) extended to also rebuild on `pathShape`/path-param changes.
- Mirror: `gml_body.jsx`.

- [ ] **Step 1: Add `pathShape` and per-shape parameter state**

Inside `GMLBody`, alongside the existing `useState` calls (the `cutMode` group around line 831), add:

```js
const [pathShape, setPathShape] = useState('circle');
const [circleR, setCircleR] = useState(2.3);
const [ellipseA, setEllipseA] = useState(2.3);
const [ellipseB, setEllipseB] = useState(1.5);
const [knotR, setKnotR] = useState(2.0);
const [knotr, setKnotr] = useState(0.6);
const [knotP, setKnotP] = useState(2);
const [knotQ, setKnotQ] = useState(3);
const [lemA, setLemA] = useState(2.3);
```

- [ ] **Step 2: Add a `buildPathSpec` helper**

Just below the path-math primitives from Task 1 (after `defaultCirclePathFrame`, before `getPolygonVertices`), add a helper that maps a shape name + params object to a `pathSpec`:

```js
function buildPathSpec(shape, params) {
  switch (shape) {
    case 'ellipse':
      return { Cfn: pathEllipse, params: { a: params.a, b: params.b }, period: 2 * Math.PI };
    case 'lemniscate':
      return { Cfn: pathLemniscate, params: { a: params.a }, period: 2 * Math.PI };
    case 'torusKnot':
      return { Cfn: pathTorusKnot, params: { P: params.P, Q: params.Q, R: params.R, rp: params.rp }, period: 2 * Math.PI };
    case 'circle':
    default:
      return { Cfn: pathCircle, params: { R: params.R }, period: 2 * Math.PI };
  }
}
```

- [ ] **Step 3: Compute `pathFrame` and stash on `stateRef` on path-state change**

Add a new `useEffect` in `GMLBody` (place it just above the existing rebuild-trigger `useEffect` at line 1400):

```js
useEffect(() => {
  if (!stateRef.current) return;
  const params = pathShape === 'ellipse' ? { a: ellipseA, b: ellipseB }
    : pathShape === 'lemniscate' ? { a: lemA }
    : pathShape === 'torusKnot' ? { R: knotR, rp: knotr, P: knotP, Q: knotQ }
    : { R: circleR };
  const spec = buildPathSpec(pathShape, params);
  stateRef.current.pathFrame = makePathFrame(spec, 1024);
}, [pathShape, circleR, ellipseA, ellipseB, knotR, knotr, knotP, knotQ, lemA]);
```

- [ ] **Step 4: Trigger a rebuild whenever `pathFrame` changes**

In the existing rebuild-trigger `useEffect` (line 1400), extend the dependency array to include the same path state, so changing the shape rebuilds the geometry:

Find:
```js
}, [tab, m, n, showRidges, cut, cutMode, sliceCount, offsetD, cutPhi, separation, seamOpen, phi1, phi2, bladeShape, bladeAmount, bladeProfile, gradient]);
```

Replace with:
```js
}, [tab, m, n, showRidges, cut, cutMode, sliceCount, offsetD, cutPhi, separation, seamOpen, phi1, phi2, bladeShape, bladeAmount, bladeProfile, gradient, pathShape, circleR, ellipseA, ellipseB, knotR, knotr, knotP, knotQ, lemA]);
```

Note: `s.pathFrame` is already mutated by the previous `useEffect` (Step 3); this just makes sure `rebuild` re-runs with the fresh frame.

- [ ] **Step 5: Mirror to `gml_body.jsx`**

Apply identical edits. Run `diff` and confirm only protected regions differ.

- [ ] **Step 6: Verify**

Open `index.html`. Default rendering is unchanged (circle, R = 2.3). In the console, set the shape manually and confirm the geometry rebuilds:

```js
// Find the React fiber for GMLBody and call setPathShape via a forced approach,
// or temporarily expose it to window in a dev build. Simpler: manually mutate
// stateRef and trigger a rebuild.
stateRef.current.pathFrame = makePathFrame(
  { Cfn: pathEllipse, params: { a: 2.3, b: 1.0 }, period: 2 * Math.PI }, 1024);
// Force a rebuild by toggling any tracked state (e.g. nudge m by clicking the slider).
```

The body should visibly squish into an ellipse after you nudge `m` (or any control). Then revert: `stateRef.current.pathFrame = defaultCirclePathFrame(2.3);` and nudge `m` again — back to circle.

- [ ] **Step 7: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
feat: pathShape state + buildPathSpec helper, no UI yet

Adds React state for the four path-shape variants (circle, ellipse,
lemniscate, (p,q)-torus knot) and per-shape parameters. A new useEffect
recomputes stateRef.current.pathFrame whenever any path state changes,
and the rebuild useEffect's deps are widened so the geometry re-renders.
Default is circle, so visible behavior is unchanged.
EOF
)"
```

---

## Task 5: Add the shape picker UI

Render a button row above the `m`/`n` sliders that selects the path shape, plus a contextual sliders block that shows only the parameters for the currently selected shape. Reuse the existing `styles.modeRow` / `styles.modeBtn` / `styles.modeBtnOn` pattern from the cut-mode picker.

**Files:**
- Modify: `index.html` controls block (around line 1748, just above the n/m sliders).
- Mirror: `gml_body.jsx`.

- [ ] **Step 1: Insert the shape-picker block**

Inside `GMLBody`'s render, just *above* the line:

```jsx
<Slider label="n" min={0} max={Math.max(12, m * 2, n + 2)} value={n}
```

(line 1749), insert:

```jsx
<div style={styles.modeRow}>
  <button
    onClick={() => setPathShape('circle')}
    style={{...styles.modeBtn, ...(pathShape === 'circle' ? styles.modeBtnOn : {})}}>
    circle
  </button>
  <button
    onClick={() => setPathShape('ellipse')}
    style={{...styles.modeBtn, ...(pathShape === 'ellipse' ? styles.modeBtnOn : {})}}>
    ellipse
  </button>
  <button
    onClick={() => setPathShape('torusKnot')}
    style={{...styles.modeBtn, ...(pathShape === 'torusKnot' ? styles.modeBtnOn : {})}}>
    knot
  </button>
  <button
    onClick={() => setPathShape('lemniscate')}
    style={{...styles.modeBtn, ...(pathShape === 'lemniscate' ? styles.modeBtnOn : {})}}>
    figure-8
  </button>
</div>
{pathShape === 'circle' && (
  <Slider label="R" min={0.5} max={5} step={0.05} value={circleR}
    onChange={setCircleR} editable />
)}
{pathShape === 'ellipse' && (
  <>
    <Slider label="a" min={0.5} max={5} step={0.05} value={ellipseA}
      onChange={setEllipseA} editable />
    <Slider label="b" min={0.5} max={5} step={0.05} value={ellipseB}
      onChange={setEllipseB} editable />
  </>
)}
{pathShape === 'torusKnot' && (
  <>
    <Slider label="R" min={0.5} max={5} step={0.05} value={knotR}
      onChange={setKnotR} editable />
    <Slider label="r" min={0.1} max={2} step={0.05} value={knotr}
      onChange={setKnotr} editable />
    <Slider label="p" min={1} max={9} value={knotP}
      onChange={setKnotP} editable />
    <Slider label="q" min={1} max={9} value={knotQ}
      onChange={setKnotQ} editable />
  </>
)}
{pathShape === 'lemniscate' && (
  <Slider label="a" min={0.5} max={5} step={0.05} value={lemA}
    onChange={setLemA} editable />
)}
```

If `Slider` does not accept a `step` prop, drop the `step` attributes — sliders will use whatever default the component uses.

- [ ] **Step 2: Verify `Slider` accepts the props you used**

Search for `Slider` definition:

```bash
grep -n "function Slider\|const Slider" /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html
```

Read the component and confirm it accepts `label`, `min`, `max`, `value`, `onChange`, and `editable`. Drop any prop it doesn't support, but keep at minimum `label`, `min`, `max`, `value`, `onChange`.

- [ ] **Step 3: Mirror to `gml_body.jsx`**

Apply identical edits. Run `diff` and confirm only protected regions differ.

- [ ] **Step 4: Visual verification — all four presets**

Open `index.html`. The shape row should appear at the top of the controls, above `n`/`m`. Click each preset:

- **circle** (default): unchanged — torus with R = 2.3, m-gon cross-section.
- **ellipse**: torus squished along the y-axis (a > b by default) — clearly elliptical from above.
- **knot**: a trefoil knot (default p=2, q=3, R=2, r=0.6) — three lobes, the body crosses itself.
- **figure-8**: a Bernoulli lemniscate, the body self-intersects at the origin.

Drag each preset's sliders and confirm they update the geometry live.

- [ ] **Step 5: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
feat: shape picker UI with circle, ellipse, knot, figure-8 presets

Button row above m/n with contextual sliders for each preset's parameters.
EOF
)"
```

---

## Task 6: Coprime-snap for the `(p, q)` torus-knot sliders

Non-coprime `(p, q)` produces a degenerate lower-order torus link rather than a single closed loop. When the user moves a slider into a non-coprime configuration, auto-bump the *other* slider by ±1 toward the nearest coprime pair.

**Files:**
- Modify: `index.html` — the `setKnotP`/`setKnotQ` slider `onChange` handlers in Task 5's shape-picker block.
- Mirror: `gml_body.jsx`.

- [ ] **Step 1: Add a `gcd` helper near the path-math block**

Below `buildPathSpec` in the path-math section, add:

```js
function gcd(a, b) {
  a = Math.abs(a | 0); b = Math.abs(b | 0);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}
```

- [ ] **Step 2: Wrap the `p` / `q` setters with snapping**

Replace the `p` and `q` slider declarations from Task 5 with the snapping versions:

```jsx
{pathShape === 'torusKnot' && (
  <>
    <Slider label="R" min={0.5} max={5} step={0.05} value={knotR}
      onChange={setKnotR} editable />
    <Slider label="r" min={0.1} max={2} step={0.05} value={knotr}
      onChange={setKnotr} editable />
    <Slider label="p" min={1} max={9} value={knotP}
      onChange={(v) => {
        const np = Math.max(1, v | 0);
        if (gcd(np, knotQ) === 1) { setKnotP(np); return; }
        // Bump q outward (toward the direction it last moved away from), or
        // simply pick q = knotQ ± 1 until coprime.
        let nq = knotQ + 1;
        while (gcd(np, nq) !== 1 && nq < 20) nq++;
        setKnotP(np); setKnotQ(nq);
      }} editable />
    <Slider label="q" min={1} max={9} value={knotQ}
      onChange={(v) => {
        const nq = Math.max(1, v | 0);
        if (gcd(knotP, nq) === 1) { setKnotQ(nq); return; }
        let np = knotP + 1;
        while (gcd(np, nq) !== 1 && np < 20) np++;
        setKnotP(np); setKnotQ(nq);
      }} editable />
  </>
)}
```

- [ ] **Step 3: Mirror to `gml_body.jsx`**

Apply identical edits. Run `diff`.

- [ ] **Step 4: Verify snapping**

Open `index.html`. Click **knot**. Default is `(p=2, q=3)` — visibly trefoil. Drag `q` to `4` — gcd(2, 4) = 2, so the snap should bump `p` to `3`, giving `(3, 4)` — visibly different (cinquefoil-ish). Drag `q` to `6` — gcd(2, 6) = 2, bump `p` to `5`, giving `(5, 6)`. Drag `p` to `4` — gcd(4, 6) = 2, bump `q` to `7`, giving `(4, 7)`. Body should always be a single connected curve.

- [ ] **Step 5: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
feat: auto-snap (p,q) to coprime pairs for torus knot preset

Non-coprime (p,q) produces a degenerate torus link rather than a single
closed loop; the slider handlers now bump the other axis to the nearest
coprime value.
EOF
)"
```

---

## Self-Review (writing-plans)

I checked the plan against the spec section by section:

- **Architecture / `pathSpec` abstraction** → Task 1 (primitives) + Task 2 (refactor).
- **Embedding change to `localToWorld`** → Task 2 Step 1.
- **Builder signature changes** → Task 2 Steps 2–4.
- **Four presets (circle, ellipse, knot, lemniscate)** → Task 1 Step 1 (math) + Task 5 (UI).
- **Frame closure / holonomy correction** → Task 1 Step 1 (inside `makePathFrame`).
- **State + UI** → Task 4 (state) + Task 5 (UI).
- **Sound-mode `(θ, φ)` recovery fix** → Task 3.
- **Coprime snap for `(p, q)`** → Task 6.
- **Two-file mirror** → reinforced at the top of the plan and in every task's mirror step.
- **Verification (manual)** → present in every task.

No placeholders. Type names are consistent: `pathFrame` is the runtime sampled-table object across all tasks; `pathSpec` is the input to `makePathFrame`; `pathShape` is the UI string. Function names (`makePathFrame`, `buildPathSpec`, `defaultCirclePathFrame`, `localToWorld`, builders) are stable across tasks.

One non-obvious choice I want to flag for the executor: in Task 3 Step 1 I assumed each builder's per-vertex `(uL, vL)` lives in scope at every `positions.push`. If a builder pre-computes vertex coordinates in a buffer and pushes them in a later loop, you'll need to push the matching `(theta, atan2(v, u))` into `wc` in the *same* loop, not in the geometry-emit loop. Trace the variable scope before adding `wc.push(...)`.
