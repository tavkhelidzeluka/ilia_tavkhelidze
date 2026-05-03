# Controls Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-width bottom drawer with a floating-palette layout — one main palette plus cut and sound popovers — on desktop, while keeping a vertical drawer fallback on mobile.

**Architecture:** UI-only change inside `GMLBody`. Add a small set of presentational components (`MainPalette`, `Pill`, `Popover`, `InfoStrip`, `MobileDrawer`), four new state hooks (`mainPos`, `mainCollapsed`, `openPopover`, `isMobile`), and a few new entries in the `styles` object. Math, builders, and `pathFrame` plumbing are untouched. The existing `Slider`, `Toggle`, `WaveformDisplay`, `PieceDots`, `BladeProfileEditor`, `CrossSection2D` components are reused as-is.

**Tech Stack:** React 18 + Three.js r128 + Babel Standalone (CDN, no build). Two-file mirror: every change applies identically to `index.html` (runtime) and `gml_body.jsx` (mirror) per `CLAUDE.md`. The mirror diff stays at 68 lines (only protected divergence: HTML scaffolding, `<script type="text/babel">` opener, `function GMLBody()` vs `export default function GMLBody()`, trailing `ReactDOM.createRoot(...)` bootstrap).

**Spec:** `docs/superpowers/specs/2026-05-04-controls-panel-redesign.md`

**Verification model:** No test runner. Each task ends with a concrete browser verification step — open `index.html` in a browser and check specific behaviors. Static checks (grep / diff) cover what the browser can't.

---

## Two-file mirror discipline

Every code edit applies to **both**:

- `/Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html` (runtime)
- `/Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx` (mirror)

After every code change, run:

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx | wc -l
```

Expected: `68`. If the diff grows, the mirror is wrong — fix before commit.

---

## File map

All edits in `index.html` (and mirrored to `gml_body.jsx`). Locations are by anchor (line numbers shift across tasks; grep instead).

| Region | What goes here |
|---|---|
| `function GMLBody() { ... }` body | New state hooks; new presentational components defined immediately above `GMLBody` (`MainPalette`, `Pill`, `Popover`, `InfoStrip`, `MobileDrawer`). |
| Render JSX inside `GMLBody` | Branch on `isMobile`. Desktop renders `<MainPalette>` + `<Pill>`s + `<Popover>`s + `<InfoStrip>`. Mobile renders `<MobileDrawer>` with the same children. |
| `const styles = { ... }` (near end) | New entries: `palette`, `paletteHeader`, `paletteHeaderTitle`, `paletteHeaderHandle`, `paletteHeaderClose`, `palettePill`, `palettePillOn`, `pillRow`, `infoStrip`, `popover`, `mobileSection`, `mobileSectionHeader`. |
| `rebuild` trigger `useEffect` deps | Drop `tab`. Add `openPopover`, `wavePlaying`, `isMobile`. The `soundMode` computation inside changes from `tab === 'sound'` to `openPopover === 'sound' \|\| wavePlaying`. |
| Audio fade-out `useEffect` (currently keys on `tab`) | Removed entirely. Closing the sound popover does not stop audio. |

No new files. The brainstorm-companion artefacts under `.superpowers/` are git-ignored.

---

## Task 1: Add state, presentational shells, and the info strip

Add the new state hooks, define empty/minimal `MainPalette`, `Pill`, `Popover`, `InfoStrip`, and `MobileDrawer` shell components, and render only `<InfoStrip>` for now. The existing drawer stays in place. No visual change beyond an extra info strip (which is visible behind the existing drawer's backdrop on first open — that's fine; we'll hide the drawer in Task 2).

**Files:**
- Modify: `index.html` (around `function GMLBody()` declaration, around the `styles` object near the bottom, and the JSX return).
- Mirror: `gml_body.jsx`.

- [ ] **Step 1: Add the four new state hooks**

Inside `GMLBody`, immediately after the existing `const [drawerOpen, setDrawerOpen] = useState(true);` line, insert:

```jsx
const [mainPos, setMainPos] = useState({ x: 18, y: 50 });
const [mainCollapsed, setMainCollapsed] = useState(false);
const [openPopover, setOpenPopover] = useState(null); // null | 'cut' | 'sound'
const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 720);

