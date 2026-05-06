# Parameter hover-hints — popover explanations for every control

**Status:** Design approved 2026-05-06
**Scope:** Add a hover-revealed popover explanation system for every parameter (sliders, toggles, mode-buttons) in the controls UI. Purely additive UI — no changes to the math layer, geometry builders, audio pipeline, or the existing palette layout from the controls-panel-redesign.

## Goal

The redesign moved every control into floating palettes (main top-left palette + cut/sound popovers + mobile drawer). The dense set of mathematically-named parameters — `m`, `n`, `p`, `q`, `R`, `r`, `a`, `b`, `τ`, `P₁`, `P₂`, `θ°`, `gap`, `open`, `amp`, `N`, `d`, plus the toggles and mode pickers — is still hard to use without prior context. Add hover-revealed popovers so the meaning of every control is one cursor-rest away, without bloating the panels themselves or introducing a separate help page.

## Non-goals

- No tutorial/onboarding modal, no help page, no separate "intro" mode.
- No new icons, badges, or `?` markers in any control row — the visual style of the redesign stays as-is.
- No changes to math, 3D rendering, audio, picking, or the layout/positioning of any palette.
- No keyboard shortcuts to "open all hints" or to navigate through hints.
- No animated cross-fade between hints; instant swap is fine.
- No localization / i18n in this pass (the content object is structured to make a future i18n cheap, but it is not done now).
- No `aria-describedby` linkage / formal a11y treatment in this pass; flagged as a follow-up.

## Interaction

### Desktop

- Hover any control row (slider, toggle, the mode-button row, the blade-button row) for **220 ms** → `<HintPopover>` appears, anchored adjacent to the row.
- While the popover is shown, moving the cursor to a different hint-armed row swaps the content **instantly** (no second 220 ms delay). The 220 ms delay only applies to going from "no hint shown" to "hint shown".
- Cursor leaves the panel (or moves to a non-hint area) → popover hides immediately.
- The popover never intercepts pointer events (`pointer-events: none` on its DOM node) so the row underneath stays fully clickable. Slider thumbs, editable number inputs, and toggle bodies keep their existing behavior unchanged.

### Mobile (`isMobile === true`, viewport width < 720 px)

- Tap on the **label text** of a row (the `m`, `R`, `auto-rotate` text — the part with no other behavior) toggles a popover for that row.
- Slider thumbs, editable number inputs, and toggle bodies keep their existing behavior. The label area is what becomes the hint trigger.
- For mode-button rows (`circle / ellipse / knot / figure-8`, `center / parallel / off-center / p→p`, blade buttons): tap-and-hold for ≥ 350 ms shows the hint for the button under the finger. Hint hides when the finger lifts OR slides off the button. A short tap (< 350 ms) is a normal button activation with no hint shown.
- Tap outside any popover dismisses.
- Only one mobile hint open at a time.

### First-run discoverability hint

- A 9 px italic muted line appears at the bottom of `<MainPalette>` (and at the bottom of `<MobileDrawer>` on mobile) on first session-mount:
  - Desktop copy: `hover labels for descriptions`
  - Mobile copy: `tap labels for descriptions`
- Fades out (200 ms opacity transition) either:
  - **6 s** after first paint, or
  - immediately when `activeHint` first becomes non-null (i.e. the user has discovered the system on their own),

  whichever happens first.
- Suppressed on subsequent palette mounts within the same tab via `sessionStorage['gml.hint.seen'] = '1'` (set when the line begins fading).

## Positioning

A single `<HintPopover>` is rendered via `ReactDOM.createPortal` into `document.body`. It reads `activeHint = { rect, content, side }` from a context provider rooted in `<GMLBody>`, where `rect = trigger.getBoundingClientRect()` is captured at the moment the hint is registered.

Auto-flip placement rule:

