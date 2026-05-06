# Intro / Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 7-step intro/walkthrough described in the spec — 3 intro steps with inline SVG diagrams explaining the GML body, then 4 walkthrough steps with connector lines pointing at real controls. Single floating card, non-blocking, auto-starts once per browser, replayable from a `?` icon.

**Architecture:** Top-level `<Tour>` component owns `tourOpen` / `tourStep` / `priorDrawerOpenRef` state, hydrates `localStorage['gml.tour.seen']`, and renders a `<TourCard>` (the morphing UI card) plus a `<TourConnector>` (a fixed-position SVG overlay). A small `<TourLauncher>` (`?` icon) lives in the palette and drawer headers and is wired into `<Tour>` via a `TourContext`. Step data is a single `TOUR_STEPS` array at module top. Existing components (`MainPalette`, `MobileDrawer`, `HintRow`, the 3D canvas) are not modified internally — only the JSX call sites add `data-tour="<id>"` attributes that `<TourConnector>` resolves at draw time.

**Tech Stack:** React 18 (CDN), Babel Standalone in-browser transpile, `ReactDOM.createPortal`, no build step, no test runner. Two-file mirror discipline: every change in `index.html` is mirrored byte-identically into `gml_body.jsx`. Manual browser verification only.

**Spec:** `docs/superpowers/specs/2026-05-06-intro-walkthrough-design.md`

**Two-file mirror reminder:** After every code change in `index.html`, perform the same edit in `gml_body.jsx`. The diff between the two files must remain confined to the imports/destructure at the top and the `export default` on `GMLBody`, exactly as `CLAUDE.md` describes.

**Serving for verification:** From repo root, run `python3 -m http.server 8000` once, then refresh `http://localhost:8000/` after each task to verify.

---

## File Structure

| File | Role | New / Modified |
|---|---|---|
| `index.html` | Runtime artifact. All component definitions, styles, render. | Modified |
| `gml_body.jsx` | Editor-only mirror. | Modified (mirrored) |

**No new files.** Everything lives inside the existing `<script type="text/babel">` block of `index.html`. New code is grouped:

- `TOUR_STEPS` constant near `HINTS` (top of script block, around line 1200).
- `TourContext` constant alongside `HoverHintContext`.
- Components `Tour`, `TourCard`, `TourConnector`, `TourLauncher`, `TourNudge`, `TorusMini`, `MnMini`, `CutMini` — defined after `FirstRunHint` (around line 1497) and before `GMLBody` (which starts at line ~1539).
- New style keys in the `styles` object: `tourCard`, `tourCardHeader`, `tourCardTitle`, `tourCardBody`, `tourCardDiagram`, `tourCardFooter`, `tourBtn`, `tourBtnPrimary`, `tourBtnSkip`, `tourClose`, `tourLauncher`, `tourNudge`.
- Six `data-tour="<id>"` attributes added at four desktop call sites + two mobile call sites in `GMLBody`'s JSX.
- Mount of `<Tour>` and `<TourLauncher>` and `<TourNudge>` inside `GMLBody`'s return JSX.

---

## Task 1: Add `TOUR_STEPS` data array and `TourContext`

**Files:**
- Modify: `index.html` (insert near `HINTS` and `HoverHintContext`, around lines 1198–1255)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** The static step data and an empty React context. No UI yet.

- [ ] **Step 1: Insert `TOUR_STEPS` immediately before `const HINTS = {`**

In `index.html`, insert this block right before the existing `const HINTS = { ... }` declaration:

```js
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
```

Mirror the same insertion in `gml_body.jsx`.

- [ ] **Step 2: Add `TourContext` immediately after `HoverHintContext`**

In `index.html`, find `const HoverHintContext = createContext(null);` and add the new line right after it:

```js
const HoverHintContext = createContext(null);
const TourContext = createContext(null);
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Browser verification — no visible change**

Refresh `http://localhost:8000/`. Page renders identically. Console clean. (Pure data + context, no consumers yet.)

- [ ] **Step 4: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(tour): add TOUR_STEPS data and TourContext

