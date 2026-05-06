# Intro / walkthrough — combined concept intro + UI tour

**Status:** Design approved 2026-05-06
**Scope:** Add a single onboarding flow that introduces *what a Generalized Möbius–Listing body is* and *how to drive the app*. Combined: 3 intro steps explaining the math (with inline mini-diagrams) followed by 4 walkthrough steps with connector lines pointing at real controls. Lives over the live 3D scene without darkening or blocking it.

## Goal

A first-time visitor lands on a rotating GML body with no idea what they are looking at, why the parameters `m` and `n` matter, or what "cutting" means here. The hover-hints already in place answer "what does this slider do" — the intro/walkthrough answers "what is this thing and how do I play with it." It runs once on first visit, can be replayed at any time from a `?` button, and is non-blocking — controls and the 3D scene keep working underneath.

## Non-goals

- No quizzes, gating, or progress that prevents the user from interacting with the app while the tour is up.
- No video, animation reels, or any external asset (every visual is an inline SVG drawn from the existing math layer).
- No darkening / spotlight cutout / dimmed backdrop. The 3D scene stays fully visible.
- No tutorial-mode or "guided practice" sub-mode (no "now try clicking the cut button" with completion detection).
- No multi-language support / i18n in this pass.
- No keyboard navigation through the tour (`Esc` is not even bound — tour close uses the `×` button or `Skip`/`Done`). Flagged as a follow-up.
- No A11y treatment beyond visible-focus on the buttons (no `aria-live` for the step content). Flagged as a follow-up.

## Steps

7 steps, copy frozen here (any future copy edits go in `TOUR_STEPS` at module top).

### Intro (steps 1–3)

Each intro step shows a small inline SVG diagram (~120 px) drawn from existing math primitives — no new asset pipeline.

1. **Welcome** — *"This is a Generalized Möbius–Listing body — a closed loop whose cross-section is a regular polygon that twists as it travels. You'll cut it, listen to it, and reshape it."* Diagram: a small torus outline with an m-gon profile (m=4) traced at one angular position, sweeping around the path.
2. **m and n** — *"**m** = sides of the cross-section polygon. **n** = how many m-gon-vertex steps the polygon rotates per full loop. m=2, n=1 is the classical Möbius strip."* Diagram: two side-by-side mini cross-sections — one labeled `m=3, n=1`, one labeled `m=6, n=2`, each rendered with `polygonBoundary`.
3. **Cuts** — *"Slice the body along a chord through the cross-section. Some chord positions split it into multiple connected pieces; others leave it whole. The piece count comes from m / gcd(2n, m)."* Diagram: a hexagonal cross-section with a horizontal chord and the resulting two regions colored using `findAllRegions`.

### Walkthrough (steps 4–7)

Each walkthrough step has a `target` — a DOM element identified by `data-tour="<id>"` — and renders a connector line + soft outline around the target. No diagram in the card body, just title + body copy.

4. **The canvas** — target `canvas`. *"Drag to rotate, scroll or pinch to zoom. Click a piece to isolate; click again to clear."*
5. **Body palette** — target `mainPalette`. *"Change the path shape (circle, ellipse, knot, figure-8), m, and n here. Toggle ridges, gradient, auto-rotate."*
6. **Cut & Sound** — target `pillRow`. *"✂ opens cut controls — chord position, blade shape, gap. ♪ plays the polygon's waveform as audio."*
7. **Hints** — target `mLabel`. *"Hover any label for a description. Press `?` (top of palette) to replay this tour."*

## Card layout

Single floating card, fixed-position, anchored bottom-center on desktop and bottom-of-mobile-drawer on mobile. Width 340 px desktop, `min(92vw, 360px)` mobile.

Visual:

- Background: `linear-gradient(180deg, rgba(28,21,18,0.96), rgba(20,15,12,0.96))` with `backdrop-filter: blur(14px)`.
- Border: 1 px `rgba(199,134,89,0.28)`, `border-radius: 10 px`.
- Padding: 16 px.
- Drop shadow: `0 8px 32px rgba(0,0,0,0.4)` plus `inset 0 1px 0 rgba(255,180,120,0.08)`.
- `z-index: 32` (above the 31-z connector overlay; above palettes at 10, popovers at 20, hint popover at 30).

Position:

- Desktop: `bottom: 86px` (clears the bottom pill row at `bottom: 18px` + 60 px pill height + a small gap), `left: 50%, transform: translateX(-50%)`.
- Mobile: when the drawer is open, the card is anchored 12 px above the top edge of the drawer (or `bottom: <drawer height + 12 px>`); when closed (briefly, before the auto-open kicks in for steps 4–7), `bottom: 50px`.

