# Parameter Hover-Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hover-revealed popover-explanation system to every slider, toggle, and mode-button in the controls UI, with a hybrid copy model (terse for most parameters, rich title/body/formula for `m`, `n`, knot `p`/`q`, modal `p`/`q`), auto-flip placement, mobile tap-equivalent, and a once-per-session discovery hint.

**Architecture:** Single React context (`HoverHintProvider`) at the top of `<GMLBody>` owns `activeHint` state and exposes `register/clear` actions. A `<HintRow>` wrapper component attaches pointer/tap listeners to each control row and pulls hint copy from a centralized `HINTS` object defined once at module top. A `<HintPopover>` rendered via `ReactDOM.createPortal` reads `activeHint` and computes auto-flip placement from the trigger's `getBoundingClientRect()`. Existing components (`Slider`, `Toggle`, `MainPalette`, `Popover`, `MobileDrawer`) are not modified internally — `<HintRow>` only wraps their JSX call sites.

**Tech Stack:** React 18 (CDN), Babel Standalone (in-browser transpile), `ReactDOM.createPortal`, no test runner. Project's two-file mirror discipline: every change in `index.html` is mirrored byte-identically into `gml_body.jsx`. Manual browser verification only.

**Spec:** `docs/superpowers/specs/2026-05-06-parameter-hover-hints-design.md`

**Two-file mirror reminder:** After every code change in `index.html`, perform the same edit in `gml_body.jsx`. The diff between the two files must remain confined to the first 3 lines (imports vs. `const { ... } = React;` destructuring) and the trailing comment delimiter, exactly as `CLAUDE.md` specifies.

**Serving for verification:** From repo root, run `python3 -m http.server 8000` once, then refresh `http://localhost:8000/` after each task to verify.

---

## File Structure

| File | Role | New / Modified |
|---|---|---|
| `index.html` | Runtime artifact. All component definitions, styles, render. | Modified |
| `gml_body.jsx` | Editor-only mirror. | Modified (mirrored) |

**No new files.** Everything lives inside the existing `<script type="text/babel">` block of `index.html` (and the corresponding `gml_body.jsx` mirror). New code is grouped:

- The `HINTS` constant near the top of the script block, before `GMLBody` (alongside other module-level constants).
- The new components `HoverHintProvider`, `HintRow`, `HintPopover`, `FirstRunHint` defined after `MobileDrawer` (line ~1197) and before `GMLBody` (line ~1199).
- The `styles` object (line ~3017) gets new keys: `hintPopover`, `hintPopoverTitle`, `hintPopoverBody`, `hintPopoverFormula`, `firstRunHint`.

---

## Task 1: Add `HoverHintContext` and provider state

**Files:**
- Modify: `index.html` (around line 42 destructure; insert provider before `GMLBody` ~line 1197)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** Context with `activeHint` state and `register/clear` API. Mounted at the top of `<GMLBody>`'s JSX. No UI is visible yet — just the plumbing.

- [ ] **Step 1: Extend the React top-level destructure**

In `index.html`, change line 42 from:

```js
const { useRef, useEffect, useState } = React;
```

to:

```js
const { useRef, useEffect, useState, useContext, createContext, useCallback } = React;
```

In `gml_body.jsx`, the corresponding line is the import — change it similarly to add the new hooks. (`gml_body.jsx` currently uses `import { useRef, useEffect, useState } from 'react';`. Update to add `useContext, createContext, useCallback`.)

- [ ] **Step 2: Add the `HoverHintContext` constant near other module-level constants**

In `index.html`, immediately before `function MobileDrawer({ open, onToggle, children })` (line ~1184), insert:

```js
const HoverHintContext = createContext(null);
```

Mirror the same insertion at the same logical position in `gml_body.jsx`.

- [ ] **Step 3: Add the `HoverHintProvider` component**

In `index.html`, immediately after the `HoverHintContext` line, insert:

```js
function HoverHintProvider({ children }) {
  const [activeHint, setActiveHint] = useState(null); // { rect, content } | null
  const [hasHovered, setHasHovered] = useState(false);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setActiveHint(null);
  }, []);

  const register = useCallback((rect, content) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (activeHint) {
      // Already showing — swap instantly (no second 220 ms delay).
      setActiveHint({ rect, content });
      setHasHovered(true);
    } else {
      timerRef.current = setTimeout(() => {
        setActiveHint({ rect, content });
        setHasHovered(true);
        timerRef.current = null;
      }, 220);
    }
  }, [activeHint]);

  // Cancel a pending timer if user moves off before 220 ms elapses.
  const cancelPending = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  return (
    <HoverHintContext.Provider value={{ activeHint, register, clear, cancelPending, hasHovered }}>
      {children}
    </HoverHintContext.Provider>
  );
}
```

Mirror the same insertion in `gml_body.jsx`.

- [ ] **Step 4: Wrap `<GMLBody>`'s returned JSX in `<HoverHintProvider>`**

Find the return statement of `GMLBody` (line ~2144 in `index.html`). The current structure is:

```jsx
return (
  <div style={styles.root}>
    <style>{cssGlobal}</style>
    {/* ... header, canvas, palettes, drawer, footer, full-screen overlay, info strip ... */}
  </div>
);
```

Change to:

```jsx
return (
  <HoverHintProvider>
    <div style={styles.root}>
      <style>{cssGlobal}</style>
      {/* ... unchanged ... */}
    </div>
  </HoverHintProvider>
);
```

Mirror in `gml_body.jsx`.

- [ ] **Step 5: Browser verification — no visible regression**

Refresh `http://localhost:8000/`. Open DevTools console. Check:

- No errors in console.
- The page renders identically: header, canvas, main palette, cut/sound pills, info strip, footer all in place.
- React DevTools (if installed) shows `HoverHintProvider` wrapping the rest of the tree.

Expected: page looks pixel-identical to before this task. The provider is mounted but no consumer exists yet.

- [ ] **Step 6: Verify two-file mirror integrity**

Run:

```bash
diff <(sed -n '4,$p' index.html | grep -v "^</script>$" | grep -v "^.*ReactDOM.createRoot" | grep -v "^.*root.render") <(sed -n '4,$p' gml_body.jsx)
```

Expected: empty diff (modulo the documented top-of-file differences).

If the diff is non-empty in unexpected places, mirror missing edits.

- [ ] **Step 7: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(hints): add HoverHintProvider context and state plumbing

