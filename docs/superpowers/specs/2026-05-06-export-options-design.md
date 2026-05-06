# Export options — Save popover (PNG, SVG, STL, OBJ, GLB, Share URL)

**Status:** Design approved 2026-05-06
**Scope:** Add a `💾 Save` pill alongside the existing `✂ Cut` and `♪ Sound` pills, opening a popover with six export options: PNG canvas screenshot, SVG cross-section, three 3D model formats (STL, OBJ, GLB), and a Share URL that encodes the entire interactive state in a copyable link.

## Goal

The viewer is a teaching tool — the natural follow-up to "I made an interesting GML body" is "I want to keep it / send it to someone / 3D-print it". Currently there's no way to do that. Add a single Save popover that covers the common formats: an image for slides, a vector image for the cross-section, three 3D model formats for printing/editing/embedding, and a URL for sharing the exact same interactive state.

## Non-goals

- No file *import* (load a `.stl` / `.json` and reconstruct state). One direction only.
- No server-side rendering or batch export.
- No animated GIF / video / WebM rotation export.
- No high-res offscreen render — the PNG is whatever the current canvas is.
- No saving of the custom blade profile in the URL (the array is long; URL only encodes scalar/short state).
- No saving of audio output (the waveform is generated live from m).
- No A11y treatment beyond visible-focus on the buttons.
- No localization of button labels in this pass.
- No `.dxf`, `.fbx`, `.usdz`, or other formats — STL/OBJ/GLB cover print, edit, and embed respectively.

## Layout

### Pill row

The existing bottom-right `pillRow` gets a third pill:

- `<Pill icon="✂" label="Cut" .../>`
- `<Pill icon="♪" label="Sound" .../>`
- `<Pill icon="💾" label="Save" active={openPopover === 'save'} onClick={() => setOpenPopover(openPopover === 'save' ? null : 'save')} />`

The existing `<Popover>` opens above its anchor pill via `getBoundingClientRect`, so the Save popover gets positioning for free.

`openPopover` state extended: `null | 'cut' | 'sound' | 'save'` (mutually exclusive — opening Save closes Cut/Sound).

### Save popover contents

Header: `💾 Save` title, `×` close button (the existing `<Popover>` already provides both).

Body: a 2-column grid, 3 rows. Each cell is a clickable button styled like the existing `bladeBtn` (rounded rectangle, 10 px monospace caps, 1 px amber border, hover-darkens). Each button shows:

- A format name (e.g. `PNG`, `STL`)
- A one-line description in 9 px muted text (e.g. `canvas screenshot`, `printable 3D model`)

Six buttons:

| Button | Description | Format |
|---|---|---|
| PNG | canvas screenshot | image/png |
| SVG | cross-section diagram | image/svg+xml |
| STL | printable 3D model | model/stl (ASCII) |
| OBJ | 3D model with UVs | model/obj |
| GLB | scene with materials | model/gltf-binary |
| Share URL | copy a link to this configuration | clipboard |

Click → fire export → 2 s feedback in place of the description (`saved` for files, `copied` for the URL) → reverts to original description text.

If an exporter is mid-load (the three.js exporter modules load lazily), the button shows `loading…` until ready.

## Export functions

All export functions read state from React closure and from `stateRef.current` (the existing mutable bag of scene data inside `GMLBody`).

### PNG

```js
const exportPNG = () => {
  const { renderer, scene, camera } = stateRef.current;
  renderer.render(scene, camera);  // ensure latest frame
  renderer.domElement.toBlob((blob) => {
    if (blob) downloadBlob(blob, buildFilename('png'));
  }, 'image/png');
};
```

Three.js by default does NOT preserve the WebGL drawing buffer between frames; reading the canvas after the rAF tick may yield a black image. Mitigation: pass `preserveDrawingBuffer: true` to the existing `WebGLRenderer` constructor. (Trivially safe; tiny perf cost.)

### SVG

```js
const exportSVG = () => {
  // Render <CrossSection2D> to an offscreen DOM container, serialize.
  const container = document.createElement('div');
  ReactDOM.render(
    <CrossSection2D m={m} n={n} cutMode={cutMode}
      sliceCount={sliceCount} offsetD={offsetD} cutPhi={cutPhi}
      phi1={phi1} phi2={phi2}
      bladeShape={bladeShape} bladeAmount={bladeAmount} bladeProfile={bladeProfile}
      size={400} highlighted={null} />,
    container
  );
  const svgEl = container.querySelector('svg');
  if (!svgEl) return;
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  downloadBlob(blob, buildFilename('svg'));
  ReactDOM.unmountComponentAtNode(container);
};
```