1. Default side is the side of the trigger row with more horizontal space relative to the viewport:
   - Main palette (top-left) → tooltip flies **right**.
   - Cut/Sound popovers (bottom-right) → tooltip flies **left**.
   - Mobile drawer rows → tooltip flies **above** (drawer occupies the bottom).
2. If the chosen side would clip the viewport (popover's projected rect exceeds `[0, viewportWidth] × [0, viewportHeight]`), flip to the opposite horizontal side. If both horizontal sides clip, anchor above the trigger.
3. 8 px gap between the trigger rect and the popover edge.
4. After flip, clamp to viewport with a 6 px margin (no popover edge closer than 6 px to any viewport edge).

Visual:

- Background: `linear-gradient(180deg, rgba(28,21,18,0.96), rgba(20,15,12,0.96))` with `backdrop-filter: blur(14px)` — same as the palettes.
- Border: 1 px `#4a3026`, `border-radius: 8px`.
- Padding: 12 px.
- `max-width: 240px`.
- Drop shadow: `0 8px 32px rgba(0,0,0,0.4)` plus inner highlight `inset 0 1px 0 rgba(255,180,120,0.08)`.
- Font: monospace stack `'JetBrains Mono', SFMono-Regular, Menlo, monospace`. 11 px body, 9 px formula in `#9a7058`.
- Title (rich kind only): 10 px uppercase, `#c78659`, letter-spacing `0.18em`, margin-bottom 6 px.
- Body color: `#e8a673`. Formula color: `#9a7058`.
- No arrow / no tail — keeps the visual clean.
- `z-index: 30` (above palettes at 10 and cut/sound popovers at 20, below the 2D modal at 21).

## Architecture

### New components

All inside the existing `index.html` `<script type="text/babel">` block. The same edits are mirrored byte-identically into `gml_body.jsx` (per the project's two-file mirror convention in `CLAUDE.md`).

- `<HoverHintProvider>` — a React context provider rendered once near the top of `<GMLBody>`'s JSX, just inside the root div. Owns:
  - `activeHint: { rect, content, side } | null`
  - `hasHovered: boolean` — set true when `activeHint` first becomes non-null
  - `register(rect, content)` / `clear()` — used by hint triggers
  - The 220 ms timer ref
  - The `sessionStorage` reads/writes for `gml.hint.seen`
- `<HintRow hint>{children}</HintRow>` — wraps a slider/toggle/mode-row. On `pointerenter`, starts the 220 ms timer (or registers immediately if a hint is already active); on `pointerleave`, clears timer + hint. On mobile, attaches the tap-to-toggle handler to its inner label element via a `data-hint-label` selector. Pointer events on inner inputs (range thumb, number input, toggle button) keep working — the wrapper only adds listeners; it does not intercept.
- `<HintPopover>` — rendered via `ReactDOM.createPortal` into `document.body`. Reads `activeHint` from context, computes placement from `rect` per the auto-flip rule, renders the content. `pointer-events: none`.
- `<FirstRunHint>` — a small fading line at the bottom of `<MainPalette>` and `<MobileDrawer>`. Reads `hasHovered` (from context) and the `sessionStorage` flag to decide whether to render. Has its own 6 s timer for the timeout fallback.

### Content prop shape

```js
{ kind: 'terse',  text: '...' }
{ kind: 'rich',   title: '...', body: '...', formula?: '...' }
```

`<HintPopover>` switches on `kind`. Renders are pure — no internal state.

### Hint content registry

A single object near the top of the file (above `GMLBody`), keyed by a stable hint-id string:

```js
const HINTS = {
  m: { kind: 'rich', title: 'Polygon sides', body: '...', formula: '...' },
  n: { kind: 'rich', title: 'Twist count',   body: '...', formula: '...' },
  R_circle: { kind: 'terse', text: 'Major radius — distance from the center of the torus to the center of the cross-section.' },
  // ...
};
```

Each `<HintRow>` references a `HINTS` entry by id (`<HintRow hint={HINTS.m}>`). Single source of truth, easy to scan, easy to localize later.

### Why no per-component `hint` prop on `<Slider>` / `<Toggle>`

The `<Slider>` and `<Toggle>` definitions stay byte-identical to today. The `<HintRow>` wrapper is what carries hint behavior. This keeps the existing component contracts unchanged and means the redesign's `<MainPalette>` / `<MobileDrawer>` children can be wrapped without any internal-component edits.

### Integration with the controls-panel-redesign

- `<HoverHintProvider>` is mounted once at the top of `<GMLBody>`'s returned JSX, wrapping everything else.
- The desktop layout (main palette + cut/sound popovers + info strip) and the mobile drawer all read from the same provider — there is one `<HintPopover>` portal regardless of which layer is active.
- `bodyControls`, `cutControls`, `soundControls` (the JSX fragments computed in `<GMLBody>` per the redesign) wrap each individual control row with `<HintRow hint={HINTS.<id>}>`. Same children rendered in either desktop palettes or mobile drawer per the redesign — no duplication.

### State summary (added to `<GMLBody>` / context)

```js
const [activeHint, setActiveHint] = useState(null);   // { rect, content, side } | null
const [hasHovered, setHasHovered] = useState(false);  // gates first-run hint
const hintTimerRef = useRef(null);                    // 220 ms delay timer
```

Plus `sessionStorage['gml.hint.seen']` for the first-run-hint suppression across palette remounts.

## Behavior deltas to non-UI code

**None.** This is purely additive React UI. No effects on:

- `rebuild` and its `useEffect` deps
- the rAF tick loop, sound mode, picking
- the math layer, geometry builders, blade profile editor
- existing event handlers (`onChange`, `onClick`) on `<Slider>`, `<Toggle>`, mode-button `<button>`s

## Content table

Each row below is one entry in `HINTS`. **Hint id** is the lookup key; **kind** is `terse` or `rich`; **content** is the displayed text.

### Path-shape mode buttons (main palette)

| Hint id | Kind | Content |
|---|---|---|
| `pathShape_circle` | terse | `Center-path is a circle (the standard torus).` |
| `pathShape_ellipse` | terse | `Center-path is an ellipse with independent semi-axes.` |
| `pathShape_knot` | terse | `Center-path is a (p,q) torus knot — winds around the symmetry axis p times and around the tube q times.` |
| `pathShape_lemniscate` | terse | `Center-path is a figure-8 (Bernoulli lemniscate).` |

### Path-shape parameters (main palette, contextual)

| Hint id | Kind | Content |
|---|---|---|
| `R_circle` | terse | `Major radius — distance from the center of the torus to the center of the cross-section.` |
| `a_ellipse` | terse | `Ellipse semi-axis along the X direction.` |
| `b_ellipse` | terse | `Ellipse semi-axis along the Z direction.` |
| `R_knot` | terse | `Major radius of the torus the knot winds around.` |
| `r_knot` | terse | `Tube radius — how far the knot deviates from the underlying torus surface.` |
| `p_knot` | rich | title: `Path winding p`. body: `Number of times the (p,q) torus knot winds around the symmetry axis. Must be coprime to q — the UI auto-bumps q if you'd break that.` |
| `q_knot` | rich | title: `Tube winding q`. body: `Number of times the (p,q) torus knot winds around the tube. Must be coprime to p — the UI auto-bumps p if you'd break that.` |
| `a_lemniscate` | terse | `Overall scale of the figure-8 path.` |

### GML core parameters (main palette)

| Hint id | Kind | Content |
|---|---|---|
| `n` | rich | title: `Twist count`. body: `The cross-section rotates n/m turns as it traces the path. The classical Möbius strip is m=2, n=1.` formula: `α = (n/m)·θ` |
| `m` | rich | title: `Polygon sides`. body: `The cross-section is a regular m-gon. m=2 collapses to a flat strip (Möbius band when n is odd).` formula: `pieces after a center cut = m / gcd(2n, m)` |

### Display toggles (main palette)

| Hint id | Kind | Content |
|---|---|---|
| `autoRotate` | terse | `Spin the model on its vertical axis. Off when you want to study a specific orientation.` |
| `ridges` | terse | `Show the m-gon edges along the surface. Disabled while the body is cut.` |
| `gradient` | terse | `Color the surface with a θ-based gradient. Off shows flat per-piece colors.` |

### Cut master toggle and modes (cut popover)

| Hint id | Kind | Content |
|---|---|---|
| `cut` | terse | `Slice the body along a chord through the cross-section. Open the cut popover for shape and mode controls.` |
| `cutMode_center` | terse | `Cut along chords through the polygon center. Diametric cuts.` |
| `cutMode_parallel` | terse | `Cut along multiple parallel chords. Slices the body into slabs.` |
| `cutMode_offcenter` | terse | `Cut along a single chord offset from the center by a fixed distance.` |
| `cutMode_p2p` | terse | `Point-to-point: cut along a chord from one cross-section vertex to another.` |

### Cut-mode-specific sliders (cut popover)

| Hint id | Kind | Content |
|---|---|---|
| `sliceCount` | terse | `Number of parallel chord cuts through the cross-section.` |
| `offsetD` | terse | `Off-center cut: distance of the chord from the polygon center, as % of the inradius.` |
| `phi1` | terse | `First vertex angle for the point-to-point cut. The chord starts at the cross-section vertex closest to this angle.` |
| `phi2` | terse | `Second vertex angle for the point-to-point cut. The chord ends at the cross-section vertex closest to this angle.` |
| `cutPhi` | terse | `Rotation of the cut chord within the cross-section.` |

### Cut spacing sliders (cut popover)

| Hint id | Kind | Content |
|---|---|---|
| `gap` | terse | `Pulls the cut pieces apart so you can see them as separate solids. 0 = touching.` |
| `seamOpen` | terse | `Opens up the seam at the cut surface. Lets you see the cut without separating the pieces.` |

### Blade controls (cut popover, non-center modes only)

| Hint id | Kind | Content |
|---|---|---|
| `bladeShape_straight` | terse | `Cut surface is a flat plane.` |
| `bladeShape_curved` | terse | `Cut surface is a smooth concave/convex curve.` |
| `bladeShape_zigzag` | terse | `Cut surface follows a sawtooth profile along the chord.` |
| `bladeShape_custom` | terse | `Cut surface follows a profile you draw below.` |
| `bladeAmount` | terse | `Amount of curvature/zigzag/profile applied to the cut surface.` |

### Cut visualization toggles (cut popover)

| Hint id | Kind | Content |
|---|---|---|
| `show2D` | terse | `Show the 2D cross-section diagram in a corner overlay.` |
| `hideOthers` | terse | `Hide every piece except the highlighted one. Click a piece-dot or the body itself to pick which.` |

### Sound parameters (sound popover)

| Hint id | Kind | Content |
|---|---|---|
| `pMode` | rich | title: `Modal number p`. body: `Spatial mode along θ that drives the per-vertex color sweep. Higher numbers, finer ripples.` formula: `phase = p·θ + q·φ − ωt` |
| `qMode` | rich | title: `Modal number q`. body: `Spatial mode along φ that drives the per-vertex color sweep. Higher numbers, finer ripples.` formula: `phase = p·θ + q·φ − ωt` |
| `waveFreq` | terse | `Audio frequency of the polygon waveform, in Hz.` |
| `waveAmp` | terse | `Output volume.` |
| `wavePlay` | terse | `Start or stop the looping polygon waveform. Color-sweep visualization stays live regardless.` |

## Verification

Manual / browser only — no test runner exists in this project.

1. **Rich hint with formula.** Hover `m` slider → popover appears 220 ms later, shows title `Polygon sides`, body, and `K_cuts` formula. Move cursor to `n` → switches instantly without second delay; new content correct. Move cursor off panel → vanishes.
2. **Path-contextual hints.** Switch to `circle`, hover `R` → terse one-liner. Switch to `ellipse`, hover `a` and `b` → each gets the right one-liner. Switch to `knot`, hover `p` → rich popover with coprime-warning text.
3. **Cut popover hints.** Open cut popover, hover `gap`, `open`, `θ°`, blade `amp` → each shows correctly. Tooltip flies left (cut popover is bottom-right). Verify auto-flip: at narrow viewport widths, the tooltip flips to the right of the cut popover when the left side would clip.
4. **Sound popover hints.** Open sound popover, hover `p` → rich with formula. Hover `Hz`, `amp` → terse.
5. **Mobile drawer.** Resize to 600 px width. Tap `m` label → popover appears above the row. Tap `R` label → switches. Tap outside drawer → hides. Tap-and-hold a mode button (e.g. `parallel`) for ≥ 350 ms → its hint shows. Short tap → button activates normally, no hint.
6. **First-run hint timing.** Fresh tab → `hover labels for descriptions` line appears at bottom of main palette. Hover any row → line fades out within 200 ms. Reload (same tab) → line does not show. Open the page in a fresh tab → line shows.
7. **First-run hint timeout.** Fresh tab, do nothing for 6 s → line fades out automatically. `sessionStorage['gml.hint.seen']` is set.
8. **Pointer-events safety.** While popover is shown, click the slider thumb under it and drag → still works, popover does not block the drag. Click the editable number input under it → focusable, typable.
9. **No regressions.** Cut + sound modes still drive geometry / audio / color exactly as before. Picking, click-vs-drag, pinch-zoom, and orbit highlight unchanged.
10. **Two-file mirror.** Diff `index.html` and `gml_body.jsx` — only the imports/destructuring at the top should differ. Every other change is byte-identical.

## Implementation order

The work decomposes into chunks; the implementation plan will detail each. The order keeps every commit a runnable app:

1. Add `<HoverHintProvider>` context, the `activeHint` / `hasHovered` state, the 220 ms timer ref. No UI changes yet.
2. Add `<HintPopover>` component and its portal. Mount it once. With no `<HintRow>` triggers wired, it's never visible.
3. Add the `HINTS` registry (the full content table above), and `<HintRow>` wrapper component. Wire it into one row (e.g. `m`) for end-to-end smoke testing.
4. Wrap every slider, toggle, and mode-row in the main palette (desktop + drawer) with `<HintRow>`.
5. Wrap every control in the cut popover (and its drawer mirror).
6. Wrap every control in the sound popover (and its drawer mirror).
7. Add the `<FirstRunHint>` component, mount it inside `<MainPalette>` and `<MobileDrawer>`. Hook up the 6 s timer and `sessionStorage` flag.
8. Mobile: add tap-to-toggle on label text + tap-and-hold on mode buttons. Handle outside-tap dismissal.
9. Run the verification checklist end-to-end.

After every step (not just at the end), the matching change is mirrored byte-identically into `gml_body.jsx` per the project's two-file mirror convention. The diff between the two files must remain limited to the import/destructuring lines at the top.

## Out of scope (callouts so they aren't lost)

- Keyboard navigation through hints (focus → hint).
- A11y: `aria-describedby` linkage between trigger and popover. Doable cheaply but adds review surface; flagged as a follow-up.
- Localized copy / i18n. The `HINTS` object is structured so a future swap is mechanical.
- Animated cross-fade between hints. Default is instant swap.
- Persistent "I've seen the hint" flag across tabs (current scope is per-tab via `sessionStorage`).
- Hint copy for the `τ` info-strip readout (the strip is read-only and lives outside the controls — covered if/when it gets an interactive treatment).