No visible behavior change yet — wires up activeHint state, the 220 ms
delay timer, and the register/clear/cancelPending API for the
upcoming HintRow consumers."
```

---

## Task 2: Add the `HINTS` content registry

**Files:**
- Modify: `index.html` (insert before `GMLBody`, near other constants ~line 1197)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** A single `HINTS` object containing every entry from the spec's content table. No UI consumes it yet. Pure data.

- [ ] **Step 1: Insert the `HINTS` constant**

In `index.html`, immediately before the `HoverHintProvider` definition added in Task 1, insert:

```js
const HINTS = {
  // Path-shape mode buttons
  pathShape_circle:     { kind: 'terse', text: 'Center-path is a circle (the standard torus).' },
  pathShape_ellipse:    { kind: 'terse', text: 'Center-path is an ellipse with independent semi-axes.' },
  pathShape_knot:       { kind: 'terse', text: 'Center-path is a (p,q) torus knot — winds around the symmetry axis p times and around the tube q times.' },
  pathShape_lemniscate: { kind: 'terse', text: 'Center-path is a figure-8 (Bernoulli lemniscate).' },

  // Path-shape parameters
  R_circle:    { kind: 'terse', text: 'Major radius — distance from the center of the torus to the center of the cross-section.' },
  a_ellipse:   { kind: 'terse', text: 'Ellipse semi-axis along the X direction.' },
  b_ellipse:   { kind: 'terse', text: 'Ellipse semi-axis along the Z direction.' },
  R_knot:      { kind: 'terse', text: 'Major radius of the torus the knot winds around.' },
  r_knot:      { kind: 'terse', text: 'Tube radius — how far the knot deviates from the underlying torus surface.' },
  p_knot:      { kind: 'rich',  title: 'Path winding p',  body: 'Number of times the (p,q) torus knot winds around the symmetry axis. Must be coprime to q — the UI auto-bumps q if you would break that.' },
  q_knot:      { kind: 'rich',  title: 'Tube winding q',  body: 'Number of times the (p,q) torus knot winds around the tube. Must be coprime to p — the UI auto-bumps p if you would break that.' },
  a_lemniscate:{ kind: 'terse', text: 'Overall scale of the figure-8 path.' },

  // GML core
  n: { kind: 'rich', title: 'Twist count',   body: 'The cross-section rotates n/m turns as it traces the path. The classical Möbius strip is m=2, n=1.', formula: 'α = (n/m)·θ' },
  m: { kind: 'rich', title: 'Polygon sides', body: 'The cross-section is a regular m-gon. m=2 collapses to a flat strip (Möbius band when n is odd).', formula: 'pieces after a center cut = m / gcd(2n, m)' },

  // Display toggles
  autoRotate: { kind: 'terse', text: 'Spin the model on its vertical axis. Off when you want to study a specific orientation.' },
  ridges:     { kind: 'terse', text: 'Show the m-gon edges along the surface. Disabled while the body is cut.' },
  gradient:   { kind: 'terse', text: 'Color the surface with a θ-based gradient. Off shows flat per-piece colors.' },

  // Cut master + modes
  cut:               { kind: 'terse', text: 'Slice the body along a chord through the cross-section. Open the cut popover for shape and mode controls.' },
  cutMode_center:    { kind: 'terse', text: 'Cut along chords through the polygon center. Diametric cuts.' },
  cutMode_parallel:  { kind: 'terse', text: 'Cut along multiple parallel chords. Slices the body into slabs.' },
  cutMode_offcenter: { kind: 'terse', text: 'Cut along a single chord offset from the center by a fixed distance.' },
  cutMode_p2p:       { kind: 'terse', text: 'Point-to-point: cut along a chord from one cross-section vertex to another.' },

  // Cut-mode-specific sliders
  sliceCount: { kind: 'terse', text: 'Number of parallel chord cuts through the cross-section.' },
  offsetD:    { kind: 'terse', text: 'Off-center cut: distance of the chord from the polygon center, as % of the inradius.' },
  phi1:       { kind: 'terse', text: 'First vertex angle for the point-to-point cut. The chord starts at the cross-section vertex closest to this angle.' },
  phi2:       { kind: 'terse', text: 'Second vertex angle for the point-to-point cut. The chord ends at the cross-section vertex closest to this angle.' },
  cutPhi:     { kind: 'terse', text: 'Rotation of the cut chord within the cross-section.' },

  // Cut spacing
  gap:      { kind: 'terse', text: 'Pulls the cut pieces apart so you can see them as separate solids. 0 = touching.' },
  seamOpen: { kind: 'terse', text: 'Opens up the seam at the cut surface. Lets you see the cut without separating the pieces.' },

  // Blade controls
  bladeShape_straight: { kind: 'terse', text: 'Cut surface is a flat plane.' },
  bladeShape_curved:   { kind: 'terse', text: 'Cut surface is a smooth concave/convex curve.' },
  bladeShape_zigzag:   { kind: 'terse', text: 'Cut surface follows a sawtooth profile along the chord.' },
  bladeShape_custom:   { kind: 'terse', text: 'Cut surface follows a profile you draw below.' },
  bladeAmount:         { kind: 'terse', text: 'Amount of curvature/zigzag/profile applied to the cut surface.' },

  // Cut visualization
  show2D:     { kind: 'terse', text: 'Show the 2D cross-section diagram in a corner overlay.' },
  hideOthers: { kind: 'terse', text: 'Hide every piece except the highlighted one. Click a piece-dot or the body itself to pick which.' },

  // Sound
  pMode:     { kind: 'rich',  title: 'Modal number p', body: 'Spatial mode along θ that drives the per-vertex color sweep. Higher numbers, finer ripples.', formula: 'phase = p·θ + q·φ − ωt' },
  qMode:     { kind: 'rich',  title: 'Modal number q', body: 'Spatial mode along φ that drives the per-vertex color sweep. Higher numbers, finer ripples.', formula: 'phase = p·θ + q·φ − ωt' },
  waveFreq:  { kind: 'terse', text: 'Audio frequency of the polygon waveform, in Hz.' },
  waveAmp:   { kind: 'terse', text: 'Output volume.' },
  wavePlay:  { kind: 'terse', text: 'Start or stop the looping polygon waveform. Color-sweep visualization stays live regardless.' },
};
```

Mirror the same insertion in `gml_body.jsx`.

- [ ] **Step 2: Browser verification — still no visible change**

Refresh. Expected: page renders identically. No errors in console. (Pure data, not consumed yet.)

- [ ] **Step 3: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(hints): add HINTS content registry

Single source of truth for every hint copy. No consumers wired yet."
```

