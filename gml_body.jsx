import React, { useRef, useEffect, useState, useContext, createContext, useCallback } from 'react';
import ReactDOM from 'react-dom';
import * as THREE from 'three';

// Brightness modulation along the body (parameter t = θ / 2π in [0, 1]).
// One full cosine cycle: bright at the seam, dim at the back of the body.
// Returns a multiplier for vertex RGB. cos(2πt) is symmetric so the seam
// brightness matches between θ=0 and θ=2π.
function gradientMod(t) {
  return 0.4 + 0.6 * (0.5 + 0.5 * Math.cos(t * 2 * Math.PI));
}

// Modulate a geometry's existing vertex colors by a θ-based gradient.
// Vertex's θ is recovered from its xy position via atan2 — the body is
// centered on the z-axis, so atan2(y, x) gives the angular position around
// the torus regardless of which slice the vertex came from.
function applyGradient(geometry) {
  const positions = geometry.attributes.position?.array;
  const colorAttr = geometry.attributes.color;
  if (!positions || !colorAttr) return;
  const colors = colorAttr.array;
  const N = positions.length / 3;
  for (let i = 0; i < N; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1];
    let theta = Math.atan2(y, x);
    if (theta < 0) theta += 2 * Math.PI;
    const mod = gradientMod(theta / (2 * Math.PI));
    colors[i * 3] *= mod;
    colors[i * 3 + 1] *= mod;
    colors[i * 3 + 2] *= mod;
  }
  colorAttr.needsUpdate = true;
}

// Add a flat bronze color attribute to a geometry that doesn't already have
// one. Used for the uncut body when gradient mode is on, so we can switch
// from the solid-color surfaceMat to the vertex-colored material.
const BRONZE_BASE = [0.78, 0.52, 0.35];
function addFlatColors(geometry, rgb = BRONZE_BASE) {
  const N = geometry.attributes.position.count;
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    arr[i * 3] = rgb[0];
    arr[i * 3 + 1] = rgb[1];
    arr[i * 3 + 2] = rgb[2];
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
}

// --- Polygon-derived audio waveforms --------------------------------------
// Following Chapman's "Audiovisual Applications of Supershape Polygons and
// Derived Complementary N-gon Waves" (ISSBG 2023): a point traveling at
// uniform velocity along a regular m-gon's edges traces out a waveform
// whose timbre depends on m. m=2 ≈ square wave (sharp transitions), m=3
// ≈ triangle/triangular angled wave, m=4 the canonical n-gon square,
// m→∞ approaches a sine. The body's cross-section polygon thus drives the
// audio's timbre.
//
// Returns one period as Float32Array in [-1, 1]. The y-coordinate of the
// point is used (one of the two "complementary n-gon waves" per side).
// Buffer length 2048 is enough to capture sharp polygon corners cleanly.
function polygonWaveform(m, samples = 2048) {
  // Build vertices on the unit circle (regular m-gon, top-aligned).
  const M = Math.max(2, m | 0);
  const verts = [];
  for (let k = 0; k < M; k++) {
    const a = (2 * Math.PI * k) / M - Math.PI / 2;
    verts.push([Math.cos(a), Math.sin(a)]);
  }
  // m=2 is a degenerate "polygon" (line segment). Treat it as a thin
  // rectangle so we get an actual square-wave-like waveform.
  if (M === 2) {
    const eps = 0.04;
    verts.length = 0;
    verts.push([1, eps], [-1, eps], [-1, -eps], [1, -eps]);
  }
  // Edge lengths and total perimeter.
  const Mv = verts.length;
  const edgeLen = new Float32Array(Mv);
  let perim = 0;
  for (let k = 0; k < Mv; k++) {
    const v0 = verts[k], v1 = verts[(k + 1) % Mv];
    const l = Math.hypot(v1[0] - v0[0], v1[1] - v0[1]);
    edgeLen[k] = l;
    perim += l;
  }
  // Sample the polygon at uniform arc length.
  const buf = new Float32Array(samples);
  let edge = 0, cum = 0;
  for (let i = 0; i < samples; i++) {
    const target = (i / samples) * perim;
    while (edge < Mv - 1 && cum + edgeLen[edge] < target) {
      cum += edgeLen[edge];
      edge++;
    }
    const f = edgeLen[edge] > 1e-9 ? (target - cum) / edgeLen[edge] : 0;
    const v0 = verts[edge], v1 = verts[(edge + 1) % Mv];
    // Use y-coordinate of point — produces the "n-gon wave along x" of the
    // complementary pair.
    buf[i] = v0[1] + f * (v1[1] - v0[1]);
  }
  // Normalize so peak is exactly 1.
  let peak = 0;
  for (let i = 0; i < samples; i++) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak > 1e-6) {
    for (let i = 0; i < samples; i++) buf[i] /= peak;
  }
  return buf;
}

// Linear-interpolation lookup of a one-period waveform at a given phase
// (radians). Used by the visual wave so screen and ear are driven by the
// SAME shape — just at very different speeds.
function sampleWaveformPhase(buf, phase) {
  if (!buf || buf.length === 0) return 0;
  const TWO_PI = 2 * Math.PI;
  let p = phase - TWO_PI * Math.floor(phase / TWO_PI);
  const t = p / TWO_PI;
  const N = buf.length;
  const idx = t * N;
  const i0 = Math.floor(idx) % N;
  const i1 = (i0 + 1) % N;
  const f = idx - Math.floor(idx);
  return buf[i0] * (1 - f) + buf[i1] * f;
}

// --- Cross-section geometry ------------------------------------------------
function polygonBoundary(phi, m, r) {
  if (m === 2) {
    const eps = 0.08 * r;
    let p = phi % (2 * Math.PI); if (p < 0) p += 2 * Math.PI;
    const c = Math.cos(p), s = Math.sin(p);
    const tx = Math.abs(c) < 1e-9 ? Infinity : r / Math.abs(c);
    const ty = Math.abs(s) < 1e-9 ? Infinity : eps / Math.abs(s);
    const t = Math.min(tx, ty);
    return [t * c, t * s];
  }
  const wedge = (2 * Math.PI) / m;
  let p = phi % (2 * Math.PI); if (p < 0) p += 2 * Math.PI;
  const k = Math.floor(p / wedge);
  const phiC = (k + 0.5) * wedge;
  const off = p - phiC;
  const d = (r * Math.cos(wedge / 2)) / Math.cos(off);
  return [d * Math.cos(p), d * Math.sin(p)];
}

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

// --- Path-shape primitives ------------------------------------------------
// Center-curve generators C(θ) → [x, y, z] for each preset. They return a
// raw 3D point; frame computation is done by makePathFrame() below.

function pathCircle(theta, params) {
  const R = params.R;
  return [R * Math.cos(theta), R * Math.sin(theta), 0];
}

function pathEllipse(theta, params) {
  return [params.a * Math.cos(theta), params.b * Math.sin(theta), 0];
}

function pathLemniscate(theta, params) {
  // 3D-lifted Bernoulli figure-eight. The planar curve passes through the
  // origin at θ = π/2 and θ = 3π/2; lifting z = lift·sin(θ) sends one lobe
  // up and the other down so the swept body never self-intersects. The
  // resulting shape is a smooth 3D figure-8 — like a Viviani curve flavor.
  const a = params.a;
  const s = Math.sin(theta), c = Math.cos(theta);
  const denom = 1 + s * s;
  const lift = params.lift != null ? params.lift : 1.0;
  return [a * c / denom, a * s * c / denom, lift * s];
}

function pathTorusKnot(theta, params) {
  // Standard (p, q)-torus knot wrapped on a virtual torus of radii (R, r_path).
  // Period 2π for any coprime (P, Q).
  const P = params.P, Q = params.Q, R = params.R, rp = params.rp;
  const ct = Math.cos(Q * theta), st = Math.sin(Q * theta);
  const cp = Math.cos(P * theta), sp = Math.sin(P * theta);
  return [(R + rp * ct) * cp, (R + rp * ct) * sp, rp * st];
}