7 steps (3 intro + 4 walkthrough). No consumers yet."
```

---

## Task 2: Add `<Tour>` shell with `localStorage` hydration and auto-start

**Files:**
- Modify: `index.html` (insert component after `FirstRunHint` ~line 1497; mount inside `GMLBody`'s return)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** A `<Tour>` component that opens automatically on first load and exposes `setTourOpen` via `TourContext`. No card content yet — only an empty container.

- [ ] **Step 1: Insert the `Tour` component**

In `index.html`, immediately after the closing brace of `function FirstRunHint(...) { ... }` (around line 1497), insert:

```js
function Tour({ isMobile, drawerOpen, setDrawerOpen }) {
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const priorDrawerOpenRef = useRef(null);

  // Auto-start on first visit (gated by localStorage).
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

  // Mobile: auto-open the drawer for steps 4-7 (UI-tour steps), restore on close.
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
      {tourOpen && (
        <div data-tour-card-mounted>
          {/* Card and connector mount here in later tasks. */}
        </div>
      )}
    </TourContext.Provider>
  );
}
```

Mirror in `gml_body.jsx`.

- [ ] **Step 2: Mount `<Tour>` inside `<GMLBody>`'s return JSX**

In `index.html`, find the `<HintPopover />` line near the end of `GMLBody`'s return (right before `</HoverHintProvider>`). Change:

```jsx
    </div>
    <HintPopover />
    </HoverHintProvider>
```

to:

```jsx
    </div>
    <HintPopover />
    <Tour isMobile={isMobile} drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen} />
    </HoverHintProvider>
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Browser verification — `tourOpen` toggles correctly across reload**

Open DevTools → Application → Local Storage. Delete `gml.tour.seen` if present, refresh.

- React DevTools should show `Tour` with `tourOpen: true`, `tourStep: 0`. (No visible UI yet — just an empty `<div data-tour-card-mounted>`.)
- Manually run in DevTools console: `localStorage.setItem('gml.tour.seen', '1')`. Refresh. `Tour` now has `tourOpen: false`.
- Manually run: `localStorage.removeItem('gml.tour.seen')`. Refresh. `tourOpen: true` again.

- [ ] **Step 4: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(tour): add Tour shell with localStorage hydration

Auto-starts on first visit (gated by gml.tour.seen). Exposes
tourOpen/tourStep/open/finish via TourContext. Empty container
mounted inside HoverHintProvider; visible UI follows in next task."
```

---

## Task 3: Add `<TourCard>` styles and bare card render

**Files:**
- Modify: `index.html` (styles object ~line 3411; component after `Tour`)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** A visible card showing step 1's title and body text, with a header row but no working buttons. Intro diagram and the 3D-protocol cross-fade animation come later.

- [ ] **Step 1: Add 12 new style keys**

In `index.html`, locate the `styles` object. After the `firstRunHint:` key (added in the hint plan, around line ~3398), insert these new keys before the closing `}` of the styles object:

```js
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
  background: 'transparent', border: 'none',
  color: 'rgba(246,239,225,0.55)',
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: 12, lineHeight: 1, padding: '0 4px',
  cursor: 'pointer',
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
```

Mirror in `gml_body.jsx`.

- [ ] **Step 2: Add the `TourCard` component**

In `index.html`, immediately after the `Tour` component definition added in Task 2, insert:

```js
function TourCard() {
  const ctx = useContext(TourContext);
  if (!ctx || !ctx.tourOpen) return null;
  const step = TOUR_STEPS[ctx.tourStep];
  if (!step) return null;
  return (
    <div style={styles.tourCard}>
      <div style={styles.tourCardHeader}>
        <span>step {ctx.tourStep + 1} / {TOUR_STEPS.length}</span>
        <button style={styles.tourClose} onClick={() => ctx.finish(false)} aria-label="close tour">×</button>
      </div>
      {step.title && <div style={styles.tourCardTitle}>{step.title}</div>}
      <div style={styles.tourCardBody}>{step.body}</div>
      <div style={styles.tourCardFooter}>
        <span /> {/* footer wiring lands in Task 4 */}
      </div>
    </div>
  );
}
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Render `<TourCard>` inside `<Tour>`**

In `index.html`, modify the `<Tour>` component's JSX. Replace:

```jsx
      {tourOpen && (
        <div data-tour-card-mounted>
          {/* Card and connector mount here in later tasks. */}
        </div>
      )}
```

with:

```jsx
      {tourOpen && <TourCard />}
```

Mirror in `gml_body.jsx`.

- [ ] **Step 4: Browser verification — card visible at step 1**

Clear `localStorage`. Refresh. The card appears bottom-center showing:
- Header: `step 1 / 7` on the left, `×` on the right.
- Title: `Welcome` in uppercase amber.
- Body: the welcome copy.
- Footer is empty (a single span placeholder).