Layout:

- Header row: step indicator `step <i> / 7` (10 px monospace, muted) on the left; close `×` button on the right.
- Title row (visible only when step has a `title`): 10 px uppercase amber, letter-spacing 0.18em, margin-bottom 6 px.
- Body row: 11 px monospace, color `#e8a673`, line-height 1.45.
- Diagram row (intro steps only): 120 px tall inline SVG, centered.
- Footer row: `Skip` button on the left (text-only, muted); `Prev` and `Next` buttons on the right (pill-style matching the existing `Pill` component aesthetic). On step 1 the `Prev` slot is empty; on step 7 the `Next` button reads `Done`.

Animations:

- Card mount: 200 ms opacity fade-in.
- Body row content cross-fades on step change: 180 ms opacity 1 → 0 → 1.
- The diagram changes between steps 1/2/3 with the same 180 ms cross-fade.
- No card-position animation between steps (it stays put).

## Connector + target outline (UI-tour steps only)

A single full-viewport SVG overlay, `position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 31`. Recomputes on every step change and on `window.resize`.

Resolution: each `target` string ∈ {`canvas`, `mainPalette`, `pillRow`, `mLabel`} is mapped to a DOM element via `document.querySelector('[data-tour="<target>"]')`. If `null` (target not in DOM yet), the connector renders nothing for this step. (E.g. `mLabel` is always present; `pillRow` is desktop-only — on mobile the targets shift to `data-tour="mobileCutSection"` etc. — see Mobile section.)

Render:

- A 1 px amber rectangle (`stroke: rgba(233,163,107,0.65); stroke-width: 1; fill: none`) traced around the target's `getBoundingClientRect()` with 4 px expansion on each side, plus a 6 px Gaussian-blur amber glow filter.
- A 1.5 px amber polyline from the closest edge midpoint of the card's bounding rect that faces the target, to the closest edge midpoint of the target's bounding rect. One 90° bend if a straight line would cross the card's body (specifically: if the polyline endpoints aren't collinear in the dominant axis). Approximation: if `|cardCenter.x − targetCenter.x| > |cardCenter.y − targetCenter.y|`, route horizontally first then vertically; otherwise vertically first then horizontally.
- 200 ms opacity fade-in on step change.

The card's own bounding rect is read from a `tourCardRef` passed to the connector via context.

## Trigger / replay / nudge

State:

- `localStorage['gml.tour.seen']` (string `'1'` once tour has been seen). Persists across tabs.
- `tourOpen` (boolean) and `tourStep` (0..6) inside `<Tour>` component state.

Auto-start:

- On `<Tour>` first mount, if `localStorage.getItem('gml.tour.seen') !== '1'`, `setTourOpen(true)`. Otherwise, the tour stays closed and is only opened by user action.
- The flag is *set* (to `'1'`) when the user reaches `Done`, presses `Skip`, or clicks `×`.

Replay button (`<TourLauncher>`):

- Renders as a small `?` text button (12 px, monospace, muted amber, no border by default; on hover, amber outline + slight glow). Sized to fit between existing palette-header elements without disrupting layout.
- Desktop: lives inside `<MainPalette>`'s header, immediately to the left of the `⠿` drag handle.
- Mobile: lives inside `<MobileDrawer>`'s header, to the right of the drawer-handle text.
- Click sets `tourStep = 0` and `tourOpen = true`.

Skip-nudge (`<TourNudge>`):

- After `Skip`, an ephemeral 9 px italic muted line `tour: press ? to replay` appears immediately under or beside the `?` icon (depending on viewport room). Fades out 6 s after appearance OR when the user hovers/clicks the `?` icon, whichever first.
- Implemented as a sibling of `<TourLauncher>`; managed by `<Tour>` via a `nudgeUntil` timestamp ref.
- Suppressed on subsequent skips (only ever shows once per page-load lifetime — there's no localStorage flag for the nudge itself; it just won't show again until next page load).

## Mobile

`isMobile === true` (viewport < 720 px):