---

## Task 3: Add `HintPopover` component, styles, and portal mount

**Files:**
- Modify: `index.html` (component near other components ~line 1197; styles ~line 3088; portal mount inside `<HoverHintProvider>` JSX)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** The popover element and its portal. With no `<HintRow>` triggers wired, `activeHint` is always `null` and the popover never renders, so still no visible change.

- [ ] **Step 1: Add the popover styles**

In `index.html`, locate the `styles` object (line ~3017). After the `popover:` block (~line 3104), insert these new keys:

```js
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
```

Mirror in `gml_body.jsx`.

- [ ] **Step 2: Add the placement helper and the `HintPopover` component**

In `index.html`, immediately after the `HoverHintProvider` definition added in Task 1, insert:

```js
function computeHintPosition(rect, contentSize, viewport) {
  const GAP = 8;
  const MARGIN = 6;
  const { width: cw, height: ch } = contentSize;
  const { width: vw, height: vh } = viewport;

  const spaceRight = vw - rect.right;
  const spaceLeft  = rect.left;

  // Default to the side with more horizontal space.
  let side = spaceRight >= spaceLeft ? 'right' : 'left';

  let left, top;
  const tryHorizontal = (s) => {
    const l = s === 'right' ? rect.right + GAP : rect.left - cw - GAP;
    return { l, fits: l >= MARGIN && l + cw <= vw - MARGIN };
  };
  let h = tryHorizontal(side);
  if (!h.fits) {
    side = side === 'right' ? 'left' : 'right';
    h = tryHorizontal(side);
  }

  if (h.fits) {
    left = h.l;
    // Vertically center on the trigger row.
    top = rect.top + rect.height / 2 - ch / 2;
    // Clamp vertically.
    top = Math.max(MARGIN, Math.min(top, vh - ch - MARGIN));
  } else {
    // Both sides clip — anchor above (or below if no space above).
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

  useEffect(() => {
    if (!ctx || !ctx.activeHint || !ref.current) { setPos(null); return; }
    const cs = { width: ref.current.offsetWidth, height: ref.current.offsetHeight };
    const vp = { width: window.innerWidth, height: window.innerHeight };
    setPos(computeHintPosition(ctx.activeHint.rect, cs, vp));
  }, [ctx && ctx.activeHint]);

  if (!ctx || !ctx.activeHint) return null;
  const { content } = ctx.activeHint;
  const style = pos
    ? { ...styles.hintPopover, left: pos.left, top: pos.top }
    : { ...styles.hintPopover, left: -9999, top: -9999 }; // measure offscreen on first render

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
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Mount `<HintPopover>` inside the provider**

In `index.html`, in the `GMLBody` return statement edited in Task 1, change:

```jsx
return (
  <HoverHintProvider>
    <div style={styles.root}>
      <style>{cssGlobal}</style>
      {/* ... unchanged ... */}
    </div>
  </HoverHintProvider>
);
```

to:

```jsx
return (
  <HoverHintProvider>
    <div style={styles.root}>
      <style>{cssGlobal}</style>
      {/* ... unchanged ... */}
    </div>
    <HintPopover />
  </HoverHintProvider>
);
```

Mirror in `gml_body.jsx`.

- [ ] **Step 4: Browser verification — still no visible popover**

Refresh. Expected:

- No console errors.
- Page looks identical to before.
- Open React DevTools and confirm `HintPopover` is in the tree but renders `null` (no children).

- [ ] **Step 5: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(hints): add HintPopover component, styles, and portal mount

Adds the popover element with auto-flip placement helper and the
hintPopover/Title/Body/Formula style keys. Mounted inside the
provider via ReactDOM.createPortal. No triggers wired, so still
invisible."
```

---

## Task 4: Add `HintRow` wrapper and smoke-test on the `m` slider

**Files:**
- Modify: `index.html` (component near other components ~line 1197; one wrap site at the `m` slider line ~2048)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** End-to-end working hover popover on the `m` slider only. Validates the architecture before scaling to all rows.

- [ ] **Step 1: Add the `HintRow` component**

In `index.html`, immediately after the `HintPopover` definition, insert:

```js
function HintRow({ hint, children }) {
  const ctx = useContext(HoverHintContext);
  const ref = useRef(null);

  if (!hint || !ctx) return children;

  const triggerRect = () => {
    // display: contents means ref.current itself has a zero rect; use its visible child instead.
    const el = ref.current && (ref.current.firstElementChild || ref.current);
    return el ? el.getBoundingClientRect() : null;
  };

  const onPointerEnter = (e) => {
    if (e.pointerType !== 'mouse') return; // mobile path uses tap, see Task 9
    const rect = triggerRect();
    if (rect) ctx.register(rect, hint);
  };
  const onPointerLeave = (e) => {
    if (e.pointerType !== 'mouse') return;
    ctx.cancelPending();
    ctx.clear();
  };

  return (
    <div
      ref={ref}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{ display: 'contents' }}
    >
      {children}
    </div>
  );
}
```

Mirror in `gml_body.jsx`.

> Why `display: 'contents'`: it makes the wrapper transparent to layout — children participate in the parent's flex/grid as if the wrapper weren't there, so existing `flex: 1` mode buttons, the sliderRow grid, and column-flex toggles all continue to work without any CSS plumbing.

> Why read the rect from `firstElementChild`: a `display: contents` element has no own box, so `getBoundingClientRect()` on it returns zeros. The visible row is the wrapper's first child (the `<Slider>`'s `<label>`, the `<Toggle>`'s `<button>`, or the mode-button `<button>`); its rect is what we want for popover placement.