Click `×` — card disappears. `localStorage['gml.tour.seen'] === '1'`. Refresh — card no longer appears.

- [ ] **Step 5: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(tour): TourCard with header, title, body, and × close

12 new style keys for the card, buttons, launcher, and nudge.
Card renders step 1 content statically; navigation buttons land
in Task 4."
```

---

## Task 4: Wire `Skip` / `Prev` / `Next` / `Done` buttons

**Files:**
- Modify: `index.html` (`TourCard` definition)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** Footer buttons that drive `tourStep` and `finish()`. Step indicator updates as the user navigates. Body content swaps without a cross-fade yet.

- [ ] **Step 1: Replace the `TourCard` footer with the wired buttons**

In `index.html`, find the `TourCard` definition and replace the `<div style={styles.tourCardFooter}>` block:

```jsx
      <div style={styles.tourCardFooter}>
        <span /> {/* footer wiring lands in Task 4 */}
      </div>
```

with:

```jsx
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
```

Mirror in `gml_body.jsx`.

- [ ] **Step 2: Browser verification — navigation works**

Clear `localStorage`, refresh. Walk through:

- Step 1 / 7: only `next` and `skip` visible. Click `next`.
- Step 2 / 7: `prev`, `next`, `skip`. Body shows `m and n` copy. Click `next`.
- Step 3 / 7: `Cuts` copy. Click `next`.
- Step 4 / 7: `The canvas` copy. (Connector lands in Task 6.)
- Click `next` through to step 7 / 7. The button reads `done`. Click it. Card closes. `localStorage['gml.tour.seen'] === '1'`. No nudge yet (lands in Task 8).
- Refresh — card does not reappear. Manually delete the localStorage key, refresh — card is back.
- Click `skip` from any step — card closes (and `localStorage` is set).
- Click `prev` from step 4 — back to step 3, body changes back.

- [ ] **Step 3: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(tour): wire Skip/Prev/Next/Done navigation

Step indicator updates correctly. Skip and Done set the
gml.tour.seen flag; prev hidden on step 1; primary button reads
'done' on the last step."
```

---

## Task 5: Add inline mini-diagrams for steps 1–3

**Files:**
- Modify: `index.html` (three new SVG components after `TourCard`; render inside `TourCard` body)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** Visual SVG diagrams under the body copy on intro steps. Each diagram is rendered with existing math primitives so no new asset pipeline is added.

- [ ] **Step 1: Add the three diagram components**

In `index.html`, immediately after the `TourCard` definition, insert:

```js
function TorusMini() {
  const W = 160, H = 120;
  const cx = W / 2, cy = H / 2;
  const Rmaj = 50, Rmin = 14;
  // Outer torus outline (a flattened ellipse — purely a 2D suggestion of a torus).
  const torusPath = `M ${cx - Rmaj} ${cy} A ${Rmaj} ${Rmaj * 0.4} 0 0 1 ${cx + Rmaj} ${cy} A ${Rmaj} ${Rmaj * 0.4} 0 0 1 ${cx - Rmaj} ${cy} Z`;
  // m=4 cross-section polygon attached at the right side (θ=0).
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
  // m=6 hexagon in local coords, then map to screen.
  const localHex = getPolygonVertices(6, r);
  // Horizontal chord at y=0 in local coords. findAllRegions takes chords as
  // { phi, d } where (cos phi, sin phi) is the chord normal and d is the
  // signed distance from origin. For a horizontal line, normal is (0, 1).
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
```

Mirror in `gml_body.jsx`.

> Note: this code calls existing math helpers `getPolygonVertices(m, r)` (returns `[[x,y], ...]` for the m-gon vertices on a circle of radius r) and `findAllRegions(polygon, chords)` (returns a Map keyed by half-plane patterns; each value is a polygon `[[x,y], ...]`). Both are defined near the top of the script block. The chord shape is `{ phi, d }` where `(cos phi, sin phi)` is the chord normal and `d` is the signed distance from origin; a horizontal chord at `y=0` is `{ phi: Math.PI/2, d: 0 }`.

- [ ] **Step 2: Render diagrams inside `TourCard` body**

In `index.html`, modify the `TourCard` JSX to render the diagram for intro steps. Find:

```jsx
      <div style={styles.tourCardBody}>{step.body}</div>
```

and change to:

