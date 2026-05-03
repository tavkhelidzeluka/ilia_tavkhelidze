# Controls panel redesign — floating palettes

**Status:** Design approved 2026-05-04
**Scope:** Replace the current full-width bottom drawer with a floating-palette layout: one main palette plus cut and sound popovers, an info strip, and a mobile fallback that uses the existing drawer pattern.

## Goal

The current panel is a full-width collapsible bottom drawer that shows tabs (geometry / sound), the m/n/τ readout, a piece-count note, the path-shape picker and contextual sliders, the n/m sliders, the toggle row (rotate/ridges/gradient/sound/cut), and conditionally the sound or cut sub-panels. Everything is on screen at once when expanded; a meaningful fraction of the viewport is taken even after collapse. The user wants a redesign that gives the 3D viewport more room while keeping every existing control reachable.

## Non-goals

- Removing or renaming any existing control. Behavior and parameter ranges are unchanged.
- Multi-palette docking, snapping, palette-resize, palette-merge, or other window-manager affordances.
- Keyboard shortcuts, saved presets, shareable URLs, undo.
- Redesigning the 2D cross-section editor or the blade-profile editor (they keep working as today, just inside the cut popover instead of the cut sub-panel).
- Touching the 3D rendering, math layer, sound engine, or picking — only the React UI layer changes.

## Layout

### Desktop (viewport width ≥ 720 px)

Five fixed-position layers over the viewport:

1. **Main palette** — top-left at `{ left: 18, top: 50 }` by default. Holds:
   - Path-shape picker row (4 pill buttons: circle / ellipse / knot / figure-8).
   - Contextual sliders for the active path shape (R; or a + b; or R + r + p + q; or a).
   - n slider, m slider.
   - Display toggles row: auto-rotate, ridges, gradient.

   Header bar shows the title `BODY` and a drag handle (`⠿`). Clicking the title collapses the palette to a header-only strip; clicking again expands.

2. **Cut pill** — bottom-right, fixed. Always visible. Click toggles a `Cut` popover anchored above the pill.

3. **Sound pill** — bottom-right, immediately to the left of the Cut pill. Always visible. Click toggles a `Sound` popover anchored above the pill.

4. **Info strip** — bottom-center, fixed. A compact pill showing `m=… · n=… · τ=…·2π`. When a cut mode is active, the strip extends to include the relevant piece-count summary (chord count, regions, piece-dots — the same content currently rendered in the bottom note inside the drawer).

5. **Cut popover** (open only when the Cut pill is toggled on) — anchored 8 px above the Cut pill. Contains the current cut UI in full: cut-mode picker (center / parallel / off-center / p→p), cut-mode-specific sliders (N / d / P₁ + P₂ / θ°), gap and seam-open sliders, blade-shape picker and amplitude (for non-center modes), the custom-blade profile editor (when blade='custom'), and the `2D view` and `solo piece` toggles. Header has a `×` close button. Outside-click closes the popover.

6. **Sound popover** (open only when the Sound pill is toggled on) — anchored 8 px above the Sound pill. Contains the waveform display, p / q / Hz / amp sliders, and a `Play / Stop` button (replaces the current `sound on / sound off` toggle in the toggle row). Header has a `×` close button.

Only one popover is open at a time. Toggling either pill closes the other.

### Mobile (viewport width < 720 px)

Reverts to a vertical bottom drawer. Same content as the desktop palettes, stacked top-to-bottom: main palette section, then a cut section, then a sound section. Each section has a click-to-collapse header. Pills and popovers do not appear on mobile. The drawer's open/closed state replaces the existing `drawerOpen` state.

