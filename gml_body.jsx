import React, { useRef, useEffect, useState } from 'react';
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
  // Bernoulli-style figure-eight in the xy-plane. Self-crosses at the origin.
  // Note: passes through origin twice per period; tangent direction reverses
  // abruptly there, but RMF handles this gracefully via continuous transport.
  const a = params.a;
  const s = Math.sin(theta), c = Math.cos(theta);
  const denom = 1 + s * s;
  return [a * c / denom, a * s * c / denom, 0];
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
      return { Cfn: pathLemniscate, params: { a: params.a }, period: 2 * Math.PI };
    case 'torusKnot':
      return { Cfn: pathTorusKnot, params: { P: params.P, Q: params.Q, R: params.R, rp: params.rp }, period: 2 * Math.PI };
    case 'circle':
    default:
      return { Cfn: pathCircle, params: { R: params.R }, period: 2 * Math.PI };
  }
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

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }
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

export default function GMLBody() {
  const mountRef = useRef(null);
  const stateRef = useRef({});
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
  const [knotr, setKnotr] = useState(0.6);
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
  const [show2D, setShow2D] = useState(true);
  const [highlightedPiece, setHighlightedPiece] = useState(null);
  const [hideOthers, setHideOthers] = useState(false);
  const [fullScreen2D, setFullScreen2D] = useState(false);
  const highlightRef = useRef(null);
  const hideOthersRef = useRef(false);
  highlightRef.current = highlightedPiece;
  hideOthersRef.current = hideOthers;

  // --- Sound tab state ----------------------------------------------------
  const [tab, setTab] = useState('geometry');  // 'geometry' | 'sound'
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

    const renderer = new THREE.WebGLRenderer({ antialias: true });
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
    const soundMode = tab === 'sound';
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
  }, [tab, m, n, showRidges, cut, cutMode, sliceCount, offsetD, cutPhi, separation, seamOpen, phi1, phi2, bladeShape, bladeAmount, bladeProfile, gradient, pathShape, circleR, ellipseA, ellipseB, knotR, knotr, knotP, knotQ, lemA]);

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
  // When leaving the sound tab, fade audio out.
  useEffect(() => {
    if (tab !== 'sound' && wavePlaying) {
      togglePlay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const note = (() => {
    if (m === 2 && n % 2 === 1) return 'Classical Möbius strip · single-sided';
    if (n === 0) return 'Untwisted polygonal torus';
    const g = gcd(n, m);
    if (g === 1) return 'Single connected ridge';
    return `${g} disjoint ridge cycles`;
  })();

  return (
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

      <div style={styles.canvasWrap}>
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

      <div style={{
        ...styles.drawer,
        maxHeight: drawerOpen ? '70vh' : 38,
      }}>
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          style={styles.drawerHandle}
          aria-label={drawerOpen ? 'collapse controls' : 'expand controls'}
        >
          <div style={styles.drawerHandleBar} />
          <span style={styles.drawerHandleLabel}>
            {drawerOpen ? 'tap to collapse' : 'tap to expand controls'}
          </span>
        </button>

        <div style={styles.drawerContent}>
          <div style={styles.tabRow}>
            <button
              onClick={() => setTab('geometry')}
              style={{...styles.tabBtn, ...(tab === 'geometry' ? styles.tabBtnOn : {})}}>
              geometry
            </button>
            <button
              onClick={() => setTab('sound')}
              style={{...styles.tabBtn, ...(tab === 'sound' ? styles.tabBtnOn : {})}}>
              sound
            </button>
          </div>

          <div style={styles.readout}>
            <div style={styles.param}>
              <span style={styles.paramLabel}>m</span>
              <span style={styles.paramVal}>{m}</span>
              <span style={styles.paramHint}>sides</span>
            </div>
            <div style={styles.param}>
              <span style={styles.paramLabel}>n</span>
              <span style={styles.paramVal}>{n}</span>
              <span style={styles.paramHint}>twist</span>
            </div>
            <div style={styles.param}>
              <span style={styles.paramLabel}>τ</span>
              <span style={styles.paramVal}>{(n/m).toFixed(3)}·2π</span>
              <span style={styles.paramHint}>per loop</span>
            </div>
          </div>

          {tab === 'geometry' && (
          <div style={styles.note}>
            {!cut ? note : cutMode === 'center' ? (
              <span style={{display:'inline-flex', alignItems:'center', gap:8, flexWrap:'wrap', justifyContent:'center'}}>
                <span>{cutInfo.K_cuts === 1 ? '1 chord cut' : `${cutInfo.K_cuts} chord cuts`}</span>
                <span style={{opacity:0.5}}>·</span>
                <span>{cutInfo.numWedges} wedges</span>
                <span style={{opacity:0.5}}>·</span>
                <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
                  <PieceDots count={cutInfo.orbits} highlighted={highlightedPiece} onSelect={setHighlightedPiece} />
                  <span style={{marginLeft:2}}>
                    {cutInfo.orbits === 1 ? '1 piece' : `${cutInfo.orbits} pieces`}
                  </span>
                </span>
              </span>
            ) : cutMode === 'parallel' ? (
              <span style={{display:'inline-flex', alignItems:'center', gap:8, flexWrap:'wrap', justifyContent:'center'}}>
                <span>{`${sliceCount} parallel ${sliceCount === 1 ? 'cut' : 'cuts'}`}</span>
                <span style={{opacity:0.5}}>·</span>
                <span>{`${sliceCount + 1} strips`}</span>
                <span style={{opacity:0.5}}>·</span>
                <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
                  <PieceDots count={parallelInfo.count} highlighted={highlightedPiece} onSelect={setHighlightedPiece} />
                  <span style={{marginLeft:2}}>
                    {parallelInfo.count === 1 ? '1 piece' : `${parallelInfo.count} pieces`}
                  </span>
                </span>
                {!parallelInfo.closes && (
                  <span style={{color:'#e88', opacity:0.85, fontSize:10, marginLeft:4}}>
                    ⚠ open seam
                  </span>
                )}
              </span>
            ) : cutMode === 'offcenter' ? (
              <span style={{display:'inline-flex', alignItems:'center', gap:8, flexWrap:'wrap', justifyContent:'center'}}>
                <span>{`${offCenterInfo?.chordCount ?? 0} ${(offCenterInfo?.chordCount ?? 0) === 1 ? 'chord' : 'chords'}`}</span>
                <span style={{opacity:0.5}}>·</span>
                <span>{`${offCenterInfo?.regionCount ?? 0} regions`}</span>
                <span style={{opacity:0.5}}>·</span>
                <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
                  <PieceDots count={offCenterInfo?.pieceCount ?? 0} highlighted={highlightedPiece} onSelect={setHighlightedPiece} />
                  <span style={{marginLeft:2}}>
                    {(offCenterInfo?.pieceCount ?? 0) === 1 ? '1 piece' : `${offCenterInfo?.pieceCount ?? 0} pieces`}
                  </span>
                </span>
              </span>
            ) : (
              <span style={{display:'inline-flex', alignItems:'center', gap:8, flexWrap:'wrap', justifyContent:'center'}}>
                <span>{`${p2pInfo?.chordCount ?? 0} ${(p2pInfo?.chordCount ?? 0) === 1 ? 'chord' : 'chords'}`}</span>
                <span style={{opacity:0.5}}>·</span>
                <span>{`${p2pInfo?.regionCount ?? 0} regions`}</span>
                <span style={{opacity:0.5}}>·</span>
                <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
                  <PieceDots count={p2pInfo?.pieceCount ?? 0} highlighted={highlightedPiece} onSelect={setHighlightedPiece} />
                  <span style={{marginLeft:2}}>
                    {(p2pInfo?.pieceCount ?? 0) === 1 ? '1 piece' : `${p2pInfo?.pieceCount ?? 0} pieces`}
                  </span>
                </span>
              </span>
            )}
          </div>
          )}

          <div style={styles.controls}>
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
              <Slider label="R" min={0.5} max={5} value={circleR}
                onChange={setCircleR} editable />
            )}
            {pathShape === 'ellipse' && (
              <>
                <Slider label="a" min={0.5} max={5} value={ellipseA}
                  onChange={setEllipseA} editable />
                <Slider label="b" min={0.5} max={5} value={ellipseB}
                  onChange={setEllipseB} editable />
              </>
            )}
            {pathShape === 'torusKnot' && (
              <>
                <Slider label="R" min={0.5} max={5} value={knotR}
                  onChange={setKnotR} editable />
                <Slider label="r" min={0.1} max={2} value={knotr}
                  onChange={setKnotr} editable />
                <Slider label="p" min={1} max={9} value={knotP}
                  onChange={setKnotP} editable />
                <Slider label="q" min={1} max={9} value={knotQ}
                  onChange={setKnotQ} editable />
              </>
            )}
            {pathShape === 'lemniscate' && (
              <Slider label="a" min={0.5} max={5} value={lemA}
                onChange={setLemA} editable />
            )}
            <Slider label="n" min={0} max={Math.max(12, m * 2, n + 2)} value={n}
              onChange={(v) => setN(Math.max(0, v))} editable />
            <Slider label="m" min={2} max={Math.max(12, m + 2)} value={m}
              onChange={(v) => setM(Math.max(2, v))} editable />

            <div style={styles.toggleRow}>
              <Toggle label="auto-rotate" on={autoRotate} onChange={setAutoRotate} />
              {tab === 'geometry' && (
                <>
                  <Toggle label="ridges" on={showRidges && !cut} onChange={setShowRidges} disabled={cut} />
                  <Toggle label="gradient" on={gradient} onChange={setGradient} />
                </>
              )}
              {tab === 'sound' && (
                <Toggle label={wavePlaying ? 'sound on' : 'sound off'}
                        on={wavePlaying} onChange={togglePlay} accent />
              )}
              <Toggle label="cut" on={cut} onChange={setCut} accent />
            </div>

            {tab === 'sound' && (
              <div style={styles.cutPanel}>
                <WaveformDisplay m={m} />
                <Slider label="p" min={0} max={8} value={pMode}
                  onChange={setPMode} suffix={`${pMode}`} />
                <Slider label="q" min={0} max={6} value={qMode}
                  onChange={setQMode} suffix={`${qMode}`} />
                <Slider label="Hz" min={50} max={1500} value={waveFreq}
                  onChange={setWaveFreq} suffix={`${waveFreq}`} />
                <Slider label="amp" min={0} max={100} value={waveAmp}
                  onChange={setWaveAmp} suffix={`${waveAmp}%`} />
                <div style={styles.soundHint}>
                  n-gon wave from m={m}-gon · timbre tracks the cross-section
                </div>
              </div>
            )}

            {cut && (
              <div style={styles.cutPanel}>
                <div style={styles.modeRow}>
                  <button
                    onClick={() => setCutMode('center')}
                    style={{...styles.modeBtn, ...(cutMode === 'center' ? styles.modeBtnOn : {})}}>
                    center
                  </button>
                  <button
                    onClick={() => setCutMode('parallel')}
                    style={{...styles.modeBtn, ...(cutMode === 'parallel' ? styles.modeBtnOn : {})}}>
                    parallel
                  </button>
                  <button
                    onClick={() => setCutMode('offcenter')}
                    style={{...styles.modeBtn, ...(cutMode === 'offcenter' ? styles.modeBtnOn : {})}}>
                    off-center
                  </button>
                  <button
                    onClick={() => setCutMode('p2p')}
                    style={{...styles.modeBtn, ...(cutMode === 'p2p' ? styles.modeBtnOn : {})}}>
                    p→p
                  </button>
                </div>
                {cutMode === 'parallel' && (
                  <Slider label="N" min={1} max={5} value={sliceCount}
                    onChange={setSliceCount} suffix={`${sliceCount}`} />
                )}
                {cutMode === 'offcenter' && (
                  <Slider label="d" min={1} max={95} value={offsetD}
                    onChange={setOffsetD} suffix={`${offsetD}%`} />
                )}
                {cutMode === 'p2p' && (
                  <>
                    <Slider label="P₁" min={0} max={359} value={phi1}
                      onChange={setPhi1} suffix={`${phi1}°`} />
                    <Slider label="P₂" min={0} max={359} value={phi2}
                      onChange={setPhi2} suffix={`${phi2}°`} />
                  </>
                )}
                {cutMode !== 'p2p' && (
                  <Slider label="θ°" min={0}
                    max={cutMode === 'center' ? Math.round(180 / cutInfo.K_cuts) : 180}
                    value={cutMode === 'center'
                      ? Math.min(cutPhi, Math.round(180 / cutInfo.K_cuts))
                      : cutPhi}
                    onChange={setCutPhi}
                    suffix={`${cutMode === 'center'
                      ? Math.min(cutPhi, Math.round(180 / cutInfo.K_cuts))
                      : cutPhi}°`} />
                )}
                <Slider label="gap" min={0} max={100} value={separation}
                  onChange={setSeparation} suffix={`${separation}%`} />
                <Slider label="open" min={0} max={100} value={seamOpen}
                  onChange={setSeamOpen} suffix={`${seamOpen}%`} />
                {cutMode !== 'center' && (
                  <>
                    <div style={styles.bladeRow}>
                      <span style={styles.bladeLabel}>blade</span>
                      <button
                        onClick={() => setBladeShape('straight')}
                        style={{...styles.bladeBtn, ...(bladeShape === 'straight' ? styles.bladeBtnOn : {})}}>
                        straight
                      </button>
                      <button
                        onClick={() => setBladeShape('curved')}
                        style={{...styles.bladeBtn, ...(bladeShape === 'curved' ? styles.bladeBtnOn : {})}}>
                        curved
                      </button>
                      <button
                        onClick={() => setBladeShape('zigzag')}
                        style={{...styles.bladeBtn, ...(bladeShape === 'zigzag' ? styles.bladeBtnOn : {})}}>
                        zig-zag
                      </button>
                      <button
                        onClick={() => setBladeShape('custom')}
                        style={{...styles.bladeBtn, ...(bladeShape === 'custom' ? styles.bladeBtnOn : {})}}>
                        draw
                      </button>
                    </div>
                    {bladeShape !== 'straight' && (
                      <Slider label="amp" min={0} max={100} value={bladeAmount}
                        onChange={setBladeAmount} suffix={`${bladeAmount}%`} />
                    )}
                    {bladeShape === 'custom' && (
                      <BladeProfileEditor
                        profile={bladeProfile}
                        setProfile={setBladeProfile}
                        N={PROFILE_N}
                      />
                    )}
                  </>
                )}
                <div style={styles.toggleRow}>
                  <Toggle label="2D view" on={show2D} onChange={setShow2D} />
                  <Toggle label="solo piece" on={hideOthers} onChange={setHideOthers} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer style={styles.footer}>
        {tab === 'geometry'
          ? <span>hover to highlight · click a piece to isolate · scroll/pinch to zoom</span>
          : <span>polygon-derived n-gon waves · timbre changes with m · cuts overlay</span>}
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
    </div>
  );
}

function Slider({ label, min, max, value, onChange, suffix, editable }) {
  const sliderMax = Math.max(max, value);
  return (
    <label style={styles.sliderRow}>
      <span style={styles.sliderLabel}>{label}</span>
      <input type="range" min={min} max={sliderMax} step={1} value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={styles.slider} />
      {editable ? (
        <input type="number" min={min} value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
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
  readout: {
    display: 'flex', justifyContent: 'space-between',
    padding: '14px 4px 4px',
    fontFamily: '"JetBrains Mono", monospace',
    borderBottom: '1px solid rgba(246,239,225,0.08)', marginBottom: 12,
  },
  param: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  paramLabel: { fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(246,239,225,0.5)' },
  paramVal: { fontSize: 16, fontWeight: 500, color: '#f6efe1' },
  paramHint: { fontSize: 9, color: 'rgba(246,239,225,0.35)' },
  note: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11, color: '#e9a36b',
    padding: '6px 10px',
    background: 'rgba(199,134,89,0.06)',
    border: '1px solid rgba(199,134,89,0.18)',
    borderRadius: 3, marginBottom: 14, textAlign: 'center',
  },
  controls: { display: 'flex', flexDirection: 'column', gap: 12 },
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
  cutPanel: {
    display: 'flex', flexDirection: 'column', gap: 10,
    padding: '12px 12px',
    background: 'rgba(233,163,107,0.05)',
    border: '1px solid rgba(233,163,107,0.18)',
    borderRadius: 3, marginTop: 4,
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
  tabRow: {
    display: 'flex', gap: 6, marginBottom: 12,
  },
  tabBtn: {
    flex: 1,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
    padding: '10px 0',
    background: 'transparent',
    border: '1px solid rgba(246,239,225,0.16)',
    color: 'rgba(246,239,225,0.55)',
    borderRadius: 3,
    cursor: 'pointer',
    transition: 'all 0.18s ease',
  },
  tabBtnOn: {
    background: 'linear-gradient(180deg, rgba(233,163,107,0.18), rgba(199,134,89,0.10))',
    borderColor: '#e9a36b',
    color: '#f6efe1',
  },
  soundHint: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 9, letterSpacing: '0.04em',
    color: 'rgba(246,239,225,0.42)',
    textAlign: 'center', marginTop: 8,
    fontStyle: 'italic',
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