- Card width = `min(92vw, 360px)`.
- Card vertical position: when drawer is closed, `bottom: 50px`. When drawer is open, the card sits 12 px above the drawer's top edge (computed from the drawer's bounding rect).
- For walkthrough steps 4–7, on entry, `<Tour>` reads the current `drawerOpen`, stores it in a `priorDrawerOpenRef`, and calls `setDrawerOpen(true)`. On tour close (Done / Skip / ×), restores the prior state.
- For step 5 (Body palette) on mobile, `target` resolves to `data-tour="mobileBody"` placed on the body section's wrapper inside the drawer.
- For step 6 (Cut & Sound) on mobile, `target` resolves to `data-tour="mobileCutSection"` (shown). The single target shows the cut section's outline; the copy still mentions both ✂ and ♪. (No separate mobile step for sound — keeps the step count at 7.)
- For step 7 on mobile, `target` resolves to the same `mLabel` (the `m` HintRow's wrapper has the attribute regardless of which layout is rendering it).
- Connector lines work the same on mobile — `getBoundingClientRect` is layout-agnostic.

The desktop ↔ mobile transition mid-tour: the existing `isMobile` state already triggers a re-render of the layout. The tour card's anchor recomputes from the new layout. No special handling required.

## Components

All inside the existing `<script type="text/babel">` block; mirrored to `gml_body.jsx`.

- `<Tour>` — top-level orchestration. Mounted inside `<HoverHintProvider>` near the existing `<HintPopover>`. Owns `tourOpen`, `tourStep`, `priorDrawerOpenRef`, `nudgeVisible` state. Reads / writes `localStorage['gml.tour.seen']`. Coordinates auto-open-drawer on mobile. Renders `<TourCard>` + `<TourConnector>` when open.
- `<TourCard>` — the morphing card. Pure-render given `step`, `kind`, `title`, `body`, optional `diagram`, and footer-button callbacks. Owns the cross-fade transition.
- `<TourConnector>` — SVG overlay. Resolves `[data-tour]` target, computes geometry, renders polyline + outline. Re-renders on `step` change and `window.resize`.
- `<TourLauncher>` — `?` text button. Two render sites (desktop palette header, mobile drawer header). Both read the same `setTourOpen` from a `TourContext` (or are passed a callback prop).
- `<TourNudge>` — ephemeral message under the `?` icon. Lives inside `<TourLauncher>`'s render area.
- `<TorusMini>`, `<MnMini>`, `<CutMini>` — three pure-render SVG components for the step 1/2/3 diagrams. Each ~120 px tall, drawn from existing math primitives:
  - `TorusMini`: a 2D projection of the path (circle) with a cross-section m-gon at one angle. Uses `polygonBoundary` for the m-gon vertices.
  - `MnMini`: two cross-section m-gons side-by-side, drawn with `polygonBoundary` and rotated by the appropriate `α = (n/m)·θ`.
  - `CutMini`: one m-gon clipped along a horizontal chord using `findAllRegions`, with the two resulting regions filled in distinct amber/teal-ish tones.

## State summary (added to `<GMLBody>` or `<Tour>`)

```js
// Inside <Tour>:
const [tourOpen, setTourOpen] = useState(false);          // hydrated on mount from localStorage
const [tourStep, setTourStep] = useState(0);              // 0..6
const [nudgeVisible, setNudgeVisible] = useState(false);
const priorDrawerOpenRef = useRef(null);                  // saved before mobile auto-open
```

Plus a small `TourContext` exposing `setTourOpen` and `nudgeVisible` so `<TourLauncher>` and `<TourNudge>` (mounted in palette/drawer headers, far away from `<Tour>` in the JSX tree) can read it.

## Data attributes

Added at four call sites in `GMLBody`'s JSX. None affect layout, just add an attribute:

- `data-tour="canvas"` on the existing `canvasWrap` `<div>`.
- `data-tour="mainPalette"` on the `<MainPalette>` outer `<div>` (passed through via a new optional `dataTour` prop, OR via a wrapping `<div>` if cleaner).
- `data-tour="pillRow"` on the `pillRow` `<div>`.
- `data-tour="mLabel"` on a plain `<div data-tour="mLabel">` wrapping the `m` HintRow. (Plain block `<div>` not `display:'contents'` — `<TourConnector>` reads the rect via `getBoundingClientRect()` on the resolved element, and a `display:'contents'` element has a zero rect, so the wrapper must occupy a real box. The slider's `<label>` inside is `display:'grid'`; a plain block-div parent is layout-neutral here because the parent of `bodyControls` is itself block context.)
- `data-tour="mobileBody"` on the body-section `<div>` inside `<MobileDrawer>`.
- `data-tour="mobileCutSection"` on the cut-section `<div>` inside `<MobileDrawer>`.

Six attributes total. Mirror in `gml_body.jsx`.

## Behavior deltas to non-UI code

- Six `data-tour` attributes added.
- Mobile auto-open-drawer: `<Tour>` reads/writes the existing `drawerOpen` state. To do this, `setDrawerOpen` and `drawerOpen` need to be either passed to `<Tour>` as props from `<GMLBody>`, or `<Tour>` is mounted directly inside `<GMLBody>`'s JSX so it can `useState` access to those values via closure. The latter is cleaner — `<Tour>` is a function component instantiated inside `<GMLBody>`'s JSX, so it can receive `drawerOpen` and `setDrawerOpen` as direct props.
- No effects on math, geometry builders, sound mode, picking, or `rebuild`.

## Verification

Manual / browser only.

1. **Auto-start.** Clear `localStorage`. Load page. Card appears bottom-center, step `1 / 7`. Welcome copy shown with mini torus diagram.
2. **Forward navigation.** Click `Next`. Body cross-fades to step 2 with `m and n` copy and the two-mini-cross-section diagram. Click `Next` again — step 3 with cut diagram. Click `Next` — step 4: connector line draws from the card's top edge to the canvas, with an amber rectangle outlining the canvas region.
3. **Backward navigation.** Click `Prev` — back to step 3, diagram changes back. On step 1 `Prev` is hidden.
4. **Skip.** Press `Skip` at any step. Card disappears. `?` icon shows the `tour: press ? to replay` nudge for 6 s. After 6 s the nudge fades. `localStorage['gml.tour.seen'] = '1'` is set.
5. **Done.** Walk to step 7, press `Done`. Card disappears. No nudge. `localStorage['gml.tour.seen'] = '1'`.
6. **Replay.** Click `?` icon (in main palette header on desktop). Tour reopens at step 1.
7. **Reload after seen.** Refresh the tab. Tour does NOT auto-start.
8. **Underlying interactivity.** While tour is on step 5 (with a connector pointing at the main palette), drag the `m` slider — value changes, body re-renders. The 3D scene continues to auto-rotate. Hover hints continue to work.
9. **Resize during tour.** Open at step 4 (connector to canvas), resize the window. Connector recomputes its geometry; outline still hugs the canvas.
10. **Auto-flip layout.** With main palette near the right edge, on step 5 the connector should still find the palette and route around the card sensibly (one bend or none).
11. **Mobile auto-open drawer.** Resize to 600 px width, clear `localStorage`, reload. Tour appears. On step 5 entry, the drawer auto-opens. On Done, drawer returns to the prior state (closed if it was closed).
12. **Mobile target resolution.** On step 5 mobile, the connector outlines `data-tour="mobileBody"` inside the drawer. On step 6 mobile, it outlines `data-tour="mobileCutSection"`.
13. **Step 7 highlight.** Connector outlines the `m` HintRow's wrapper specifically, not the entire main palette.
14. **Two-file mirror.** `index.html` and `gml_body.jsx` differ only at the documented top-of-file delta.

## Implementation order

The work decomposes into roughly nine chunks; the implementation plan will detail each:

1. Add `TOUR_STEPS` data array and `TourContext` with `tourOpen` / `setTourOpen` / `tourStep` / `setTourStep`. No UI yet.
2. Add the `localStorage['gml.tour.seen']` hydration and the auto-start side-effect inside `<Tour>`. Tour is empty for now; just verify `tourOpen` toggles correctly across reload.
3. Add the four card style keys and `<TourCard>`. Render bare-bones (header + body + footer) with hard-coded step 1 content. Mount inside `<Tour>`.
4. Wire `tourStep` to drive the rendered step. Add `Next` / `Prev` / `Skip` / `Done` / `×` button behaviors.
5. Add the three mini-diagram SVG components (`TorusMini`, `MnMini`, `CutMini`) and render them in steps 1–3.
6. Add `<TourConnector>` and the four desktop `data-tour` attributes (`canvas`, `mainPalette`, `pillRow`, `mLabel`). Connector renders polyline + outline for steps 4–7.
7. Add `<TourLauncher>` (`?` button) into the main palette header and the mobile drawer header. Wire it to reopen at step 1.
8. Add `<TourNudge>` post-`Skip` behavior with 6 s timeout.
9. Add the mobile drawer auto-open choreography and the `data-tour="mobileBody"` / `mobileCutSection"` attributes. Override the step 5 / 6 target lookup based on `isMobile`.

Each step ships a runnable browser-testable artifact.

## Out of scope (callouts so they aren't lost)

- Keyboard navigation (`←` / `→` / `Esc`).
- A11y: `aria-modal`, focus trap, `aria-live` step announcements.
- Localization / i18n — `TOUR_STEPS` is structured so a future swap is mechanical.
- Persisting tour-completion across user accounts / devices (current scope: per-browser via `localStorage`).
- "Show this tour again on next visit" preference toggle.
- Per-step deep-link URLs (`#tour=3` style).
- Animated step diagrams (current diagrams are static SVG). The 3D scene already provides motion behind the card.