The 720 px threshold is chosen to match the existing `@media (min-width: 720px)` style of the project. (None today, but it's a clean common breakpoint and the existing layout fits comfortably in 700 px.)

## Visual style — terminal-luxe

Same warm-amber on near-black palette already present in the page header and viewport tone, refined:

- Surface: `linear-gradient(180deg, rgba(28,21,18,0.96), rgba(20,15,12,0.96))` with `backdrop-filter: blur(14px)` for the glass effect over the 3D scene.
- Border: 1 px `#4a3026`, `border-radius: 10 px` for palettes and 14–18 px for pills.
- Text: monospace stack (`'SF Mono', Menlo, monospace`), 11 px body / 9 px labels in `#e8a673`, dimmed labels `#9a7058`, headers `#c78659` with 0.18 em letter-spacing and uppercase.
- Buttons (pill + chip): rounded; selected state uses `linear-gradient(180deg, #5a3826, #3a2820)` with `border: 1px solid #7a4a30` and `inset 0 1px 0 rgba(255,200,150,0.12)`; idle state has a transparent fill and `border: 1px solid #2a1f1a` with `#7a5a48` text.
- Sliders: 4 px track on `#1a1310`, fill is `linear-gradient(90deg, #5a3826, #c78659)`, no thumb visible (HTML range with `::-webkit-slider-thumb { width: 14px; height: 14px; background: #c78659; border-radius: 50% }` and equivalent for `::-moz-range-thumb`).
- Drop shadow on palettes: `0 8px 32px rgba(0,0,0,0.4)` plus inner highlight `inset 0 1px 0 rgba(255,180,120,0.08)`.

These rules go into the existing `styles` object in `GMLBody`. No external CSS, no new fonts.

## Interactions

### Drag

The main palette is draggable by its header (the `⠿` handle, or anywhere on the header). Implementation:

- Drag uses `pointerdown` / `pointermove` / `pointerup` on the palette header, capturing pointer with `setPointerCapture`.
- Position is stored in React state `[mainPos, setMainPos]` as `{ x, y }`. Default: `{ x: 18, y: 50 }`.
- On drag end, `mainPos` is persisted to `localStorage['gml.mainPalette.pos']`. Restored on next mount (with viewport bounds-checking — if the saved position is off-screen, fall back to default).
- During drag, the palette uses CSS `transform: translate3d(x, y, 0)` for smoothness; on commit, switches back to `top` / `left`.
- Popovers are not draggable.

### Collapse

The main palette has a collapsed state — clicking the title text in the header (not the drag handle) toggles between expanded (full content) and collapsed (header bar only, ~30 px tall). Stored as `mainCollapsed` in `localStorage`.

Popovers do not collapse — they're either open (visible above their pill) or closed (hidden).

### Pill / popover

- The Cut and Sound pills have an "active" visual state when their popover is open (filled gradient).
- Clicking a pill toggles its popover. Opening one closes the other.
- Outside-click on the viewport closes any open popover. (Click inside the popover, on the corresponding pill, or on the main palette must NOT close it.)
- Keyboard `Escape` closes any open popover. Required (cheap to implement via a `keydown` listener on the document).

### Outside-click detection

Uses a mounted document-level `mousedown` listener that checks if the event target is inside a known set of refs (the open popover element + its trigger pill).

### Mobile transition

A `useEffect` watches `window.innerWidth` (debounced via `resize` listener, throttled to 200 ms) and sets a boolean `isMobile`. When `isMobile`, the floating layout is replaced by the drawer container. The same React state holds the same component children — only the wrapping layout differs. Toggling between layouts mid-session (resize, device rotation) preserves all underlying state.

## Architecture

### Components (new)

- `<MainPalette />` — top-left palette container. Props: `pos`, `setPos`, `collapsed`, `setCollapsed`, plus a `children` prop that holds the path picker, sliders, and toggles. Encapsulates the drag header and collapse logic.
- `<Pill label icon active onClick />` — bottom pill button. Reusable for cut and sound.
- `<Popover anchor open onClose>{children}</Popover>` — generic popover positioned above its anchor pill. Handles outside-click and `×` close. The cut-specific and sound-specific UI lives inside, not re-implemented per popover.
- `<InfoStrip m n cut cutInfo .../>` — bottom-center strip. Pure-render based on current state.
- `<MobileDrawer>{children}</MobileDrawer>` — replicates the current bottom drawer pattern, used as a fallback container on mobile.

The existing `Slider`, `Toggle`, `WaveformDisplay`, `PieceDots`, `BladeProfileEditor`, `CrossSection2D` components are reused without changes.

### State (new in `GMLBody`)

```
const [mainPos, setMainPos] = useState({ x: 18, y: 50 });   // hydrated from localStorage on mount
const [mainCollapsed, setMainCollapsed] = useState(false);  // hydrated from localStorage on mount
const [openPopover, setOpenPopover] = useState(null);       // null | 'cut' | 'sound'
const [isMobile, setIsMobile] = useState(window.innerWidth < 720);
```

State the redesign retires:
- `drawerOpen` — replaced by `mainCollapsed` semantics on desktop and an equivalent boolean inside `<MobileDrawer>` on mobile.
- `tab` — geometry/sound tabs go away; sound is a pill-popover. The few places that read `tab === 'sound'` get rewritten to read `openPopover === 'sound'` (for in-popover content) or to a new `soundActive` flag (for sound-mode rendering, which is independent of UI visibility — sound mode is "on" iff `wavePlaying === true`).

### Behaviour deltas to non-UI code

- **`rebuild`** trigger `useEffect` deps drop `tab` and pick up `openPopover` and `wavePlaying`. The effect computes `soundMode = openPopover === 'sound' || wavePlaying`. This preserves today's behavior — opening the sound popover gives a live color-sweep preview without requiring audio, exactly as switching to the sound tab does today — and adds the new affordance that audio can keep playing after the popover is closed.
- **Audio fade-out on tab change** (current `useEffect` near `if (tab !== 'sound' && wavePlaying)`) is removed — the popover-close action does not stop audio. The user stops audio by pressing the in-popover `Stop` button (which calls the existing `togglePlay` flow). Closing the popover is intentionally non-destructive.

These two changes are the only places where the redesign reaches outside the UI layer. Math, builders, and `pathFrame` plumbing are untouched.

## Z-index strategy

- Viewport canvas: `z-index: 0`.
- Info strip, pills, main palette: `z-index: 10`.
- Popovers: `z-index: 20` (above their pills, above the main palette so dragging the palette over the popover doesn't render it underneath).
- Modal-style overlays from the existing `show2D` and `BladeProfileEditor` (when expanded inside the cut popover) get `z-index: 21`.

## Mobile-drawer details

The `<MobileDrawer>` shell mirrors the current drawer:

- Fixed-bottom container with rounded top corners.
- A header strip with a drag-handle bar and "tap to collapse / expand controls" label.
- `maxHeight: 70vh` when expanded; `38px` when collapsed.
- Content area: vertical stack of three sections (`Body`, `Cut`, `Sound`) each with a clickable header that toggles its own collapsed state. The Cut and Sound sections render the same children as their desktop popovers.
- Drag-to-resize is not added — same fixed snap as today.

## Implementation order

The work decomposes into roughly six chunks; the implementation plan will detail each. The order ensures every commit ships a runnable app:

1. Add the new state (`mainPos`, `mainCollapsed`, `openPopover`, `isMobile`) and the `localStorage` hydration. UI unchanged.
2. Add `<InfoStrip>` and render it (bottom-center) alongside the existing drawer. Drawer remains as today.
3. Add `<MainPalette>` (no drag yet) and `<Pill>` and `<Popover>`; render them when `!isMobile`. Hide the existing drawer when `!isMobile`. Mobile path still uses the existing drawer.
4. Add drag and persistence for the main palette.
5. Migrate cut and sound content into their popovers (delete the cut sub-panel and sound sub-panel from the drawer / hide them on desktop).
6. Refactor the mobile drawer into `<MobileDrawer>` so the desktop palettes and the mobile drawer share the same children components.

## Verification

Manual / browser only (no test runner). Each implementation step ends with a specific browser check (e.g. "drag the main palette, refresh, position persists"; "click cut pill twice, popover toggles open/closed; while open, click sound pill, cut closes and sound opens"; "resize to 600 px width, layout collapses to drawer; resize back to 1200 px, layout expands; both transitions preserve all state").

## Out of scope (mention in implementation if user wants any of them later)

- Multi-palette docking and free arrangement of cut/sound popovers.
- Keyboard shortcuts (e.g. `c` to toggle cut, `s` to toggle sound, `r` to toggle rotate).
- Saved presets / shareable URL state.
- Undo / redo.
- Snap-to-grid for the main palette drag position.
- Right-click / long-press context menus on the main palette (e.g. "reset position").