```jsx
      <div style={styles.tourCardBody}>{step.body}</div>
      {step.kind === 'intro' && (
        <div style={styles.tourCardDiagram}>
          {step.diagram === 'torus' && <TorusMini />}
          {step.diagram === 'mn' && <MnMini />}
          {step.diagram === 'cut' && <CutMini />}
        </div>
      )}
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Browser verification — diagrams render**

Clear `localStorage`. Refresh.

- Step 1: a small torus outline with a 4-gon profile attached to its right side.
- Step 2: two side-by-side polygons — a triangle (`m=3, n=1`) and a hexagon (`m=6, n=2`), each labeled.
- Step 3: a hexagon split into two regions in different amber/teal tones with a dashed amber chord line through it, label `2 regions after this cut`.
- Steps 4–7: no diagram (UI-tour steps).

If the CutMini renders only one region or none, double-check the chord shape — `findAllRegions` expects `{ phi, d }` (chord normal angle + signed distance), not `{ a, b, c }`. The Map returned has multiple keys; we render `Array.from(regionsMap.values())`.

- [ ] **Step 4: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(tour): inline SVG mini-diagrams for steps 1-3

TorusMini, MnMini, and CutMini drawn from existing polygonBoundary
and findAllRegions helpers — no new asset pipeline."
```

---

## Task 6: Add `<TourConnector>` and four desktop `data-tour` attributes

**Files:**
- Modify: `index.html` (component after the diagram components; data-tour at canvas, mainPalette, pillRow, mLabel)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** Connector line + target outline for steps 4–7 on desktop. Mobile target swap lands in Task 9.

- [ ] **Step 1: Insert the `TourConnector` component**

In `index.html`, immediately after the three diagram components (inside the script block, before `function GMLBody`), insert:

```js
function TourConnector({ isMobile }) {
  const ctx = useContext(TourContext);
  const [geom, setGeom] = useState(null);

  const step = ctx && ctx.tourOpen ? TOUR_STEPS[ctx.tourStep] : null;
  const target = step && step.kind === 'ui' ? step.target : null;

  useEffect(() => {
    if (!target) { setGeom(null); return; }
    const compute = () => {
      // Resolve target id (mobile remap is added in Task 9).
      const id = target;
      const el = document.querySelector(`[data-tour="${id}"]`);
      const cardEl = document.querySelector('[data-tour-card]');
      if (!el || !cardEl) { setGeom(null); return; }
      const tr = el.getBoundingClientRect();
      const cr = cardEl.getBoundingClientRect();
      // Outline: 4 px expansion.
      const outline = { x: tr.left - 4, y: tr.top - 4, w: tr.width + 8, h: tr.height + 8 };
      // Polyline: from card edge midpoint facing target, to target edge midpoint facing card.
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
      // One bend at right angles.
      const bend = horizontalDominant ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
      setGeom({ outline, points: [from, bend, to] });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [target, ctx && ctx.tourStep, isMobile]);

  if (!geom) return null;
  const { outline, points } = geom;
  const ptsAttr = points.map((p) => `${p.x},${p.y}`).join(' ');
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
        rx="4" ry="4" filter="url(#tour-glow)" />
      <polyline points={ptsAttr} fill="none"
        stroke="rgba(233,163,107,0.7)" strokeWidth="1.5" />
    </svg>,
    document.body
  );
}
```

Mirror in `gml_body.jsx`.

- [ ] **Step 2: Add `data-tour-card` to `TourCard`**

In `index.html`, modify the `TourCard` outer `<div>` to add the data attribute:

```jsx
    <div style={styles.tourCard}>
```

becomes:

```jsx
    <div style={styles.tourCard} data-tour-card>
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Render `<TourConnector>` inside `<Tour>`**

In `index.html`, modify the `<Tour>` JSX. The current return inside the provider is:

```jsx
      {tourOpen && <TourCard />}
```

Change to:

```jsx
      {tourOpen && <TourCard />}
      {tourOpen && <TourConnector isMobile={isMobile} />}
```

Mirror in `gml_body.jsx`.

- [ ] **Step 4: Add `data-tour="canvas"` on the canvas wrapper**

In `index.html`, find the `<div style={styles.canvasWrap}>` line in `GMLBody`'s return (around line 2196) and change to:

```jsx
      <div style={styles.canvasWrap} data-tour="canvas">
```

Mirror in `gml_body.jsx`.

- [ ] **Step 5: Add `data-tour="mainPalette"` on `MainPalette`'s root**

In `index.html`, modify the `MainPalette` component (line ~1041). Change:

```jsx
    <div style={{...styles.palette, left: pos.x, top: pos.y}}>