useEffect(() => {
  const onResize = () => setIsMobile(window.innerWidth < 720);
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, []);

useEffect(() => {
  try {
    const raw = localStorage.getItem('gml.mainPalette');
    if (raw) {
      const v = JSON.parse(raw);
      if (v && typeof v.x === 'number' && typeof v.y === 'number') {
        const x = Math.min(Math.max(0, v.x), Math.max(0, window.innerWidth - 200));
        const y = Math.min(Math.max(0, v.y), Math.max(0, window.innerHeight - 60));
        setMainPos({ x, y });
      }
      if (typeof v.collapsed === 'boolean') setMainCollapsed(v.collapsed);
    }
  } catch {}
}, []);

useEffect(() => {
  try {
    localStorage.setItem('gml.mainPalette', JSON.stringify({
      x: mainPos.x, y: mainPos.y, collapsed: mainCollapsed,
    }));
  } catch {}
}, [mainPos, mainCollapsed]);
```

- [ ] **Step 2: Add the new style entries**

Inside the `const styles = { ... }` object (near the bottom of the JSX block), add the following entries. Place them after the existing `cutPanel:` entry. The values intentionally reuse the existing JetBrains Mono / Cormorant Garamond stack and amber palette (not the SF Mono / Menlo placeholders from the spec mockup):

```jsx
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
mobileSection: {
  borderTop: '1px solid rgba(246,239,225,0.06)',
  paddingTop: 10, marginTop: 10,
},
mobileSectionHeader: {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: 9, letterSpacing: '0.18em', color: '#c78659', textTransform: 'uppercase',
  cursor: 'pointer', marginBottom: 8,
},
```

- [ ] **Step 3: Define the presentational shell components**

Immediately ABOVE the line `function GMLBody() {`, insert:

```jsx
function MainPalette({ pos, setPos, collapsed, setCollapsed, children }) {
  const headerRef = useRef(null);
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
      x: Math.min(Math.max(0, dragRef.current.start.x + dx), window.innerWidth - 200),
      y: Math.min(Math.max(0, dragRef.current.start.y + dy), window.innerHeight - 60),
    });
  };
  const onPointerUp = () => { dragRef.current = null; };
  return (
    <div style={{...styles.palette, left: pos.x, top: pos.y}}>
      <div
        ref={headerRef}
        style={{...styles.paletteHeader, cursor: 'grab'}}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span style={styles.paletteHeaderTitle} data-no-drag onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'} Body
        </span>
        <span style={styles.paletteHeaderHandle}>⠿</span>
      </div>
      {!collapsed && children}
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
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      // Click on the anchor element should NOT close (the anchor's own onClick toggles)
      if (anchor && anchor.current && anchor.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return (
    <div ref={ref} style={{...styles.popover, right: 18, bottom: 60}}>
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
      <button onClick={onToggle} style={styles.drawerHandle} aria-label={open ? 'collapse controls' : 'expand controls'}>
        <div style={styles.drawerHandleBar} />
        <span style={styles.drawerHandleLabel}>{open ? 'tap to collapse' : 'tap to expand controls'}</span>
      </button>
      <div style={styles.drawerContent}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Render `<InfoStrip>` alongside the existing drawer**

Inside `GMLBody`'s return, find the closing `</div>` of the drawer (search for `</div>` immediately following the existing drawer's `<div style={{...styles.drawer, ...}}>` block — typically right after the last `}` of `cut && (...)`. ). Just before the `</div>` of the outermost `<div style={styles.root}>`, insert:

```jsx
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
```

(This pre-checks the existence of `parallelInfo`, `offCenterInfo`, `p2pInfo`, etc. — they are computed earlier in `GMLBody`; they are already in scope.)

- [ ] **Step 5: Mirror to `gml_body.jsx`**

Apply identical edits at the equivalent locations.

- [ ] **Step 6: Verify in browser**

Open `index.html` in a browser. The existing controls drawer is unchanged. A new info strip appears at the bottom-center showing `m=… · n=… · τ=…·2π`. Toggle `cut` on; the strip updates to include the piece count and dots. Resize the window below 720 px; the info strip disappears (mobile fallback). Resize above; it returns. In the browser console:

```js
console.assert(typeof MainPalette === 'function' && typeof Pill === 'function' && typeof Popover === 'function', 'shells defined');
```

- [ ] **Step 7: Static checks**

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx | wc -l
```
Expected: `68`.

- [ ] **Step 8: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
feat(controls): add panel-redesign scaffolding (state + components + InfoStrip)

Adds the React state for floating palettes (mainPos, mainCollapsed,
openPopover, isMobile) and localStorage persistence. Defines presentational
shells MainPalette, Pill, Popover, InfoStrip, MobileDrawer. Renders only
InfoStrip alongside the existing drawer for now. Existing drawer is
untouched; visible behavior change is a new bottom-center info strip on
desktop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Render desktop palette + pills, hide existing drawer on desktop

Branch on `isMobile`. Desktop renders `<MainPalette>` (with the path picker, contextual sliders, n/m sliders, display toggles row) and a `<Pill>` for cut and sound. Existing drawer is hidden when `!isMobile`. Mobile path keeps the existing drawer untouched (we'll convert it to `<MobileDrawer>` in Task 6). Popovers don't open yet — that's Task 3.

**Files:**
- Modify: `index.html` (the JSX return body of `GMLBody`).
- Mirror: `gml_body.jsx`.

- [ ] **Step 1: Wrap the existing drawer in an `isMobile` guard**

Locate the existing drawer block (search for the line `<div style={{` followed by `...styles.drawer,`). Wrap the whole drawer block (`<div style={{...styles.drawer, maxHeight: drawerOpen ? '70vh' : 38}}>` through its closing `</div>`) in `{isMobile && ( ... )}`:

```jsx
{isMobile && (
  <div style={{
    ...styles.drawer,
    maxHeight: drawerOpen ? '70vh' : 38,
  }}>
    {/* ... existing drawer contents ... */}
  </div>
)}
```

- [ ] **Step 2: Add the desktop palette + pills above the drawer**

Just BEFORE the `{isMobile && (` block from Step 1, insert:

```jsx
{!isMobile && (
  <>
    <MainPalette pos={mainPos} setPos={setMainPos} collapsed={mainCollapsed} setCollapsed={setMainCollapsed}>
      <div style={styles.modeRow}>
        <button onClick={() => setPathShape('circle')} style={{...styles.modeBtn, ...(pathShape === 'circle' ? styles.modeBtnOn : {})}}>circle</button>
        <button onClick={() => setPathShape('ellipse')} style={{...styles.modeBtn, ...(pathShape === 'ellipse' ? styles.modeBtnOn : {})}}>ellipse</button>
        <button onClick={() => setPathShape('torusKnot')} style={{...styles.modeBtn, ...(pathShape === 'torusKnot' ? styles.modeBtnOn : {})}}>knot</button>
        <button onClick={() => setPathShape('lemniscate')} style={{...styles.modeBtn, ...(pathShape === 'lemniscate' ? styles.modeBtnOn : {})}}>figure-8</button>
      </div>
      {pathShape === 'circle' && (
        <Slider label="R" min={0.5} max={5} step={0.05} value={circleR} onChange={setCircleR} editable />
      )}
      {pathShape === 'ellipse' && (
        <>
          <Slider label="a" min={0.5} max={5} step={0.05} value={ellipseA} onChange={setEllipseA} editable />
          <Slider label="b" min={0.5} max={5} step={0.05} value={ellipseB} onChange={setEllipseB} editable />
        </>
      )}
      {pathShape === 'torusKnot' && (
        <>
          <Slider label="R" min={0.5} max={5} step={0.05} value={knotR} onChange={setKnotR} editable />
          <Slider label="r" min={0.85} max={2} step={0.05} value={knotr} onChange={setKnotr} editable />
          <Slider label="p" min={1} max={9} value={knotP} onChange={(v) => {
            const np = Math.max(1, v | 0);
            if (gcd(np, knotQ) === 1) { setKnotP(np); return; }
            let nq = knotQ + 1;
            while (gcd(np, nq) !== 1 && nq < 20) nq++;
            setKnotP(np); setKnotQ(nq);
          }} editable />
          <Slider label="q" min={1} max={9} value={knotQ} onChange={(v) => {
            const nq = Math.max(1, v | 0);
            if (gcd(knotP, nq) === 1) { setKnotQ(nq); return; }
            let np = knotP + 1;
            while (gcd(np, nq) !== 1 && np < 20) np++;
            setKnotP(np); setKnotQ(nq);
          }} editable />
        </>
      )}
      {pathShape === 'lemniscate' && (
        <Slider label="a" min={0.5} max={5} step={0.05} value={lemA} onChange={setLemA} editable />
      )}
      <Slider label="n" min={0} max={Math.max(12, m * 2, n + 2)} value={n} onChange={(v) => setN(Math.max(0, v))} editable />
      <Slider label="m" min={2} max={Math.max(12, m + 2)} value={m} onChange={(v) => setM(Math.max(2, v))} editable />
      <div style={styles.toggleRow}>
        <Toggle label="auto-rotate" on={autoRotate} onChange={setAutoRotate} />
        <Toggle label="ridges" on={showRidges && !cut} onChange={setShowRidges} disabled={cut} />
        <Toggle label="gradient" on={gradient} onChange={setGradient} />
      </div>
    </MainPalette>
    <div style={styles.pillRow}>
      <Pill icon="✂" label="Cut" active={cut} onClick={() => setCut(!cut)} />
      <Pill icon="♪" label="Sound" active={openPopover === 'sound'} onClick={() => setOpenPopover(openPopover === 'sound' ? null : 'sound')} />
    </div>
  </>
)}
```

The cut pill currently toggles the existing `cut` state directly — this preserves Task 1's behavior. We'll convert it to toggle a *cut popover* in Task 3 instead.

- [ ] **Step 3: Mirror to `gml_body.jsx`**

- [ ] **Step 4: Verify in browser**

Open `index.html`. On desktop (≥ 720 px wide):
- A floating `BODY` palette is at top-left with the path picker, contextual sliders, n/m sliders, and the auto-rotate / ridges / gradient toggles.
- The bottom-right has two pills: `✂ Cut` and `♪ Sound`. Click `Cut` once — the body splits (the existing `cut` state still drives geometry); click again — un-cuts.
- Existing bottom drawer is hidden (no drawer at the bottom).
- Info strip is at bottom-center.

Resize below 720 px: the floating palette + pills disappear; the bottom drawer reappears. Resize back; the floating layout returns.

Click the title `▾ Body` of the main palette: it collapses to header-only. Click again: re-expands. Refresh: collapsed state persists.

- [ ] **Step 5: Static check**

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx | wc -l
```
Expected: `68`.

- [ ] **Step 6: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
feat(controls): desktop floating palette + cut/sound pills

The MainPalette renders top-left with path picker, n/m sliders, and the
display toggle row. Cut and Sound pills appear bottom-right. Existing
bottom drawer is hidden on desktop (≥720px) and kept on mobile. Cut pill
toggles the existing cut state; Sound pill toggles openPopover state but
no popover content is wired yet (Task 3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire the Sound popover

Render the sound popover with the existing waveform display, p / q / Hz / amp sliders, and a Play / Stop button. Outside-click and Escape close it; clicking the Sound pill toggles it. Update `rebuild`'s `soundMode` computation so opening the popover gives a live preview.

**Files:**
- Modify: `index.html` (JSX inside `GMLBody`, plus the rebuild-trigger `useEffect`).
- Mirror: `gml_body.jsx`.

- [ ] **Step 1: Add a ref for the sound pill and pass it to its `Popover`**

In the `<Pill icon="♪" ...>` line you wrote in Task 2, change it to keep a ref. Replace the entire `<div style={styles.pillRow}>` block with:

```jsx
<div style={styles.pillRow}>
  <Pill icon="✂" label="Cut" active={cut} onClick={() => setCut(!cut)} />
  <span ref={soundPillRef}>
    <Pill icon="♪" label="Sound" active={openPopover === 'sound'}
          onClick={() => setOpenPopover(openPopover === 'sound' ? null : 'sound')} />
  </span>
</div>
<Popover open={openPopover === 'sound'} anchor={soundPillRef} onClose={() => setOpenPopover(null)} title="♪ Sound">
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
</Popover>
```

Add at the top of `GMLBody`'s body, alongside the other refs:

```jsx
const soundPillRef = useRef(null);
```

- [ ] **Step 2: Update `soundMode` computation**

Find the existing line in `GMLBody`:

```jsx
const soundMode = tab === 'sound';
```

(It's inside the rebuild-trigger `useEffect`.)

Replace with:

```jsx
const soundMode = openPopover === 'sound' || wavePlaying;
```

Update the `useEffect` deps array of that effect: drop `tab`, add `openPopover` and `wavePlaying`. Find the closing of the effect — the line resembling:

```jsx
}, [tab, m, n, showRidges, cut, cutMode, sliceCount, offsetD, cutPhi, separation, seamOpen, phi1, phi2, bladeShape, bladeAmount, bladeProfile, gradient, pathShape, circleR, ellipseA, ellipseB, knotR, knotr, knotP, knotQ, lemA]);
```

Replace with:

```jsx
}, [openPopover, wavePlaying, m, n, showRidges, cut, cutMode, sliceCount, offsetD, cutPhi, separation, seamOpen, phi1, phi2, bladeShape, bladeAmount, bladeProfile, gradient, pathShape, circleR, ellipseA, ellipseB, knotR, knotr, knotP, knotQ, lemA]);
```

- [ ] **Step 3: Remove the audio fade-out-on-tab-change useEffect**

Find the existing `useEffect` containing the line:

```jsx
if (tab !== 'sound' && wavePlaying) {
```

Delete the entire `useEffect(() => { ... }, [tab]);` block. Closing the popover no longer auto-stops audio per spec.

- [ ] **Step 4: Mirror to `gml_body.jsx`**

- [ ] **Step 5: Verify in browser**

On desktop:
- Click `♪ Sound` pill — popover opens above it, showing the waveform, p/q/Hz/amp sliders, and a Play button. The body's color sweep starts animating immediately (live preview).
- Click `▶ Play` — audio starts; button label changes to `■ Stop` and gains the active fill.
- Click outside the popover (e.g. on the canvas) — popover closes; audio keeps playing; color sweep stops (because `openPopover === 'sound'` is now false but `wavePlaying` is true → soundMode stays on). Wait — that last bit is a contradiction. Re-check: `soundMode = openPopover === 'sound' || wavePlaying`. After closing the popover with audio playing, `wavePlaying` is true so `soundMode` is still true. Color sweep continues. ✓
- Click `■ Stop` (after re-opening the popover) — audio stops; sweep stops if popover is also closed.
- Press `Escape` while popover is open — popover closes.

- [ ] **Step 6: Static check**

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx | wc -l
```
Expected: `68`.

- [ ] **Step 7: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
feat(controls): wire Sound popover with waveform + Play/Stop

Sound pill toggles a popover containing the existing waveform display,
p/q/Hz/amp sliders, and a Play button (replaces the toggle-row sound
on/off). soundMode is now (openPopover === 'sound' || wavePlaying), so
opening the popover gives a live color-sweep preview without audio.
Closing the popover does not stop audio. Tab-driven audio fade-out is
removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the Cut popover

Convert the cut pill from "toggle cut state" to "toggle the cut popover," and put all cut-mode UI inside the popover. The cut state itself becomes a control inside the popover.

**Files:**
- Modify: `index.html` (the cut pill onClick handler, plus a new `<Popover>` for cut).
- Mirror: `gml_body.jsx`.

- [ ] **Step 1: Add a cut pill ref**

Alongside `soundPillRef`, add:

```jsx
const cutPillRef = useRef(null);
```

- [ ] **Step 2: Replace the cut pill block**

Replace the `<Pill icon="✂" label="Cut" ...>` line and add the cut popover beside the sound popover.

Replace the JSX block from Task 3 Step 1 with:

```jsx
<div style={styles.pillRow}>
  <span ref={cutPillRef}>
    <Pill icon="✂" label="Cut" active={openPopover === 'cut'}
          onClick={() => setOpenPopover(openPopover === 'cut' ? null : 'cut')} />
  </span>
  <span ref={soundPillRef}>
    <Pill icon="♪" label="Sound" active={openPopover === 'sound'}
          onClick={() => setOpenPopover(openPopover === 'sound' ? null : 'sound')} />
  </span>
</div>
<Popover open={openPopover === 'cut'} anchor={cutPillRef} onClose={() => setOpenPopover(null)} title="✂ Cut">
  <div style={styles.toggleRow}>
    <Toggle label={cut ? 'cutting' : 'whole'} on={cut} onChange={setCut} accent />
  </div>
  {cut && (
    <>
      <div style={{...styles.modeRow, marginTop: 8}}>
        <button onClick={() => setCutMode('center')} style={{...styles.modeBtn, ...(cutMode === 'center' ? styles.modeBtnOn : {})}}>center</button>
        <button onClick={() => setCutMode('parallel')} style={{...styles.modeBtn, ...(cutMode === 'parallel' ? styles.modeBtnOn : {})}}>parallel</button>
        <button onClick={() => setCutMode('offcenter')} style={{...styles.modeBtn, ...(cutMode === 'offcenter' ? styles.modeBtnOn : {})}}>off-center</button>
        <button onClick={() => setCutMode('p2p')} style={{...styles.modeBtn, ...(cutMode === 'p2p' ? styles.modeBtnOn : {})}}>p→p</button>
      </div>
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
      <Slider label="gap" min={0} max={100} value={separation} onChange={setSeparation} suffix={`${separation}%`} />
      <Slider label="open" min={0} max={100} value={seamOpen} onChange={setSeamOpen} suffix={`${seamOpen}%`} />
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
      <div style={styles.toggleRow}>
        <Toggle label="2D view" on={show2D} onChange={setShow2D} />
        <Toggle label="solo piece" on={hideOthers} onChange={setHideOthers} />
      </div>
    </>
  )}
</Popover>
```

- [ ] **Step 3: Mirror to `gml_body.jsx`**

- [ ] **Step 4: Verify in browser**

On desktop:
- Click `✂ Cut` pill — popover opens with a "whole/cutting" toggle and (if cut is on) the cut-mode picker, sliders, blade controls, 2D view, and solo piece.
- Toggle "cutting" on; the body splits per the existing logic. The cut-mode picker becomes visible inside the popover.
- Click each cut mode (center/parallel/off-center/p→p); the contextual sliders update inline.
- Choose `parallel` mode and `blade=curved`; the blade amplitude slider appears; drag it; mesh updates.
- Choose `blade=draw` (custom); the inline `BladeProfileEditor` shows; modify a control point; mesh updates.
- Click outside the popover; popover closes; cut state is preserved (body still cut). Re-open the popover; previous settings are still there.
- The info strip's piece-count summary updates as you change cut modes.
- Press `Escape`; popover closes.

- [ ] **Step 5: Static check**

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx | wc -l
```
Expected: `68`.

- [ ] **Step 6: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
feat(controls): wire Cut popover with all cut/blade controls

Cut pill now toggles a popover that contains the cut on/off toggle, the
mode picker (center/parallel/off-center/p→p), all mode-specific sliders,
gap/open, the blade picker (with custom-profile editor), and the 2D-view
and solo-piece toggles. Clicking outside or pressing Escape closes the
popover; cut state is preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Position the popovers correctly above their pills

Currently `Popover` is hard-coded at `right: 18, bottom: 60`. With both pills in the same row, the cut popover should anchor to the cut pill (~110 px further left) and the sound popover to the sound pill (rightmost). Make `Popover`'s position computed from its `anchor` ref's bounding rect.

**Files:**
- Modify: `index.html` (`Popover` component body).
- Mirror: `gml_body.jsx`.

- [ ] **Step 1: Replace the `Popover` body with rect-based positioning**

Find the `function Popover({ open, anchor, onClose, title, children }) { ... }` defined in Task 1, Step 3. Replace its body with:

```jsx
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
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', compute);
      document.removeEventListener('mousedown', onDown);
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
```

- [ ] **Step 2: Mirror to `gml_body.jsx`**

- [ ] **Step 3: Verify in browser**

On desktop:
- Click `Cut` pill: popover appears anchored above the cut pill (left of the sound pill).
- Click `Sound` pill: popover appears above the sound pill (right side).
- Resize the window: popover stays anchored above its pill.
- The two popovers never overlap their pill row.

- [ ] **Step 4: Static check**

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx | wc -l
```
Expected: `68`.

- [ ] **Step 5: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
feat(controls): anchor popovers to their trigger pill via getBoundingClientRect

Popover position is now computed from anchor.current.getBoundingClientRect
on open and on resize. Cut popover sits above the cut pill; sound popover
sits above the sound pill. No more hard-coded right:18.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate mobile drawer to `<MobileDrawer>` with shared children

The desktop palette and the mobile drawer currently render different children blocks. Refactor so both render the **same** children (path picker + sliders + toggles + cut + sound) inside their respective container. This eliminates the duplication introduced by Task 2's `{!isMobile && (...)}` / `{isMobile && (...)}` split.

**Files:**
- Modify: `index.html` (the JSX inside `GMLBody`'s return).
- Mirror: `gml_body.jsx`.

- [ ] **Step 1: Extract the shared children block**

Inside `GMLBody`, just BEFORE the `return ( ... )`, define the shared blocks as JSX local variables:

```jsx
const bodyControls = (
  <>
    <div style={styles.modeRow}>
      <button onClick={() => setPathShape('circle')} style={{...styles.modeBtn, ...(pathShape === 'circle' ? styles.modeBtnOn : {})}}>circle</button>
      <button onClick={() => setPathShape('ellipse')} style={{...styles.modeBtn, ...(pathShape === 'ellipse' ? styles.modeBtnOn : {})}}>ellipse</button>
      <button onClick={() => setPathShape('torusKnot')} style={{...styles.modeBtn, ...(pathShape === 'torusKnot' ? styles.modeBtnOn : {})}}>knot</button>
      <button onClick={() => setPathShape('lemniscate')} style={{...styles.modeBtn, ...(pathShape === 'lemniscate' ? styles.modeBtnOn : {})}}>figure-8</button>
    </div>
    {pathShape === 'circle' && (
      <Slider label="R" min={0.5} max={5} step={0.05} value={circleR} onChange={setCircleR} editable />
    )}
    {pathShape === 'ellipse' && (
      <>
        <Slider label="a" min={0.5} max={5} step={0.05} value={ellipseA} onChange={setEllipseA} editable />
        <Slider label="b" min={0.5} max={5} step={0.05} value={ellipseB} onChange={setEllipseB} editable />
      </>
    )}
    {pathShape === 'torusKnot' && (
      <>
        <Slider label="R" min={0.5} max={5} step={0.05} value={knotR} onChange={setKnotR} editable />
        <Slider label="r" min={0.85} max={2} step={0.05} value={knotr} onChange={setKnotr} editable />
        <Slider label="p" min={1} max={9} value={knotP} onChange={(v) => {
          const np = Math.max(1, v | 0);
          if (gcd(np, knotQ) === 1) { setKnotP(np); return; }
          let nq = knotQ + 1;
          while (gcd(np, nq) !== 1 && nq < 20) nq++;
          setKnotP(np); setKnotQ(nq);
        }} editable />
        <Slider label="q" min={1} max={9} value={knotQ} onChange={(v) => {
          const nq = Math.max(1, v | 0);
          if (gcd(knotP, nq) === 1) { setKnotQ(nq); return; }
          let np = knotP + 1;
          while (gcd(np, nq) !== 1 && np < 20) np++;
          setKnotP(np); setKnotQ(nq);
        }} editable />
      </>
    )}
    {pathShape === 'lemniscate' && (
      <Slider label="a" min={0.5} max={5} step={0.05} value={lemA} onChange={setLemA} editable />
    )}
    <Slider label="n" min={0} max={Math.max(12, m * 2, n + 2)} value={n} onChange={(v) => setN(Math.max(0, v))} editable />
    <Slider label="m" min={2} max={Math.max(12, m + 2)} value={m} onChange={(v) => setM(Math.max(2, v))} editable />
    <div style={styles.toggleRow}>
      <Toggle label="auto-rotate" on={autoRotate} onChange={setAutoRotate} />
      <Toggle label="ridges" on={showRidges && !cut} onChange={setShowRidges} disabled={cut} />
      <Toggle label="gradient" on={gradient} onChange={setGradient} />
    </div>
  </>
);

const cutControls = (
  <>
    <div style={styles.toggleRow}>
      <Toggle label={cut ? 'cutting' : 'whole'} on={cut} onChange={setCut} accent />
    </div>
    {cut && (
      <>
        <div style={{...styles.modeRow, marginTop: 8}}>
          <button onClick={() => setCutMode('center')} style={{...styles.modeBtn, ...(cutMode === 'center' ? styles.modeBtnOn : {})}}>center</button>
          <button onClick={() => setCutMode('parallel')} style={{...styles.modeBtn, ...(cutMode === 'parallel' ? styles.modeBtnOn : {})}}>parallel</button>
          <button onClick={() => setCutMode('offcenter')} style={{...styles.modeBtn, ...(cutMode === 'offcenter' ? styles.modeBtnOn : {})}}>off-center</button>
          <button onClick={() => setCutMode('p2p')} style={{...styles.modeBtn, ...(cutMode === 'p2p' ? styles.modeBtnOn : {})}}>p→p</button>
        </div>
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
        <Slider label="gap" min={0} max={100} value={separation} onChange={setSeparation} suffix={`${separation}%`} />
        <Slider label="open" min={0} max={100} value={seamOpen} onChange={setSeamOpen} suffix={`${seamOpen}%`} />
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
        <div style={styles.toggleRow}>
          <Toggle label="2D view" on={show2D} onChange={setShow2D} />
          <Toggle label="solo piece" on={hideOthers} onChange={setHideOthers} />
        </div>
      </>
    )}
  </>
);

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

- [ ] **Step 2: Replace the desktop and mobile branches with shared children**

Replace the entire `{!isMobile && (...)} {isMobile && (...)}` pair (which currently contains a copy of the controls in each branch) with:

```jsx
{!isMobile && (
  <>
    <MainPalette pos={mainPos} setPos={setMainPos} collapsed={mainCollapsed} setCollapsed={setMainCollapsed}>
      {bodyControls}
    </MainPalette>
    <div style={styles.pillRow}>
      <span ref={cutPillRef}>
        <Pill icon="✂" label="Cut" active={openPopover === 'cut'}
              onClick={() => setOpenPopover(openPopover === 'cut' ? null : 'cut')} />
      </span>
      <span ref={soundPillRef}>
        <Pill icon="♪" label="Sound" active={openPopover === 'sound'}
              onClick={() => setOpenPopover(openPopover === 'sound' ? null : 'sound')} />
      </span>
    </div>
    <Popover open={openPopover === 'cut'} anchor={cutPillRef} onClose={() => setOpenPopover(null)} title="✂ Cut">
      {cutControls}
    </Popover>
    <Popover open={openPopover === 'sound'} anchor={soundPillRef} onClose={() => setOpenPopover(null)} title="♪ Sound">
      {soundControls}
    </Popover>
  </>
)}

{isMobile && (
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
)}
```

- [ ] **Step 3: Mirror to `gml_body.jsx`**

- [ ] **Step 4: Verify in browser — desktop and mobile**

Desktop (≥ 720 px):
- Layout from Tasks 2–5 still works identically. No regression.

Mobile (< 720 px, e.g. 600 px wide):
- Bottom drawer collapses/expands via the handle.
- Inside: Body section (path picker / sliders / display toggles), then Cut section (the same toggle/mode/sliders/blade/2D/solo from the desktop popover), then Sound section (waveform + sliders + Play).
- Toggle cut on; the cut sub-controls appear inside the Cut section. Toggle off; they hide.
- Press Play in the Sound section; audio starts.
- Resize the window between mobile and desktop widths; all state (path, cut, sound, sliders) is preserved across the layout switch.

- [ ] **Step 5: Static check**

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx | wc -l
```
Expected: `68`.

- [ ] **Step 6: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
refactor(controls): share children between desktop palettes and mobile drawer

Hoist bodyControls / cutControls / soundControls JSX vars and render the
same blocks inside MainPalette + popovers (desktop) or MobileDrawer
sections (mobile). Eliminates the duplication introduced when the
floating palette landed alongside the mobile drawer. State is preserved
across desktop ↔ mobile transitions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Remove dead `tab` state and obsolete UI

The `tab` state and the geometry/sound tab row are no longer wired to anything visible. Delete them so there's nothing to drift.

**Files:**
- Modify: `index.html` (the `useState('geometry')` line, the tab-row JSX inside the old drawer, the readout block).
- Mirror: `gml_body.jsx`.

- [ ] **Step 1: Remove `tab` state**

Find:

```jsx
const [tab, setTab] = useState('geometry');
```

Delete that line.

- [ ] **Step 2: Remove all `tab`/`setTab` references**

Run:

```bash
grep -n -E "(tab\b|setTab\b)" /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html
```

Expected: zero hits. If any remain (e.g. inside the deleted drawer's tab-row block), delete them.

For each remaining reference, delete the surrounding JSX:
- `<div style={styles.tabRow}>` and its contents (the geometry/sound tab buttons that lived in the old drawer).
- Any `tab === 'geometry'` / `tab === 'sound'` conditionals inside the JSX. The `note` block (piece-count summary) was previously gated by `tab === 'geometry'`; it's now unused at all because the same content lives inside the `InfoStrip`.
- The old `readout` block (the `<div style={styles.readout}>`) — m / n / τ now live inside the `InfoStrip`, so this block is dead code.

(These regions should already be unreachable due to Task 6's mobile-drawer simplification, but they remain in source.)

- [ ] **Step 3: Drop unused style entries (optional)**

If `styles.tabRow`, `styles.tabBtn`, `styles.tabBtnOn`, `styles.readout`, `styles.param`, `styles.paramLabel`, `styles.paramVal`, `styles.paramHint`, and `styles.note` are no longer referenced (grep first to confirm), delete them. If grep shows any reference remaining, leave them alone.

```bash
for k in tabRow tabBtn tabBtnOn readout param paramLabel paramVal paramHint note; do
  echo "=== $k ==="
  grep -c "styles.$k" /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html
done
```

For any key with a `0` count, delete the corresponding entry from the `const styles = { ... }` object.

- [ ] **Step 4: Mirror to `gml_body.jsx`**

- [ ] **Step 5: Verify in browser**

Open `index.html`. No visible change from Task 6 — same layout, same behavior. Resize across the mobile threshold; both layouts work. Toggle cut / sound; popovers and audio behave correctly. The only difference is that the source code is smaller and the `tab` ghost is gone.

- [ ] **Step 6: Static checks**

```bash
diff /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx | wc -l
```
Expected: `68`.

```bash
grep -n -E "tab\b|setTab\b" /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html
```
Expected: empty.

- [ ] **Step 7: Commit**

```bash
git add /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/index.html /Users/sds-ge573/PycharmProjects/ilia_tavkhelidze/gml_body.jsx
git commit -m "$(cat <<'EOF'
chore(controls): remove obsolete tab state, tabRow, readout, and note JSX

After the floating-palette redesign, the geometry/sound tab pair, the
readout strip, and the bottom note are dead code: m/n/τ and piece counts
are rendered by InfoStrip; sound is a popover, not a tab. Drops 'tab'
state and the related JSX/styles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

I reviewed the plan against the spec section by section:

- **Layout (desktop)** — Task 2 (palette + pills) + Task 3 (sound popover) + Task 4 (cut popover) + Task 5 (anchored positioning).
- **Mobile drawer fallback** — Task 1 (`<MobileDrawer>` shell defined) + Task 6 (children shared between desktop and mobile).
- **`isMobile` state + resize listener** — Task 1, Step 1.
- **Drag + localStorage persistence** — Task 1, Steps 1 & 3 (state + `<MainPalette>` pointer-event drag handler + `gml.mainPalette` localStorage round-trip).
- **Collapse main palette via title click** — Task 1, Step 3 (`onClick={() => setCollapsed(!collapsed)}` on the title span).
- **Outside-click + Escape close popover** — Task 1, Step 3 (`Popover` initial implementation) + Task 5 (anchor-aware re-implementation).
- **Only one popover open at a time** — `setOpenPopover('cut' | 'sound' | null)` is single-valued, by construction.
- **Cut and Sound pills with active state** — Task 2 (initial `<Pill>`), Tasks 3 & 4 (wired to `openPopover`).
- **Info strip (m/n/τ + piece-count summary on cut)** — Task 1 (`<InfoStrip>` defined and rendered).
- **Visual style (terminal-luxe)** — Task 1, Step 2 (`styles.palette`, `styles.popover`, `styles.palettePill[On]`, `styles.infoStrip`).
- **`soundMode = openPopover === 'sound' || wavePlaying`** — Task 3, Step 2.
- **Audio fade-out useEffect removed** — Task 3, Step 3.
- **Z-index strategy** — Task 1, Step 2 (`palette/pillRow/infoStrip = 10`, `popover = 20`).
- **Dead code cleanup** — Task 7.

No spec requirement is left without a task.

**Type / name consistency check** — `mainPos` is consistently `{x, y}`; `setMainPos`, `setMainCollapsed`, `setOpenPopover`, `setIsMobile` are the exact setter names used everywhere; `MainPalette`/`Pill`/`Popover`/`InfoStrip`/`MobileDrawer` component names are stable across tasks; `cutPillRef` / `soundPillRef` are the only refs introduced and they match between Task 3 and Tasks 4–5; `bodyControls` / `cutControls` / `soundControls` are the JSX vars introduced in Task 6 and used in both branches.

**Placeholder scan** — no TBD / TODO / "implement later" / "similar to Task N" patterns. Every step shows the actual code.

**One known soft area to flag for the executor:** Task 1 Step 4 says "find the closing `</div>` of the drawer." If the executor cannot uniquely identify that location, fall back to: insert the `<InfoStrip>` immediately before the closing `</div>` of the outermost `<div style={styles.root}>` block (which is the very last element of the `return (...)`). The component is `position: fixed`, so its placement in the JSX tree doesn't affect layout — only React reconciliation order.