> Why the listeners still fire: pointer-event dispatch follows DOM ancestry, not layout boxes. `pointerenter` and `pointerleave` fire on every ancestor in the entry/exit path of the visible target, so they fire on the wrapper even though it has no box. (Verified in Chrome 65+, Firefox 65+, Safari 11.1+ — the project's effective floor.)

> Fallback if pointer events don't fire on the `display: contents` wrapper in some browser: switch to `display: 'block'` and accept the extra layer. Mode-button rows would then need additional styling on the wrapper (`{ flex: 1, display: 'flex' }`) so the inner `<button>`'s `flex: 1` keeps working. Add a `flexChild` prop to `HintRow` if this fallback is needed.

- [ ] **Step 2: Wrap the `m` slider call site**

In `index.html`, line 2048 currently reads:

```jsx
<Slider label="m" min={2} max={Math.max(12, m + 2)} value={m} onChange={(v) => setM(Math.max(2, v))} editable />
```

Change to:

```jsx
<HintRow hint={HINTS.m}>
  <Slider label="m" min={2} max={Math.max(12, m + 2)} value={m} onChange={(v) => setM(Math.max(2, v))} editable />
</HintRow>
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Browser verification — `m` slider hover shows popover**

Refresh. Expected:

- Hover the `m` slider row in the main palette. After ~220 ms, the rich popover appears to the right of the row with title `Polygon sides`, body text, and the `K_cuts` formula.
- Move the cursor off the row → popover hides immediately.
- Drag the `m` slider thumb → still works; popover does not block the drag.
- Click the editable number input → still focusable, still typable.
- Hover the `n` slider row → no popover (not wrapped yet).
- Console is clean.

If layout broke around the `m` row (e.g. the row is suddenly inline / overlapping its label), `display: contents` is likely to blame — see the caveat in Step 1 and switch to the prop-ref fallback.

- [ ] **Step 4: Test viewport-edge auto-flip**

Resize the browser window so the main palette is near the right viewport edge (drag it there manually or shrink the window). Hover `m` again. Expected: popover appears on the **left** of the row instead of the right. No clipping.

- [ ] **Step 5: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(hints): add HintRow wrapper and wire the m slider

End-to-end smoke test of the hover-hint pipeline: 220 ms reveal
delay, instant swap-on-move (none yet, but timer logic is in place),
auto-flip placement at viewport edges, pointer-events-none popover."
```

---

## Task 5: Wrap every control in the main palette

**Files:**
- Modify: `index.html` (lines ~2007–2055, the `bodyControls` JSX fragment)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** Hover hints on every slider, toggle, and mode-button in the main palette and (because `bodyControls` is shared) the corresponding mobile-drawer body section.

- [ ] **Step 1: Wrap path-shape mode buttons**

In `index.html`, lines 2009–2014 currently read:

```jsx
<div style={styles.modeRow}>
  <button onClick={() => setPathShape('circle')} style={{...styles.modeBtn, ...(pathShape === 'circle' ? styles.modeBtnOn : {})}}>circle</button>
  <button onClick={() => setPathShape('ellipse')} style={{...styles.modeBtn, ...(pathShape === 'ellipse' ? styles.modeBtnOn : {})}}>ellipse</button>
  <button onClick={() => setPathShape('torusKnot')} style={{...styles.modeBtn, ...(pathShape === 'torusKnot' ? styles.modeBtnOn : {})}}>knot</button>
  <button onClick={() => setPathShape('lemniscate')} style={{...styles.modeBtn, ...(pathShape === 'lemniscate' ? styles.modeBtnOn : {})}}>figure-8</button>
</div>
```

Change to:

```jsx
<div style={styles.modeRow}>
  <HintRow hint={HINTS.pathShape_circle}>
    <button onClick={() => setPathShape('circle')} style={{...styles.modeBtn, ...(pathShape === 'circle' ? styles.modeBtnOn : {})}}>circle</button>
  </HintRow>
  <HintRow hint={HINTS.pathShape_ellipse}>
    <button onClick={() => setPathShape('ellipse')} style={{...styles.modeBtn, ...(pathShape === 'ellipse' ? styles.modeBtnOn : {})}}>ellipse</button>
  </HintRow>
  <HintRow hint={HINTS.pathShape_knot}>
    <button onClick={() => setPathShape('torusKnot')} style={{...styles.modeBtn, ...(pathShape === 'torusKnot' ? styles.modeBtnOn : {})}}>knot</button>
  </HintRow>
  <HintRow hint={HINTS.pathShape_lemniscate}>
    <button onClick={() => setPathShape('lemniscate')} style={{...styles.modeBtn, ...(pathShape === 'lemniscate' ? styles.modeBtnOn : {})}}>figure-8</button>
  </HintRow>
</div>
```

Mirror in `gml_body.jsx`.

- [ ] **Step 2: Wrap path-shape contextual sliders**

In `index.html`, lines 2015–2046, change each contextual slider block as follows:

```jsx
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
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Wrap the `n` slider (already-wrapped `m` stays wrapped)**

In `index.html`, line 2047 currently reads:

```jsx
<Slider label="n" min={0} max={Math.max(12, m * 2, n + 2)} value={n} onChange={(v) => setN(Math.max(0, v))} editable />
```

Change to:

```jsx
<HintRow hint={HINTS.n}>
  <Slider label="n" min={0} max={Math.max(12, m * 2, n + 2)} value={n} onChange={(v) => setN(Math.max(0, v))} editable />
</HintRow>
```

Mirror in `gml_body.jsx`.

- [ ] **Step 4: Wrap display toggles**

In `index.html`, lines 2049–2053 currently read:

```jsx
<div style={{...styles.toggleRow, flexDirection: 'column'}}>
  <Toggle label="auto-rotate" on={autoRotate} onChange={setAutoRotate} />
  <Toggle label="ridges" on={showRidges && !cut} onChange={setShowRidges} disabled={cut} />
  <Toggle label="gradient" on={gradient} onChange={setGradient} />
</div>
```

Change to:

```jsx
<div style={{...styles.toggleRow, flexDirection: 'column'}}>
  <HintRow hint={HINTS.autoRotate}>
    <Toggle label="auto-rotate" on={autoRotate} onChange={setAutoRotate} />
  </HintRow>
  <HintRow hint={HINTS.ridges}>
    <Toggle label="ridges" on={showRidges && !cut} onChange={setShowRidges} disabled={cut} />
  </HintRow>
  <HintRow hint={HINTS.gradient}>
    <Toggle label="gradient" on={gradient} onChange={setGradient} />
  </HintRow>
</div>
```

Mirror in `gml_body.jsx`.

- [ ] **Step 5: Browser verification — every main-palette row hints**

Refresh. Hover each of: each path-shape mode button (circle/ellipse/knot/figure-8), each contextual slider per path shape, `n`, `m`, each toggle. Each should show its correct hint copy. Switching between hints should be instant (no second 220 ms delay).

Specifically test:

- Switch path shape to `knot` → hover `p` → rich popover with the coprime-warning text. Hover `q` → rich popover with mirror text.
- Hover `n` → rich popover with `α = (n/m)·θ` formula.
- Hover `auto-rotate` → terse popover. Hover `ridges` while cut is on (toggle is disabled) → still shows hint, the disabled state doesn't suppress hover.

- [ ] **Step 6: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(hints): wrap every main-palette control with HintRow

Path-shape mode buttons, contextual path sliders, n, m, and the
display toggles all show their hints on hover."
```

---

## Task 6: Wrap every control in the cut popover

**Files:**
- Modify: `index.html` (lines ~2057–2115, the `cutControls` JSX fragment)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** Hover hints on every cut-mode button, slider, toggle, blade button, and blade slider in the cut popover (and its mobile-drawer mirror).

- [ ] **Step 1: Wrap the cut master toggle**

In `index.html`, lines 2059–2061:

```jsx
<div style={styles.toggleRow}>
  <Toggle label="cut" on={cut} onChange={setCut} accent />
</div>
```

Change to:

```jsx
<div style={styles.toggleRow}>
  <HintRow hint={HINTS.cut}>
    <Toggle label="cut" on={cut} onChange={setCut} accent />
  </HintRow>
</div>
```

- [ ] **Step 2: Wrap cut-mode picker buttons**

In `index.html`, lines 2064–2069:

```jsx
<div style={{...styles.modeRow, marginTop: 8}}>
  <button onClick={() => setCutMode('center')} style={{...styles.modeBtn, ...(cutMode === 'center' ? styles.modeBtnOn : {})}}>center</button>
  <button onClick={() => setCutMode('parallel')} style={{...styles.modeBtn, ...(cutMode === 'parallel' ? styles.modeBtnOn : {})}}>parallel</button>
  <button onClick={() => setCutMode('offcenter')} style={{...styles.modeBtn, ...(cutMode === 'offcenter' ? styles.modeBtnOn : {})}}>off-center</button>
  <button onClick={() => setCutMode('p2p')} style={{...styles.modeBtn, ...(cutMode === 'p2p' ? styles.modeBtnOn : {})}}>p→p</button>
</div>
```

Change to:

```jsx
<div style={{...styles.modeRow, marginTop: 8}}>
  <HintRow hint={HINTS.cutMode_center}>
    <button onClick={() => setCutMode('center')} style={{...styles.modeBtn, ...(cutMode === 'center' ? styles.modeBtnOn : {})}}>center</button>
  </HintRow>
  <HintRow hint={HINTS.cutMode_parallel}>
    <button onClick={() => setCutMode('parallel')} style={{...styles.modeBtn, ...(cutMode === 'parallel' ? styles.modeBtnOn : {})}}>parallel</button>
  </HintRow>
  <HintRow hint={HINTS.cutMode_offcenter}>
    <button onClick={() => setCutMode('offcenter')} style={{...styles.modeBtn, ...(cutMode === 'offcenter' ? styles.modeBtnOn : {})}}>off-center</button>
  </HintRow>
  <HintRow hint={HINTS.cutMode_p2p}>
    <button onClick={() => setCutMode('p2p')} style={{...styles.modeBtn, ...(cutMode === 'p2p' ? styles.modeBtnOn : {})}}>p→p</button>
  </HintRow>
</div>
```

- [ ] **Step 3: Wrap cut-mode-specific sliders**

In `index.html`, lines 2070–2088:

```jsx
{cutMode === 'parallel' && (
  <Slider label="N" min={1} max={5} value={sliceCount} onChange={setSliceCount} suffix={`${sliceCount}`} />
)}
{cutMode === 'offcenter' && (
  <Slider label="d" min={1} max={95} value={offsetD} onChange={setOffsetD} suffix={`${offsetD}%`} />
)}
{cutMode === 'p2p' && (
  <>
    <Slider label="P₁" min={0} max={359} value={phi1} onChange={setPhi1} suffix={`${phi1}°`} />
    <Slider label="P₂" min={0} max={359} value={phi2} onChange={setPhi2} suffix={`${phi2}°`} />
  </>
)}
{cutMode !== 'p2p' && (
  <Slider label="θ°" min={0}
    max={cutMode === 'center' ? Math.round(180 / cutInfo.K_cuts) : 180}
    value={cutMode === 'center' ? Math.min(cutPhi, Math.round(180 / cutInfo.K_cuts)) : cutPhi}
    onChange={setCutPhi}
    suffix={`${cutMode === 'center' ? Math.min(cutPhi, Math.round(180 / cutInfo.K_cuts)) : cutPhi}°`} />
)}
```

Change to:

```jsx
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
```

- [ ] **Step 4: Wrap gap and seamOpen sliders**

Lines 2089–2090:

```jsx
<Slider label="gap" min={0} max={100} value={separation} onChange={setSeparation} suffix={`${separation}%`} />
<Slider label="open" min={0} max={100} value={seamOpen} onChange={setSeamOpen} suffix={`${seamOpen}%`} />
```

Change to:

```jsx
<HintRow hint={HINTS.gap}>
  <Slider label="gap" min={0} max={100} value={separation} onChange={setSeparation} suffix={`${separation}%`} />
</HintRow>
<HintRow hint={HINTS.seamOpen}>
  <Slider label="open" min={0} max={100} value={seamOpen} onChange={setSeamOpen} suffix={`${seamOpen}%`} />
</HintRow>
```

- [ ] **Step 5: Wrap blade controls**

Lines 2091–2107:

```jsx
{cutMode !== 'center' && (
  <>
    <div style={styles.bladeRow}>
      <span style={styles.bladeLabel}>blade</span>
      <button onClick={() => setBladeShape('straight')} style={{...styles.bladeBtn, ...(bladeShape === 'straight' ? styles.bladeBtnOn : {})}}>straight</button>
      <button onClick={() => setBladeShape('curved')} style={{...styles.bladeBtn, ...(bladeShape === 'curved' ? styles.bladeBtnOn : {})}}>curved</button>
      <button onClick={() => setBladeShape('zigzag')} style={{...styles.bladeBtn, ...(bladeShape === 'zigzag' ? styles.bladeBtnOn : {})}}>zig-zag</button>
      <button onClick={() => setBladeShape('custom')} style={{...styles.bladeBtn, ...(bladeShape === 'custom' ? styles.bladeBtnOn : {})}}>draw</button>
    </div>
    {bladeShape !== 'straight' && (
      <Slider label="amp" min={0} max={100} value={bladeAmount} onChange={setBladeAmount} suffix={`${bladeAmount}%`} />
    )}
    {bladeShape === 'custom' && (
      <BladeProfileEditor profile={bladeProfile} setProfile={setBladeProfile} N={PROFILE_N} />
    )}
  </>
)}
```

Change to:

```jsx
{cutMode !== 'center' && (
  <>
    <div style={styles.bladeRow}>
      <span style={styles.bladeLabel}>blade</span>
      <HintRow hint={HINTS.bladeShape_straight}>
        <button onClick={() => setBladeShape('straight')} style={{...styles.bladeBtn, ...(bladeShape === 'straight' ? styles.bladeBtnOn : {})}}>straight</button>
      </HintRow>
      <HintRow hint={HINTS.bladeShape_curved}>
        <button onClick={() => setBladeShape('curved')} style={{...styles.bladeBtn, ...(bladeShape === 'curved' ? styles.bladeBtnOn : {})}}>curved</button>
      </HintRow>
      <HintRow hint={HINTS.bladeShape_zigzag}>
        <button onClick={() => setBladeShape('zigzag')} style={{...styles.bladeBtn, ...(bladeShape === 'zigzag' ? styles.bladeBtnOn : {})}}>zig-zag</button>
      </HintRow>
      <HintRow hint={HINTS.bladeShape_custom}>
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
```

- [ ] **Step 6: Wrap cut visualization toggles**

Lines 2108–2111:

```jsx
<div style={styles.toggleRow}>
  <Toggle label="2D view" on={show2D} onChange={setShow2D} />
  <Toggle label="solo piece" on={hideOthers} onChange={setHideOthers} />
</div>
```

Change to:

```jsx
<div style={styles.toggleRow}>
  <HintRow hint={HINTS.show2D}>
    <Toggle label="2D view" on={show2D} onChange={setShow2D} />
  </HintRow>
  <HintRow hint={HINTS.hideOthers}>
    <Toggle label="solo piece" on={hideOthers} onChange={setHideOthers} />
  </HintRow>
</div>
```

Mirror all of Steps 1–6 in `gml_body.jsx`.

- [ ] **Step 7: Browser verification — every cut-popover row hints**

Refresh. Open the cut popover (click the ✂ Cut pill). Toggle `cut` ON. Hover each of: `cut`, `center / parallel / off-center / p→p`, `θ°`, `gap`, `open`. Switch to `parallel` mode → hover `N`. Switch to `offcenter` → hover `d`. Switch to `p2p` → hover `P₁`, `P₂`. Switch to a non-center mode → hover blade buttons (`straight / curved / zigzag / draw`) and `amp`. Hover `2D view`, `solo piece`.

Each must show its correct hint. The popover should fly **left** (since cut popover is bottom-right). At narrow widths it should auto-flip right.

- [ ] **Step 8: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(hints): wrap every cut-popover control with HintRow

Cut master toggle, cut-mode picker, mode-specific sliders, gap/open,
blade controls, and cut visualization toggles all show hints on
hover. Auto-flip places hints to the left of the bottom-right
popover."
```

---

## Task 7: Wrap every control in the sound popover

**Files:**
- Modify: `index.html` (lines ~2117–2141, the `soundControls` JSX fragment)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** Hover hints on the sound `p`, `q`, `Hz`, `amp` sliders and the play/stop button. The waveform display itself does not get a hint (it is a passive visualization).

- [ ] **Step 1: Wrap sound sliders and play button**

In `index.html`, lines 2117–2141 currently read:

```jsx
const soundControls = (
  <>
    <WaveformDisplay m={m} />
    <Slider label="p" min={0} max={8} value={pMode} onChange={setPMode} suffix={`${pMode}`} />
    <Slider label="q" min={0} max={6} value={qMode} onChange={setQMode} suffix={`${qMode}`} />
    <Slider label="Hz" min={50} max={1500} value={waveFreq} onChange={setWaveFreq} suffix={`${waveFreq}`} />
    <Slider label="amp" min={0} max={100} value={waveAmp} onChange={setWaveAmp} suffix={`${waveAmp}%`} />
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
  </>
);
```

Change to:

```jsx
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
    <HintRow hint={HINTS.wavePlay}>
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
```

Mirror in `gml_body.jsx`.

- [ ] **Step 2: Browser verification — every sound-popover row hints**

Refresh. Open the sound popover (click the ♪ Sound pill). Hover each of: `p`, `q`, `Hz`, `amp`, the play/stop button. Each shows the correct hint. `p` and `q` show rich popovers with the `phase = p·θ + q·φ − ωt` formula. The waveform display has no hint.

- [ ] **Step 3: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(hints): wrap every sound-popover control with HintRow

p/q/Hz/amp sliders and the play/stop button show hints on hover.
Modal numbers p and q render as rich hints with the phase formula."
```

---

## Task 8: Add `FirstRunHint` discovery line + sessionStorage suppression

**Files:**
- Modify: `index.html` (component near other components ~line 1197; styles ~line 3104; mount inside `MainPalette` and `MobileDrawer` content areas)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** A muted italic line at the bottom of the main palette and the mobile drawer that fades out on first hover or after 6 s, suppressed on subsequent palette mounts in the same tab.

- [ ] **Step 1: Add the first-run-hint style**

In `index.html`, in the `styles` object, add this key after the `hintPopoverFormula` key from Task 3:

```js
firstRunHint: {
  marginTop: 8,
  fontSize: 9,
  fontStyle: 'italic',
  color: 'rgba(246,239,225,0.35)',
  textAlign: 'center',
  letterSpacing: '0.05em',
  transition: 'opacity 200ms ease',
},
```

Mirror in `gml_body.jsx`.

- [ ] **Step 2: Add the `FirstRunHint` component**

In `index.html`, immediately after the `HintRow` definition added in Task 4, insert:

```js
function FirstRunHint({ mobile }) {
  const ctx = useContext(HoverHintContext);
  const [visible, setVisible] = useState(() => {
    try { return sessionStorage.getItem('gml.hint.seen') !== '1'; }
    catch { return true; }
  });
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => fadeOut(), 6000);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (ctx && ctx.hasHovered) fadeOut();
  }, [ctx && ctx.hasHovered, visible]);

  function fadeOut() {
    setOpacity(0);
    try { sessionStorage.setItem('gml.hint.seen', '1'); } catch {}
    setTimeout(() => setVisible(false), 220);
  }

  if (!visible) return null;
  const text = mobile ? 'tap labels for descriptions' : 'hover labels for descriptions';
  return <div style={{...styles.firstRunHint, opacity}}>{text}</div>;
}
```

Mirror in `gml_body.jsx`.

- [ ] **Step 3: Mount inside the main palette**

In `index.html`, the `MainPalette` component (line ~1041) currently ends:

```jsx
return (
  <div style={{...styles.palette, left: pos.x, top: pos.y}}>
    <div
      style={{...styles.paletteHeader, cursor: 'grab'}}
      ...
    >
      ...
    </div>
    {!collapsed && children}
  </div>
);
```

Change `{!collapsed && children}` to:

```jsx
{!collapsed && children}
{!collapsed && <FirstRunHint />}
```

Mirror in `gml_body.jsx`.

> Note: `<FirstRunHint>` is intentionally placed *outside* the `children` prop so the same `bodyControls` JSX fragment can still be reused inside the mobile drawer without double-rendering the hint.

- [ ] **Step 4: Mount inside the mobile drawer**

In `index.html`, the mobile drawer JSX (line ~2204):

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
</MobileDrawer>
```

Change to:

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

Mirror in `gml_body.jsx`.

- [ ] **Step 5: Browser verification — first-run-hint behavior**

Open a fresh tab to `http://localhost:8000/`. Expected:

- The line `hover labels for descriptions` appears at the bottom of the main palette.
- Hover any control row → after the popover appears, the line fades out (opacity 1 → 0 over 200 ms) and disappears within ~420 ms.
- Refresh in the same tab → line does not appear.
- Open in a fresh tab → line appears again.

To re-test the 6 s timeout: open a fresh tab and don't hover anything. Wait 6 s. Expected: line fades out automatically, even with no hover.

To re-test mobile copy: shrink the window below 720 px → drawer mode. Open a fresh tab at narrow width. Expected: line at the bottom of the drawer reads `tap labels for descriptions`.

To clear `sessionStorage` for re-testing: in DevTools console run `sessionStorage.removeItem('gml.hint.seen')` then refresh.

- [ ] **Step 6: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(hints): add FirstRunHint discovery line

Once-per-session muted line at the bottom of the main palette and
mobile drawer. Fades out on first hover or after 6 s. Suppressed on
subsequent palette mounts via sessionStorage['gml.hint.seen']."
```

---

## Task 9: Mobile tap behavior — tap-on-label and tap-and-hold-on-mode-button

**Files:**
- Modify: `index.html` (extend `HintRow` with mobile branch; add tap-and-hold helpers)
- Modify: `gml_body.jsx` (mirror)

**What this task delivers:** On `isMobile`, the user can tap a slider label (`m`, `R`, etc.) to toggle a hint, and tap-and-hold (≥ 350 ms) a mode button to peek a hint. Outside taps dismiss.

- [ ] **Step 1: Extend `HintRow` with mobile-touch support**

In `index.html`, replace the `HintRow` definition from Task 4 with:

```js
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

  // Mobile: tap-and-hold on fully-interactive rows (modeButton); tap-on-label for sliders.
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
      // Slider row: tap the label span (non-interactive) to toggle hint. Slider thumb,
      // editable number input, and any descendant button are skipped so they keep their behavior.
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

  // If the long-press fired (heldRef.current is true), suppress the synthetic click that
  // would otherwise activate the underlying button/toggle on finger-lift. Capture phase
  // runs before the child's React onClick so stopPropagation actually prevents activation.
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
```

Mirror in `gml_body.jsx`.

> Why a `modeButton` prop: any row whose entire surface is interactive — meaning a tap activates a button rather than landing on inert label text — needs tap-and-hold semantics to coexist with the normal short-tap activation. This includes mode buttons (path-shape, cut-mode, blade-shape), every `<Toggle>` (the toggle's label is part of the button), and the play/stop button. Slider rows have a non-interactive label `<span>` the user can tap, so they keep tap-on-label semantics.

- [ ] **Step 2: Pass `modeButton` to every wrapped row that is fully interactive**

Add `modeButton` as a flag prop on every `<HintRow>` whose child is a `<button>` or `<Toggle>`. Concretely, in both `index.html` and `gml_body.jsx`:

**Path-shape mode buttons (4)** — Task 5 Step 1:

```jsx
<HintRow hint={HINTS.pathShape_circle} modeButton>...</HintRow>
<HintRow hint={HINTS.pathShape_ellipse} modeButton>...</HintRow>
<HintRow hint={HINTS.pathShape_knot} modeButton>...</HintRow>
<HintRow hint={HINTS.pathShape_lemniscate} modeButton>...</HintRow>
```

**Display toggles (3)** — Task 5 Step 4:

```jsx
<HintRow hint={HINTS.autoRotate} modeButton>...</HintRow>
<HintRow hint={HINTS.ridges} modeButton>...</HintRow>
<HintRow hint={HINTS.gradient} modeButton>...</HintRow>
```

**Cut master toggle (1)** — Task 6 Step 1:

```jsx
<HintRow hint={HINTS.cut} modeButton>...</HintRow>
```

**Cut-mode buttons (4)** — Task 6 Step 2:

```jsx
<HintRow hint={HINTS.cutMode_center} modeButton>...</HintRow>
<HintRow hint={HINTS.cutMode_parallel} modeButton>...</HintRow>
<HintRow hint={HINTS.cutMode_offcenter} modeButton>...</HintRow>
<HintRow hint={HINTS.cutMode_p2p} modeButton>...</HintRow>
```

**Blade-shape buttons (4)** — Task 6 Step 5:

```jsx
<HintRow hint={HINTS.bladeShape_straight} modeButton>...</HintRow>
<HintRow hint={HINTS.bladeShape_curved} modeButton>...</HintRow>
<HintRow hint={HINTS.bladeShape_zigzag} modeButton>...</HintRow>
<HintRow hint={HINTS.bladeShape_custom} modeButton>...</HintRow>
```

**Cut visualization toggles (2)** — Task 6 Step 6:

```jsx
<HintRow hint={HINTS.show2D} modeButton>...</HintRow>
<HintRow hint={HINTS.hideOthers} modeButton>...</HintRow>
```

**Play/stop button (1)** — Task 7 Step 1:

```jsx
<HintRow hint={HINTS.wavePlay} modeButton>...</HintRow>
```

**Slider rows do NOT get `modeButton`** — they have inert label spans for tap-on-label.

Total: 19 wrappers gain the `modeButton` flag (4 path-shape buttons, 3 display toggles, 1 cut master toggle, 4 cut-mode buttons, 4 blade-shape buttons, 2 cut-visualization toggles, 1 play/stop button). The 22 slider wrappers (1 m, 1 n, up to 8 path-contextual depending on mode, 5 cut-mode-specific including θ°, gap, seamOpen, bladeAmount, and 4 sound sliders) do not. Mirror every change in `gml_body.jsx`.

- [ ] **Step 3: Add outside-tap dismissal**

In `index.html`, in `<HoverHintProvider>`, extend the body to add a document-level pointerdown listener that clears the hint when the tap lands outside any control:

```js
useEffect(() => {
  if (!activeHint) return;
  const onDocPointerDown = (e) => {
    if (e.pointerType === 'mouse') return; // mouse path uses pointerleave
    // If tap is inside any HintRow (its boundingClientRect contains the point), keep it; otherwise clear.
    if (activeHint && activeHint.rect) {
      const r = activeHint.rect;
      const x = e.clientX, y = e.clientY;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return;
    }
    setActiveHint(null);
  };
  document.addEventListener('pointerdown', onDocPointerDown);
  return () => document.removeEventListener('pointerdown', onDocPointerDown);
}, [activeHint]);
```

Add this `useEffect` inside `HoverHintProvider`, after the `cancelPending` declaration and before the `return`. Mirror in `gml_body.jsx`.

- [ ] **Step 4: Browser verification — mobile interactions**

Resize to 600 px width (drawer mode). Verify:

1. Tap the `m` label text → popover appears above the row.
2. Tap the `R` label (after switching path shape if needed) → popover switches.
3. Tap the same `m` label again → popover hides.
4. Tap outside the drawer entirely → popover hides.
5. Drag the `m` slider thumb → still works; no popover.
6. Click the editable number input → focusable, typable; no popover.
7. Tap-and-hold a mode button (e.g. `parallel`) for ≥ 350 ms → popover appears. Release → popover hides.
8. Short-tap the same `parallel` button → button activates (changes the cut mode), no popover.
9. Tap-and-hold a toggle (e.g. `auto-rotate`) for ≥ 350 ms → popover appears with terse text; the toggle does NOT toggle. Release → popover hides; toggle is still in its prior state.
10. Short-tap the same `auto-rotate` toggle → it toggles on/off as normal; no popover.
11. Tap-and-hold the `▶ Play` button for ≥ 350 ms → popover appears. Short-tap → audio starts/stops as normal.

Use Chrome DevTools "Device Mode" with touch emulation, or test on a real touch device.

- [ ] **Step 5: Commit**

```bash
git add index.html gml_body.jsx
git commit -m "feat(hints): mobile tap behavior — label-tap and mode-button hold

HintRow grows a modeButton prop that switches its mobile gesture from
tap-toggle (slider/toggle labels) to tap-and-hold-350ms (mode
buttons). Outside-tap dismissal added to the provider effect."
```

---

## Task 10: Final verification + two-file mirror diff check

**Files:** None modified. Verification only.

**What this task delivers:** Confidence that the spec verification checklist passes end-to-end and that `index.html` and `gml_body.jsx` are byte-equivalent (modulo the documented top-of-file delta).

- [ ] **Step 1: Run the spec's verification checklist**

Walk through every item under "Verification" in the spec (`docs/superpowers/specs/2026-05-06-parameter-hover-hints-design.md`) — items 1 through 10. Mark each pass/fail in this checklist (write the result inline if any fails). Expected: all pass.

- [ ] **Step 2: Diff `index.html` and `gml_body.jsx`**

```bash
diff <(awk 'NR>3' index.html) <(awk 'NR>3' gml_body.jsx) | head -40
```

Skip the imports/destructuring delta at the top. Expected: differences confined to the documented top-of-file block (the `import` lines vs. `const { ... } = React;`) and the trailing comment delimiter only. If any difference appears in the middle of the file, mirror the missing edit.

- [ ] **Step 3: Visual smoke test of all five layout states**

Open `http://localhost:8000/` in a fresh tab (clear `sessionStorage` first). Walk through:

1. **Desktop, default state**: Hover `m`, `n`, `R` → all hints work; first-run line shows then fades.
2. **Desktop, knot path**: Switch to `knot`. Hover `p`, `q` → rich hints with coprime warning.
3. **Desktop, cut popover open**: Click ✂ Cut, toggle cut on. Hover every control. Tooltip flies left; auto-flips at narrow widths.
4. **Desktop, sound popover open**: Click ♪ Sound. Hover `p`, `q`, `Hz`, `amp`, play button. Modal `p, q` show formula.
5. **Mobile drawer**: Resize < 720 px. Tap labels work; tap-and-hold mode buttons work; outside-tap dismisses; first-run line shows `tap labels for descriptions`.

- [ ] **Step 4: Final commit (verification metadata only, if any failures were fixed)**

If Step 1 found any issues that needed fixing, commit them now under `fix(hints): <whatever>`. Otherwise no commit.

- [ ] **Step 5: Update CLAUDE.md (if applicable)**

If the new `<HintRow>` / `HoverHintProvider` pattern materially changes the file's "code architecture" mental model, append a short paragraph under "Code architecture" in `CLAUDE.md` describing the hover-hint layer. Otherwise skip.

Suggested addition (paste verbatim if added):

```markdown
**Hint layer:**
A `HoverHintProvider` near the top of `<GMLBody>` and a `<HintPopover>` portal-mounted at document level handle hover-revealed parameter explanations. Each control row is wrapped in `<HintRow hint={HINTS.<id>}>`; the centralized `HINTS` object near the top of the file is the single source of truth for hint copy. Mode-button rows pass `modeButton` for tap-and-hold-350ms semantics on mobile; slider/toggle rows use tap-on-label.
```

Commit:

```bash
git add CLAUDE.md
git commit -m "docs: describe the hover-hint layer in CLAUDE.md"
```

---

## Self-review summary

- Every spec section (interaction desktop/mobile, first-run hint, positioning, architecture, content table, verification) has at least one task that implements it. The full HINTS table in Task 2 covers every entry from the spec's content table.
- No placeholders. Every code block is the actual code to paste.
- Type/method names are consistent: `HoverHintContext`, `HoverHintProvider`, `HintRow`, `HintPopover`, `FirstRunHint`, `HINTS`, `register/clear/cancelPending/hasHovered`, `activeHint = { rect, content, side }`, hint shapes `{ kind: 'terse', text }` and `{ kind: 'rich', title, body, formula? }` — used identically in every task that references them.
- Two-file mirror is restated at the top of every task that modifies code.
- Verification is browser-only (no test runner exists in this project) and each task's verification step is concrete: a specific control to hover, a specific text to read, a specific console state.