```

to:

```jsx
    <div style={{...styles.palette, left: pos.x, top: pos.y}} data-tour="mainPalette">
```

Mirror in `gml_body.jsx`.

- [ ] **Step 6: Add `data-tour="pillRow"` on the pill row**

In `index.html`, find the `<div style={styles.pillRow}>` line (around line 2222). Change to:

```jsx
          <div style={styles.pillRow} data-tour="pillRow">
```

Mirror in `gml_body.jsx`.

- [ ] **Step 7: Add `data-tour="mLabel"` wrapper around the `m` HintRow**

In `index.html`, find the `<HintRow hint={HINTS.m}>` block in `bodyControls` (around line 2284):

```jsx
      <HintRow hint={HINTS.m}>
        <Slider label="m" min={2} max={Math.max(12, m + 2)} value={m} onChange={(v) => setM(Math.max(2, v))} editable />
      </HintRow>
```

Wrap with a div:

```jsx
      <div data-tour="mLabel">
        <HintRow hint={HINTS.m}>
          <Slider label="m" min={2} max={Math.max(12, m + 2)} value={m} onChange={(v) => setM(Math.max(2, v))} editable />
        </HintRow>
      </div>
```

Mirror in `gml_body.jsx`.

- [ ] **Step 8: Browser verification — connectors draw on desktop**

Clear `localStorage`. Refresh. Navigate to:

- Step 4: an amber outline appears around the entire canvas region; a polyline connects the top edge of the card to the canvas's bottom edge.
- Step 5: outline around the main palette (top-left); connector goes from the card's top-left to the palette's bottom edge.
- Step 6: outline hugs the cut/sound pill row (bottom-right); short connector from card to pills.
- Step 7: outline around just the `m` slider row (a small box around it); connector goes to the m row.

While on any UI-tour step, drag the `m` slider — the value changes; geometry under the connector responds; connector outline keeps tracking the m row. Resize the window — connector recomputes correctly.

- [ ] **Step 9: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(tour): TourConnector with target outline and bent polyline

Resolves data-tour=<id> via querySelector. One 90° bend in the
polyline so it doesn't cross the card. Re-renders on resize.
Four desktop data-tour attributes added (canvas, mainPalette,
pillRow, mLabel)."
```

---

## Task 7: Add `<TourLauncher>` (`?` icon) in palette and drawer headers

**Files:**
- Modify: `index.html` (component after `TourConnector`; mount inside `MainPalette` and `MobileDrawer` headers)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** A `?` icon the user can click to reopen the tour at step 1. Visible in the BODY palette header on desktop and in the drawer header on mobile.

- [ ] **Step 1: Add the `TourLauncher` component**

In `index.html`, immediately after the `TourConnector` definition, insert:

```js
function TourLauncher() {
  const ctx = useContext(TourContext);
  if (!ctx) return null;
  return (
    <button
      style={styles.tourLauncher}
      onClick={(e) => { e.stopPropagation(); ctx.open(); }}
      data-no-drag
      aria-label="replay intro tour"
      title="replay intro tour"
    >?</button>
  );
}
```

Mirror in `gml_body.jsx`.

> Note: `data-no-drag` matches the existing convention in `<MainPalette>`'s drag handler (line 1044) — clicks on elements with `[data-no-drag]` don't initiate a drag.

- [ ] **Step 2: Render `<TourLauncher>` in `MainPalette` header**

In `index.html`, modify the `MainPalette` header. Find:

```jsx
        <span style={styles.paletteHeaderTitle} data-no-drag onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'} Body
        </span>
        <span style={styles.paletteHeaderHandle}>⠿</span>
```

Change to:

```jsx
        <span style={styles.paletteHeaderTitle} data-no-drag onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'} Body
        </span>
        <span style={{display: 'flex', alignItems: 'center', gap: 4}}>
          <TourLauncher />
          <span style={styles.paletteHeaderHandle}>⠿</span>
        </span>
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Render `<TourLauncher>` in `MobileDrawer` header**

In `index.html`, find the `MobileDrawer` definition (line ~1185). Change:

```jsx
      <button onClick={onToggle} style={styles.drawerHandle} aria-label={open ? 'collapse controls' : 'expand controls'}>
        <div style={styles.drawerHandleBar} />
        <span style={styles.drawerHandleLabel}>{open ? 'tap to collapse' : 'tap to expand controls'}</span>
      </button>
      <div style={styles.drawerContent}>{children}</div>