`<CrossSection2D>` is the existing 2D editor component. We render it offscreen at a larger size (400 px) for export quality, serialize the SVG element, prepend the XML declaration, and unmount. (React 18's `createRoot` is used elsewhere in the file; for this transient offscreen render, the legacy `ReactDOM.render` API is acceptable, OR we use `createRoot(container).render(...)` and immediately `.unmount()`.)

### STL / OBJ / GLB

These require Three.js exporter modules that aren't part of the core CDN script. We load them lazily on first export click:

```js
const loadExporter = (() => {
  const cache = {};
  return (name) => {
    if (cache[name]) return cache[name];
    const url = `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/exporters/${name}.js`;
    cache[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => resolve(THREE[name]);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return cache[name];
  };
})();
```

The three.js r128 `examples/js/exporters/` files attach their classes to the `THREE` global (`THREE.STLExporter`, `THREE.OBJExporter`, `THREE.GLTFExporter`).

Each export function awaits its exporter, parses the body group, and downloads:

```js
const exportSTL = async () => {
  const Exporter = await loadExporter('STLExporter');
  const stl = new Exporter().parse(stateRef.current.group);
  downloadBlob(new Blob([stl], { type: 'model/stl' }), buildFilename('stl'));
};

const exportOBJ = async () => {
  const Exporter = await loadExporter('OBJExporter');
  const obj = new Exporter().parse(stateRef.current.group);
  downloadBlob(new Blob([obj], { type: 'model/obj' }), buildFilename('obj'));
};

const exportGLB = async () => {
  const Exporter = await loadExporter('GLTFExporter');
  const exporter = new Exporter();
  const buffer = await new Promise((resolve, reject) => {
    exporter.parse(
      stateRef.current.group,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true }
    );
  });
  downloadBlob(new Blob([buffer], { type: 'model/gltf-binary' }), buildFilename('glb'));
};
```

The GLTFExporter callback signature is `(result, onError, options)` per three.js r128 docs (2-callback form for binary export).

`stateRef.current.group` is the existing `THREE.Group` that holds the body meshes — already populated by the rebuild effect.

### Share URL

```js
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

const shareURL = async () => {
  const params = new URLSearchParams();
  // Encode each non-default state value (omit defaults to keep URL short — optional optimization).
  for (const [stateName, key] of Object.entries(URL_KEYS)) {
    const v = currentValueOf(stateName);
    if (v === undefined || v === null) continue;
    if (typeof v === 'boolean') params.set(key, v ? '1' : '0');
    else params.set(key, String(v));
  }
  const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  await navigator.clipboard.writeText(url);
};
```

`currentValueOf(stateName)` is a small switch that returns the React-state value for that key (e.g. `stateName === 'm'` → return the React `m` state). Implemented inline in `<GMLBody>` where the state setters live.

### URL hydration on page load

A new `useEffect` near the start of `<GMLBody>` (before the rebuild effect) runs once on mount:

```js
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.size === 0) return;
  for (const [stateName, key] of Object.entries(URL_KEYS)) {
    if (!params.has(key)) continue;
    const v = params.get(key);
    applyToSetter(stateName, v);
  }
}, []);
```

`applyToSetter(stateName, v)` parses `v` to the right type (number / boolean / string) and calls the matching setter (e.g. `setM(parseInt(v))`).

The hydration runs *before* the rebuild effect because `useEffect`s fire in declaration order; the rebuild effect comes later. State setters from this effect schedule a re-render, which then triggers the rebuild effect with the new state.

### Filename

```js
const buildFilename = (ext) => {
  const cutSuffix = cut ? '_cut' : '';
  return `gml_m${m}_n${n}_${pathShape}${cutSuffix}.${ext}`;
};
```

Examples: `gml_m4_n1_circle.png`, `gml_m6_n2_torusKnot_cut.stl`.

### Download helper

```js
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
```

## Components

All inside the existing script block; mirrored to `gml_body.jsx`.

- `<SavePopoverContent>` — the body of the Save popover. Renders the 6-button grid, owns per-button `feedback` state (per-button "saved/copied" / "loading…" indicator).
- `<SaveButton label, description, onClick>` — one cell. Pure-render given props; transient feedback is owned by `<SavePopoverContent>`.

The pill itself is just another `<Pill>` instance — no new component needed.

The export functions live as plain functions inside `<GMLBody>` (where they have access to React state and `stateRef`). They are passed to `<SavePopoverContent>` as a single `actions` prop.

## State summary

```js
// Inside <GMLBody>:
const [openPopover, setOpenPopover] = useState(null);  // existing — extend to allow 'save'
const savePillRef = useRef(null);                       // new — for popover anchoring
```

No new state inside `<GMLBody>` beyond `savePillRef`. `<SavePopoverContent>` owns its per-button feedback state.

## Behavior deltas to non-UI code

- `WebGLRenderer` constructor gets `preserveDrawingBuffer: true`. Required for `toBlob()` to produce a non-empty PNG. Existing renderer is created inside the rebuild effect — the constructor call adds this option.
- A new `useEffect` reads URL params on mount and applies them to state. Runs before any rebuild effect by virtue of source order.
- Three CDN script tags are added at runtime (lazily, on first export click). They load `STLExporter.js`, `OBJExporter.js`, `GLTFExporter.js` from `cdn.jsdelivr.net`. The script-load promises are cached so each exporter is loaded once per session.
- Math layer, geometry builders, sound mode, picking, and the rAF tick loop are not touched.

## Z-index strategy (no change)

Save popover uses the existing `<Popover>` style (z-index 20), same as Cut and Sound. The existing 2D modal (21), hint popover (30), tour connector (31), and tour card (32) remain above.

## Verification

Manual / browser only.

1. **PNG**: open Save popover, click PNG. Browser downloads `gml_m{m}_n{n}_{pathShape}.png`. Open it — image matches the current canvas pixel-for-pixel.
2. **SVG**: click SVG. Downloads `gml_m{m}_n{n}_{pathShape}.svg`. Open in a browser — shows the cross-section diagram (with chord cuts if `cut === true`). Open in Inkscape/Illustrator — vectors are editable.
3. **STL ASCII**: click STL. Downloads `…stl`. Open in MeshLab or Cura — geometry matches, no errors. Vertex count matches the visible mesh.
4. **OBJ**: click OBJ. Downloads `…obj`. Open in Blender — geometry imports with correct UVs (each face shows a UV grid; the `gradient`-colored seam aligns with the same θ-position).
5. **GLB**: click GLB. Downloads `…glb`. Open in `https://gltf-viewer.donmccurdy.com/` — body renders with materials and per-vertex colors visible.
6. **Share URL — copy**: click Share URL. Button text changes to `copied` for ~2 s. Paste in a new tab → page loads with identical state (m, n, path shape, cut params, sound params, all toggles).
7. **Share URL — non-default state**: change `m` to 5, `cutMode` to `parallel`, `sliceCount` to 3. Click Share URL. Paste in a new tab — confirms `?m=5&cm=parallel&N=3&...` decodes correctly.
8. **Mid-tour interaction**: open Save popover during step 6 of the tour (the connector points at the pill row). Connector outline correctly hugs all three pills now (because pillRow is the target). Save popover opens above the Save pill; tour card and connector keep working.
9. **Lazy exporter load**: from a fresh session, click STL once. Network tab shows `STLExporter.js` is loaded. Click STL again — no second network request.
10. **Fallback when clipboard API blocked**: in an `http://` (non-https) context, `navigator.clipboard.writeText` may reject. Verify the Share button shows `URL copy failed — paste from console` and `console.log`s the URL. (`localhost` is treated as secure by Chrome/Firefox; this is a fallback for hosting environments without HTTPS.)
11. **Two-file mirror**: `index.html` and `gml_body.jsx` differ only at the documented top-of-file delta.

## Implementation order

The work decomposes into roughly seven chunks:

1. Add `preserveDrawingBuffer: true` to the renderer. Add the `URL_KEYS` map and the URL-hydration `useEffect` (no UI yet — just verify in DevTools that `?m=5` actually changes m on load).
2. Add the `Save` pill and extend `openPopover` to accept `'save'`. Render an empty `<Popover>` on click.
3. Add `<SavePopoverContent>` with the 6-button grid and per-button feedback state. Wire stub onClicks that just `console.log`.
4. Implement `exportPNG` and `exportSVG` (no exporter dependencies). Wire their buttons.
5. Implement `loadExporter` lazy loader. Implement `exportSTL`, `exportOBJ`, `exportGLB`. Wire their buttons.
6. Implement `shareURL` (clipboard) and `currentValueOf` / `applyToSetter` helpers. Wire the Share URL button.
7. Verification: walk all six exports, confirm filenames, confirm URL round-trips state.

Each step ships a runnable browser-testable artifact.

## Out of scope (callouts so they aren't lost)

- Importing saved files.
- High-res offscreen render (the PNG is canvas-resolution).
- Encoding the custom blade profile in the URL (array is too long; URL falls back to the default profile).
- Encoding tour-seen / hint-seen / palette-position state in the URL (these are purely UI session state, not the artifact).
- Animated formats (GIF, WebM, MP4).
- Encoding sound state beyond the four scalars (pMode, qMode, waveFreq, waveAmp). The audio context itself is not portable.
- Compressing the URL with a hash-shortener service.