// Numerical tangent via central difference. Used by makePathFrame for shapes
// that don't have an analytic frame on hand.
function pathTangent(C, theta, params, h = 1e-4) {
  const eps = h;
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
// For a CCW circle, T = (-sinθ, cosθ, 0); rotating T by −90° in the xy-plane
// (i.e. [T[1], −T[0]]) gives the outward radial (cosθ, sinθ).
function initialNormal(T) {
  const flat = [T[1], -T[0], 0];
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
  // We define B = N × T so that for a CCW planar curve with outward radial N,
  // B points up out of the plane (matches the original z-up convention).
  const N0 = [Ns[0], Ns[1], Ns[2]];
  const B0 = [
    N0[1]*T_wrap[2] - N0[2]*T_wrap[1],
    N0[2]*T_wrap[0] - N0[0]*T_wrap[2],
    N0[0]*T_wrap[1] - N0[1]*T_wrap[0],
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
      Ni[1]*Ti[2] - Ni[2]*Ti[1],
      Ni[2]*Ti[0] - Ni[0]*Ti[2],
      Ni[0]*Ti[1] - Ni[1]*Ti[0],
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
    return Math.floor(t / period * K) % K;
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
function defaultCirclePathFrame(R = 2.3) {
  return makePathFrame({ Cfn: pathCircle, params: { R }, period: 2 * Math.PI });
}

function buildPathSpec(shape, params) {
  switch (shape) {
    case 'ellipse':
      return { Cfn: pathEllipse, params: { a: params.a, b: params.b }, period: 2 * Math.PI };
    case 'lemniscate':
      return { Cfn: pathLemniscate, params: { a: params.a, lift: params.lift }, period: 2 * Math.PI };
    case 'torusKnot':
      return { Cfn: pathTorusKnot, params: { P: params.P, Q: params.Q, R: params.R, rp: params.rp }, period: 2 * Math.PI };
    case 'circle':
    default:
      return { Cfn: pathCircle, params: { R: params.R }, period: 2 * Math.PI };
  }
}

function gcd(a, b) {
  a = Math.abs(a | 0); b = Math.abs(b | 0);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// Polygon vertices in the rotating frame, counter-clockwise. m=2 is treated
// as a thin rectangle so it has well-defined area for cutting.
function getPolygonVertices(m, r) {
  if (m === 2) {
    const eps = 0.08 * r;
    return [[r, eps], [-r, eps], [-r, -eps], [r, -eps]];
  }
  const verts = [];
  for (let k = 0; k < m; k++) {
    const phi = (2 * Math.PI * k) / m;
    verts.push([r * Math.cos(phi), r * Math.sin(phi)]);
  }
  return verts;
}

// Sutherland–Hodgman clip of convex polygon by a half-plane.
// Keep points where (u*nx + v*ny - d) * sign >= 0.
function clipPolygonByHalfPlane(poly, nx, ny, d, sign) {
  const out = [];
  if (poly.length === 0) return out;
  const inside = (p) => (p[0] * nx + p[1] * ny - d) * sign >= -1e-9;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = inside(a), bIn = inside(b);
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const aD = (a[0] * nx + a[1] * ny - d) * sign;
      const bD = (b[0] * nx + b[1] * ny - d) * sign;
      const t = aD / (aD - bD);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

// Clip polygon to a parallel strip: { d_left <= proj <= d_right } where
// proj = u*cos(phiCut) + v*sin(phiCut).
function clipPolygonToStrip(poly, phiCut, dLeft, dRight) {
  const cosP = Math.cos(phiCut), sinP = Math.sin(phiCut);
  let p = clipPolygonByHalfPlane(poly, cosP, sinP, dLeft, 1);   // proj >= dLeft
  p = clipPolygonByHalfPlane(p, cosP, sinP, dRight, -1);         // proj <= dRight
  return p;
}

// One palette per connected piece (orbit). Mathematically capped at ~2 for
// diametric cuts, but more entries kept for robustness/future extensions.
const PIECE_PALETTE = [
  { surf: [0.78, 0.52, 0.35], cut: [0.96, 0.78, 0.55] },  // bronze (default)
  { surf: [0.42, 0.62, 0.68], cut: [0.68, 0.86, 0.92] },  // glacier teal
  { surf: [0.72, 0.55, 0.78], cut: [0.92, 0.80, 0.95] },  // pale lavender
  { surf: [0.55, 0.72, 0.45], cut: [0.80, 0.93, 0.65] },  // sage
  { surf: [0.88, 0.62, 0.45], cut: [1.00, 0.85, 0.70] },  // peach
  { surf: [0.50, 0.55, 0.78], cut: [0.78, 0.82, 0.97] },  // periwinkle
];

function rgbCss([r, g, b]) {
  return `rgb(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)})`;
}

// Number of chord cuts needed for a closing Tavkhelidze cut, plus the
// permutation each wedge undergoes after one revolution.
function getCutInfo(m, n) {
  const g = gcd(2 * n, m);
  const K_cuts = m / g;            // chord cuts through center
  const numWedges = 2 * K_cuts;    // wedges in each cross-section
  const wedgeShift = (2 * n) / g;  // wedge index shift per revolution
  const orbits = gcd(wedgeShift, numWedges);  // connected components
  return { K_cuts, numWedges, wedgeShift, orbits };
}

// --- Whole body (no cut) ---------------------------------------------------
function buildWholeGeometry(m, n, pathFrame, r, segs) {
  const positions = [], indices = [], wc = [];
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * 2 * Math.PI;
    for (let k = 0; k < m; k++) {
      const phi = (2 * Math.PI * k) / m;
      const [bU, bV] = polygonBoundary(phi, m, r);
      const [px, py, pz] = localToWorld(pathFrame, theta, bU, bV, m, n);
      positions.push(px, py, pz);
      wc.push(theta, Math.atan2(bV, bU));
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      const a = i * m + k, b = i * m + k1;
      const c = (i + 1) * m + k1, d = (i + 1) * m + k;
      indices.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.userData = g.userData || {};
  g.userData.waveCoords = new Float32Array(wc);
  return g;
}

// --- One pie-slice wedge between two chord cuts ---------------------------
// Wedge spans phiLocal in [phiStart, phiEnd], with apex at the polygon center.
// The wedge is shifted radially in its centroid direction by `sep` for visual
// separation. Cut faces (the two chord halves) get a contrasting vertex color.
function buildWedgeGeometry(m, n, pathFrame, r, segs, K, phiStart, phiEnd, sep, palette, thetaMax = 2 * Math.PI, endCaps = false) {
  const positions = [], indices = [], colors = [], wc = [];
  const SURF = palette.surf;
  const CUT = palette.cut;

  const wedgeAngle = phiEnd - phiStart;
  const centroidPhi = phiStart + wedgeAngle / 2;
  // In-plane centroid-direction splay. For modes where the orbit shift is a
  // rotation R(α) of the cross-section (center, off-center, p2p), this is
  // automatically seam-consistent: if B is the orbit image of A, then
  // disp_B = R(α)·disp_A because their centroids are also related by R(α).
  const dispU = sep * Math.cos(centroidPhi);
  const dispV = sep * Math.sin(centroidPhi);

  // 1) Outer curved surface: K boundary samples per ring.
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * thetaMax;
    for (let j = 0; j < K; j++) {
      const phiLocal = phiStart + (j / (K - 1)) * wedgeAngle;
      const [bU, bV] = polygonBoundary(phiLocal, m, r);
      const [px, py, pz] = localToWorld(pathFrame, theta, bU + dispU, bV + dispV, m, n);
      positions.push(px, py, pz);
      wc.push(theta, Math.atan2(bV + dispV, bU + dispU));
      colors.push(...SURF);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < K - 1; j++) {
      const a = i * K + j, b = i * K + j + 1;
      const c = (i + 1) * K + j + 1, d = (i + 1) * K + j;
      indices.push(a, b, c, a, c, d);
    }
  }

  // 2) Left cut face: chord from apex (0,0) to boundary(phiStart).
  const NCUT = 5;
  const leftStart = positions.length / 3;
  const [bUL, bVL] = polygonBoundary(phiStart, m, r);
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * thetaMax;
    for (let q = 0; q < NCUT; q++) {
      const t = q / (NCUT - 1);
      const uL = t * bUL + dispU;
      const vL = t * bVL + dispV;
      const [px, py, pz] = localToWorld(pathFrame, theta, uL, vL, m, n);
      positions.push(px, py, pz);
      wc.push(theta, Math.atan2(vL, uL));
      colors.push(...CUT);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let q = 0; q < NCUT - 1; q++) {
      const a = leftStart + i * NCUT + q;
      const b = leftStart + i * NCUT + q + 1;
      const c = leftStart + (i + 1) * NCUT + q + 1;
      const d = leftStart + (i + 1) * NCUT + q;
      indices.push(a, b, c, a, c, d);
    }
  }

  // 3) Right cut face: chord from apex to boundary(phiEnd), reverse winding.
  const rightStart = positions.length / 3;
  const [bUR, bVR] = polygonBoundary(phiEnd, m, r);
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * thetaMax;
    for (let q = 0; q < NCUT; q++) {
      const t = q / (NCUT - 1);
      const uL = t * bUR + dispU;
      const vL = t * bVR + dispV;
      const [px, py, pz] = localToWorld(pathFrame, theta, uL, vL, m, n);
      positions.push(px, py, pz);
      wc.push(theta, Math.atan2(vL, uL));
      colors.push(...CUT);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let q = 0; q < NCUT - 1; q++) {
      const a = rightStart + i * NCUT + q;
      const b = rightStart + i * NCUT + q + 1;
      const c = rightStart + (i + 1) * NCUT + q + 1;
      const d = rightStart + (i + 1) * NCUT + q;
      indices.push(a, c, b, a, d, c);
    }
  }

  // 4) End caps (when seam is open): cross-section is the wedge polygon
  // [apex, boundary samples K-1..0]. Place at theta=0 and theta=thetaMax.
  if (endCaps) {
    const wedgePoly = [[0, 0]];
    for (let j = 0; j < K; j++) {
      const phiLocal = phiStart + (j / (K - 1)) * wedgeAngle;
      wedgePoly.push(polygonBoundary(phiLocal, m, r));
    }
    addEndCap(positions, indices, colors, wc, wedgePoly, 0, dispU, dispV, pathFrame, m, n, palette.cut, true);
    addEndCap(positions, indices, colors, wc, wedgePoly, thetaMax, dispU, dispV, pathFrame, m, n, palette.cut, false);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.userData = g.userData || {};
  g.userData.waveCoords = new Float32Array(wc);
  return g;
}

function buildRidgeLines(m, n, pathFrame, r, segs) {
  const lines = [];
  for (let k = 0; k < m; k++) {
    const pos = [];
    const phi = (2 * Math.PI * k) / m;
    for (let i = 0; i <= segs; i++) {
      const theta = (i / segs) * 2 * Math.PI;
      const [bU, bV] = polygonBoundary(phi, m, r);
      const [px, py, pz] = localToWorld(pathFrame, theta, bU, bV, m, n);
      pos.push(px, py, pz);
    }
    lines.push(pos);
  }
  return lines;
}

// --- Parallel-strip cuts ---------------------------------------------------
// Build a single longitudinal strip whose 2D cross-section is the polygon
// clipped to perpendicular distances [dLeft, dRight] from center along
// direction phiCut. Each edge is subdivided so vertex-normals shade nicely.
function buildStripGeometry(m, n, pathFrame, r, segs, phiCut, dLeft, dRight, sep, palette, thetaMax = 2 * Math.PI, endCaps = false) {
  const polygonVerts = getPolygonVertices(m, r);
  const stripPoly = clipPolygonToStrip(polygonVerts, phiCut, dLeft, dRight);
  if (stripPoly.length < 3) return null;

  // Centroid (in rotating frame) — used as the displacement direction for
  // splaying the strip outward. For parallel cuts whose orbit ISN'T a
  // rotation of the cross-section (most twisted cases), the body has an
  // open seam anyway — the warning in the UI tells the user.
  let cu = 0, cv = 0;
  for (const p of stripPoly) { cu += p[0]; cv += p[1]; }
  cu /= stripPoly.length; cv /= stripPoly.length;
  const cLen = Math.hypot(cu, cv) || 1e-6;
  const dispU = sep * (cu / cLen);
  const dispV = sep * (cv / cLen);

  const SUBDIV = 4;
  const cosP = Math.cos(phiCut), sinP = Math.sin(phiCut);
  const onCut = (a, b) => {
    const projA = a[0] * cosP + a[1] * sinP;
    const projB = b[0] * cosP + b[1] * sinP;
    const eps = 1e-4;
    return (Math.abs(projA - dLeft) < eps && Math.abs(projB - dLeft) < eps) ||
           (Math.abs(projA - dRight) < eps && Math.abs(projB - dRight) < eps);
  };

  const ringPoints = [];
  for (let i = 0; i < stripPoly.length; i++) {
    const a = stripPoly[i];
    const b = stripPoly[(i + 1) % stripPoly.length];
    const cut = onCut(a, b);
    for (let s = 0; s < SUBDIV; s++) {
      const t = s / SUBDIV;
      ringPoints.push([
        a[0] + t * (b[0] - a[0]),
        a[1] + t * (b[1] - a[1]),
        cut,
      ]);
    }
  }

  const positions = [], indices = [], colors = [], wc = [];
  const K = ringPoints.length;

  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * thetaMax;
    for (let j = 0; j < K; j++) {
      const [bU, bV, isCut] = ringPoints[j];
      const [px, py, pz] = localToWorld(pathFrame, theta, bU + dispU, bV + dispV, m, n);
      positions.push(px, py, pz);
      wc.push(theta, Math.atan2(bV + dispV, bU + dispU));
      const c = isCut ? palette.cut : palette.surf;
      colors.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < K; j++) {
      const j1 = (j + 1) % K;
      const a = i * K + j, b = i * K + j1;
      const c = (i + 1) * K + j1, d = (i + 1) * K + j;
      indices.push(a, b, c, a, c, d);
    }
  }
  if (endCaps) {
    addEndCap(positions, indices, colors, wc, stripPoly, 0, dispU, dispV, pathFrame, m, n, palette.cut, true);
    addEndCap(positions, indices, colors, wc, stripPoly, thetaMax, dispU, dispV, pathFrame, m, n, palette.cut, false);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.userData = g.userData || {};
  g.userData.waveCoords = new Float32Array(wc);
  return g;
}

// Evenly-spaced cut offsets, symmetric around 0, sized to span most of the
// polygon while staying inside it. Returns N offsets sorted ascending.
function evenlySpacedCutOffsets(N, span) {
  const out = [];
  for (let j = 0; j < N; j++) {
    out.push(((j + 1) / (N + 1) - 0.5) * 2 * span);
  }
  return out;
}

// Compute orbit assignment for parallel strips under the body's twist.
// The twist rotates the cross-section by 2πn/m. For symmetric parallel cuts,
// the configuration is preserved when the rotation is a multiple of π
// (i.e., m | 2n). Then strip j ↔ strip (numStrips - 1 - j) under sign-flip.
// When n is a multiple of m the twist is trivial and each strip is its own
// orbit. Otherwise the cut does not close — we fall back to "no closure".
function getParallelOrbits(m, n, numStrips) {
  const orbitOf = new Array(numStrips);
  if (n % m === 0) {
    for (let j = 0; j < numStrips; j++) orbitOf[j] = j;
    return { orbitOf, count: numStrips, closes: true };
  }
  if ((2 * n) % m === 0) {
    let next = 0;
    for (let j = 0; j < numStrips; j++) orbitOf[j] = -1;
    for (let j = 0; j < numStrips; j++) {
      if (orbitOf[j] !== -1) continue;
      const partner = numStrips - 1 - j;
      orbitOf[j] = next;
      orbitOf[partner] = next;
      next++;
    }
    return { orbitOf, count: next, closes: true };
  }
  for (let j = 0; j < numStrips; j++) orbitOf[j] = j;
  return { orbitOf, count: numStrips, closes: false };
}

// --- Off-center cuts -------------------------------------------------------
// A single chord at offset d gets an "orbit closure": k = m/gcd(n,m) rotated
// copies of the chord, so the configuration is invariant under the body twist.
// Chords are at angles phiCut + j*2πn/m for j=0..k-1, all at distance d.
function offCenterChords(m, n, phiCut, d) {
  const k = m / gcd(n, m);
  const out = [];
  for (let j = 0; j < k; j++) {
    out.push({ phi: phiCut + (2 * Math.PI * n * j) / m, d });
  }
  return out;
}

// --- Point-to-point cuts ---------------------------------------------------
// User picks two angles on the polygon boundary. The chord between those
// points becomes the cut. Orbit closure rotates the chord (both endpoints)
// k = m/gcd(n,m) times, then converts each to (phi, d) form for the clipper.
function pointToPointChords(m, n, phi1, phi2, r) {
  const k = m / gcd(n, m);
  const out = [];
  const p1 = polygonBoundary(phi1, m, r);
  const p2 = polygonBoundary(phi2, m, r);
  for (let j = 0; j < k; j++) {
    const rot = (2 * Math.PI * n * j) / m;
    const cR = Math.cos(rot), sR = Math.sin(rot);
    const r1 = [p1[0] * cR - p1[1] * sR, p1[0] * sR + p1[1] * cR];
    const r2 = [p2[0] * cR - p2[1] * sR, p2[0] * sR + p2[1] * cR];
    const dx = r2[0] - r1[0], dy = r2[1] - r1[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = -dy / len, ny = dx / len;
    const d = r1[0] * nx + r1[1] * ny;
    const phi = Math.atan2(ny, nx);
    out.push({ phi, d });
  }
  return out;
}

// --- Blade shapes ----------------------------------------------------------
// Sample a profile array (evenly-spaced y-samples in [-1, 1] across t∈[0,1])
// at parameter t with linear interpolation.
function sampleProfile(profile, t) {
  if (!profile || profile.length === 0) return 0;
  if (profile.length === 1) return profile[0];
  t = Math.max(0, Math.min(1, t));
  const N = profile.length;
  const idx = t * (N - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(N - 1, i0 + 1);
  const f = idx - i0;
  return profile[i0] * (1 - f) + profile[i1] * f;
}

// Replace the straight chord segment between two endpoints with a curved,
// zig-zag, or user-drawn polyline. The bow always points along the chord's
// outward normal (cos(phi), sin(phi)) so that two regions sharing a chord get
// the SAME curve in absolute coordinates — no gaps where the cut meets up.
// Custom profiles are auto-symmetrized and tapered so endpoints stay on the
// chord; this is required for matching across adjacent regions.
function bladePoint(A, B, chord, blade, amount, t, profile = null) {
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const nx = Math.cos(chord.phi), ny = Math.sin(chord.phi);
  let off = 0;
  if (blade === 'curved') {
    // Bell curve: zero at endpoints, peak at midpoint.
    off = Math.sin(t * Math.PI) * amount;
  } else if (blade === 'zigzag') {
    // Cosine ripple with sine taper. Integer freq makes the wave symmetric
    // around t=0.5, which is required so adjacent regions match up.
    const freq = 4;
    const taper = Math.sin(t * Math.PI);
    off = Math.cos(t * 2 * Math.PI * freq) * taper * amount * 0.6;
  } else if (blade === 'custom' && profile && profile.length > 0) {
    // Symmetrize: average y(t) and y(1-t). Taper to zero at endpoints with
    // sin(t·π) so the edge meets the chord cleanly.
    const taper = Math.sin(t * Math.PI);
    const yt = sampleProfile(profile, t);
    const y1mt = sampleProfile(profile, 1 - t);
    off = ((yt + y1mt) / 2) * taper * amount;
  }
  return [
    A[0] + t * dx + nx * off,
    A[1] + t * dy + ny * off,
  ];
}

// Deform a region polygon by replacing every edge that lies on a cut chord
// with a sampled polyline along the blade shape.
// Returns { points, cutTags } where cutTags[i] is true iff the edge from
// points[i] to points[(i+1) % N] is a cut edge.
function deformPolygon(regionPoly, chords, blade, amount, profile = null, samples = 12) {
  const points = [];
  const cutTags = [];
  const findChord = (A, B) => {
    for (const c of chords) {
      const cp = Math.cos(c.phi), sp = Math.sin(c.phi);
      const pa = A[0] * cp + A[1] * sp;
      const pb = B[0] * cp + B[1] * sp;
      if (Math.abs(pa - c.d) < 1e-3 && Math.abs(pb - c.d) < 1e-3) return c;
    }
    return null;
  };
  const skipDeform = blade === 'straight' || amount === 0;
  for (let i = 0; i < regionPoly.length; i++) {
    const A = regionPoly[i];
    const B = regionPoly[(i + 1) % regionPoly.length];
    points.push(A);
    const c = findChord(A, B);
    if (!c || skipDeform) {
      cutTags.push(c !== null);
      continue;
    }
    for (let s = 1; s < samples; s++) {
      points.push(bladePoint(A, B, c, blade, amount, s / samples, profile));
      cutTags.push(true);
    }
    cutTags.push(true);
  }
  return { points, cutTags };
}

function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

// BFS over bit patterns to find all non-empty regions of the polygon under
// the chord arrangement. Each chord c_j defines a half-plane: side bit b_j
// is 1 when proj_j > d_j (positive side), 0 otherwise.
function findAllRegions(polygon, chords) {
  const k = chords.length;
  if (k === 0) return new Map();
  const half = chords.map(c => ({ nx: Math.cos(c.phi), ny: Math.sin(c.phi), d: c.d }));

  const clipByPattern = (pattern) => {
    let p = polygon;
    for (let j = 0; j < k; j++) {
      const sign = ((pattern >> j) & 1) ? 1 : -1;
      p = clipPolygonByHalfPlane(p, half[j].nx, half[j].ny, half[j].d, sign);
      if (p.length < 3) return null;
    }
    return p;
  };

  const regions = new Map();  // pattern -> polygon
  const queue = [];
  // Seed with center's pattern (for d > 0, center has all bits = 0).
  let seed = 0;
  for (let j = 0; j < k; j++) {
    const proj = 0;  // origin
    if (proj > half[j].d) seed |= (1 << j);
  }
  queue.push(seed);

  while (queue.length > 0) {
    const pat = queue.shift();
    if (regions.has(pat)) continue;
    const p = clipByPattern(pat);
    if (p && polygonArea(p) > 1e-5) {
      regions.set(pat, p);
      for (let j = 0; j < k; j++) queue.push(pat ^ (1 << j));
    }
  }
  return regions;
}

// Cyclic shift of a k-bit pattern. The body's twist permutes chords cyclically,
// so it permutes regions by cyclically shifting their bit patterns.
function cyclicShiftLeft(b, k) {
  const mask = (1 << k) - 1;
  return (((b << 1) | (b >> (k - 1))) & mask);
}

function computeOrbitsCyclic(patternMap, k) {
  const orbitOf = new Map();
  let next = 0;
  for (const pat of patternMap.keys()) {
    if (orbitOf.has(pat)) continue;
    let p = pat;
    do {
      if (patternMap.has(p)) orbitOf.set(p, next);
      p = cyclicShiftLeft(p, k);
    } while (p !== pat);
    next++;
  }
  return { orbitOf, count: next };
}

// Fan-triangulate a 2D polygon and add it as an end cap to the mesh at a
// specific theta. The polygon's vertices are placed via localToWorld and
// the resulting triangles use the supplied vertex color.
function addEndCap(positions, indices, colors, wc, polygon2D, theta, dispU, dispV, pathFrame, m, n, color, reversed) {
  const baseIdx = positions.length / 3;
  const verts = reversed ? polygon2D.slice().reverse() : polygon2D;
  for (const [u, v] of verts) {
    const uL = u + dispU;
    const vL = v + dispV;
    const [px, py, pz] = localToWorld(pathFrame, theta, uL, vL, m, n);
    positions.push(px, py, pz);
    if (wc) wc.push(theta, Math.atan2(vL, uL));
    if (colors) colors.push(color[0], color[1], color[2]);
  }
  for (let i = 1; i < verts.length - 1; i++) {
    indices.push(baseIdx, baseIdx + i, baseIdx + i + 1);
  }
}

// Generalized region mesh builder — works for any convex region polygon.
// Edges are classified as "cut" (lying on one of the chords) for coloring.
function buildRegionGeometry(m, n, pathFrame, r, segs, regionPoly, chords, sep, palette, thetaMax = 2 * Math.PI, endCaps = false, cutTags = null) {
  if (regionPoly.length < 3) return null;

  // Centroid (in rotating frame) — used as the displacement direction.
  // For center / off-center / p2p modes the orbit shift is a rotation of
  // the cross-section, so disp_B = R(α)·disp_A automatically and the seam
  // stays continuous. For deformed regions the centroid still works since
  // sampling preserves rough shape.
  let cu = 0, cv = 0;
  for (const p of regionPoly) { cu += p[0]; cv += p[1]; }
  cu /= regionPoly.length; cv /= regionPoly.length;
  const cLen = Math.hypot(cu, cv) || 1e-6;
  const dispU = sep * (cu / cLen);
  const dispV = sep * (cv / cLen);

  // When cutTags is provided (deformed polygons), trust it directly.
  // Otherwise classify each edge by projecting onto chord normals.
  const edgeIsCut = (i, a, b) => {
    if (cutTags) return cutTags[i];
    for (const c of chords) {
      const cosP = Math.cos(c.phi), sinP = Math.sin(c.phi);
      const projA = a[0] * cosP + a[1] * sinP;
      const projB = b[0] * cosP + b[1] * sinP;
      if (Math.abs(projA - c.d) < 1e-3 && Math.abs(projB - c.d) < 1e-3) return true;
    }
    return false;
  };

  const SUBDIV = 4;
  const ringPoints = [];
  for (let i = 0; i < regionPoly.length; i++) {
    const a = regionPoly[i];
    const b = regionPoly[(i + 1) % regionPoly.length];
    const onCut = edgeIsCut(i, a, b);
    for (let s = 0; s < SUBDIV; s++) {
      const t = s / SUBDIV;
      ringPoints.push([
        a[0] + t * (b[0] - a[0]),
        a[1] + t * (b[1] - a[1]),
        onCut,
      ]);
    }
  }

  const positions = [], indices = [], colors = [], wc = [];
  const K = ringPoints.length;
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * thetaMax;
    for (let j = 0; j < K; j++) {
      const [bU, bV, isCut] = ringPoints[j];
      const [px, py, pz] = localToWorld(pathFrame, theta, bU + dispU, bV + dispV, m, n);
      positions.push(px, py, pz);
      wc.push(theta, Math.atan2(bV + dispV, bU + dispU));
      const c = isCut ? palette.cut : palette.surf;
      colors.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < K; j++) {
      const j1 = (j + 1) % K;
      const a = i * K + j, b = i * K + j1;
      const c = (i + 1) * K + j1, d = (i + 1) * K + j;
      indices.push(a, b, c, a, c, d);
    }
  }
  if (endCaps) {
    addEndCap(positions, indices, colors, wc, regionPoly, 0, dispU, dispV, pathFrame, m, n, palette.cut, true);
    addEndCap(positions, indices, colors, wc, regionPoly, thetaMax, dispU, dispV, pathFrame, m, n, palette.cut, false);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.userData = g.userData || {};
  g.userData.waveCoords = new Float32Array(wc);
  return g;
}

// --- Component -------------------------------------------------------------

const PALETTE_W = 220;
const PALETTE_H_MIN = 60;

function MainPalette({ pos, setPos, collapsed, setCollapsed, children }) {
  const dragRef = useRef(null);
  const onPointerDown = (e) => {
    if (e.target.closest('[data-no-drag]')) return;
    const startX = e.clientX, startY = e.clientY;
    const start = { x: pos.x, y: pos.y };
    dragRef.current = { startX, startY, start };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({
      x: Math.min(Math.max(0, dragRef.current.start.x + dx), window.innerWidth - PALETTE_W),
      y: Math.min(Math.max(0, dragRef.current.start.y + dy), window.innerHeight - PALETTE_H_MIN),
    });
  };
  const onPointerUp = () => { dragRef.current = null; };
  return (
    <div style={{...styles.palette, left: pos.x, top: pos.y}} data-tour="mainPalette">
      <div
        style={{...styles.paletteHeader, cursor: 'grab'}}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span style={styles.paletteHeaderTitle} data-no-drag onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'} Body
        </span>
        <span style={{display: 'flex', alignItems: 'center', gap: 4, position: 'relative'}}>
          <TourLauncher />
          <span style={styles.paletteHeaderHandle}>⠿</span>
          <TourNudge />
        </span>
      </div>
      {!collapsed && children}
      {!collapsed && <FirstRunHint />}
    </div>
  );
}

function Pill({ icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={active ? {...styles.palettePill, ...styles.palettePillOn} : styles.palettePill}
    >
      {icon} {label}
    </button>
  );
}

function Popover({ open, anchor, onClose, title, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ right: 18, bottom: 60 });
  useEffect(() => {
    if (!open) return;
    const compute = () => {
      if (anchor && anchor.current) {
        const rect = anchor.current.getBoundingClientRect();
        setPos({
          right: Math.max(8, window.innerWidth - rect.right),
          bottom: window.innerHeight - rect.top + 8,
        });
      }
    };
    compute();
    window.addEventListener('resize', compute);
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      if (anchor && anchor.current && anchor.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', compute);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return (
    <div ref={ref} style={{...styles.popover, right: pos.right, bottom: pos.bottom}}>
      <div style={styles.paletteHeader}>
        <span>{title}</span>
        <button style={styles.paletteHeaderClose} onClick={onClose} aria-label="close">×</button>
      </div>
      {children}
    </div>
  );
}

function InfoStrip({ m, n, cut, cutMode, cutInfo, parallelInfo, offCenterInfo, p2pInfo, highlightedPiece, setHighlightedPiece }) {
  const tau = (n / m).toFixed(3);
  let cutSummary = null;
  if (cut) {
    if (cutMode === 'center') {
      cutSummary = (
        <>
          <span style={{opacity: 0.5}}>·</span>
          <span>{cutInfo.K_cuts === 1 ? '1 cut' : `${cutInfo.K_cuts} cuts`}</span>
          <span style={{opacity: 0.5}}>·</span>
          <PieceDots count={cutInfo.orbits} highlighted={highlightedPiece} onSelect={setHighlightedPiece} />
        </>
      );
    } else if (cutMode === 'parallel') {
      cutSummary = (
        <>
          <span style={{opacity: 0.5}}>·</span>
          <span>{`${parallelInfo.count} pieces`}</span>
          <PieceDots count={parallelInfo.count} highlighted={highlightedPiece} onSelect={setHighlightedPiece} />
        </>
      );
    } else if (cutMode === 'offcenter') {
      cutSummary = (
        <>
          <span style={{opacity: 0.5}}>·</span>
          <span>{`${offCenterInfo?.pieceCount ?? 0} pieces`}</span>
          <PieceDots count={offCenterInfo?.pieceCount ?? 0} highlighted={highlightedPiece} onSelect={setHighlightedPiece} />
        </>
      );
    } else {
      cutSummary = (
        <>
          <span style={{opacity: 0.5}}>·</span>
          <span>{`${p2pInfo?.pieceCount ?? 0} pieces`}</span>
          <PieceDots count={p2pInfo?.pieceCount ?? 0} highlighted={highlightedPiece} onSelect={setHighlightedPiece} />
        </>
      );
    }
  }
  return (
    <div style={styles.infoStrip}>
      <span>m={m}</span>
      <span style={{opacity: 0.5}}>·</span>
      <span>n={n}</span>
      <span style={{opacity: 0.5}}>·</span>
      <span>τ={tau}·2π</span>
      {cutSummary}
    </div>
  );
}

function MobileDrawer({ open, onToggle, children }) {
  return (
    <div style={{
      ...styles.drawer,
      maxHeight: open ? '70vh' : 38,
    }}>
      <div style={{position: 'relative'}}>
        <button onClick={onToggle} style={styles.drawerHandle} aria-label={open ? 'collapse controls' : 'expand controls'}>
          <div style={styles.drawerHandleBar} />
          <span style={styles.drawerHandleLabel}>{open ? 'tap to collapse' : 'tap to expand controls'}</span>
        </button>
        <div style={{position: 'absolute', right: 12, top: 12}}>
          <TourLauncher />
          <TourNudge />
        </div>
      </div>
      <div style={styles.drawerContent}>{children}</div>
    </div>
  );
}

const URL_KEYS = {
  m: 'm', n: 'n', pathShape: 'ps',
  circleR: 'R', ellipseA: 'a', ellipseB: 'b',
  knotR: 'kR', knotr: 'kr', knotP: 'p', knotQ: 'q',
  lemA: 'lA',
  cut: 'cut', cutMode: 'cm',
  sliceCount: 'N', offsetD: 'd', phi1: 'p1', phi2: 'p2', cutPhi: 'cp',
  separation: 'gap', seamOpen: 'op',
  bladeShape: 'bs', bladeAmount: 'ba',
  show2D: 's2d', hideOthers: 'ho',
  autoRotate: 'ar', showRidges: 'rg', gradient: 'gr',
  pMode: 'pm', qMode: 'qm', waveFreq: 'hz', waveAmp: 'am',
};

const TOUR_STEPS = [
  { kind: 'intro', diagram: 'torus', title: 'Welcome',
    body: "This is a Generalized Möbius–Listing body — a closed loop whose cross-section is a regular polygon that twists as it travels. You'll cut it, listen to it, and reshape it." },
  { kind: 'intro', diagram: 'mn', title: 'm and n',
    body: "m = sides of the cross-section polygon. n = how many m-gon-vertex steps the polygon rotates per full loop. m=2, n=1 is the classical Möbius strip." },
  { kind: 'intro', diagram: 'cut', title: 'Cuts',
    body: "Slice the body along a chord through the cross-section. Some chord positions split it into multiple connected pieces; others leave it whole. The piece count comes from m / gcd(2n, m)." },
  { kind: 'ui', target: 'canvas',       title: 'The canvas',
    body: "Drag to rotate, scroll or pinch to zoom. Click a piece to isolate; click again to clear." },
  { kind: 'ui', target: 'mainPalette',  title: 'Body palette',
    body: "Change the path shape (circle, ellipse, knot, figure-8), m, and n here. Toggle ridges, gradient, auto-rotate." },
  { kind: 'ui', target: 'pillRow',      title: 'Cut & Sound',
    body: "✂ opens cut controls — chord position, blade shape, gap. ♪ plays the polygon's waveform as audio." },
  { kind: 'ui', target: 'mLabel',       title: 'Hints',
    body: "Hover any label for a description. Press ? (top of palette) to replay this tour." },
];

const HINTS = {
  pathShape_circle:     { kind: 'terse', text: 'Center-path is a circle (the standard torus).' },
  pathShape_ellipse:    { kind: 'terse', text: 'Center-path is an ellipse with independent semi-axes.' },
  pathShape_knot:       { kind: 'terse', text: 'Center-path is a (p,q) torus knot — winds around the symmetry axis p times and around the tube q times.' },
  pathShape_lemniscate: { kind: 'terse', text: 'Center-path is a figure-8 (Bernoulli lemniscate).' },

  R_circle:    { kind: 'terse', text: 'Major radius — distance from the center of the torus to the center of the cross-section.' },
  a_ellipse:   { kind: 'terse', text: 'Ellipse semi-axis along the X direction.' },
  b_ellipse:   { kind: 'terse', text: 'Ellipse semi-axis along the Z direction.' },
  R_knot:      { kind: 'terse', text: 'Major radius of the torus the knot winds around.' },
  r_knot:      { kind: 'terse', text: 'Tube radius — how far the knot deviates from the underlying torus surface.' },
  p_knot:      { kind: 'rich',  title: 'Path winding p',  body: 'Number of times the (p,q) torus knot winds around the symmetry axis. Must be coprime to q — the UI auto-bumps q if you would break that.' },
  q_knot:      { kind: 'rich',  title: 'Tube winding q',  body: 'Number of times the (p,q) torus knot winds around the tube. Must be coprime to p — the UI auto-bumps p if you would break that.' },
  a_lemniscate:{ kind: 'terse', text: 'Overall scale of the figure-8 path.' },

  n: { kind: 'rich', title: 'Twist count',   body: 'The cross-section rotates n/m turns as it traces the path. The classical Möbius strip is m=2, n=1.', formula: 'α = (n/m)·θ' },
  m: { kind: 'rich', title: 'Polygon sides', body: 'The cross-section is a regular m-gon. m=2 collapses to a flat strip (Möbius band when n is odd).', formula: 'pieces after a center cut = m / gcd(2n, m)' },

  autoRotate: { kind: 'terse', text: 'Spin the model on its vertical axis. Off when you want to study a specific orientation.' },
  ridges:     { kind: 'terse', text: 'Show the m-gon edges along the surface. Disabled while the body is cut.' },
  gradient:   { kind: 'terse', text: 'Color the surface with a θ-based gradient. Off shows flat per-piece colors.' },

  cut:               { kind: 'terse', text: 'Slice the body along a chord through the cross-section. Open the cut popover for shape and mode controls.' },
  cutMode_center:    { kind: 'terse', text: 'Cut along chords through the polygon center. Diametric cuts.' },
  cutMode_parallel:  { kind: 'terse', text: 'Cut along multiple parallel chords. Slices the body into slabs.' },
  cutMode_offcenter: { kind: 'terse', text: 'Cut along a single chord offset from the center by a fixed distance.' },
  cutMode_p2p:       { kind: 'terse', text: 'Point-to-point: cut along a chord from one cross-section vertex to another.' },

  sliceCount: { kind: 'terse', text: 'Number of parallel chord cuts through the cross-section.' },
  offsetD:    { kind: 'terse', text: 'Off-center cut: distance of the chord from the polygon center, as % of the inradius.' },
  phi1:       { kind: 'terse', text: 'First vertex angle for the point-to-point cut. The chord starts at the cross-section vertex closest to this angle.' },
  phi2:       { kind: 'terse', text: 'Second vertex angle for the point-to-point cut. The chord ends at the cross-section vertex closest to this angle.' },
  cutPhi:     { kind: 'terse', text: 'Rotation of the cut chord within the cross-section.' },

  gap:      { kind: 'terse', text: 'Pulls the cut pieces apart so you can see them as separate solids. 0 = touching.' },
  seamOpen: { kind: 'terse', text: 'Opens up the seam at the cut surface. Lets you see the cut without separating the pieces.' },

  bladeShape_straight: { kind: 'terse', text: 'Cut surface is a flat plane.' },
  bladeShape_curved:   { kind: 'terse', text: 'Cut surface is a smooth concave/convex curve.' },
  bladeShape_zigzag:   { kind: 'terse', text: 'Cut surface follows a sawtooth profile along the chord.' },
  bladeShape_custom:   { kind: 'terse', text: 'Cut surface follows a profile you draw below.' },
  bladeAmount:         { kind: 'terse', text: 'Amount of curvature/zigzag/profile applied to the cut surface.' },

  show2D:     { kind: 'terse', text: 'Show the 2D cross-section diagram in a corner overlay.' },
  hideOthers: { kind: 'terse', text: 'Hide every piece except the highlighted one. Click a piece-dot or the body itself to pick which.' },

  pMode:    { kind: 'rich',  title: 'Modal number p', body: 'Spatial mode along θ that drives the per-vertex color sweep. Higher numbers, finer ripples.', formula: 'phase = p·θ + q·φ − ωt' },
  qMode:    { kind: 'rich',  title: 'Modal number q', body: 'Spatial mode along φ that drives the per-vertex color sweep. Higher numbers, finer ripples.', formula: 'phase = p·θ + q·φ − ωt' },
  waveFreq: { kind: 'terse', text: 'Audio frequency of the polygon waveform, in Hz.' },
  waveAmp:  { kind: 'terse', text: 'Output volume.' },
  wavePlay: { kind: 'terse', text: 'Start or stop the looping polygon waveform. Color-sweep visualization stays live regardless.' },
};

const HoverHintContext = createContext(null);
const TourContext = createContext(null);

function HoverHintProvider({ children }) {
  const [activeHint, setActiveHint] = useState(null);
  const [hasHovered, setHasHovered] = useState(false);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setActiveHint(null);
  }, []);

  const cancelPending = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const register = useCallback((rect, content) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setActiveHint((prev) => {
      if (prev) {
        setHasHovered(true);
        return { rect, content };
      }
      timerRef.current = setTimeout(() => {
        setActiveHint({ rect, content });
        setHasHovered(true);
        timerRef.current = null;
      }, 220);
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!activeHint) return;
    const onDocPointerDown = (e) => {
      if (e.pointerType === 'mouse') return;
      const r = activeHint.rect;
      if (r) {
        const x = e.clientX, y = e.clientY;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return;
      }
      setActiveHint(null);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [activeHint]);

  return (
    <HoverHintContext.Provider value={{ activeHint, register, clear, cancelPending, hasHovered }}>
      {children}
    </HoverHintContext.Provider>
  );
}

function computeHintPosition(rect, contentSize, viewport) {
  const GAP = 8;
  const MARGIN = 6;
  const cw = contentSize.width, ch = contentSize.height;
  const vw = viewport.width, vh = viewport.height;

  const spaceRight = vw - rect.right;
  const spaceLeft = rect.left;
  let side = spaceRight >= spaceLeft ? 'right' : 'left';

  const tryHorizontal = (s) => {
    const l = s === 'right' ? rect.right + GAP : rect.left - cw - GAP;
    return { l, fits: l >= MARGIN && l + cw <= vw - MARGIN };
  };
  let h = tryHorizontal(side);
  if (!h.fits) {
    side = side === 'right' ? 'left' : 'right';
    h = tryHorizontal(side);
  }

  let left, top;
  if (h.fits) {
    left = h.l;
    top = rect.top + rect.height / 2 - ch / 2;
    top = Math.max(MARGIN, Math.min(top, vh - ch - MARGIN));
  } else {
    side = 'above';
    left = rect.left + rect.width / 2 - cw / 2;
    left = Math.max(MARGIN, Math.min(left, vw - cw - MARGIN));
    top = rect.top - ch - GAP;
    if (top < MARGIN) top = rect.bottom + GAP;
  }
  return { left, top, side };
}

function HintPopover() {
  const ctx = useContext(HoverHintContext);
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  const active = ctx && ctx.activeHint;

  useEffect(() => {
    if (!active || !ref.current) { setPos(null); return; }
    const cs = { width: ref.current.offsetWidth, height: ref.current.offsetHeight };
    const vp = { width: window.innerWidth, height: window.innerHeight };
    setPos(computeHintPosition(active.rect, cs, vp));
  }, [active]);

  if (!active) return null;
  const { content } = active;
  const style = pos
    ? { ...styles.hintPopover, left: pos.left, top: pos.top }
    : { ...styles.hintPopover, left: -9999, top: -9999 };

  return ReactDOM.createPortal(
    <div ref={ref} style={style}>
      {content.kind === 'rich' ? (
        <>
          <div style={styles.hintPopoverTitle}>{content.title}</div>
          <div style={styles.hintPopoverBody}>{content.body}</div>
          {content.formula && <div style={styles.hintPopoverFormula}>{content.formula}</div>}
        </>
      ) : (
        <div style={styles.hintPopoverBody}>{content.text}</div>
      )}
    </div>,
    document.body
  );
}

function HintRow({ hint, children, modeButton }) {
  const ctx = useContext(HoverHintContext);
  const ref = useRef(null);
  const holdTimerRef = useRef(null);
  const heldRef = useRef(false);

  if (!hint || !ctx) return children;

  const triggerRect = () => {
    const el = ref.current && (ref.current.firstElementChild || ref.current);
    return el ? el.getBoundingClientRect() : null;
  };

  const onPointerEnter = (e) => {
    if (e.pointerType !== 'mouse') return;
    const rect = triggerRect();
    if (rect) ctx.register(rect, hint);
  };
  const onPointerLeave = (e) => {
    if (e.pointerType !== 'mouse') return;
    ctx.cancelPending();
    ctx.clear();
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse') return;
    if (modeButton) {
      heldRef.current = false;
      holdTimerRef.current = setTimeout(() => {
        heldRef.current = true;
        const rect = triggerRect();
        if (rect) ctx.register(rect, hint);
        holdTimerRef.current = null;
      }, 350);
    } else {
      const interactive = e.target.closest('input, button, [role="button"]');
      if (!interactive) {
        if (ctx.activeHint && ctx.activeHint.content === hint) ctx.clear();
        else {
          const rect = triggerRect();
          if (rect) ctx.register(rect, hint);
        }
      }
    }
  };
  const onPointerUp = (e) => {
    if (e.pointerType === 'mouse') return;
    if (modeButton) {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      ctx.clear();
    }
  };
  const onPointerCancel = onPointerUp;
  const onClickCapture = (e) => {
    if (heldRef.current) {
      e.preventDefault();
      e.stopPropagation();
      heldRef.current = false;
    }
  };

  return (
    <div
      ref={ref}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClickCapture={onClickCapture}
      style={{ display: 'contents' }}
    >
      {children}
    </div>
  );
}

function FirstRunHint({ mobile }) {
  const ctx = useContext(HoverHintContext);
  const [visible, setVisible] = useState(() => {
    try { return sessionStorage.getItem('gml.hint.seen') !== '1'; }
    catch (_) { return true; }
  });
  const [opacity, setOpacity] = useState(1);
  const fadingRef = useRef(false);

  const fadeOut = useCallback(() => {
    if (fadingRef.current) return;
    fadingRef.current = true;
    setOpacity(0);
    try { sessionStorage.setItem('gml.hint.seen', '1'); } catch (_) {}
    setTimeout(() => setVisible(false), 220);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(fadeOut, 6000);
    return () => clearTimeout(timer);
  }, [visible, fadeOut]);

  useEffect(() => {
    if (!visible || !ctx) return;
    if (ctx.hasHovered) fadeOut();
  }, [ctx && ctx.hasHovered, visible, fadeOut]);

  if (!visible) return null;
  const text = mobile ? 'tap labels for descriptions' : 'hover labels for descriptions';
  return <div style={{...styles.firstRunHint, opacity}}>{text}</div>;
}

function Tour({ children, isMobile, drawerOpen, setDrawerOpen }) {
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const priorDrawerOpenRef = useRef(null);

  useEffect(() => {
    try {
      if (localStorage.getItem('gml.tour.seen') !== '1') setTourOpen(true);
    } catch (_) { setTourOpen(true); }
  }, []);

  const finish = useCallback((skipped) => {
    try { localStorage.setItem('gml.tour.seen', '1'); } catch (_) {}
    if (isMobile && priorDrawerOpenRef.current !== null) {
      setDrawerOpen(priorDrawerOpenRef.current);
      priorDrawerOpenRef.current = null;
    }
    setTourOpen(false);
    setTourStep(0);
    if (skipped) {
      setNudgeVisible(true);
      setTimeout(() => setNudgeVisible(false), 6000);
    }
  }, [isMobile, setDrawerOpen]);

  const open = useCallback(() => {
    setTourStep(0);
    setTourOpen(true);
  }, []);

  useEffect(() => {
    if (!isMobile || !tourOpen) return;
    if (tourStep >= 3) {
      if (priorDrawerOpenRef.current === null) priorDrawerOpenRef.current = drawerOpen;
      if (!drawerOpen) setDrawerOpen(true);
    }
  }, [isMobile, tourOpen, tourStep, drawerOpen, setDrawerOpen]);

  const ctxValue = { tourOpen, tourStep, open, setTourStep, finish, nudgeVisible };

  return (
    <TourContext.Provider value={ctxValue}>
      {children}
      {tourOpen && <TourCard />}
      {tourOpen && <TourConnector isMobile={isMobile} />}
    </TourContext.Provider>
  );
}

function TorusMini() {
  const W = 160, H = 120;
  const cx = W / 2, cy = H / 2;
  const Rmaj = 50, Rmin = 14;
  const torusPath = `M ${cx - Rmaj} ${cy} A ${Rmaj} ${Rmaj * 0.4} 0 0 1 ${cx + Rmaj} ${cy} A ${Rmaj} ${Rmaj * 0.4} 0 0 1 ${cx - Rmaj} ${cy} Z`;
  const verts4 = getPolygonVertices(4, Rmin);
  const mPolyPts = verts4.map(([x, y]) => `${cx + Rmaj + x},${cy + y}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      <ellipse cx={cx} cy={cy} rx={Rmaj} ry={Rmaj * 0.4}
        fill="none" stroke="rgba(199,134,89,0.4)" strokeWidth="0.8" strokeDasharray="2 2" />
      <path d={torusPath} fill="none" stroke="rgba(233,163,107,0.5)" strokeWidth="1" />
      <polygon points={mPolyPts} fill="rgba(233,163,107,0.18)" stroke="#e9a36b" strokeWidth="1" />
    </svg>
  );
}

function MnMini() {
  const W = 200, H = 120;
  const r = 28;
  const drawPoly = (cx, cy, m) => {
    const verts = getPolygonVertices(m, r);
    return verts.map(([x, y]) => `${cx + x},${cy + y}`).join(' ');
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      <polygon points={drawPoly(58, 56, 3)} fill="rgba(233,163,107,0.18)" stroke="#e9a36b" strokeWidth="1" />
      <text x={58} y={108} textAnchor="middle" fill="rgba(246,239,225,0.55)"
        fontFamily='"JetBrains Mono", monospace' fontSize="9">m=3, n=1</text>
      <polygon points={drawPoly(142, 56, 6)} fill="rgba(233,163,107,0.18)" stroke="#e9a36b" strokeWidth="1" />
      <text x={142} y={108} textAnchor="middle" fill="rgba(246,239,225,0.55)"
        fontFamily='"JetBrains Mono", monospace' fontSize="9">m=6, n=2</text>
    </svg>
  );
}

function CutMini() {
  const W = 160, H = 120;
  const cx = W / 2, cy = 56;
  const r = 38;
  const localHex = getPolygonVertices(6, r);
  const regionsMap = findAllRegions(localHex, [{ phi: Math.PI / 2, d: 0 }]);
  const regions = Array.from(regionsMap.values());
  const colors = ['rgba(199,134,89,0.45)', 'rgba(120,180,180,0.45)'];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      {regions.map((reg, i) => {
        const pts = reg.map(([x, y]) => `${cx + x},${cy + y}`).join(' ');
        return <polygon key={i} points={pts} fill={colors[i % 2]} stroke="#e9a36b" strokeWidth="0.8" />;
      })}
      <line x1={cx - r} y1={cy} x2={cx + r} y2={cy}
        stroke="#ffd9b3" strokeWidth="1.2" strokeDasharray="3 2" />
      <text x={cx} y={108} textAnchor="middle" fill="rgba(246,239,225,0.55)"
        fontFamily='"JetBrains Mono", monospace' fontSize="9">2 regions after this cut</text>
    </svg>
  );
}

const exporterCache = {};
function loadExporter(name) {
  if (exporterCache[name]) return exporterCache[name];
  exporterCache[name] = new Promise((resolve, reject) => {
    if (THREE[name]) { resolve(THREE[name]); return; }
    const s = document.createElement('script');
    s.src = `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/exporters/${name}.js`;
    s.onload = () => resolve(THREE[name]);
    s.onerror = () => reject(new Error(`failed to load ${name}`));
    document.head.appendChild(s);
  });
  return exporterCache[name];
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SaveButton({ label, description, feedback, onClick }) {
  return (
    <button onClick={onClick} style={styles.saveBtn}>
      <span style={styles.saveBtnLabel}>{label}</span>
      <span style={styles.saveBtnDesc}>{feedback || description}</span>
    </button>
  );
}

function SavePopoverContent({ m, n, pathShape, cut, stateRef, currentValueOf, crossSectionProps }) {
  const [feedback, setFeedback] = useState({});

  const filename = (ext) => `gml_m${m}_n${n}_${pathShape}${cut ? '_cut' : ''}.${ext}`;

  const flash = (key, msg, ms = 2000) => {
    setFeedback((f) => ({ ...f, [key]: msg }));
    setTimeout(() => setFeedback((f) => { const next = { ...f }; delete next[key]; return next; }), ms);
  };

  const exportPNG = () => {
    const sr = stateRef.current;
    if (!sr || !sr.renderer || !sr.scene || !sr.camera) return;
    sr.renderer.render(sr.scene, sr.camera);
    sr.renderer.domElement.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, filename('png'));
        flash('PNG', 'saved');
      } else {
        flash('PNG', 'failed', 2500);
      }
    }, 'image/png');
  };

  const exportSVG = () => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:400px;height:400px';
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    root.render(<CrossSection2D {...crossSectionProps} size={400} highlighted={null} />);
    requestAnimationFrame(() => {
      const svgEl = container.querySelector('svg');
      if (!svgEl) {
        root.unmount();
        document.body.removeChild(container);
        flash('SVG', 'failed', 2500);
        return;
      }
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svgEl);
      downloadBlob(new Blob([xml], { type: 'image/svg+xml' }), filename('svg'));
      root.unmount();
      document.body.removeChild(container);
      flash('SVG', 'saved');
    });
  };

  const exportThree = async (key, exporterName, ext, mime, parseAsync) => {
    flash(key, 'loading…', 60000);
    try {
      const Exporter = await loadExporter(exporterName);
      const exporter = new Exporter();
      const group = stateRef.current && stateRef.current.group;
      if (!group) throw new Error('no scene group');
      const data = parseAsync ? await parseAsync(exporter, group) : exporter.parse(group);
      const blob = data instanceof ArrayBuffer
        ? new Blob([data], { type: mime })
        : new Blob([data], { type: mime });
      downloadBlob(blob, filename(ext));
      flash(key, 'saved');
    } catch (err) {
      console.error(err);
      flash(key, 'failed', 2500);
    }
  };

  const exportSTL = () => exportThree('STL', 'STLExporter', 'stl', 'model/stl');
  const exportOBJ = () => exportThree('OBJ', 'OBJExporter', 'obj', 'model/obj');
  const exportGLB = () => exportThree('GLB', 'GLTFExporter', 'glb', 'model/gltf-binary',
    (exporter, group) => new Promise((resolve, reject) => {
      exporter.parse(group, resolve, reject, { binary: true });
    }));

  const shareURL = async () => {
    const params = new URLSearchParams();
    for (const [stateName, key] of Object.entries(URL_KEYS)) {
      const v = currentValueOf(stateName);
      if (v === undefined || v === null) continue;
      if (typeof v === 'boolean') params.set(key, v ? '1' : '0');
      else params.set(key, String(v));
    }
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      flash('Share', 'copied');
    } catch (err) {
      console.warn('clipboard failed; URL is:', url);
      flash('Share', 'check console', 3000);
    }
  };

  return (
    <div style={styles.saveGrid}>
      <SaveButton label="PNG" description="canvas screenshot"     feedback={feedback.PNG}   onClick={exportPNG} />
      <SaveButton label="SVG" description="cross-section diagram" feedback={feedback.SVG}   onClick={exportSVG} />
      <SaveButton label="STL" description="printable 3D model"    feedback={feedback.STL}   onClick={exportSTL} />
      <SaveButton label="OBJ" description="3D model with UVs"     feedback={feedback.OBJ}   onClick={exportOBJ} />
      <SaveButton label="GLB" description="scene with materials"  feedback={feedback.GLB}   onClick={exportGLB} />
      <SaveButton label="Share" description="copy link to clipboard" feedback={feedback.Share} onClick={shareURL} />
    </div>
  );
}

function TourLauncher() {
  const ctx = useContext(TourContext);
  if (!ctx) return null;
  return (
    <button
      style={styles.tourLauncher}
      onClick={(e) => { e.stopPropagation(); ctx.open(); }}
      data-no-drag
      aria-label="replay tour"
      title="replay tour"
    >?</button>
  );
}

function TourNudge() {
  const ctx = useContext(TourContext);
  const [opacity, setOpacity] = useState(1);
  useEffect(() => {
    if (!ctx || !ctx.nudgeVisible) return;
    setOpacity(1);
    const t = setTimeout(() => setOpacity(0), 5800);
    return () => clearTimeout(t);
  }, [ctx && ctx.nudgeVisible]);
  if (!ctx || !ctx.nudgeVisible) return null;
  return (
    <span style={{
      ...styles.tourNudge,
      opacity,
      right: 16,
      top: 22,
    }}>tour: press ? to replay</span>
  );
}

function TourConnector({ isMobile }) {
  const ctx = useContext(TourContext);
  const [geom, setGeom] = useState(null);
  const [drawn, setDrawn] = useState(false);

  const step = ctx && ctx.tourOpen ? TOUR_STEPS[ctx.tourStep] : null;
  const target = step && step.kind === 'ui' ? step.target : null;

  useEffect(() => {
    if (!target) { setGeom(null); return; }
    const compute = () => {
      let id = target;
      if (isMobile) {
        if (id === 'mainPalette') id = 'mobileBody';
        else if (id === 'pillRow') id = 'mobileCutSection';
      }
      const el = document.querySelector(`[data-tour="${id}"]`);
      const cardEl = document.querySelector('[data-tour-card]');
      if (!el || !cardEl) { setGeom(null); return; }
      const tr = el.getBoundingClientRect();
      const cr = cardEl.getBoundingClientRect();
      const outline = { x: tr.left - 4, y: tr.top - 4, w: tr.width + 8, h: tr.height + 8 };
      const cardCx = cr.left + cr.width / 2, cardCy = cr.top + cr.height / 2;
      const tgtCx = tr.left + tr.width / 2, tgtCy = tr.top + tr.height / 2;
      const dx = tgtCx - cardCx, dy = tgtCy - cardCy;
      const horizontalDominant = Math.abs(dx) > Math.abs(dy);
      let from, to;
      if (horizontalDominant) {
        from = { x: dx > 0 ? cr.right : cr.left, y: cardCy };
        to   = { x: dx > 0 ? tr.left  : tr.right, y: tgtCy };
      } else {
        from = { x: cardCx, y: dy > 0 ? cr.top : cr.bottom };
        to   = { x: tgtCx, y: dy > 0 ? tr.bottom : tr.top };
      }
      const bend = horizontalDominant ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
      setGeom({ outline, points: [from, bend, to] });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [target, ctx && ctx.tourStep, isMobile]);

  // Restart the draw-on animation each time the geometry changes (new step,
  // resize, or tour reopen). Two rAFs so the browser commits the
  // dashoffset=length frame before transitioning to dashoffset=0.
  useEffect(() => {
    if (!geom) { setDrawn(false); return; }
    setDrawn(false);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setDrawn(true));
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [geom]);

  if (!geom) return null;
  const { outline, points } = geom;
  const ptsAttr = points.map((p) => `${p.x},${p.y}`).join(' ');
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    totalLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return ReactDOM.createPortal(
    <svg
      style={{
        position: 'fixed', left: 0, top: 0,
        width: '100vw', height: '100vh',
        pointerEvents: 'none', zIndex: 31,
      }}
    >
      <defs>
        <filter id="tour-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x={outline.x} y={outline.y} width={outline.w} height={outline.h}
        fill="none" stroke="rgba(233,163,107,0.65)" strokeWidth="1"
        rx="4" ry="4" filter="url(#tour-glow)"
        opacity={drawn ? 1 : 0}
        style={{ transition: drawn ? 'opacity 400ms ease-out 350ms' : 'none' }} />
      <polyline points={ptsAttr} fill="none"
        stroke="rgba(233,163,107,0.7)" strokeWidth="1.5"
        strokeDasharray={totalLen}
        strokeDashoffset={drawn ? 0 : totalLen}
        style={{ transition: drawn ? 'stroke-dashoffset 750ms ease-out' : 'none' }} />
    </svg>,
    document.body
  );
}

function TourCard() {
  const ctx = useContext(TourContext);
  if (!ctx || !ctx.tourOpen) return null;
  const step = TOUR_STEPS[ctx.tourStep];
  if (!step) return null;
  return (
    <div style={styles.tourCard} data-tour-card>
      <div style={styles.tourCardHeader}>
        <span>step {ctx.tourStep + 1} / {TOUR_STEPS.length}</span>
        <button style={styles.tourClose} onClick={() => ctx.finish(false)} aria-label="close tour">×</button>
      </div>
      {step.title && <div style={styles.tourCardTitle}>{step.title}</div>}
      <div style={styles.tourCardBody}>{step.body}</div>
      {step.kind === 'intro' && (
        <div style={styles.tourCardDiagram}>
          {step.diagram === 'torus' && <TorusMini />}
          {step.diagram === 'mn' && <MnMini />}
          {step.diagram === 'cut' && <CutMini />}
        </div>
      )}
      <div style={styles.tourCardFooter}>
        <button style={styles.tourBtnSkip} onClick={() => ctx.finish(true)}>
          {ctx.tourStep === TOUR_STEPS.length - 1 ? '' : 'skip'}
        </button>
        <div style={{display: 'flex', gap: 8}}>
          {ctx.tourStep > 0 && (
            <button
              style={styles.tourBtn}
              onClick={() => ctx.setTourStep(ctx.tourStep - 1)}
            >prev</button>
          )}
          <button
            style={{...styles.tourBtn, ...styles.tourBtnPrimary}}
            onClick={() => {
              if (ctx.tourStep === TOUR_STEPS.length - 1) ctx.finish(false);
              else ctx.setTourStep(ctx.tourStep + 1);
            }}
          >{ctx.tourStep === TOUR_STEPS.length - 1 ? 'done' : 'next'}</button>
        </div>
      </div>
    </div>
  );
}

export default function GMLBody() {
  const mountRef = useRef(null);
  const stateRef = useRef({});
  const soundPillRef = useRef(null);
  const cutPillRef = useRef(null);
  const savePillRef = useRef(null);
  const [m, setM] = useState(3);
  const [n, setN] = useState(1);
  const [autoRotate, setAutoRotate] = useState(true);
  const [showRidges, setShowRidges] = useState(true);
  const [gradient, setGradient] = useState(false);
  const [cut, setCut] = useState(false);
  const [cutMode, setCutMode] = useState('center');
  const [pathShape, setPathShape] = useState('circle');
  const [circleR, setCircleR] = useState(2.3);
  const [ellipseA, setEllipseA] = useState(2.3);
  const [ellipseB, setEllipseB] = useState(1.5);
  const [knotR, setKnotR] = useState(2.0);
  // Default 0.9 and min 0.85 keep the knot tube wider than the cross-section
  // circumradius (r ≈ 0.78 in rebuild), preventing the swept body from
  // self-intersecting at strand crossings.
  const [knotr, setKnotr] = useState(0.9);
  const [knotP, setKnotP] = useState(2);
  const [knotQ, setKnotQ] = useState(3);
  const [lemA, setLemA] = useState(2.3);
  const [sliceCount, setSliceCount] = useState(2);
  const [offsetD, setOffsetD] = useState(40);
  const [phi1, setPhi1] = useState(30);   // p2p mode endpoint 1 (degrees)
  const [phi2, setPhi2] = useState(150);  // p2p mode endpoint 2 (degrees)
  const [bladeShape, setBladeShape] = useState('straight');  // 'straight'|'curved'|'zigzag'|'custom'
  const [bladeAmount, setBladeAmount] = useState(40);  // 0-100, controls bow/zigzag amplitude
  const PROFILE_N = 41;  // odd so the chord midpoint is exactly captured
  const [bladeProfile, setBladeProfile] = useState(() => new Array(PROFILE_N).fill(0));
  const [cutPhi, setCutPhi] = useState(0);
  const [separation, setSeparation] = useState(40);
  const [seamOpen, setSeamOpen] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const readPaletteStorage = () => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('gml.mainPalette') : null;
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  };
  const savedPalette = typeof window !== 'undefined' ? readPaletteStorage() : null;
  const initialMainPos = (() => {
    if (savedPalette && typeof savedPalette.x === 'number' && typeof savedPalette.y === 'number') {
      return {
        x: Math.min(Math.max(0, savedPalette.x), Math.max(0, window.innerWidth - PALETTE_W)),
        y: Math.min(Math.max(0, savedPalette.y), Math.max(0, window.innerHeight - PALETTE_H_MIN)),
      };
    }
    return { x: 18, y: 50 };
  })();
  const initialMainCollapsed = !!(savedPalette && savedPalette.collapsed);

  const [mainPos, setMainPos] = useState(initialMainPos);
  const [mainCollapsed, setMainCollapsed] = useState(initialMainCollapsed);
  const [openPopover, setOpenPopover] = useState(null); // null | 'cut' | 'sound' | 'save'
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 720);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 720);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('gml.mainPalette', JSON.stringify({
        x: mainPos.x, y: mainPos.y, collapsed: mainCollapsed,
      }));
    } catch {}
  }, [mainPos, mainCollapsed]);

  // Hydrate state from URL params (Share URL round-trip).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let any = false;
    params.forEach(() => { any = true; });
    if (!any) return;
    const setters = {
      m: (v) => setM(Math.max(3, parseInt(v, 10))),
      n: (v) => setN(parseInt(v, 10)),
      pathShape: (v) => setPathShape(v),
      circleR: (v) => setCircleR(parseFloat(v)),
      ellipseA: (v) => setEllipseA(parseFloat(v)),
      ellipseB: (v) => setEllipseB(parseFloat(v)),
      knotR: (v) => setKnotR(parseFloat(v)),
      knotr: (v) => setKnotr(parseFloat(v)),
      knotP: (v) => setKnotP(parseInt(v, 10)),
      knotQ: (v) => setKnotQ(parseInt(v, 10)),
      lemA: (v) => setLemA(parseFloat(v)),
      cut: (v) => setCut(v === '1'),
      cutMode: (v) => setCutMode(v),
      sliceCount: (v) => setSliceCount(parseInt(v, 10)),
      offsetD: (v) => setOffsetD(parseInt(v, 10)),
      phi1: (v) => setPhi1(parseInt(v, 10)),
      phi2: (v) => setPhi2(parseInt(v, 10)),
      cutPhi: (v) => setCutPhi(parseInt(v, 10)),
      separation: (v) => setSeparation(parseInt(v, 10)),
      seamOpen: (v) => setSeamOpen(parseInt(v, 10)),
      bladeShape: (v) => setBladeShape(v),
      bladeAmount: (v) => setBladeAmount(parseInt(v, 10)),
      show2D: (v) => setShow2D(v === '1'),
      hideOthers: (v) => setHideOthers(v === '1'),
      autoRotate: (v) => setAutoRotate(v === '1'),
      showRidges: (v) => setShowRidges(v === '1'),
      gradient: (v) => setGradient(v === '1'),
      pMode: (v) => setPMode(parseInt(v, 10)),
      qMode: (v) => setQMode(parseInt(v, 10)),
      waveFreq: (v) => setWaveFreq(parseInt(v, 10)),
      waveAmp: (v) => setWaveAmp(parseInt(v, 10)),
    };
    for (const [stateName, key] of Object.entries(URL_KEYS)) {
      if (!params.has(key)) continue;
      const setter = setters[stateName];
      if (setter) setter(params.get(key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [show2D, setShow2D] = useState(true);
  const [highlightedPiece, setHighlightedPiece] = useState(null);
  const [hideOthers, setHideOthers] = useState(false);
  const [fullScreen2D, setFullScreen2D] = useState(false);
  const highlightRef = useRef(null);
  const hideOthersRef = useRef(false);
  highlightRef.current = highlightedPiece;
  hideOthersRef.current = hideOthers;

  // --- Sound state --------------------------------------------------------
  const [pMode, setPMode] = useState(2);   // wave count around the torus
  const [qMode, setQMode] = useState(1);   // wave count around the cross-section
  const [waveFreq, setWaveFreq] = useState(220);  // audible Hz
  const [waveAmp, setWaveAmp] = useState(40);     // 0-100, drives both visual amplitude and audio volume
  const [wavePlaying, setWavePlaying] = useState(false);
  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);

  const cutInfo = getCutInfo(m, n);
  const parallelInfo = getParallelOrbits(m, n, sliceCount + 1);

  // Compute off-center cut info (chord count, regions, pieces) when relevant.
  const offCenterInfo = (() => {
    if (!cut || cutMode !== 'offcenter') return null;
    const r = 0.78;  // matches rebuild
    const polyVerts = getPolygonVertices(m, r);
    const dPhi = (cutPhi / 180) * Math.PI;
    const dVal = (offsetD / 100) * 0.85 * r;
    const chords = offCenterChords(m, n, dPhi, dVal);
    const regions = findAllRegions(polyVerts, chords);
    const { count } = computeOrbitsCyclic(regions, chords.length);
    return { chordCount: chords.length, regionCount: regions.size, pieceCount: count };
  })();

  // Same info for point-to-point mode.
  const p2pInfo = (() => {
    if (!cut || cutMode !== 'p2p') return null;
    const r = 0.78;
    const polyVerts = getPolygonVertices(m, r);
    const phi1Rad = (phi1 / 180) * Math.PI;
    const phi2Rad = (phi2 / 180) * Math.PI;
    const chords = pointToPointChords(m, n, phi1Rad, phi2Rad, r);
    if (chords.length === 0) return { chordCount: 0, regionCount: 1, pieceCount: 1 };
    const regions = findAllRegions(polyVerts, chords);
    const { count } = computeOrbitsCyclic(regions, chords.length);
    return { chordCount: chords.length, regionCount: regions.size, pieceCount: count };
  })();

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth, h = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0c0a09');
    scene.fog = new THREE.Fog('#0c0a09', 12, 22);

    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    camera.position.set(5.5, -7.5, 4.2);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x4a3a30, 0.55));
    const key = new THREE.DirectionalLight(0xffd9a8, 1.4);
    key.position.set(6, -4, 8); scene.add(key);
    const rim = new THREE.DirectionalLight(0x6a88b8, 0.55);
    rim.position.set(-6, 5, -2); scene.add(rim);
    const warm = new THREE.PointLight(0xff8c4a, 0.35, 18);
    warm.position.set(-3, -3, 1.5); scene.add(warm);

    const surfaceMat = new THREE.MeshStandardMaterial({
      color: 0xc78659, metalness: 0.7, roughness: 0.32, side: THREE.DoubleSide,
    });
    const vertexColorMat = new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.55, roughness: 0.4, side: THREE.DoubleSide,
    });
    const ridgeMat = new THREE.LineBasicMaterial({
      color: 0xf6efe1, transparent: true, opacity: 0.85,
    });

    const group = new THREE.Group();
    scene.add(group);

    let dragging = false, lastX = 0, lastY = 0;
    let userYaw = 0, userPitch = 0;
    const dom = renderer.domElement;
    // Multi-pointer tracking for pinch-to-zoom.
    const pointers = new Map(); // pointerId -> { x, y }
    let pinching = false, pinchStartDist = 0, pinchStartZoom = 1;
    // Click vs drag detection: track total movement during a drag; if the
    // pointer barely moved between down and up, treat it as a click.
    let downX = 0, downY = 0, totalMoved = 0;
    const CLICK_THRESHOLD = 6; // pixels

    // Raycaster for hover/click picking. Returns the orbitIdx of the topmost
    // visible mesh under the pointer, or null if pointer is over empty space.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pickAt = (clientX, clientY) => {
      const rect = dom.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(group.children, true);
      for (const hit of hits) {
        const obj = hit.object;
        // Only invisible meshes shouldn't pick — three.js usually skips them
        // already, but be defensive in case future code paths change.
        if (obj.visible === false) continue;
        if (obj.userData?.orbitIdx !== undefined) return obj.userData.orbitIdx;
      }
      return null;
    };
    let lastHoverIdx = null;

    const onDown = (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { dom.setPointerCapture?.(e.pointerId); } catch (_) {}
      if (pointers.size === 1) {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        downX = e.clientX; downY = e.clientY; totalMoved = 0;
      } else if (pointers.size === 2) {
        // Switch from rotation to pinch.
        dragging = false;
        pinching = true;
        const [a, b] = [...pointers.values()];
        pinchStartDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        pinchStartZoom = stateRef.current.zoom || 1;
      }
    };
    const onUp = (e) => {
      const wasDragging = dragging && pointers.size === 1;
      const upX = e.clientX, upY = e.clientY;
      pointers.delete(e.pointerId);
      try { dom.releasePointerCapture?.(e.pointerId); } catch (_) {}
      if (pointers.size < 2) pinching = false;
      if (pointers.size === 0) {
        // Was this a click (negligible movement) on the body?
        const moved = Math.hypot(upX - downX, upY - downY);
        if (wasDragging && moved < CLICK_THRESHOLD && totalMoved < CLICK_THRESHOLD * 2) {
          const idx = pickAt(upX, upY);
          if (idx !== null) {
            // Clicking the same piece while it's already soloed un-solos it;
            // otherwise solo this piece.
            if (hideOthersRef.current && highlightRef.current === idx) {
              setHighlightedPiece(null);
              setHideOthers(false);
            } else {
              setHighlightedPiece(idx);
              setHideOthers(true);
            }
          } else {
            // Click on empty space → un-solo / clear highlight.
            if (hideOthersRef.current || highlightRef.current !== null) {
              setHighlightedPiece(null);
              setHideOthers(false);
            }
          }
        }
        dragging = false;
      } else if (pointers.size === 1) {
        // Resume single-pointer rotation from the remaining finger.
        const [p] = [...pointers.values()];
        dragging = true; lastX = p.x; lastY = p.y;
        downX = p.x; downY = p.y; totalMoved = 0;
      }
    };
    const onMove = (e) => {
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (pinching && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        // Fingers further apart => zoom in (smaller camera distance).
        const newZoom = pinchStartZoom * (pinchStartDist / dist);
        stateRef.current.zoom = Math.max(0.25, Math.min(3.0, newZoom));
        return;
      }
      if (!dragging) {
        // Hover pick: only when pointer is hovering with no button pressed
        // (mouse only — touch devices skip this naturally). We also skip when
        // the user has soloed a piece, because hovering shouldn't change which
        // piece is isolated.
        if (hideOthersRef.current) return;
        const idx = pickAt(e.clientX, e.clientY);
        dom.style.cursor = idx !== null ? 'pointer' : 'default';
        if (idx !== lastHoverIdx) {
          lastHoverIdx = idx;
          setHighlightedPiece(idx);
        }
        return;
      }
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      totalMoved += Math.abs(dx) + Math.abs(dy);
      userYaw += dx * 0.008;
      userPitch += dy * 0.008;
      userPitch = Math.max(-1.2, Math.min(1.2, userPitch));
      lastX = e.clientX; lastY = e.clientY;
    };
    const onWheel = (e) => {
      e.preventDefault();
      const cur = stateRef.current.zoom || 1;
      const factor = Math.exp(e.deltaY * 0.001);  // smooth exponential zoom
      stateRef.current.zoom = Math.max(0.25, Math.min(3.0, cur * factor));
    };
    const onLeave = () => {
      // Cursor left the canvas — clear any hover-only highlight, but don't
      // touch the highlight if the user has explicitly soloed a piece.
      if (hideOthersRef.current) return;
      if (lastHoverIdx !== null) {
        lastHoverIdx = null;
        setHighlightedPiece(null);
      }
      dom.style.cursor = 'default';
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointercancel', onUp);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerleave', onLeave);
    dom.addEventListener('wheel', onWheel, { passive: false });

    let autoT = 0, raf = 0;
    let waveT = 0;  // time accumulator for the wave animation, in seconds
    let lastFrame = performance.now();
    const baseCamX = 5.5, baseCamY = -7.5, baseCamZ = 4.2;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const s = stateRef.current;
      if (s.autoRotate) autoT += 0.0035;
      group.rotation.set(userPitch, 0, userYaw + autoT);
      // Apply zoom by scaling the camera distance from the origin. Direction
      // stays the same so the framing is identical, just closer/farther.
      const z = s.zoom || 1;
      camera.position.set(baseCamX * z, baseCamY * z, baseCamZ * z);
      camera.lookAt(0, 0, 0);

      // --- Animate the sound-wave coloring ---------------------------
      // Visual angular velocity is fixed so the pattern is always perceivable;
      // the audio frequency is independent. The wave SHAPE is sampled from
      // the same polygon-derived waveform that drives the audio — see/hear
      // the same timbre.
      if (s.soundMode && s.objects.length) {
        waveT += dt;
        const sp = s.soundParams || { p: 2, q: 1, amp: 0.4, vSpeed: 1.5 };
        const omegaVis = sp.vSpeed;
        const phase = omegaVis * waveT;
        const p = sp.p, q = sp.q;
        const amp = Math.max(0, Math.min(1, sp.amp));
        const polyWave = s.polygonWave;  // Float32Array, one period of polygon waveform
        for (const obj of s.objects) {
          const wc = obj.userData?.waveCoords;
          if (!wc) continue;
          const colorAttr = obj.geometry.attributes.color;
          if (!colorAttr) continue;
          const colors = colorAttr.array;
          const N = wc.length / 2;
          for (let i = 0; i < N; i++) {
            const theta = wc[i * 2];
            const phi = wc[i * 2 + 1];
            const ph = p * theta + q * phi - phase;
            // Sample the polygon-derived waveform at this phase. Falls back
            // to a sine if the buffer hasn't been built yet (very early
            // frames before the buffer ref is populated).
            const raw = polyWave ? sampleWaveformPhase(polyWave, ph) : Math.cos(ph);
            const wave = amp * raw;
            const tt = (wave + 1) * 0.5;
            // Cool-to-warm diverging colormap: blue at troughs, white-ish at
            // zero, warm red at crests.
            colors[i * 3]     = 0.20 + tt * 0.75;
            colors[i * 3 + 1] = 0.45 - 0.30 * Math.abs(wave);
            colors[i * 3 + 2] = 0.95 - tt * 0.75;
          }
          colorAttr.needsUpdate = true;
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      const ww = mount.clientWidth, hh = mount.clientHeight;
      renderer.setSize(ww, hh);
      camera.aspect = ww / hh; camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    stateRef.current = {
      group, surfaceMat, vertexColorMat, ridgeMat,
      renderer, scene, camera,
      autoRotate: true, objects: [], ridges: [], orbitMats: [], zoom: 1,
      pathFrame: defaultCirclePathFrame(),
      applyHighlight() {
        const s = stateRef.current;
        if (!s.orbitMats) return;
        const piece = highlightRef.current;
        const hideOther = hideOthersRef.current;
        const oc = s.orbitMats.length;
        const effective = (piece !== null && piece >= 0 && piece < oc) ? piece : null;
        for (let i = 0; i < oc; i++) {
          const bright = effective === null || effective === i;
          s.orbitMats[i].opacity = bright ? 1.0 : (hideOther ? 0 : 0.18);
          s.orbitMats[i].depthWrite = bright;
        }
        // When "hide others" is on, fully skip rendering for non-selected meshes.
        for (const o of s.objects) {
          const idx = o.userData?.orbitIdx;
          if (idx === undefined) { o.visible = true; continue; }
          const bright = effective === null || effective === idx;
          o.visible = bright || !hideOther;
        }
      },
      rebuild(mV, nV, ridgesOn, cutOn, mode, slices, dParam, cutPhiRad, sep, thetaMax, endCaps, p1Rad, p2Rad, blade, bladeAmt, profile, gradientOn, soundMode) {
        const s = stateRef.current;
        s.objects.forEach(o => { s.group.remove(o); o.geometry.dispose(); });
        s.objects = [];
        s.ridges.forEach(l => { s.group.remove(l); l.geometry.dispose(); });
        s.ridges = [];
        s.orbitMats.forEach(m => m.dispose());
        s.orbitMats = [];
        s.soundMode = !!soundMode;
        s.soundM = mV; s.soundN = nV;

        const r = 0.78;
        const pathFrame = s.pathFrame || defaultCirclePathFrame();
        const segs = Math.min(1500, Math.max(240, Math.ceil(Math.abs(nV) * 6) + Math.ceil(mV * 4)));
        const bladeShape = blade || 'straight';
        const bladeAmount = (bladeAmt || 0) * 0.7 * r;  // scale slider 0..1 to physical units

        // Helper: lazily create one cloned vertex-color material per orbit.
        // transparent:true is set so dimmed pieces can fade out via opacity.
        const matForOrbit = (oIdx) => {
          while (s.orbitMats.length <= oIdx) {
            const mat = s.vertexColorMat.clone();
            mat.transparent = true;
            mat.opacity = 1.0;
            s.orbitMats.push(mat);
          }
          return s.orbitMats[oIdx];
        };

        if (cutOn && mode === 'p2p') {
          const polyVerts = getPolygonVertices(mV, r);
          const chords = pointToPointChords(mV, nV, p1Rad, p2Rad, r);
          if (chords.length > 0) {
            const regions = findAllRegions(polyVerts, chords);
            const { orbitOf } = computeOrbitsCyclic(regions, chords.length);
            for (const [pat, regionPoly] of regions) {
              const oIdx = orbitOf.get(pat);
              const palette = PIECE_PALETTE[oIdx % PIECE_PALETTE.length];
              const { points: defPoly, cutTags } = deformPolygon(regionPoly, chords, bladeShape, bladeAmount, profile);
              const g = buildRegionGeometry(mV, nV, pathFrame, r, segs, defPoly, chords, sep, palette, thetaMax, endCaps, cutTags);
              if (g && gradientOn) applyGradient(g);
              if (g) {
                const mesh = new THREE.Mesh(g, matForOrbit(oIdx));
                mesh.userData.orbitIdx = oIdx;
                s.group.add(mesh);
                s.objects.push(mesh);
              }
            }
          } else {
            // Degenerate (phi1 == phi2): just render whole body.
            const g = buildWholeGeometry(mV, nV, pathFrame, r, segs);
            let wholeMat = s.surfaceMat;
            if (gradientOn) {
              addFlatColors(g);
              applyGradient(g);
              if (!s._wholeGradientMat) {
                s._wholeGradientMat = s.vertexColorMat.clone();
                s._wholeGradientMat.transparent = false;
                s._wholeGradientMat.opacity = 1.0;
              }
              wholeMat = s._wholeGradientMat;
            }
            const mesh = new THREE.Mesh(g, wholeMat);
            s.group.add(mesh); s.objects.push(mesh);
          }
        } else if (cutOn && mode === 'offcenter') {
          const polyVerts = getPolygonVertices(mV, r);
          const dVal = dParam * 0.85 * r;
          const chords = offCenterChords(mV, nV, cutPhiRad, dVal);
          const regions = findAllRegions(polyVerts, chords);
          const { orbitOf } = computeOrbitsCyclic(regions, chords.length);
          for (const [pat, regionPoly] of regions) {
            const oIdx = orbitOf.get(pat);
            const palette = PIECE_PALETTE[oIdx % PIECE_PALETTE.length];
            const { points: defPoly, cutTags } = deformPolygon(regionPoly, chords, bladeShape, bladeAmount, profile);
            const g = buildRegionGeometry(mV, nV, pathFrame, r, segs, defPoly, chords, sep, palette, thetaMax, endCaps, cutTags);
              if (g && gradientOn) applyGradient(g);
            if (g) {
              const mesh = new THREE.Mesh(g, matForOrbit(oIdx));
              mesh.userData.orbitIdx = oIdx;
              s.group.add(mesh);
              s.objects.push(mesh);
            }
          }
        } else if (cutOn && mode === 'parallel') {
          const offsets = evenlySpacedCutOffsets(slices, r * 0.78);
          const numStrips = slices + 1;
          const { orbitOf } = getParallelOrbits(mV, nV, numStrips);
          // Build a chord list so deformPolygon can recognize cut edges in parallel mode.
          const parallelChords = offsets.map(off => ({ phi: cutPhiRad, d: off }));
          const polygonVerts = getPolygonVertices(mV, r);
          for (let j = 0; j < numStrips; j++) {
            const dLeft = j === 0 ? -r * 1.5 : offsets[j - 1];
            const dRight = j === numStrips - 1 ? r * 1.5 : offsets[j];
            const oIdx = orbitOf[j];
            const palette = PIECE_PALETTE[oIdx % PIECE_PALETTE.length];
            const stripPoly = clipPolygonToStrip(polygonVerts, cutPhiRad, dLeft, dRight);
            if (stripPoly.length >= 3) {
              const { points: defPoly, cutTags } = deformPolygon(stripPoly, parallelChords, bladeShape, bladeAmount, profile);
              const g = buildRegionGeometry(mV, nV, pathFrame, r, segs, defPoly, parallelChords, sep, palette, thetaMax, endCaps, cutTags);
              if (g && gradientOn) applyGradient(g);
              if (g) {
                const mesh = new THREE.Mesh(g, matForOrbit(oIdx));
                mesh.userData.orbitIdx = oIdx;
                s.group.add(mesh);
                s.objects.push(mesh);
              }
            }
          }
        } else if (cutOn) {
          const { K_cuts, numWedges, orbits } = getCutInfo(mV, nV);
          const wedgeAngle = Math.PI / K_cuts;
          const K = Math.max(8, Math.ceil(mV * wedgeAngle / (Math.PI * 2) * 16) + 4);
          for (let w = 0; w < numWedges; w++) {
            const phiStart = cutPhiRad + w * wedgeAngle;
            const phiEnd = phiStart + wedgeAngle;
            const oIdx = w % orbits;
            const palette = PIECE_PALETTE[oIdx % PIECE_PALETTE.length];
            const g = buildWedgeGeometry(mV, nV, pathFrame, r, segs, K, phiStart, phiEnd, sep, palette, thetaMax, endCaps);
            if (gradientOn) applyGradient(g);
            const mesh = new THREE.Mesh(g, matForOrbit(oIdx));
            mesh.userData.orbitIdx = oIdx;
            s.group.add(mesh);
            s.objects.push(mesh);
          }
        } else {
          const g = buildWholeGeometry(mV, nV, pathFrame, r, segs);
          let wholeMat = s.surfaceMat;
          if (gradientOn) {
            // Whole body has no per-vertex colors; add a flat bronze base then
            // modulate it with the gradient. Switch to the vertex-color
            // material so the colors actually show.
            addFlatColors(g);
            applyGradient(g);
            // A clone keeps surface options (transparent etc.) independent of
            // the cut-piece materials.
            if (!s._wholeGradientMat) {
              s._wholeGradientMat = s.vertexColorMat.clone();
              s._wholeGradientMat.transparent = false;
              s._wholeGradientMat.opacity = 1.0;
            }
            wholeMat = s._wholeGradientMat;
          }
          const mesh = new THREE.Mesh(g, wholeMat);
          s.group.add(mesh);
          s.objects.push(mesh);
          if (ridgesOn) {
            for (const pos of buildRidgeLines(mV, nV, pathFrame, r, segs)) {
              const lg = new THREE.BufferGeometry();
              lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
              const line = new THREE.Line(lg, s.ridgeMat);
              s.group.add(line); s.ridges.push(line);
            }
          }
        }

        // --- SOUND MODE post-processing ----------------------------------
        // Take the meshes that were just built (whole body, wedges, strips,
        // regions — whatever the cut configuration produced) and turn them
        // into wave-painted surfaces. Every mesh gets a cloned sound material
        // (so per-piece highlight/solo still works) and a precomputed
        // (theta, phi) buffer that the tick loop reads each frame to recolor.
        if (soundMode) {
          // Discard the orbit/cut materials produced above; we'll replace them.
          s.orbitMats.forEach(mat => mat.dispose());
          s.orbitMats = [];
          for (const obj of s.objects) {
            // Make sure we have somewhere to write per-vertex colors. Whole-
            // body geometries don't have a color attribute by default.
            if (!obj.geometry.attributes.color) {
              addFlatColors(obj.geometry, [0.5, 0.5, 0.7]);
            }
            obj.userData.waveCoords = obj.geometry.userData?.waveCoords;
            // Each piece (or the single uncut body) gets its own sound
            // material clone, indexed by orbitIdx so applyHighlight can fade
            // unselected ones via opacity.
            const oIdx = obj.userData?.orbitIdx ?? 0;
            while (s.orbitMats.length <= oIdx) {
              const mat = new THREE.MeshStandardMaterial({
                vertexColors: true,
                metalness: 0.35, roughness: 0.55,
                side: THREE.DoubleSide,
                transparent: true, opacity: 1.0,
              });
              s.orbitMats.push(mat);
            }
            obj.material = s.orbitMats[oIdx];
            // Tag uncut whole-body meshes with orbitIdx 0 so highlight/solo
            // semantics behave consistently across modes.
            if (obj.userData.orbitIdx === undefined) {
              obj.userData.orbitIdx = 0;
            }
          }
        }

        s.applyHighlight();
      },
    };
    stateRef.current.rebuild(3, 1, true, false, 'center', 2, 0.4, 0, 0, 2 * Math.PI, false, 0, Math.PI, 'straight', 0, null, false, false);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onUp);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerleave', onLeave);
      dom.removeEventListener('wheel', onWheel);
      renderer.dispose();
      if (dom.parentNode === mount) mount.removeChild(dom);
    };
  }, []);

  useEffect(() => {
    if (!stateRef.current) return;
    const params = pathShape === 'ellipse' ? { a: ellipseA, b: ellipseB }
      : pathShape === 'lemniscate' ? { a: lemA }
      : pathShape === 'torusKnot' ? { R: knotR, rp: knotr, P: knotP, Q: knotQ }
      : { R: circleR };
    const spec = buildPathSpec(pathShape, params);
    stateRef.current.pathFrame = makePathFrame(spec, 1024);
  }, [pathShape, circleR, ellipseA, ellipseB, knotR, knotr, knotP, knotQ, lemA]);

  useEffect(() => {
    const seamFrac = seamOpen / 100;
    const thetaMax = 2 * Math.PI * (1 - 0.3 * seamFrac);
    const endCaps = cut && seamOpen > 0;
    const soundMode = openPopover === 'sound' || wavePlaying;
    stateRef.current.rebuild?.(
      m, n, showRidges, cut, cutMode, sliceCount, offsetD / 100,
      (cutPhi / 180) * Math.PI,
      (separation / 100) * 0.55,
      thetaMax, endCaps,
      (phi1 / 180) * Math.PI,
      (phi2 / 180) * Math.PI,
      bladeShape,
      bladeAmount / 100,
      bladeProfile,
      gradient && !soundMode,
      soundMode,
    );
  }, [openPopover, wavePlaying, m, n, showRidges, cut, cutMode, sliceCount, offsetD, cutPhi, separation, seamOpen, phi1, phi2, bladeShape, bladeAmount, bladeProfile, gradient, pathShape, circleR, ellipseA, ellipseB, knotR, knotr, knotP, knotQ, lemA]);

  // Push the live sound parameters into stateRef so the tick loop sees them
  // without rebuilding the geometry every time the user wiggles a slider.
  useEffect(() => {
    if (!stateRef.current) return;
    stateRef.current.soundParams = {
      p: pMode,
      q: qMode,
      amp: waveAmp / 100,
      // Visual angular speed: a slow rotation so the pattern is perceivable.
      // Independent of the audio frequency so audio can change without making
      // the visual confusingly fast.
      vSpeed: 1.4 + Math.log2(Math.max(50, waveFreq) / 220) * 0.8,
    };
  }, [pMode, qMode, waveAmp, waveFreq]);

  useEffect(() => { stateRef.current.autoRotate = autoRotate; }, [autoRotate]);

  // Apply highlight whenever the selected piece or hide-others toggle changes.
  useEffect(() => {
    stateRef.current.applyHighlight?.();
  }, [highlightedPiece, hideOthers]);

  // Clear highlight when the orbit structure may have changed (so we never
  // dim with a stale piece index that no longer exists).
  useEffect(() => {
    setHighlightedPiece(null);
  }, [m, n, cut, cutMode, sliceCount, offsetD, phi1, phi2, bladeShape]);

  // --- Audio lifecycle ----------------------------------------------------
  // Audio uses a polygon-derived waveform (per the supersounds paper) instead
  // of a plain sine. The cross-section polygon's timbre IS the audio timbre.
  // We loop a one-period AudioBuffer through an AudioBufferSourceNode and
  // pitch with playbackRate. The source gets recreated when m changes (the
  // buffer's contents can't be swapped on a running node) — there's a tiny
  // crossfade through the gain to hide the transition.
  const sourceRef = useRef(null);
  const polygonBufferRef = useRef(null);
  const baseFreqRef = useRef(50);  // Hz that 1× playbackRate plays at.

  const buildPolygonBuffer = (ctx, mVal) => {
    const samples = 2048;
    const wave = polygonWaveform(mVal, samples);
    const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
    buf.copyToChannel(wave, 0);
    baseFreqRef.current = ctx.sampleRate / samples;
    return { audioBuffer: buf, samples: wave };
  };

  const ensureAudio = () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ctx.destination);
    audioCtxRef.current = ctx;
    gainRef.current = gain;
    const built = buildPolygonBuffer(ctx, m);
    polygonBufferRef.current = built;
    return ctx;
  };
  const startSource = (ctx) => {
    if (!polygonBufferRef.current) {
      polygonBufferRef.current = buildPolygonBuffer(ctx, m);
    }
    const src = ctx.createBufferSource();
    src.buffer = polygonBufferRef.current.audioBuffer;
    src.loop = true;
    src.playbackRate.value = Math.max(20, waveFreq) / baseFreqRef.current;
    src.connect(gainRef.current);
    src.start();
    sourceRef.current = src;
  };
  const stopSource = () => {
    const src = sourceRef.current;
    if (!src) return;
    try { src.stop(); src.disconnect(); } catch (_) {}
    sourceRef.current = null;
  };
  const togglePlay = () => {
    const ctx = ensureAudio();
    if (!ctx || !gainRef.current) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    if (wavePlaying) {
      gainRef.current.gain.cancelScheduledValues(t0);
      gainRef.current.gain.setValueAtTime(gainRef.current.gain.value, t0);
      gainRef.current.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      // Stop after the ramp completes.
      const src = sourceRef.current;
      setTimeout(() => { if (sourceRef.current === src) stopSource(); }, 80);
      setWavePlaying(false);
    } else {
      startSource(ctx);
      const target = Math.max(0.0005, (waveAmp / 100) * 0.28);
      gainRef.current.gain.cancelScheduledValues(t0);
      gainRef.current.gain.setValueAtTime(0.0001, t0);
      gainRef.current.gain.exponentialRampToValueAtTime(target, t0 + 0.05);
      setWavePlaying(true);
    }
  };
  // Track frequency changes via the source's playbackRate.
  useEffect(() => {
    const ctx = audioCtxRef.current;
    const src = sourceRef.current;
    if (!ctx || !src) return;
    const r = Math.max(20, waveFreq) / baseFreqRef.current;
    src.playbackRate.cancelScheduledValues(ctx.currentTime);
    src.playbackRate.setValueAtTime(src.playbackRate.value, ctx.currentTime);
    src.playbackRate.exponentialRampToValueAtTime(r, ctx.currentTime + 0.04);
  }, [waveFreq]);
  // Track amplitude (gain) changes while playing.
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !gainRef.current || !wavePlaying) return;
    const target = Math.max(0.0005, (waveAmp / 100) * 0.28);
    gainRef.current.gain.cancelScheduledValues(ctx.currentTime);
    gainRef.current.gain.setValueAtTime(Math.max(0.0001, gainRef.current.gain.value), ctx.currentTime);
    gainRef.current.gain.exponentialRampToValueAtTime(target, ctx.currentTime + 0.04);
  }, [waveAmp, wavePlaying]);
  // When m changes, rebuild the polygon waveform buffer. The visual wave
  // sampler reads it from the same ref. If audio is currently playing, swap
  // in a new source with the new buffer through a brief gain dip so the
  // transition isn't a click.
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) {
      // Audio not yet created — store the buffer for visual sampling only.
      // We'll lazily build the AudioBuffer on first play.
      polygonBufferRef.current = { samples: polygonWaveform(m), audioBuffer: null };
      return;
    }
    const built = buildPolygonBuffer(ctx, m);
    polygonBufferRef.current = built;
    if (sourceRef.current && wavePlaying) {
      const t0 = ctx.currentTime;
      const target = Math.max(0.0005, (waveAmp / 100) * 0.28);
      gainRef.current.gain.cancelScheduledValues(t0);
      gainRef.current.gain.setValueAtTime(gainRef.current.gain.value, t0);
      gainRef.current.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.02);
      stopSource();
      startSource(ctx);
      gainRef.current.gain.setValueAtTime(0.0005, t0 + 0.02);
      gainRef.current.gain.exponentialRampToValueAtTime(target, t0 + 0.06);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m]);
  // Keep the visual wave sampler synced with the same waveform buffer.
  useEffect(() => {
    if (!polygonBufferRef.current) {
      polygonBufferRef.current = { samples: polygonWaveform(m), audioBuffer: null };
    }
    if (stateRef.current) {
      stateRef.current.polygonWave = polygonBufferRef.current.samples;
    }
  }, [m]);
  // Stop and tear down everything on unmount.
  useEffect(() => () => {
    stopSource();
    try { audioCtxRef.current?.close(); } catch (_) {}
    sourceRef.current = null;
    gainRef.current = null;
    audioCtxRef.current = null;
    polygonBufferRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bodyControls = (
    <>
      <div style={styles.modeRow}>
        <HintRow hint={HINTS.pathShape_circle} modeButton>
          <button onClick={() => setPathShape('circle')} style={{...styles.modeBtn, ...(pathShape === 'circle' ? styles.modeBtnOn : {})}}>circle</button>
        </HintRow>
        <HintRow hint={HINTS.pathShape_ellipse} modeButton>
          <button onClick={() => setPathShape('ellipse')} style={{...styles.modeBtn, ...(pathShape === 'ellipse' ? styles.modeBtnOn : {})}}>ellipse</button>
        </HintRow>
        <HintRow hint={HINTS.pathShape_knot} modeButton>
          <button onClick={() => setPathShape('torusKnot')} style={{...styles.modeBtn, ...(pathShape === 'torusKnot' ? styles.modeBtnOn : {})}}>knot</button>
        </HintRow>
        <HintRow hint={HINTS.pathShape_lemniscate} modeButton>
          <button onClick={() => setPathShape('lemniscate')} style={{...styles.modeBtn, ...(pathShape === 'lemniscate' ? styles.modeBtnOn : {})}}>figure-8</button>
        </HintRow>
      </div>
      {pathShape === 'circle' && (
        <HintRow hint={HINTS.R_circle}>
          <Slider label="R" min={0.5} max={5} step={0.05} value={circleR} onChange={setCircleR} editable />
        </HintRow>
      )}
      {pathShape === 'ellipse' && (
        <>
          <HintRow hint={HINTS.a_ellipse}>
            <Slider label="a" min={0.5} max={5} step={0.05} value={ellipseA} onChange={setEllipseA} editable />
          </HintRow>
          <HintRow hint={HINTS.b_ellipse}>
            <Slider label="b" min={0.5} max={5} step={0.05} value={ellipseB} onChange={setEllipseB} editable />
          </HintRow>
        </>
      )}
      {pathShape === 'torusKnot' && (
        <>
          <HintRow hint={HINTS.R_knot}>
            <Slider label="R" min={0.5} max={5} step={0.05} value={knotR} onChange={setKnotR} editable />
          </HintRow>
          <HintRow hint={HINTS.r_knot}>
            <Slider label="r" min={0.85} max={2} step={0.05} value={knotr} onChange={setKnotr} editable />
          </HintRow>
          <HintRow hint={HINTS.p_knot}>
            <Slider label="p" min={1} max={9} value={knotP} onChange={(v) => {
              const np = Math.max(1, v | 0);
              if (gcd(np, knotQ) === 1) { setKnotP(np); return; }
              let nq = knotQ + 1;
              while (gcd(np, nq) !== 1 && nq < 20) nq++;
              setKnotP(np); setKnotQ(nq);
            }} editable />
          </HintRow>
          <HintRow hint={HINTS.q_knot}>
            <Slider label="q" min={1} max={9} value={knotQ} onChange={(v) => {
              const nq = Math.max(1, v | 0);
              if (gcd(knotP, nq) === 1) { setKnotQ(nq); return; }
              let np = knotP + 1;
              while (gcd(np, nq) !== 1 && np < 20) np++;
              setKnotP(np); setKnotQ(nq);
            }} editable />
          </HintRow>
        </>
      )}
      {pathShape === 'lemniscate' && (
        <HintRow hint={HINTS.a_lemniscate}>
          <Slider label="a" min={0.5} max={5} step={0.05} value={lemA} onChange={setLemA} editable />
        </HintRow>
      )}
      <HintRow hint={HINTS.n}>
        <Slider label="n" min={0} max={Math.max(12, m * 2, n + 2)} value={n} onChange={(v) => setN(Math.max(0, v))} editable />
      </HintRow>
      <div data-tour="mLabel">
        <HintRow hint={HINTS.m}>
          <Slider label="m" min={3} max={Math.max(12, m + 2)} value={m} onChange={(v) => setM(Math.max(3, v))} editable />
        </HintRow>
      </div>
      <div style={{...styles.modeRow, marginTop: 6}}>
        <button
          onClick={() => { setM(4); setN(2); }}
          style={{...styles.modeBtn, ...((m === 4 && n === 2) ? styles.modeBtnOn : {})}}
        >
          möbius strip
        </button>
      </div>
      <div style={{...styles.toggleRow, flexDirection: 'column'}}>
        <HintRow hint={HINTS.autoRotate} modeButton>
          <Toggle label="auto-rotate" on={autoRotate} onChange={setAutoRotate} />
        </HintRow>
        <HintRow hint={HINTS.ridges} modeButton>
          <Toggle label="ridges" on={showRidges && !cut} onChange={setShowRidges} disabled={cut} />
        </HintRow>
        <HintRow hint={HINTS.gradient} modeButton>
          <Toggle label="gradient" on={gradient} onChange={setGradient} />
        </HintRow>
      </div>
    </>
  );

  const cutControls = (
    <>
      <div style={styles.toggleRow}>
        <HintRow hint={HINTS.cut} modeButton>
          <Toggle label="cut" on={cut} onChange={setCut} accent />
        </HintRow>
      </div>
      {cut && (
        <>
          <div style={{...styles.modeRow, marginTop: 8}}>
            <HintRow hint={HINTS.cutMode_center} modeButton>
              <button onClick={() => setCutMode('center')} style={{...styles.modeBtn, ...(cutMode === 'center' ? styles.modeBtnOn : {})}}>center</button>
            </HintRow>
            <HintRow hint={HINTS.cutMode_parallel} modeButton>
              <button onClick={() => setCutMode('parallel')} style={{...styles.modeBtn, ...(cutMode === 'parallel' ? styles.modeBtnOn : {})}}>parallel</button>
            </HintRow>
            <HintRow hint={HINTS.cutMode_offcenter} modeButton>
              <button onClick={() => setCutMode('offcenter')} style={{...styles.modeBtn, ...(cutMode === 'offcenter' ? styles.modeBtnOn : {})}}>off-center</button>
            </HintRow>
            <HintRow hint={HINTS.cutMode_p2p} modeButton>
              <button onClick={() => setCutMode('p2p')} style={{...styles.modeBtn, ...(cutMode === 'p2p' ? styles.modeBtnOn : {})}}>p→p</button>
            </HintRow>
          </div>
          {cutMode === 'parallel' && (
            <HintRow hint={HINTS.sliceCount}>
              <Slider label="N" min={1} max={5} value={sliceCount} onChange={setSliceCount} suffix={`${sliceCount}`} />
            </HintRow>
          )}
          {cutMode === 'offcenter' && (
            <HintRow hint={HINTS.offsetD}>
              <Slider label="d" min={1} max={95} value={offsetD} onChange={setOffsetD} suffix={`${offsetD}%`} />
            </HintRow>
          )}
          {cutMode === 'p2p' && (
            <>
              <HintRow hint={HINTS.phi1}>
                <Slider label="P₁" min={0} max={359} value={phi1} onChange={setPhi1} suffix={`${phi1}°`} />
              </HintRow>
              <HintRow hint={HINTS.phi2}>
                <Slider label="P₂" min={0} max={359} value={phi2} onChange={setPhi2} suffix={`${phi2}°`} />
              </HintRow>
            </>
          )}
          {cutMode !== 'p2p' && (
            <HintRow hint={HINTS.cutPhi}>
              <Slider label="θ°" min={0}
                max={cutMode === 'center' ? Math.round(180 / cutInfo.K_cuts) : 180}
                value={cutMode === 'center' ? Math.min(cutPhi, Math.round(180 / cutInfo.K_cuts)) : cutPhi}
                onChange={setCutPhi}
                suffix={`${cutMode === 'center' ? Math.min(cutPhi, Math.round(180 / cutInfo.K_cuts)) : cutPhi}°`} />
            </HintRow>
          )}
          <HintRow hint={HINTS.gap}>
            <Slider label="gap" min={0} max={100} value={separation} onChange={setSeparation} suffix={`${separation}%`} />
          </HintRow>
          <HintRow hint={HINTS.seamOpen}>
            <Slider label="open" min={0} max={100} value={seamOpen} onChange={setSeamOpen} suffix={`${seamOpen}%`} />
          </HintRow>
          {cutMode !== 'center' && (
            <>
              <div style={styles.bladeRow}>
                <span style={styles.bladeLabel}>blade</span>
                <HintRow hint={HINTS.bladeShape_straight} modeButton>
                  <button onClick={() => setBladeShape('straight')} style={{...styles.bladeBtn, ...(bladeShape === 'straight' ? styles.bladeBtnOn : {})}}>straight</button>
                </HintRow>
                <HintRow hint={HINTS.bladeShape_curved} modeButton>
                  <button onClick={() => setBladeShape('curved')} style={{...styles.bladeBtn, ...(bladeShape === 'curved' ? styles.bladeBtnOn : {})}}>curved</button>
                </HintRow>
                <HintRow hint={HINTS.bladeShape_zigzag} modeButton>
                  <button onClick={() => setBladeShape('zigzag')} style={{...styles.bladeBtn, ...(bladeShape === 'zigzag' ? styles.bladeBtnOn : {})}}>zig-zag</button>
                </HintRow>
                <HintRow hint={HINTS.bladeShape_custom} modeButton>
                  <button onClick={() => setBladeShape('custom')} style={{...styles.bladeBtn, ...(bladeShape === 'custom' ? styles.bladeBtnOn : {})}}>draw</button>
                </HintRow>
              </div>
              {bladeShape !== 'straight' && (
                <HintRow hint={HINTS.bladeAmount}>
                  <Slider label="amp" min={0} max={100} value={bladeAmount} onChange={setBladeAmount} suffix={`${bladeAmount}%`} />
                </HintRow>
              )}
              {bladeShape === 'custom' && (
                <BladeProfileEditor profile={bladeProfile} setProfile={setBladeProfile} N={PROFILE_N} />
              )}
            </>
          )}
          <div style={styles.toggleRow}>
            <HintRow hint={HINTS.show2D} modeButton>
              <Toggle label="2D view" on={show2D} onChange={setShow2D} />
            </HintRow>
            <HintRow hint={HINTS.hideOthers} modeButton>
              <Toggle label="solo piece" on={hideOthers} onChange={setHideOthers} />
            </HintRow>
          </div>
        </>
      )}
    </>
  );

  const soundControls = (
    <>
      <WaveformDisplay m={m} />
      <HintRow hint={HINTS.pMode}>
        <Slider label="p" min={0} max={8} value={pMode} onChange={setPMode} suffix={`${pMode}`} />
      </HintRow>
      <HintRow hint={HINTS.qMode}>
        <Slider label="q" min={0} max={6} value={qMode} onChange={setQMode} suffix={`${qMode}`} />
      </HintRow>
      <HintRow hint={HINTS.waveFreq}>
        <Slider label="Hz" min={50} max={1500} value={waveFreq} onChange={setWaveFreq} suffix={`${waveFreq}`} />
      </HintRow>
      <HintRow hint={HINTS.waveAmp}>
        <Slider label="amp" min={0} max={100} value={waveAmp} onChange={setWaveAmp} suffix={`${waveAmp}%`} />
      </HintRow>
      <HintRow hint={HINTS.wavePlay} modeButton>
        <button
          onClick={togglePlay}
          style={{
            marginTop: 8, padding: '8px 14px',
            background: wavePlaying
              ? 'linear-gradient(180deg, rgba(122,74,48,0.92), rgba(58,40,32,0.92))'
              : 'transparent',
            border: '1px solid rgba(199,134,89,0.4)',
            borderRadius: 18,
            color: wavePlaying ? '#ffd9b3' : 'rgba(246,239,225,0.65)',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase',
            cursor: 'pointer', width: '100%',
          }}
        >
          {wavePlaying ? '■ Stop' : '▶ Play'}
        </button>
      </HintRow>
    </>
  );

  const saveControls = (
    <SavePopoverContent
      m={m} n={n} pathShape={pathShape} cut={cut}
      stateRef={stateRef}
      currentValueOf={(name) => {
        switch (name) {
          case 'm': return m; case 'n': return n; case 'pathShape': return pathShape;
          case 'circleR': return circleR; case 'ellipseA': return ellipseA; case 'ellipseB': return ellipseB;
          case 'knotR': return knotR; case 'knotr': return knotr; case 'knotP': return knotP; case 'knotQ': return knotQ;
          case 'lemA': return lemA;
          case 'cut': return cut; case 'cutMode': return cutMode;
          case 'sliceCount': return sliceCount; case 'offsetD': return offsetD;
          case 'phi1': return phi1; case 'phi2': return phi2; case 'cutPhi': return cutPhi;
          case 'separation': return separation; case 'seamOpen': return seamOpen;
          case 'bladeShape': return bladeShape; case 'bladeAmount': return bladeAmount;
          case 'show2D': return show2D; case 'hideOthers': return hideOthers;
          case 'autoRotate': return autoRotate; case 'showRidges': return showRidges; case 'gradient': return gradient;
          case 'pMode': return pMode; case 'qMode': return qMode;
          case 'waveFreq': return waveFreq; case 'waveAmp': return waveAmp;
        }
        return undefined;
      }}
      crossSectionProps={{
        m, n, cutMode,
        sliceCount, offsetD, cutPhi,
        phi1, phi2,
        bladeShape, bladeAmount, bladeProfile,
      }}
    />
  );

  return (
    <HoverHintProvider>
    <Tour isMobile={isMobile} drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen}>
    <div style={styles.root}>
      <style>{cssGlobal}</style>
      <header style={styles.header}>
        <div style={styles.eyebrow}>topology · parametric surfaces</div>
        <h1 style={styles.title}>
          Generalized Möbius–Listing Body
          <span style={styles.titleSub}>
            &nbsp;GML<sup style={{fontSize:'0.55em'}}>n</sup><sub style={{fontSize:'0.55em', marginLeft:-4}}>m</sub>
          </span>
        </h1>
      </header>

      <div style={styles.canvasWrap} data-tour="canvas">
        <div ref={mountRef} style={styles.canvas} />
        {cut && show2D && (
          <button
            onClick={() => setFullScreen2D(true)}
            style={styles.overlay2D}
            title="tap to enlarge"
            aria-label="enlarge cross-section view"
          >
            <div style={styles.overlay2DHeader}>
              <span style={styles.overlay2DLabel}>cross-section</span>
              <span style={styles.overlay2DExpand}>⤢</span>
            </div>
            <CrossSection2D m={m} n={n} cutMode={cutMode}
              sliceCount={sliceCount} offsetD={offsetD} cutPhi={cutPhi}
              phi1={phi1} phi2={phi2}
              bladeShape={bladeShape} bladeAmount={bladeAmount} bladeProfile={bladeProfile}
              size={120} highlighted={highlightedPiece} />
          </button>
        )}
      </div>

      {!isMobile && (
        <>
          <MainPalette pos={mainPos} setPos={setMainPos} collapsed={mainCollapsed} setCollapsed={setMainCollapsed}>
            {bodyControls}
          </MainPalette>
          <div style={styles.pillRow} data-tour="pillRow">
            <span ref={cutPillRef}>
              <Pill icon="✂" label="Cut" active={openPopover === 'cut'}
                    onClick={() => setOpenPopover(openPopover === 'cut' ? null : 'cut')} />
            </span>
            <span ref={soundPillRef}>
              <Pill icon="♪" label="Sound" active={openPopover === 'sound'}
                    onClick={() => setOpenPopover(openPopover === 'sound' ? null : 'sound')} />
            </span>
            <span ref={savePillRef}>
              <Pill icon="💾" label="Save" active={openPopover === 'save'}
                    onClick={() => setOpenPopover(openPopover === 'save' ? null : 'save')} />
            </span>
          </div>
          <Popover open={openPopover === 'cut'} anchor={cutPillRef} onClose={() => setOpenPopover(null)} title="✂ Cut">
            {cutControls}
          </Popover>
          <Popover open={openPopover === 'sound'} anchor={soundPillRef} onClose={() => setOpenPopover(null)} title="♪ Sound">
            {soundControls}
          </Popover>
          <Popover open={openPopover === 'save'} anchor={savePillRef} onClose={() => setOpenPopover(null)} title="💾 Save">
            {saveControls}
          </Popover>
        </>
      )}

      {isMobile && (
        <MobileDrawer open={drawerOpen} onToggle={() => setDrawerOpen(!drawerOpen)}>
          <div style={{padding: '6px 4px 10px'}} data-tour="mobileBody">
            {bodyControls}
          </div>
          <div style={styles.mobileSection} data-tour="mobileCutSection">
            <div style={styles.mobileSectionHeader}><span>✂ Cut</span></div>
            {cutControls}
          </div>
          <div style={styles.mobileSection}>
            <div style={styles.mobileSectionHeader}><span>♪ Sound</span></div>
            {soundControls}
          </div>
          <div style={styles.mobileSection}>
            <div style={styles.mobileSectionHeader}><span>💾 Save</span></div>
            {saveControls}
          </div>
          <FirstRunHint mobile />
        </MobileDrawer>
      )}

      <footer style={styles.footer}>
        <span>hover to highlight · click a piece to isolate · scroll/pinch to zoom</span>
      </footer>

      {fullScreen2D && cut && (
        <div style={styles.fullScreenOverlay} onClick={() => setFullScreen2D(false)}>
          <div style={styles.fullScreenInner} onClick={(e) => e.stopPropagation()}>
            <div style={styles.fullScreenHeader}>
              <div>
                <div style={styles.fullScreenEyebrow}>
                  cross-section · GML<sup>{n}</sup><sub style={{marginLeft:-4}}>{m}</sub>
                </div>
                <div style={styles.fullScreenSubtitle}>
                  {cutMode === 'p2p'
                    ? 'drag P1/P2 to reshape the chord · tap a region to highlight'
                    : 'tap a region to highlight its piece'}
                </div>
              </div>
              <button
                onClick={() => setFullScreen2D(false)}
                style={styles.fullScreenClose}
                aria-label="close enlarged view"
              >×</button>
            </div>
            <div style={styles.fullScreenSvg}>
              <CrossSection2D m={m} n={n} cutMode={cutMode}
                sliceCount={sliceCount} offsetD={offsetD} cutPhi={cutPhi}
                phi1={phi1} phi2={phi2}
                bladeShape={bladeShape} bladeAmount={bladeAmount} bladeProfile={bladeProfile}
                size="100%" highlighted={highlightedPiece}
                onSelect={setHighlightedPiece}
                onPhi1Change={setPhi1} onPhi2Change={setPhi2} />
            </div>
            <div style={styles.fullScreenLegend}>
              <PieceDots
                count={
                  cutMode === 'center' ? cutInfo.orbits :
                  cutMode === 'parallel' ? parallelInfo.count :
                  cutMode === 'offcenter' ? (offCenterInfo?.pieceCount ?? 0) :
                  (p2pInfo?.pieceCount ?? 0)
                }
                highlighted={highlightedPiece}
                onSelect={setHighlightedPiece} />
              <span style={{marginLeft: 8, fontFamily:'"JetBrains Mono", monospace', fontSize: 11, color: 'rgba(246,239,225,0.65)'}}>
                {(() => {
                  const c = cutMode === 'center' ? cutInfo.orbits :
                            cutMode === 'parallel' ? parallelInfo.count :
                            cutMode === 'offcenter' ? (offCenterInfo?.pieceCount ?? 0) :
                            (p2pInfo?.pieceCount ?? 0);
                  return c === 1 ? '1 connected piece' : `${c} connected pieces`;
                })()}
              </span>
            </div>
          </div>
        </div>
      )}
      {!isMobile && (
        <InfoStrip
          m={m} n={n}
          cut={cut} cutMode={cutMode}
          cutInfo={cutInfo}
          parallelInfo={parallelInfo}
          offCenterInfo={offCenterInfo}
          p2pInfo={p2pInfo}
          highlightedPiece={highlightedPiece}
          setHighlightedPiece={setHighlightedPiece}
        />
      )}
    </div>
    <HintPopover />
    </Tour>
    </HoverHintProvider>
  );
}

function Slider({ label, min, max, value, onChange, suffix, editable, step = 1 }) {
  const sliderMax = Math.max(max, value);
  const isInt = step >= 1;
  const parse = isInt ? (v) => parseInt(v, 10) : (v) => parseFloat(v);
  return (
    <label style={styles.sliderRow}>
      <span style={styles.sliderLabel}>{label}</span>
      <input type="range" min={min} max={sliderMax} step={step} value={value}
        onChange={(e) => onChange(parse(e.target.value))}
        style={styles.slider} />
      {editable ? (
        <input type="number" min={min} step={step} value={value}
          onChange={(e) => {
            const v = parse(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          onClick={(e) => e.target.select()}
          style={styles.sliderValInput} />
      ) : (
        <span style={styles.sliderVal}>
          {suffix !== undefined ? suffix : String(value).padStart(2, '0')}
        </span>
      )}
    </label>
  );
}

// Clickable colored dots representing each connected piece. Tapping a dot
// highlights that piece and dims the others; tapping the same dot again clears.
// Small SVG that shows one period of the polygon-derived waveform that's
// driving the audio. Updates whenever m changes. The shape itself is the
// timbre — a square-like wave for m=2, a triangle-flavored wave for m=3,
// rounding into a sine as m grows. (See Chapman, ISSBG 2023.)
function WaveformDisplay({ m }) {
  const samples = polygonWaveform(m, 256);
  const N = samples.length;
  const W = 200, H = 36;
  const points = new Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * W;
    const y = H / 2 - samples[i] * (H / 2 - 2);
    points[i] = `${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return (
    <div style={styles.waveformDisplay}>
      <span style={styles.waveformLabel}>polygon n-gon wave</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
           style={{width: '100%', height: 36, display: 'block'}}>
        <line x1={0} y1={H/2} x2={W} y2={H/2}
              stroke="rgba(246,239,225,0.18)" strokeWidth={0.4} strokeDasharray="2 2"/>
        <polyline points={points.join(' ')}
                  fill="none" stroke="#e9a36b" strokeWidth={1.2}
                  strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function PieceDots({ count, highlighted, onSelect }) {
  if (count <= 0) return null;
  return (
    <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
      {Array.from({length: count}).map((_, i) => {
        const color = rgbCss(PIECE_PALETTE[i % PIECE_PALETTE.length].surf);
        const isActive = highlighted === i;
        const isDimmed = highlighted !== null && highlighted !== i;
        return (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(highlighted === i ? null : i);
            }}
            title={isActive ? 'tap to clear highlight' : `highlight piece ${i + 1}`}
            style={{
              width: 14, height: 14, borderRadius: '50%',
              background: color,
              boxShadow: isActive
                ? `0 0 0 2px #f6efe1, 0 0 10px ${color}`
                : `0 0 6px ${color}`,
              opacity: isDimmed ? 0.35 : 1,
              transform: isActive ? 'scale(1.15)' : 'scale(1)',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              transition: 'all 0.16s ease',
              display: 'inline-block',
            }}
          />
        );
      })}
    </span>
  );
}

// Drawing canvas for a custom blade profile. The user drags across the
// canvas to define a curve y(t) that's then used as the blade's bow.
// The curve is auto-symmetrized at use time (in bladePoint) so the cut
// stays consistent across adjacent regions.
function BladeProfileEditor({ profile, setProfile, N }) {
  const drawRef = useRef({ active: false, lastIdx: null, lastY: 0 });

  const eventToProfileCoords = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = -((e.clientY - rect.top) / rect.height * 2 - 1);
    return {
      t: Math.max(0, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
    };
  };

  const onDown = (e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    const { t, y } = eventToProfileCoords(e);
    const idx = Math.round(t * (N - 1));
    setProfile(() => {
      const newP = new Array(N).fill(0);
      newP[idx] = y;
      return newP;
    });
    drawRef.current = { active: true, lastIdx: idx, lastY: y };
  };

  const onMove = (e) => {
    if (!drawRef.current.active) return;
    const { t, y } = eventToProfileCoords(e);
    const idx = Math.round(t * (N - 1));
    const lastIdx = drawRef.current.lastIdx;
    const lastY = drawRef.current.lastY;
    setProfile(prev => {
      const newP = [...prev];
      if (lastIdx === null || lastIdx === idx) {
        newP[idx] = y;
      } else {
        // Linearly fill between the previous and current sample so fast
        // strokes don't leave gaps.
        const step = idx > lastIdx ? 1 : -1;
        const total = Math.abs(idx - lastIdx);
        for (let k = 0; k <= total; k++) {
          const i = lastIdx + step * k;
          const f = total === 0 ? 0 : k / total;
          newP[i] = lastY * (1 - f) + y * f;
        }
      }
      return newP;
    });
    drawRef.current.lastIdx = idx;
    drawRef.current.lastY = y;
  };

  const endDraw = (e) => {
    drawRef.current.active = false;
    drawRef.current.lastIdx = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  const reset = () => setProfile(new Array(N).fill(0));

  // Build SVG polyline: x = t*100, y = 15 - profile[i]*13 (center at y=15).
  const points = profile.map((y, i) => {
    const t = i / (profile.length - 1);
    return `${(t * 100).toFixed(2)},${(15 - y * 13).toFixed(2)}`;
  }).join(' ');

  // Show the symmetrized + tapered version that's actually applied to cuts,
  // so the user sees what they'll get.
  const symPoints = profile.map((_, i) => {
    const t = i / (profile.length - 1);
    const taper = Math.sin(t * Math.PI);
    const yt = sampleProfile(profile, t);
    const y1mt = sampleProfile(profile, 1 - t);
    const yEff = ((yt + y1mt) / 2) * taper;
    return `${(t * 100).toFixed(2)},${(15 - yEff * 13).toFixed(2)}`;
  }).join(' ');

  return (
    <div style={styles.profileWrap}>
      <div style={styles.profileHeader}>
        <span style={styles.profileLabel}>draw a blade shape</span>
        <button onClick={reset} style={styles.profileReset}>reset</button>
      </div>
      <svg
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        style={styles.profileCanvas}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={endDraw}
        onPointerCancel={endDraw}
      >
        <line x1={0} y1={15} x2={100} y2={15}
              stroke="rgba(246,239,225,0.18)"
              strokeWidth={0.4} strokeDasharray="2 2" />
        <line x1={50} y1={2} x2={50} y2={28}
              stroke="rgba(246,239,225,0.08)"
              strokeWidth={0.3} strokeDasharray="1 1.5" />
        <polyline points={points} fill="none"
                  stroke="rgba(246,239,225,0.35)"
                  strokeWidth={0.8} />
        <polyline points={symPoints} fill="none"
                  stroke="#e9a36b"
                  strokeWidth={1.4}
                  strokeLinejoin="round" />
      </svg>
      <div style={styles.profileHint}>
        raw stroke (faded) · symmetrized blade (orange)
      </div>
    </div>
  );
}

// 2D top-down view of the polygon cross-section with all cut chords drawn
// and each region filled in its piece's color. Lets the user see at a glance
// how the body is sliced and which regions go together.
function CrossSection2D({ m, n, cutMode, sliceCount, offsetD, cutPhi, phi1, phi2, bladeShape, bladeAmount, bladeProfile, size, highlighted, onSelect, onPhi1Change, onPhi2Change }) {
  const r = 0.78;
  const polyVerts = getPolygonVertices(m, r);
  const dPhi = (cutPhi / 180) * Math.PI;
  const blade = bladeShape || 'straight';
  const bladeAmt = ((bladeAmount || 0) / 100) * 0.7 * r;
  const profile = bladeProfile || null;
  const editable = cutMode === 'p2p' && (onPhi1Change || onPhi2Change);

  // Drag tracking — which point is being moved (1, 2, or null).
  const [draggingPoint, setDraggingPoint] = useState(null);
  const svgRef = useRef(null);

  const regions = [];
  const chordSegs = [];          // for non-deformed chord rendering
  const bladePolylines = [];     // for deformed chord rendering (one per chord)
  const endpointMarkers = [];

  const collectChordSeg = (chords) => {
    for (const c of chords) {
      const a = [c.d * Math.cos(c.phi) - 2 * Math.sin(c.phi),
                 c.d * Math.sin(c.phi) + 2 * Math.cos(c.phi)];
      const b = [c.d * Math.cos(c.phi) + 2 * Math.sin(c.phi),
                 c.d * Math.sin(c.phi) - 2 * Math.cos(c.phi)];
      chordSegs.push([a, b]);
    }
  };

  // For deformed cuts, build a sampled polyline that runs across the whole
  // polygon along the chord's blade shape (for chord-line rendering only).
  // The line endpoints are the chord's intersections with the polygon.
  const collectBladePolyline = (c) => {
    if (blade === 'straight' || bladeAmt === 0) return;
    // Find intersections of this chord with the polygon boundary.
    const cosP = Math.cos(c.phi), sinP = Math.sin(c.phi);
    const hits = [];
    for (let i = 0; i < polyVerts.length; i++) {
      const a = polyVerts[i], b = polyVerts[(i + 1) % polyVerts.length];
      const da = a[0] * cosP + a[1] * sinP - c.d;
      const db = b[0] * cosP + b[1] * sinP - c.d;
      if (da * db < 0) {
        const t = da / (da - db);
        hits.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      } else if (Math.abs(da) < 1e-6) hits.push(a);
    }
    if (hits.length < 2) return;
    const A = hits[0], B = hits[hits.length - 1];
    const samples = 30;
    const pts = [];
    for (let s = 0; s <= samples; s++) {
      pts.push(bladePoint(A, B, c, blade, bladeAmt, s / samples, profile));
    }
    bladePolylines.push(pts);
  };

  const deformReg = (poly, chords) => deformPolygon(poly, chords, blade, bladeAmt, profile).points;

  if (cutMode === 'p2p') {
    const phi1Rad = (phi1 / 180) * Math.PI;
    const phi2Rad = (phi2 / 180) * Math.PI;
    const chords = pointToPointChords(m, n, phi1Rad, phi2Rad, r);
    if (chords.length > 0) {
      const regMap = findAllRegions(polyVerts, chords);
      const { orbitOf } = computeOrbitsCyclic(regMap, chords.length);
      for (const [pat, poly] of regMap) {
        const oIdx = orbitOf.get(pat);
        regions.push({
          poly: deformReg(poly, chords),
          palette: PIECE_PALETTE[oIdx % PIECE_PALETTE.length],
          orbitIdx: oIdx,
        });
      }
      collectChordSeg(chords);
      chords.forEach(collectBladePolyline);
    } else {
      regions.push({ poly: polyVerts, palette: PIECE_PALETTE[0], orbitIdx: 0 });
    }
    endpointMarkers.push(polygonBoundary(phi1Rad, m, r));
    endpointMarkers.push(polygonBoundary(phi2Rad, m, r));
  } else if (cutMode === 'offcenter') {
    const dVal = (offsetD / 100) * 0.85 * r;
    const chords = offCenterChords(m, n, dPhi, dVal);
    const regMap = findAllRegions(polyVerts, chords);
    const { orbitOf } = computeOrbitsCyclic(regMap, chords.length);
    for (const [pat, poly] of regMap) {
      const oIdx = orbitOf.get(pat);
      regions.push({
        poly: deformReg(poly, chords),
        palette: PIECE_PALETTE[oIdx % PIECE_PALETTE.length],
        orbitIdx: oIdx,
      });
    }
    collectChordSeg(chords);
    chords.forEach(collectBladePolyline);
  } else if (cutMode === 'parallel') {
    const offsets = evenlySpacedCutOffsets(sliceCount, r * 0.78);
    const numStrips = sliceCount + 1;
    const { orbitOf } = getParallelOrbits(m, n, numStrips);
    const parChords = offsets.map(off => ({ phi: dPhi, d: off }));
    for (let j = 0; j < numStrips; j++) {
      const dLeft = j === 0 ? -r * 1.5 : offsets[j - 1];
      const dRight = j === numStrips - 1 ? r * 1.5 : offsets[j];
      const stripPoly = clipPolygonToStrip(polyVerts, dPhi, dLeft, dRight);
      if (stripPoly.length >= 3) {
        const oIdx = orbitOf[j];
        regions.push({
          poly: deformReg(stripPoly, parChords),
          palette: PIECE_PALETTE[oIdx % PIECE_PALETTE.length],
          orbitIdx: oIdx,
        });
      }
    }
    for (const off of offsets) {
      chordSegs.push([
        [off * Math.cos(dPhi) - 2 * Math.sin(dPhi),
         off * Math.sin(dPhi) + 2 * Math.cos(dPhi)],
        [off * Math.cos(dPhi) + 2 * Math.sin(dPhi),
         off * Math.sin(dPhi) - 2 * Math.cos(dPhi)],
      ]);
    }
    parChords.forEach(collectBladePolyline);
  } else {
    // Center mode keeps straight wedge rays — blade shape doesn't apply.
    const { K_cuts, numWedges, orbits } = getCutInfo(m, n);
    const wedgeAngle = Math.PI / K_cuts;
    const Ksamp = 16;
    for (let w = 0; w < numWedges; w++) {
      const phiStart = dPhi + w * wedgeAngle;
      const wedgePoly = [[0, 0]];
      for (let q = 0; q < Ksamp; q++) {
        const phi = phiStart + (q / (Ksamp - 1)) * wedgeAngle;
        wedgePoly.push(polygonBoundary(phi, m, r));
      }
      const oIdx = w % orbits;
      regions.push({ poly: wedgePoly, palette: PIECE_PALETTE[oIdx % PIECE_PALETTE.length], orbitIdx: oIdx });
    }
    for (let j = 0; j < K_cuts; j++) {
      const ang = dPhi + j * wedgeAngle;
      chordSegs.push([
        [-Math.cos(ang) * 2, -Math.sin(ang) * 2],
        [Math.cos(ang) * 2, Math.sin(ang) * 2],
      ]);
    }
  }

  const VB = 200;
  const padding = 16;
  const scale = (VB - 2 * padding) / (2 * r);
  const cx = VB / 2, cy = VB / 2;
  const tx = (u) => cx + u * scale;
  const ty = (v) => cy - v * scale;
  const polyStr = (poly) => poly.map(([u, v]) => `${tx(u).toFixed(2)},${ty(v).toFixed(2)}`).join(' ');

  const clipId = `polyClip_${size}_${m}`;

  const handleRegionClick = (oIdx) => (e) => {
    e.stopPropagation();
    if (onSelect) onSelect(highlighted === oIdx ? null : oIdx);
  };

  // Convert a pointer event to a polygon-frame angle in degrees.
  const pointerToAngle = (e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * VB;
    const py = ((e.clientY - rect.top) / rect.height) * VB;
    const u = (px - cx) / scale;
    const v = -(py - cy) / scale;
    let deg = (Math.atan2(v, u) * 180) / Math.PI;
    return Math.round(((deg % 360) + 360) % 360);
  };

  const startDrag = (which) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingPoint(which);
    if (svgRef.current && e.pointerId !== undefined) {
      try { svgRef.current.setPointerCapture(e.pointerId); } catch (_) {}
    }
  };

  const onPointerMove = (e) => {
    if (!draggingPoint) return;
    const deg = pointerToAngle(e);
    if (deg === null) return;
    if (draggingPoint === 1 && onPhi1Change) onPhi1Change(deg);
    else if (draggingPoint === 2 && onPhi2Change) onPhi2Change(deg);
  };

  const endDrag = (e) => {
    if (draggingPoint && svgRef.current && e.pointerId !== undefined) {
      try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    setDraggingPoint(null);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      style={{display:'block', maxWidth:'100%', maxHeight:'100%',
              touchAction: editable ? 'none' : 'auto'}}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={editable ? onPointerMove : undefined}
      onPointerUp={editable ? endDrag : undefined}
      onPointerCancel={editable ? endDrag : undefined}
    >
      <rect x={0} y={0} width={VB} height={VB} fill="rgba(12,10,9,0.92)" rx={4} />
      <polygon points={polyStr(polyVerts)} fill="rgba(40,30,22,0.5)" stroke="none" />
      {regions.map((reg, i) => {
        const isDimmed = highlighted !== null && highlighted !== reg.orbitIdx;
        const isActive = highlighted === reg.orbitIdx;
        return (
          <polygon
            key={i}
            points={polyStr(reg.poly)}
            fill={rgbCss(reg.palette.surf)}
            fillOpacity={isDimmed ? 0.16 : 1}
            stroke={isActive ? 'rgba(246,239,225,0.95)' : 'rgba(12,10,9,0.5)'}
            strokeWidth={isActive ? 1.4 : 0.6}
            onClick={onSelect ? handleRegionClick(reg.orbitIdx) : undefined}
            style={onSelect ? {cursor: 'pointer'} : undefined}
          />
        );
      })}
      <polygon points={polyStr(polyVerts)}
               fill="none" stroke="rgba(246,239,225,0.55)" strokeWidth={1}
               style={{pointerEvents: 'none'}} />
      {bladePolylines.length === 0 && chordSegs.map(([a, b], i) => (
        <line key={i}
              x1={tx(a[0])} y1={ty(a[1])}
              x2={tx(b[0])} y2={ty(b[1])}
              stroke="rgba(246,239,225,0.6)" strokeWidth={0.8}
              strokeDasharray="2 2"
              clipPath={`url(#${clipId})`}
              style={{pointerEvents: 'none'}} />
      ))}
      {bladePolylines.map((poly, i) => (
        <polyline key={`bp${i}`}
              points={polyStr(poly)}
              fill="none"
              stroke="rgba(246,239,225,0.6)" strokeWidth={0.8}
              strokeDasharray="2 2"
              clipPath={`url(#${clipId})`}
              style={{pointerEvents: 'none'}} />
      ))}
      {endpointMarkers.map((p, i) => {
        const which = i + 1;  // 1 or 2
        const isDragging = draggingPoint === which;
        const grabbable = editable && (which === 1 ? !!onPhi1Change : !!onPhi2Change);
        return (
          <g key={`ep${i}`}>
            {grabbable && (
              <circle cx={tx(p[0])} cy={ty(p[1])} r={9}
                      fill="transparent"
                      onPointerDown={startDrag(which)}
                      style={{cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none'}} />
            )}
            <circle cx={tx(p[0])} cy={ty(p[1])} r={isDragging ? 4.2 : 3.4}
                    fill="#e9a36b" stroke="#0c0a09" strokeWidth={0.9}
                    style={{pointerEvents: 'none'}} />
            <text x={tx(p[0]) + 5} y={ty(p[1]) - 4}
                  fontSize={7}
                  fontFamily='"JetBrains Mono", monospace'
                  fill="#e9a36b"
                  style={{pointerEvents: 'none'}}>
              P{which}
            </text>
          </g>
        );
      })}
      <defs>
        <clipPath id={clipId}>
          <polygon points={polyStr(polyVerts)} />
        </clipPath>
      </defs>
    </svg>
  );
}

function Toggle({ label, on, onChange, disabled, accent }) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      style={{
        ...styles.toggle,
        background: on ? (accent ? 'rgba(233,163,107,0.22)' : 'rgba(199,134,89,0.18)') : 'transparent',
        borderColor: on ? (accent ? '#e9a36b' : '#c78659') : 'rgba(246,239,225,0.18)',
        color: disabled ? 'rgba(246,239,225,0.25)' : (on ? '#f6efe1' : 'rgba(246,239,225,0.55)'),
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: on ? '#e9a36b' : 'rgba(246,239,225,0.25)',
        boxShadow: on ? '0 0 8px #e9a36b' : 'none',
      }} />
      {label}
    </button>
  );
}

const cssGlobal = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; cursor: pointer; }
input[type=range]::-webkit-slider-runnable-track { height: 1px; background: rgba(246,239,225,0.22); }
input[type=range]::-moz-range-track { height: 1px; background: rgba(246,239,225,0.22); }
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: #c78659; border: 2px solid #f6efe1; margin-top: -7px;
  box-shadow: 0 0 12px rgba(199,134,89,0.5);
}
input[type=range]::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: #c78659; border: 2px solid #f6efe1;
  box-shadow: 0 0 12px rgba(199,134,89,0.5);
}
button:disabled { opacity: 0.5; }
button { font-family: inherit; }
input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button {
  -webkit-appearance: none; margin: 0;
}
input[type=number]:focus {
  border-color: rgba(233,163,107,0.5) !important;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
`;

const styles = {
  root: {
    width: '100%', minHeight: '100vh', maxHeight: '100vh',
    background: 'radial-gradient(ellipse at 30% 20%, #1a1310 0%, #0c0a09 55%, #050403 100%)',
    color: '#f6efe1', fontFamily: '"Cormorant Garamond", Georgia, serif',
    display: 'flex', flexDirection: 'column',
    padding: '14px 14px 0', position: 'relative', overflow: 'hidden',
  },
  header: { marginBottom: 6 },
  eyebrow: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
    color: '#c78659', marginBottom: 4,
  },
  title: { fontWeight: 500, fontSize: 22, lineHeight: 1.1, fontStyle: 'italic', letterSpacing: '-0.01em' },
  titleSub: { fontStyle: 'normal', fontWeight: 300, color: '#e9a36b' },
  canvasWrap: {
    position: 'relative',
    flex: '1 1 auto',
    display: 'flex',
    minHeight: 200,
  },
  canvas: {
    flex: '1 1 auto', width: '100%', minHeight: 200,
    borderRadius: 4, overflow: 'hidden',
    border: '1px solid rgba(246,239,225,0.08)',
    background: '#0c0a09', touchAction: 'none', cursor: 'grab',
  },
  overlay2D: {
    position: 'absolute',
    top: 8, right: 8,
    padding: 4,
    border: '1px solid rgba(233,163,107,0.25)',
    borderRadius: 4,
    background: 'rgba(12,10,9,0.6)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    cursor: 'pointer',
    color: '#f6efe1',
    transition: 'border-color 0.18s, background 0.18s',
  },
  overlay2DHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 3, paddingLeft: 2, paddingRight: 2,
  },
  overlay2DLabel: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8, letterSpacing: '0.18em', textTransform: 'uppercase',
    color: '#c78659',
  },
  overlay2DExpand: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 12, color: 'rgba(246,239,225,0.55)',
    lineHeight: 1, marginLeft: 4,
  },
  fullScreenOverlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(5,4,3,0.92)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
    zIndex: 50,
    animation: 'fadeIn 0.22s ease',
  },
  fullScreenInner: {
    background: 'linear-gradient(160deg, rgba(26,19,16,0.95), rgba(12,10,9,0.95))',
    border: '1px solid rgba(233,163,107,0.22)',
    borderRadius: 6,
    padding: 16,
    width: '100%', maxWidth: 560,
    display: 'flex', flexDirection: 'column',
    gap: 12,
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  fullScreenHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    gap: 12,
  },
  fullScreenEyebrow: {
    fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic',
    fontSize: 18, color: '#f6efe1', lineHeight: 1.2,
  },
  fullScreenSubtitle: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: 'rgba(246,239,225,0.45)',
    marginTop: 4,
  },
  fullScreenClose: {
    width: 32, height: 32,
    borderRadius: 16,
    border: '1px solid rgba(246,239,225,0.18)',
    background: 'transparent',
    color: '#f6efe1',
    fontFamily: 'serif',
    fontSize: 22, lineHeight: 1, padding: 0,
    cursor: 'pointer',
    flexShrink: 0,
  },
  fullScreenSvg: {
    width: '100%',
    aspectRatio: '1 / 1',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  fullScreenLegend: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    paddingTop: 6,
    borderTop: '1px solid rgba(246,239,225,0.08)',
  },
  drawer: {
    flexShrink: 0,
    overflow: 'hidden',
    transition: 'max-height 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
    background: 'linear-gradient(to top, rgba(20,16,14,0.92), rgba(12,10,9,0.85))',
    borderTop: '1px solid rgba(246,239,225,0.1)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    margin: '8px -14px 0',
    padding: '0 14px',
  },
  drawerHandle: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    width: '100%',
    padding: '6px 0 4px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    gap: 2,
  },
  drawerHandleBar: {
    width: 36, height: 3,
    borderRadius: 2,
    background: 'rgba(233,163,107,0.6)',
  },
  drawerHandleLabel: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: 'rgba(246,239,225,0.4)',
    marginTop: 2,
  },
  drawerContent: {
    paddingBottom: 12,
    overflowY: 'auto',
    maxHeight: 'calc(70vh - 38px)',
  },
  sliderRow: { display: 'grid', gridTemplateColumns: '32px 1fr 68px', alignItems: 'center', gap: 14 },
  sliderLabel: { fontFamily: '"Cormorant Garamond", serif', fontStyle: 'italic', fontSize: 18, color: '#e9a36b' },
  slider: { width: '100%' },
  sliderVal: { fontFamily: '"JetBrains Mono", monospace', fontSize: 12, color: '#f6efe1', textAlign: 'right' },
  sliderValInput: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 12, color: '#f6efe1', textAlign: 'right',
    background: 'rgba(246,239,225,0.04)',
    border: '1px solid rgba(246,239,225,0.18)',
    borderRadius: 2,
    padding: '4px 6px',
    width: '100%',
    outline: 'none',
    appearance: 'textfield',
    MozAppearance: 'textfield',
  },
  toggleRow: { display: 'flex', gap: 8, marginTop: 4 },
  toggle: {
    flex: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '10px 8px',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
    border: '1px solid rgba(246,239,225,0.18)',
    background: 'transparent', color: 'rgba(246,239,225,0.55)',
    borderRadius: 2, transition: 'all 0.2s ease',
  },
  palette: {
    position: 'fixed',
    background: 'linear-gradient(180deg, rgba(28,21,18,0.96), rgba(20,15,12,0.96))',
    border: '1px solid rgba(199,134,89,0.28)',
    borderRadius: 10,
    padding: '12px 14px 14px',
    width: 220,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    color: '#f6efe1',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,180,120,0.08)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    zIndex: 10,
    userSelect: 'none',
  },
  paletteHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 9, letterSpacing: '0.18em', color: '#c78659', textTransform: 'uppercase',
    borderBottom: '1px solid rgba(246,239,225,0.08)',
    paddingBottom: 8, marginBottom: 10,
  },
  paletteHeaderTitle: { cursor: 'pointer' },
  paletteHeaderHandle: { color: 'rgba(246,239,225,0.35)', cursor: 'grab', fontSize: 13, lineHeight: 1 },
  paletteHeaderClose: {
    background: 'transparent', border: 'none', color: 'rgba(246,239,225,0.55)',
    cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 6,
  },
  palettePill: {
    background: 'rgba(20,16,14,0.92)',
    border: '1px solid rgba(199,134,89,0.28)',
    borderRadius: 18,
    padding: '8px 14px',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    letterSpacing: '0.15em',
    color: 'rgba(246,239,225,0.65)',
    cursor: 'pointer',
    textTransform: 'uppercase',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
  },
  palettePillOn: {
    background: 'linear-gradient(180deg, rgba(122,74,48,0.92), rgba(58,40,32,0.92))',
    borderColor: 'rgba(255,217,179,0.5)',
    color: '#ffd9b3',
  },
  pillRow: {
    position: 'fixed',
    bottom: 18, right: 18,
    display: 'flex', gap: 8,
    zIndex: 10,
  },
  infoStrip: {
    position: 'fixed',
    bottom: 18, left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(20,16,14,0.92)',
    border: '1px solid rgba(199,134,89,0.28)',
    borderRadius: 14,
    padding: '6px 14px',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    letterSpacing: '0.15em',
    color: 'rgba(246,239,225,0.65)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    maxWidth: 'calc(100vw - 320px)',
    zIndex: 10,
    pointerEvents: 'auto',
  },
  popover: {
    position: 'fixed',
    background: 'linear-gradient(180deg, rgba(28,21,18,0.96), rgba(20,15,12,0.96))',
    border: '1px solid rgba(199,134,89,0.28)',
    borderRadius: 10,
    padding: '12px 14px 14px',
    width: 260,
    maxHeight: '70vh',
    overflowY: 'auto',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    color: '#f6efe1',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,180,120,0.08)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    zIndex: 20,
  },
  hintPopover: {
    position: 'fixed',
    background: 'linear-gradient(180deg, rgba(28,21,18,0.96), rgba(20,15,12,0.96))',
    border: '1px solid rgba(199,134,89,0.28)',
    borderRadius: 8,
    padding: 12,
    maxWidth: 240,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    lineHeight: 1.45,
    color: '#e8a673',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,180,120,0.08)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    zIndex: 30,
    pointerEvents: 'none',
  },
  hintPopoverTitle: {
    fontSize: 10,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: '#c78659',
    marginBottom: 6,
  },
  hintPopoverBody: {
    color: '#e8a673',
  },
  hintPopoverFormula: {
    marginTop: 6,
    fontSize: 9,
    color: '#9a7058',
    fontStyle: 'italic',
  },
  firstRunHint: {
    marginTop: 8,
    fontSize: 9,
    fontStyle: 'italic',
    color: 'rgba(246,239,225,0.35)',
    textAlign: 'center',
    letterSpacing: '0.05em',
    transition: 'opacity 200ms ease',
  },
  tourCard: {
    position: 'fixed',
    bottom: 86,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 340,
    background: 'linear-gradient(180deg, rgba(28,21,18,0.96), rgba(20,15,12,0.96))',
    border: '1px solid rgba(199,134,89,0.28)',
    borderRadius: 10,
    padding: 16,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    color: '#f6efe1',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,180,120,0.08)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    zIndex: 32,
  },
  tourCardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 9, letterSpacing: '0.18em', color: 'rgba(246,239,225,0.45)',
    textTransform: 'uppercase', marginBottom: 10,
  },
  tourCardTitle: {
    fontSize: 10, letterSpacing: '0.18em', color: '#c78659',
    textTransform: 'uppercase', marginBottom: 6,
  },
  tourCardBody: {
    color: '#e8a673', lineHeight: 1.55,
  },
  tourCardDiagram: {
    marginTop: 10, display: 'flex', justifyContent: 'center',
    height: 120,
  },
  tourCardFooter: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 14, gap: 8,
  },
  tourBtn: {
    background: 'rgba(20,16,14,0.92)',
    border: '1px solid rgba(199,134,89,0.28)',
    borderRadius: 18,
    padding: '6px 14px',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10, letterSpacing: '0.15em',
    color: 'rgba(246,239,225,0.7)',
    cursor: 'pointer',
    textTransform: 'uppercase',
  },
  tourBtnPrimary: {
    background: 'linear-gradient(180deg, rgba(122,74,48,0.92), rgba(58,40,32,0.92))',
    borderColor: 'rgba(255,217,179,0.5)',
    color: '#ffd9b3',
  },
  tourBtnSkip: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(246,239,225,0.45)',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10, letterSpacing: '0.12em',
    cursor: 'pointer', padding: 0,
    textTransform: 'lowercase',
  },
  tourClose: {
    background: 'transparent', border: 'none',
    color: 'rgba(246,239,225,0.55)',
    fontSize: 16, lineHeight: 1, padding: 0, cursor: 'pointer',
  },
  tourLauncher: {
    background: 'rgba(20,16,14,0.92)',
    border: '1px solid rgba(199,134,89,0.4)',
    borderRadius: 50,
    width: 18, height: 18,
    display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center',
    color: '#c78659',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11, lineHeight: 1,
    padding: 0,
    cursor: 'pointer',
    transition: 'all 0.18s ease',
  },
  tourNudge: {
    position: 'absolute',
    fontSize: 9, fontStyle: 'italic',
    color: 'rgba(246,239,225,0.45)',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    transition: 'opacity 200ms ease',
  },
  saveGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginTop: 4,
  },
  saveBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    gap: 2,
    background: 'rgba(20,16,14,0.92)',
    border: '1px solid rgba(199,134,89,0.28)',
    borderRadius: 8,
    padding: '10px 12px',
    cursor: 'pointer',
    fontFamily: '"JetBrains Mono", monospace',
    transition: 'all 0.18s ease',
    textAlign: 'left',
  },
  saveBtnLabel: {
    fontSize: 11, letterSpacing: '0.15em',
    color: '#c78659', textTransform: 'uppercase',
  },
  saveBtnDesc: {
    fontSize: 9, color: 'rgba(246,239,225,0.5)',
    letterSpacing: '0.04em',
  },
  mobileSection: {
    borderTop: '1px solid rgba(246,239,225,0.06)',
    paddingTop: 10, marginTop: 10,
  },
  mobileSectionHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 9, letterSpacing: '0.18em', color: '#c78659', textTransform: 'uppercase',
    cursor: 'pointer', marginBottom: 8,
  },
  modeRow: { display: 'flex', gap: 4, marginBottom: 2 },
  modeBtn: {
    flex: 1,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
    padding: '8px 2px',
    background: 'transparent',
    border: '1px solid rgba(246,239,225,0.18)',
    color: 'rgba(246,239,225,0.55)',
    borderRadius: 2,
    cursor: 'pointer',
    transition: 'all 0.18s ease',
    whiteSpace: 'nowrap',
  },
  bladeRow: {
    display: 'flex', gap: 4, alignItems: 'center', marginTop: 2,
  },
  bladeLabel: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
    color: '#c78659', minWidth: 36,
  },
  bladeBtn: {
    flex: 1,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
    padding: '6px 2px',
    background: 'transparent',
    border: '1px solid rgba(246,239,225,0.18)',
    color: 'rgba(246,239,225,0.55)',
    borderRadius: 2,
    cursor: 'pointer',
    transition: 'all 0.18s ease',
    whiteSpace: 'nowrap',
  },
  bladeBtnOn: {
    color: '#f6efe1',
    borderColor: 'rgba(233,163,107,0.55)',
    background: 'rgba(233,163,107,0.1)',
  },
  profileWrap: {
    display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2,
  },
  profileHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  profileLabel: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
    color: '#c78659',
  },
  profileReset: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
    padding: '3px 10px',
    background: 'transparent',
    border: '1px solid rgba(246,239,225,0.18)',
    color: 'rgba(246,239,225,0.55)',
    borderRadius: 2,
    cursor: 'pointer',
  },
  profileCanvas: {
    width: '100%',
    height: 90,
    background: 'rgba(12,10,9,0.6)',
    border: '1px solid rgba(233,163,107,0.18)',
    borderRadius: 3,
    touchAction: 'none',
    cursor: 'crosshair',
  },
  profileHint: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 8, letterSpacing: '0.08em',
    color: 'rgba(246,239,225,0.35)',
    textAlign: 'center',
  },
  modeBtnOn: {
    background: 'rgba(233,163,107,0.18)',
    borderColor: '#e9a36b',
    color: '#f6efe1',
  },
  waveformDisplay: {
    display: 'flex', flexDirection: 'column', gap: 4,
    padding: '6px 8px',
    border: '1px solid rgba(233,163,107,0.18)',
    borderRadius: 3,
    background: 'rgba(12,10,9,0.6)',
    marginBottom: 4,
  },
  waveformLabel: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
    color: '#c78659',
  },
  footer: {
    marginTop: 12, paddingTop: 10,
    borderTop: '1px solid rgba(246,239,225,0.06)',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9, color: 'rgba(246,239,225,0.35)',
    letterSpacing: '0.05em', textAlign: 'center',
  },
};