```

to:

```jsx
      <div style={{position: 'relative'}}>
        <button onClick={onToggle} style={styles.drawerHandle} aria-label={open ? 'collapse controls' : 'expand controls'}>
          <div style={styles.drawerHandleBar} />
          <span style={styles.drawerHandleLabel}>{open ? 'tap to collapse' : 'tap to expand controls'}</span>
        </button>
        <div style={{position: 'absolute', right: 12, top: 12}}>
          <TourLauncher />
        </div>
      </div>
      <div style={styles.drawerContent}>{children}</div>
```

Mirror in `gml_body.jsx`.

- [ ] **Step 4: Browser verification — `?` reopens the tour**

Set `localStorage['gml.tour.seen'] = '1'`. Refresh — tour does not auto-start.

- The `?` icon appears between the `Body` label and the `⠿` drag handle in the palette header.
- Click the `?` — tour opens at step 1.
- Walk through and click `done`. Tour closes.
- Click `?` again — tour reopens at step 1.

Resize to 600 px. The `?` appears in the top-right of the mobile drawer header. Click it — tour opens.

- [ ] **Step 5: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(tour): TourLauncher (? icon) in palette and drawer headers

Click reopens the tour at step 1. Lives next to the drag handle
on desktop and in the top-right of the drawer header on mobile."
```

---

## Task 8: Add `<TourNudge>` post-Skip behavior

**Files:**
- Modify: `index.html` (component; mount alongside `TourLauncher`)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** A small ephemeral line `tour: press ? to replay` next to the `?` icon that appears for 6 s after the user skips the tour, then fades out. Already gated by `nudgeVisible` from `TourContext` (set in `Tour.finish(true)`).

- [ ] **Step 1: Add the `TourNudge` component**

In `index.html`, immediately after the `TourLauncher` definition, insert:

```js
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
```

Mirror in `gml_body.jsx`.

- [ ] **Step 2: Mount `<TourNudge>` next to `<TourLauncher>`**

In `index.html`, modify both `<TourLauncher />` mount sites to wrap them with a positioned container that also holds `<TourNudge />`. Find the desktop mount in `MainPalette`:

```jsx
        <span style={{display: 'flex', alignItems: 'center', gap: 4}}>
          <TourLauncher />
          <span style={styles.paletteHeaderHandle}>⠿</span>
        </span>
```

Change to:

```jsx
        <span style={{display: 'flex', alignItems: 'center', gap: 4, position: 'relative'}}>
          <TourLauncher />
          <span style={styles.paletteHeaderHandle}>⠿</span>
          <TourNudge />
        </span>
```

For mobile, find:

```jsx
        <div style={{position: 'absolute', right: 12, top: 12}}>
          <TourLauncher />
        </div>
```

Change to:

```jsx
        <div style={{position: 'absolute', right: 12, top: 12}}>
          <TourLauncher />
          <TourNudge />
        </div>
```

Mirror both edits in `gml_body.jsx`.

- [ ] **Step 3: Browser verification — nudge appears after Skip**

Clear `localStorage`. Refresh — tour auto-starts.

- Click `skip`. Card disappears. The text `tour: press ? to replay` appears just below or beside the `?` icon (positioned via `top: 22, right: 16` relative to the launcher's container).
- Wait 6 s. The text fades out (200 ms transition) and disappears.
- Refresh. Tour does NOT auto-start (gml.tour.seen is set). Click the `?` — tour reopens. Press `done`. No nudge appears.

- [ ] **Step 4: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(tour): TourNudge — 6s 'press ? to replay' line after Skip

Appears next to the ? icon in the palette/drawer header, fades
out after 5.8s + 200ms opacity transition. Suppressed when the
user uses Done or × to close the tour (only Skip triggers it)."
```

---

## Task 9: Mobile target swap + auto-open drawer choreography

**Files:**
- Modify: `index.html` (`TourConnector`'s id resolution, `data-tour` attributes inside `MobileDrawer`)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** On mobile, steps 5 and 6 resolve to drawer-internal targets; the drawer auto-opens for steps 4–7 and restores on close. Step 4 (canvas) and step 7 (mLabel) keep working as on desktop.

- [ ] **Step 1: Add `data-tour="mobileBody"` and `data-tour="mobileCutSection"` inside `MobileDrawer` content**

In `index.html`, find the JSX that renders inside `<MobileDrawer>` in `GMLBody`'s return (around line 2519):

```jsx
        <MobileDrawer open={drawerOpen} onToggle={() => setDrawerOpen(!drawerOpen)}>
          <div style={{padding: '6px 4px 10px'}}>
            {bodyControls}
          </div>
          <div style={styles.mobileSection}>
            <div style={styles.mobileSectionHeader}><span>✂ Cut</span></div>
            {cutControls}
          </div>
          <div style={styles.mobileSection}>
            <div style={styles.mobileSectionHeader}><span>♪ Sound</span></div>
            {soundControls}
          </div>
          <FirstRunHint mobile />
        </MobileDrawer>
```

Change to:

```jsx
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
          <FirstRunHint mobile />
        </MobileDrawer>
```

Mirror in `gml_body.jsx`.

- [ ] **Step 2: Update `TourConnector` to remap ids on mobile**

In `index.html`, modify the inside of the `useEffect` in `TourConnector`. Find:

```js
    const compute = () => {
      // Resolve target id (mobile remap is added in Task 9).
      const id = target;
      const el = document.querySelector(`[data-tour="${id}"]`);
```

Change to:

```js
    const compute = () => {
      // Resolve target id, with mobile remap for steps that point at the floating layout.
      let id = target;
      if (isMobile) {
        if (id === 'mainPalette') id = 'mobileBody';
        else if (id === 'pillRow') id = 'mobileCutSection';
      }
      const el = document.querySelector(`[data-tour="${id}"]`);
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Verify `<Tour>`'s mobile-drawer-auto-open effect already runs**

The Tour component added in Task 2 already includes:

```js
useEffect(() => {
  if (!isMobile || !tourOpen) return;
  if (tourStep >= 3) {
    if (priorDrawerOpenRef.current === null) priorDrawerOpenRef.current = drawerOpen;
    if (!drawerOpen) setDrawerOpen(true);
  }
}, [isMobile, tourOpen, tourStep, drawerOpen, setDrawerOpen]);
```

No changes needed — this already triggers on entry into step 4 (`tourStep >= 3` since `tourStep` is 0-indexed). The drawer-state restore is already wired in `finish()`. Nothing to add in this step.

- [ ] **Step 4: Browser verification — mobile flow**

Resize to 600 px width. Clear `localStorage`. Refresh.

1. Tour auto-starts. Card appears bottom-center, sized to fit the narrower viewport (still 340 px wide → on a 600 px viewport this fits with margin; if it doesn't, it'll be confirmed in Task 10).
2. Walk through steps 1–3 — diagrams render the same as desktop.
3. Step 4: the connector outlines the canvas region (the upper part of the viewport above the drawer handle).
4. Step 5 entry: drawer was closed; it auto-opens. Connector outlines the body section (`data-tour="mobileBody"`).
5. Step 6: connector outlines the cut section in the drawer.
6. Step 7: connector outlines the `m` row (whose `data-tour="mLabel"` wrapper renders inside the drawer's body section in mobile mode).
7. Press `done`. Drawer collapses back to its prior state (closed).

Test the prior-state restore: with `localStorage` cleared, manually open the drawer first by tapping the handle (so prior state is "open"), then refresh — the tour starts with drawer open. Walk to step 7, press `done`. Drawer stays open (matches prior state).

- [ ] **Step 5: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(tour): mobile target swap + drawer auto-open

Steps 5/6 retarget to mobileBody/mobileCutSection on isMobile.
Drawer auto-opens at step 4 entry and restores prior state on
tour close. Step 4 (canvas) and step 7 (mLabel) work the same
across both layouts."
```

---

## Task 10: Final verification + mirror diff

**Files:** None modified. Verification only.

**What this task delivers:** Confidence that the spec verification checklist passes end-to-end and that `index.html` and `gml_body.jsx` are byte-equivalent (modulo the documented top-of-file delta).

- [ ] **Step 1: Run the spec's verification checklist**

Walk through items 1–14 under "Verification" in `docs/superpowers/specs/2026-05-06-intro-walkthrough-design.md`. Mark each pass/fail. Expected: all pass.

Specifically:

1. Auto-start (clear localStorage, refresh, card at step 1/7 with welcome diagram).
2. Forward navigation (step 1 → 7 with cross-fades — the cross-fade animation isn't implemented in this plan; the body simply re-renders. If desired, add an opacity transition in a follow-up; the spec calls for 180 ms cross-fade.)
3. Backward navigation.
4. Skip + nudge.
5. Done.
6. Replay.
7. Reload after seen.
8. Underlying interactivity (drag slider during step 5).
9. Resize during tour (connector recomputes).
10. Auto-flip layout — note: the connector picks the dominant axis and bends once. If the card is bottom-center and target is bottom-right (e.g. step 6), the connector should route up-and-right with one bend. Verify visually.
11. Mobile auto-open drawer.
12. Mobile target resolution (mobileBody, mobileCutSection).
13. Step 7 highlight (just the `m` row, not the entire palette).
14. Two-file mirror.

> About item 2 / cross-fade: the spec says step body cross-fades over 180 ms. The plan as written does not implement this animation. If the user wants the cross-fade, add a follow-up step here:
>
> ```js
> const [bodyOpacity, setBodyOpacity] = useState(1);
> useEffect(() => {
>   setBodyOpacity(0);
>   const t = setTimeout(() => setBodyOpacity(1), 90);
>   return () => clearTimeout(t);
> }, [ctx && ctx.tourStep]);
> ```
> applied to `tourCardBody` and `tourCardDiagram` style with `transition: 'opacity 180ms ease', opacity: bodyOpacity`.
>
> Decide pass/fail with the user.

- [ ] **Step 2: Diff `index.html` and `gml_body.jsx`**

```bash
diff <(sed -n '42,$p' index.html | sed '/^const root = ReactDOM/,$d') <(sed -n '4,$p' gml_body.jsx) | head -40
```

Skip the documented top-of-file delta and the `export default function GMLBody`. Expected: differences only at those two known sites.

If any difference appears in the middle of the file, mirror the missing edit.

- [ ] **Step 3: Visual smoke test of all five layout states**

Open `http://localhost:8000/` in a fresh tab. Walk through:

1. **Desktop, default state**: `?` in palette header. Tour auto-starts on first visit. All steps work.
2. **Desktop, replay**: refresh after Done; click `?`; tour restarts.
3. **Desktop, mid-tour interaction**: at step 5, drag slider, change shape, hover hints — all still work; connector tracks.
4. **Mobile, drawer-closed start**: tour auto-starts; drawer auto-opens at step 4; restored on Done.
5. **Mobile, drawer-open start**: tour starts with drawer already open; stays open after Done.

- [ ] **Step 4: Update CLAUDE.md (optional)**

If the new tour layer is meaningful enough to mention, append a short paragraph under "Code architecture" in `CLAUDE.md`. Suggested addition:

```markdown
**Tour layer:**
A `<Tour>` component near the top of `<GMLBody>`'s JSX owns the intro/walkthrough state and renders `<TourCard>` (the morphing 7-step card) and `<TourConnector>` (an SVG portal that draws an outline + bent polyline from the card to the focused control). Step data is in the `TOUR_STEPS` array near the top of the file. Targets are resolved via `data-tour="<id>"` attributes on existing JSX. The `?` icon (`<TourLauncher>`) lives in the main-palette and mobile-drawer headers and reopens the tour at step 1.
```

Commit:

```bash
git add CLAUDE.md
git commit -m "docs: describe the tour layer in CLAUDE.md"
```

---

## Self-review summary

- Every spec section maps to a task: TOUR_STEPS data → Task 1; localStorage hydration + auto-start → Task 2; card layout/styles + buttons → Tasks 3–4; mini-diagrams → Task 5; connector + outline + 4 desktop targets → Task 6; `?` launcher → Task 7; nudge → Task 8; mobile drawer auto-open + mobile target swap → Task 9; verification → Task 10.
- No placeholders. Every code block contains the actual code an engineer pastes.
- Names consistent: `Tour`, `TourCard`, `TourConnector`, `TourLauncher`, `TourNudge`, `TorusMini`, `MnMini`, `CutMini`, `TourContext`, `TOUR_STEPS`. Context value shape `{ tourOpen, tourStep, open, setTourStep, finish, nudgeVisible }` referenced consistently across Tasks 2, 3, 4, 6, 7, 8.
- Two-file mirror restated at the top of every code-modifying task.
- Verification is browser-only (the project has no test runner).
- One known scope decision: the spec calls for a 180 ms cross-fade between step bodies; the plan defers this animation as an optional follow-up in Task 10. If the user wants strict spec compliance, add the cross-fade snippet shown in Task 10 / Step 1's note.
