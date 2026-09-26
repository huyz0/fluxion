# 01 — Rendering & Editor Engines Research

> Project: **Fluxion** — AI-generated + human-edited interactive presentations and static info sites.
> Scope: canvas/diagram engines, rendering tech, editor-core architecture, shape libraries, connectors, mobile presentation.
> Research date: 2026-09. Versions/licensing verified against vendor pages where cited; anything marked *(verify)* should be re-checked before a contractual decision.

---

## 0. TL;DR

- **Build our own engine**, rendered with **DOM + SVG inside React**, organized as a *scene graph of normalized records* with a *signals-based store*. Borrow patterns heavily from tldraw (ShapeUtil, bindings, statechart tools, migrations) but **do not depend on the tldraw SDK** (source-available, license key required for production, commercial pricing by negotiation, watermark on non-commercial tiers).
- Use **MIT/permissive libraries for the hard sub-problems**: `rbush`/`flatbush` (spatial index), `libavoid-js` (orthogonal routing, LGPL-2.1 wasm — keep it dynamically loaded & replaceable) plus an in-house A*/Manhattan fallback, `bezier-js` (curve math), `@iconify/*` (icon ingestion), `immer` patches or a hand-rolled diff log (undo), `alien-signals` or `@preact/signals-core` (reactivity), `elkjs`/`dagre` (auto-layout, optional).
- **React Flow (MIT)** is a strong reference for "nodes are React components", but it is a *node-graph* library (no rotation, no rich connector routing, no grouping semantics suited to slides). Good for prototyping, not as the foundation.
- For mobile: **scale-to-fit fixed canvas by default + optional per-breakpoint layout overrides** (a "mobile layout" variant of each screen, AI-generatable), with swipe navigation and pinch-zoom in present mode.

---

## 1. Canvas / Diagram Engines Landscape

### 1.1 Summary table

| Engine | Rendering | Shapes as React components? | Connectors / routing | Data model | License (2026) | Fit for Fluxion |
|---|---|---|---|---|---|---|
| **tldraw SDK** (v4.x, 4.4 Feb 2026) | DOM (HTML/SVG per shape via React) + canvas for some overlays/indicators (4.4 added canvas indicators) | **Yes** — `ShapeUtil.component()` returns JSX | Arrows with bindings (straight/curved; elbow arrows added in 3.x/4.x) | Normalized records in `@tldraw/store`, signals (`@tldraw/state`, successor of signia), schema migrations | **tldraw license** (source-available): dev use free; **production requires license key** (trial 100 days, hobby w/ watermark, commercial by quote, startup discount) | Excellent architecture reference; licensing cost + lock-in is the blocker |
| **Excalidraw** | Canvas2D (dual canvas: static + interactive), rough.js | No (embeddables/iframes only) | Arrows w/ bindings, elbow arrows | Flat element array, versioned elements | **MIT** | Hand-drawn aesthetic; canvas rendering conflicts with React-component shapes |
| **React Flow / xyflow** (v12.x) | DOM (nodes = divs) + SVG edges layer | **Yes** — nodes are React components; custom edges too | Bezier / step / smoothstep / straight; handles = ports; floating-edge examples; no built-in obstacle avoidance (community: smart-edge A*, libavoid wasm) | Arrays of nodes/edges, Zustand internally | **MIT**; optional Pro subscription (examples/support, no license key) | Great for node-graph UIs; lacks rotation, rich text, grouping/align tooling of a slide editor |
| **JointJS / JointJS+** (4.x) | SVG | React integration available (JointJS 4 has React support; HTML in foreignObject) | Rich: routers (normal, orthogonal, manhattan, metro), connectors (rounded, smooth, jumpover), anchors, connection points, ports | Backbone-style graph model | Core **MPL-2.0**; JointJS+ commercial (per developer, from ≈$3.4k) — undo, selection, stencil, snaplines, export are **+ only** | Best-in-class connector toolbox; MPL fine, but key editor UX paid; framework-y, non-React idioms |
| **mxGraph → maxGraph** (0.24, Jul 2026) | SVG | No (HTML labels possible) | Very rich edge styles (orthogonal, elbow, entity-relation, segment), perimeters, constraints | mxGraphModel/XML (draw.io compatible) | **Apache-2.0** | Useful for reading draw.io XML & stencil semantics; still 0.x, non-React, heavy |
| **draw.io (diagrams.net)** | SVG (mxGraph) | No | Same as mxGraph | XML | Apache-2.0 (app code); stencil libraries mixed | Source of stencil formats & shape libraries |
| **GoJS** (3.x) | Canvas (SVG export) | No | Excellent routing (AvoidsNodes orthogonal), link labels, ports | Model/Diagram | Commercial, per developer (~$3,995 individual), license key | Powerful but canvas-only, closed, costly |
| **Konva / react-konva** | Canvas2D scene graph | JSX API, but nodes are Konva shapes not DOM components | None built in | Scene graph | **MIT** | Good for pure-graphics; can't host arbitrary React/HTML |
| **Fabric.js** (v6+) | Canvas2D | No | None | Object model | **MIT** | Image/graphics editors; wrong fit |
| **PixiJS** (v8.x, WebGL/WebGPU) | GPU | `@pixi/react` v8 (React 19) — JSX for Pixi objects; `DOMContainer` overlays DOM in sync; `html-source` renders live DOM to textures | None | Scene graph | **MIT** | Candidate for a future GPU layer, not the primary one |
| **Rete.js** (v2) | Pluggable (React/Vue/Angular renderers) | Yes via React plugin | Node-editor style connections | Node graph + dataflow engine | **MIT** | Visual programming; not a slide/diagram editor |
| **Penpot** | Migrating SVG → Rust/wasm + Skia on WebGL (beta mid-2026) | No | Basic | ClojureScript; binary serialization to wasm | **MPL-2.0** | Proof that SVG hits limits at *design-file* scale; architecture lesson only |
| **Figma** | C++ → wasm, WebGL → **WebGPU (2025)**, tiled renderer | No (plugins run sandboxed, UI in iframes) | Connectors in FigJam | Custom document tree, multiplayer via server-authoritative per-property LWW | Proprietary | Lessons: property-level CRDT-ish sync, GPU renderer for huge docs |
| **Miro / Whimsical** | Canvas/WebGL (Miro), Whimsical DOM/canvas hybrid | No | Smart connectors | Proprietary | Proprietary | UX reference only |

### 1.2 tldraw in depth (the most relevant reference)

**Architecture**
- `Editor` class owns everything; UI and canvas are React components subscribing via signals.
- **Store**: normalized records keyed by typed IDs (`shape:…`, `page:…`, `binding:…`, `instance`, `camera`), each record type with a validator (`@tldraw/validate`) and a **migration sequence** — documents from old versions upgrade on load.
- **Signals** (`@tldraw/state`, the in-repo successor of `signia`): `atom` / `computed` with *epoch-based* incremental computation; computed caches like "shape page bounds", "shapes in viewport", "culled shapes" recompute only for changed records.
- **ShapeUtil**: per shape type — `getDefaultProps`, `getGeometry` (Geometry2d used for hit testing, snapping, binding, arrows), `component` (JSX), `indicator` (selection outline; v4.4 adds canvas path indicators), `toSvg` (export), resize/rotate handlers, `canBind`, `canCull`, etc. v4.3 reduced type-boilerplate for custom shapes/bindings.
- **BindingUtil**: bindings are *first-class records* (`fromId`, `toId`, props like normalized anchor, `isPrecise`, `isExact`), with lifecycle hooks (`onAfterChangeToShape`, `onBeforeDelete…`) so arrows follow shapes and constraints can be implemented (e.g., sticker, layout). v4.4 added shape-aware binding checks.
- **Tools** = hierarchical **StateNodes** (statechart): `select` → `idle` / `pointing_shape` / `translating` / `resizing` / `rotating` / `brushing` … Events flow down the active path. Extremely instructive and hand-rolled (no XState).
- **History**: marks + diffs (`RecordsDiff`) squashed per interaction; undo reverts diffs until the previous mark.
- **Sync**: `@tldraw/sync` — server-authoritative record-level sync over websockets (Cloudflare Durable Objects template).

**License (critical)**
- Since v2 the SDK is under the **tldraw license**: free in development; **production deployments require a license key** that encodes allowed hosts, type, expiry. Types: **Trial** (100 days), **Hobby** (non-commercial, watermark stays), **Commercial** (removes watermark; price by sales quote — HN discussion in 2025 called it a "massive license fee"), plus a **Startup** program. Key enforcement must not be tampered with; the SDK may report usage for compliance. (Sources: tldraw.dev/pricing, /sdk-features/license-key, LICENSE.md.)
- Some low-level packages have historically been MIT (e.g., early signia, possibly store/state/utils) *(verify per package on npm before copying code; the monorepo LICENSE applies to the SDK)*.
- **Implication**: Fluxion is a commercial product whose *whole value* is the editor; embedding tldraw means perpetual per-deal licensing, domain-locked keys (painful for a static-site exporter publishing to arbitrary customer domains!), and dependence on their roadmap. **Reading and learning from their public architecture is fine; copying code is not.**

### 1.3 React Flow / xyflow in depth
- Nodes are arbitrary React components; `Handle` components define ports (multiple, typed, positioned by CSS); edges are SVG paths in a separate layer; built-in edge path helpers (bezier, smoothstep, step, straight) and `EdgeLabelRenderer` for HTML labels.
- Viewport = CSS transform on a container; internal store is Zustand; supports sub-flows (parent nodes), `NodeResizer`, `NodeToolbar`, helper lines example, undo example (Pro).
- Limitations for Fluxion: no rotation, no native grouping/alignment tooling, handle positions are DOM-measured (async, harder for deterministic AI generation/SSR), routing is basic, node model is "graph", not "slide design".
- License **MIT**; Pro subscription optional, no license key, attribution badge removable.

### 1.4 JointJS
- Open core (MPL-2.0) contains the strongest *free* connector toolkit: routers (`orthogonal`, `manhattan` with obstacle avoidance, `metro`), connectors (`rounded`, `smooth`, `jumpover` = line hops), anchors & connection points (bbox, boundary/perimeter), ports with layouts. JointJS team also published a **standalone libavoid routing demo**.
- JointJS+ (commercial, per developer, from ≈$3,420) adds command manager (undo), selection, stencil palette, halo, snaplines, inspector, export, Visio import.
- Worth studying `manhattan` router & `jumpover` connector implementations (MPL-2.0 = file-level copyleft: modified MPL files must stay MPL; fine to *use*, careful to *copy*).

### 1.5 maxGraph / draw.io
- maxGraph is the TypeScript successor to mxGraph (EOL 2020), Apache-2.0, 0.24.0 released July 2026, becoming modular/tree-shakable. Keeps XML compatibility.
- Valuable for Fluxion as a **semantic reference and importer**: edge styles (`orthogonalEdgeStyle`, `elbowEdgeStyle`, `entityRelationEdgeStyle`), perimeters (rectangle, ellipse, rhombus, triangle…), connection constraints, stencil XML interpreter.

---

## 2. Rendering Technology Trade-offs

### 2.1 Comparison

| Criterion | DOM/HTML + SVG | Canvas2D | WebGL / WebGPU |
|---|---|---|---|
| Arbitrary React components as shapes | **Native** | Impossible (only overlays) | Impossible (overlay via DOMContainer / html-to-texture hacks) |
| Text quality, rich text, fonts, i18n, bidi, selection | **Best** (browser text engine, CSS) | Manual layout, no native selection | Hardest (SDF/MSDF glyphs or texture uploads) |
| Accessibility (screen readers, focus, ARIA) | **Native** | Needs shadow DOM/ARIA mirror | Same as canvas |
| Editing in place (contentEditable, inputs, TipTap/Lexical) | **Native** | Overlay required | Overlay required |
| Export (SVG/PDF/PNG, static site) | **Trivial** — the DOM *is* the output; SSR-able HTML | Re-implement to SVG/PDF | Re-implement |
| SEO / static info sites | **Excellent** (HTML) | Poor | Poor |
| WYSIWYG edit ≡ present | **Same components** in both modes | Same renderer, but interactive widgets differ | same |
| Perf @ 500 elements | Great | Great | Great |
| Perf @ 5,000 elements | OK with culling + memoization + `content-visibility`, CSS transforms for camera | Good | Great |
| Perf @ 50k+ | Poor | OK | **Best** (Figma, Penpot new engine) |
| Effects (blur, blend, filters) | CSS/SVG filters (can be slow at scale) | Moderate | Best |
| Hit testing | Browser (`elementFromPoint`) or geometry | Manual geometry | Manual / GPU picking |

**Verdict for Fluxion**: a slide/screen rarely exceeds a few hundred elements; even an info-site "canvas" should stay under ~5k. The requirements *React components as shapes*, *WYSIWYG = present*, *static-site export*, *a11y* and *text quality* all point decisively to **DOM + SVG**. Penpot's and Figma's moves to GPU are driven by design files with 100k+ layers — not our case.

### 2.2 Recommended hybrid layering (per screen)

```
<Viewport>                       ← pointer capture, gestures, camera transform
  <Background layer/>            ← CSS/SVG (theme backgrounds, grids in edit mode)
  <ConnectorLayer svg/>          ← one SVG with all connector paths + markers (below or above shapes, z-order aware)
  <ShapeLayer>                   ← one absolutely-positioned div per shape; inside: SVG geometry + HTML text + React component
  <ConnectorLabelLayer/>         ← HTML labels positioned along paths
  <OverlayLayer (edit only)>     ← selection boxes, handles, snaplines, port dots, brush — SVG or Canvas2D
</Viewport>
```
- Z-ordering connectors between shapes: either split connectors into per-z-band SVGs, or render each connector as its own absolutely positioned SVG (tldraw approach) so it can interleave with shapes via `z-index`. Recommended: **each element (shape or connector) is its own positioned element** with a fractional-index z-order; simplest mental model and matches tldraw.
- Edit overlays can move to **Canvas2D** later if selection chrome becomes a bottleneck (tldraw 4.4 did precisely this for indicators).
- Optional future: a PixiJS/WebGL *background/effects* layer for particles/animations — isolated behind the layer plugin API.

### 2.3 Camera, culling, hit testing, spatial index
- **Camera**: `{x, y, z}`; apply as one CSS `transform: scale(z) translate(x,y)` on the shape container; keep screen-space UI (handles) outside the scaled container so handle size is constant. Present mode uses a *fit transform* instead of a free camera.
- **Viewport culling**: compute visible page bounds; shapes outside get `display:none` (keep mounted for state-preserving React components — tldraw culls this way) or unmount if flagged `canUnmount`.
- **Spatial index**: `rbush` (dynamic R-tree, MIT) for editing (insert/remove on change); `flatbush` (static, packed, very fast, MIT) for present mode / export where the scene is immutable. Queries: brush selection, snapping candidates, connector obstacle lists, hit testing.
- **Hit testing**: geometry-based (each ShapeUtil exposes `getGeometry()` → Geometry2d with `hitTestPoint`, `nearestPoint`, `intersectLineSegment`), *not* DOM-based, so it works for rotated shapes, thin strokes (tolerance by zoom), hollow vs filled shapes, and connectors. React-component shapes default to their bounding rectangle.

---

## 3. Editor Core Architecture Patterns

### 3.1 Document model — normalized records
```
Document ─ Screens(pages) ─ Elements (shape | connector | group | frame)
         ─ Bindings (connector-end ↔ shape port, constraints)
         ─ Themes, Assets, Libraries (shape definitions), Metadata
```
- Every record: `{ id, typeName, version?, ...props }`, flat in a store, parent via `parentId` + `index` (fractional indexing, e.g. `fractional-indexing` npm, MIT) for stable ordering & merge-friendly reorders.
- Transform: `x, y, rotation` relative to parent; `w, h` in props. Groups are elements whose bounds are derived.
- Keep **runtime/UI state** (selection, hover, camera, tool state) in separate *session* records not persisted in the document.
- JSON-serializable, schema-validated (Zod/Valibot/TypeBox) and **LLM-friendly** (AI will generate this; keep ids stable and props explicit; prefer semantic props like `anchor: "right"` over raw coordinates when possible).

### 3.2 Reactive store options

| Option | Model | Fine-grained derived data | React integration | Notes |
|---|---|---|---|---|
| **tldraw `@tldraw/state`** | signals, epoch-based incremental computeds | Excellent (`computed` with diffs) | `track()`, `useValue` | Built for exactly this; license *(verify)* |
| **alien-signals** (MIT) | push-pull, fastest benchmarks; basis of Vue 3.6 reactivity | Good | via small hook (`useSyncExternalStore`) | Tiny, framework-agnostic |
| **@preact/signals-core / -react** (MIT) | signals | Good | official adapter | Mature |
| **MobX** (MIT) | observable objects | Good | `observer` | Heavier; proxy-based |
| **Valtio** (MIT) | proxy snapshots | Moderate | `useSnapshot` | Simple, less control |
| **Zustand** (MIT) | immutable store + selectors | Via selectors/memo | Excellent | React Flow uses it; per-shape selectors fine at few-k elements |
| **Jotai** (MIT) | atoms | atomFamily per record | Excellent | Viable; many atoms |
| **Legend-State** (MIT) | observables, very fast | Good | yes | Smaller community |

**Recommendation**: a thin **Fluxion Store** (records Map + change log + history + migrations) whose reactivity is implemented on **alien-signals** (or preact signals-core) — one atom per record + computed caches (bounds, page transforms, spatial index, connector routes). Expose React hooks `useRecord(id)`, `useValue(computed)`. Keep the store framework-agnostic so it runs in Node (AI pipelines, SSR/static export, tests).

### 3.3 Commands, transactions, undo/redo
- All mutations go through `editor.run(fn, {history})` / `transact` → produce a **diff** `{added, updated:[from,to], removed}` per record. Undo = apply inverse diff. Squash diffs between *marks* (one mark per user gesture). This is what tldraw does and is simpler than Immer patches when the store is already record-based.
- Immer `produceWithPatches` is a fine alternative if the store were a single immutable tree; for normalized records, record-level diffs are cheaper and sync-friendly.
- Named **commands** (VS Code style: `fluxion.align.left`, `shape.bringForward`) registered by plugins, bound to keybindings/menus/command palette/AI tool-calls — the same command API should be the **AI agent's tool surface**.
- Collaborative future: record diffs map naturally to server-authoritative sync (tldraw-sync style) or to **Yjs**/**Loro**/Automerge (Y.Map per record). Decide later; design diffs to be serializable now.

### 3.4 Tools & interaction state machines
- Hand-rolled hierarchical statechart (tldraw `StateNode` pattern): `root → select{idle, pointing, translating, resizing, rotating, brushing, editing_text, dragging_handle}`, `connector{idle, pointing, creating}`, `hand`, `laser`/`pointer` (present-mode). Each node handles `onPointerDown/Move/Up`, `onKeyDown`, `onEnter/onExit`.
- XState v5 is a good option for complex *modal* flows (wizards, AI sessions) but per-pointer-move overhead and verbosity make a hand-rolled engine preferable for the hot path.
- **Present mode** = a different root tool set (only navigation, pointer, and *component-internal* interactivity), with the store in read-only mode (commands rejected by a policy guard).

### 3.5 Plugin system
Combine two patterns:
1. **Util registration** (tldraw): plugins register `ShapeUtil`, `ConnectorUtil`, `BindingUtil`, `Tool`, `ThemeToken` sets, `Importer`/`Exporter`, `LayoutAlgorithm`, `Router`.
2. **Contribution points** (VS Code): declarative manifest (`fluxion-plugin.json` / TS object) contributing commands, menus, toolbar items, inspector panels, keybindings, shape-library entries, AI tool descriptions — lazily activated.
- Each record type contributed by a plugin carries its **own schema + migrations** (namespaced: `acme.chart@3`). Unknown record types on load → preserved as opaque "missing plugin" placeholders rather than dropped.
- Sandboxing: first-party/trusted plugins run in-process (React components need that). Untrusted marketplace plugins later → iframe/ShadowRealm isolation with a message API (Figma model).

### 3.6 Schema migrations
- Per record type: ordered `migrations: [{id:'acme.chart/2', up(r){…}, down?}]` + document-level migrations (e.g., splitting a record type). Store stores `schemaVersions` per namespace. Validate after migration. (tldraw's `createMigrationSequence` is the reference design.)

---

## 4. Shape Libraries

### 4.1 Sources & formats

| Source | Format | Scale | License notes | Import strategy |
|---|---|---|---|---|
| **Iconify** | IconifyJSON: `{prefix, icons:{name:{body, width?, height?, left?, top?, rotate?, hFlip?, vFlip?}}, aliases, width/height defaults, info}` — `body` is inner SVG markup | 200k+ icons, 150+ sets (`@iconify/json`, per-set `@iconify-json/<prefix>`) | Iconify tooling MIT; **each set has its own license** in `info.license` (MIT, Apache, CC-BY, GPL…) → filter/record attribution | Ingest per-set JSON; icons become "icon shapes" (fill/stroke recolorable via `currentColor`); use `@iconify/utils` (`getIconData`, `iconToSVG`) |
| **Lucide** | SVG / JS components | ~1.5k | ISC | Also available in Iconify as `lucide:` |
| **draw.io stencils** | XML `<shape name w h aspect strokewidth><connections><constraint x y perimeter name/></connections><background>…</background><foreground>path/rect/ellipse/text…</foreground></shape>` | thousands (BPMN, UML, network, cloud, electrical…) | draw.io code Apache-2.0; bundled vendor icon sets carry vendor terms | Write a stencil→Fluxion converter (normalized 0..1 coordinates, constraints → ports) |
| **draw.io libraries** (`.xml` `<mxlibrary>` JSON arrays of compressed cells/images) | JSON inside XML | user libs | user-owned | Import as library of templates |
| **Visio** (`.vssx`) | OPC zip with ShapeSheet XML | large | vendor | Low priority; convert via draw.io or a VSDX parser |
| **AWS Architecture Icons** | SVG/PNG packs, quarterly | ~800 | Allowed for architecture diagrams incl. third-party tools; **no modification**, only to represent AWS services | Ship as optional library; keep unmodified |
| **Azure / GCP / Kubernetes icons** | SVG packs | hundreds | Vendor terms similar (diagram use) *(verify each)*; K8s icons Apache/CC | Same |
| **BPMN (bpmn.io) / UML** | Derived shapes | — | bpmn-js has custom license w/ watermark → **do not embed bpmn-js**; draw semantics ourselves | Implement as parametric shapes |

### 4.2 Defining shapes — three tiers (all first-class)
1. **Declarative parametric shapes (JSON)** — the AI-friendly, serializable tier:
   ```ts
   {
     id: "flow.decision", name: "Decision",
     params: { skew: { type: "number", default: 0.2, min: 0, max: 0.5 } },
     viewBox: "0 0 1 1",  // normalized
     path: "M {0.5} 0 L 1 {0.5} L {0.5} 1 L 0 {0.5} Z",   // or expression-templated
     geometry: "polygon",                      // for hit-test/perimeter
     ports: [{ id:"n", x:0.5, y:0 }, { id:"e", x:1, y:0.5 }, …, { id:"*", kind:"perimeter" }],
     textBox: { inset:[0.25,0.2,0.25,0.2], autoFit:"shrink" },
     style: { fill:"theme.surface", stroke:"theme.accent" }
   }
   ```
   Path templates reference `w`, `h` and params (evaluated with a tiny safe expression evaluator, not `eval`), enabling non-uniform scaling that keeps corners/arrowheads proportionate (like draw.io's `aspect`/`fixed` and Visio's ShapeSheet formulas).
2. **Geometry-function shapes (TS)** — `getPath(w,h,params) → Path2D string`, `getGeometry()`, `getPorts()`; for complex math (gears, callouts, stars, charts axes).
3. **React-component shapes** — `component: (props) => JSX` with their own state/logic; declare `getGeometry` (defaults to rect), `ports` (static or dynamic), `interactive` policy (which pointer events belong to the component vs the editor in edit mode), and an optional `toStaticHTML/toSVG` for export.

All three compile down to the same `ShapeUtil` interface internally.

### 4.3 Ports / anchors
- **Static ports**: normalized `(x,y)` in shape bounds + optional `direction` (N/E/S/W vector for routing), `kind` (in/out), `maxConnections`, `accepts` (typed).
- **Perimeter ("floating") anchor**: connection end stores only `targetId`; the endpoint is computed as the intersection of the line from the other end (or shape center) with the shape geometry (draw.io `perimeter=1`, JointJS `boundary` connection point, React Flow floating-edges example).
- **Fixed-on-perimeter anchor**: store normalized point + `isPrecise` (tldraw) so the end sticks where the user dropped it.
- **Dynamic ports**: computed by the ShapeUtil from props (e.g., a table shape exposing one port per row; a React component registering ports at runtime via a `usePort(id, ref)` hook that measures DOM elements → stored in a *derived* cache, not the document).

### 4.4 Text in shapes
- HTML text inside the shape div (CSS flex for vertical alignment); `textBox` insets from the shape definition (e.g., inner rectangle of a diamond).
- Auto-fit modes: `none | shrink-to-fit (font scale) | grow-shape (h auto) | clip`. Implement shrink via measure loop or CSS container query units (`cqw`) + binary search; cache measurements keyed on (text, font, width).
- Rich text: TipTap (ProseMirror, MIT) or Lexical (MIT) editor mounted only while editing; stored as a portable JSON doc; render via lightweight renderer in present mode — identical CSS in both to guarantee WYSIWYG.
- Fonts: themes define font tokens; load via `FontFace` API and await `document.fonts.ready` before measuring.

---

## 5. Connectors

### 5.1 Geometry types
| Type | Definition | Notes |
|---|---|---|
| Straight | 2 points | trivial |
| Polyline | points[] | user waypoints |
| Curved (bezier) | cubic segments; control points auto-derived from port direction (React Flow `getBezierPath`) or user-edited | `bezier-js` for length, nearest point, split, bbox |
| Smooth through waypoints | Catmull-Rom → Bezier conversion | "curved multi-point" |
| Arc (tldraw style) | single circular arc via bend value | nice for hand-feel |
| Orthogonal (elbow/Manhattan) | axis-aligned segments; optional corner radius | default for diagrams |
| Custom | plugin `ConnectorUtil.getPath(ctx)` | e.g., zig-zag, lightning, sankey ribbons |

### 5.2 Routing
- **Simple orthogonal (no avoidance)**: draw.io `orthogonalEdgeStyle`/`elbowEdgeStyle` & React Flow `smoothstep` heuristics — port direction → stub → midpoint elbow. Fast, deterministic; good default for slides.
- **Obstacle avoidance**:
  - **libavoid (Adaptagrams)** via **`libavoid-js`** (wasm, npm `0.5.0-beta`): high-quality orthogonal & polyline routing, *nudging* of parallel segments, incremental re-routing when shapes move. ~8–11× slower than native but fine for per-slide scenes; run in a Web Worker. **License: LGPL-2.1** — OK to use as a separately loaded, replaceable module; do not statically merge/modify without publishing changes. Proven with React Flow and JointJS demos.
  - **JointJS `manhattan` router** (MPL-2.0): grid-based A* with obstacle bbox padding; reference implementation.
  - **Own A* on a sparse orthogonal visibility graph** (as in `@tisoap/react-flow-smart-edge`, workflowbuilder.io write-up) — MIT-safe fallback, good for <200 obstacles.
  - **ELK (elkjs, EPL-2.0)** for *layout + routing* of whole graphs (AI "auto-arrange" command).
- Strategy: `Router` plugin interface `{ route(connector, obstacles, ctx) → Path }`, default = simple orthogonal; `avoid` router (libavoid worker) opt-in per connector or per screen; routed paths are **derived data** cached in memory, and *baked* into the document on export (static sites need no router at runtime).

### 5.3 Decorations
- **Arrowheads/markers**: define as small path generators (none, triangle, open, diamond, circle, bar, crow's-foot ERD, UML composition/aggregation…) scaled by stroke width; render as explicit `<path>` at endpoints (more controllable than SVG `<marker>`, and export-consistent). Shorten the line by marker inset.
- **Labels**: multiple labels at `t ∈ [0,1]` along the path + perpendicular offset; HTML elements positioned via `getPointAtLength`; optional background "mask" to break the line.
- **Rounded corners** on polylines: replace each corner with a quadratic/arc of radius `min(r, seg/2)`.
- **Line jumps / hops**: compute pairwise segment intersections (spatial index to prune), insert arc/gap on the later-z connector (draw.io `jumpStyle=arc|gap|sharp`, JointJS `jumpover` connector).
- Stroke styles: dash patterns, animated flow (`stroke-dashoffset` animation — great for presentations), gradients.

### 5.4 Glue / binding model
```ts
Connector { id, start: End, end: End, waypoints: Point[], routing: 'straight'|'curved'|'orthogonal'|'avoid'|custom, style, labels[] }
End = { kind:'free', point } | { kind:'bound', bindingId }
Binding { id, fromId: connectorId, toId: shapeId, terminal:'start'|'end',
          anchor: {type:'port', portId} | {type:'perimeter'} | {type:'fixed', nx, ny}, gap?: number }
```
- Bindings as separate records (tldraw) make reverse lookup ("which connectors attach to this shape?") an indexed computed, keep cascading deletes explicit, and allow non-connector bindings later (e.g., "label sticks to shape", layout constraints).
- On shape move/resize → computed connector geometry recalculates automatically (signals); no explicit "update connectors" code path.

---

## 6. Mobile / Responsive Presentation

### 6.1 How others do it
| Product | Model | Mobile behavior |
|---|---|---|
| **Gamma** | Scrollable *cards* (flow layout, not fixed canvas) | Content reflows per device; claims much higher mobile read-through vs fixed decks |
| **Pitch** | Fixed 16:9 slides | Scaled slides; mobile viewer with swipe; editing primarily desktop |
| **Canva** | Fixed-size designs | Scale-to-fit; "responsive" only for Canva Websites (limited reflow); separate mobile-format designs |
| **Prezi** | Infinite canvas with zoom path | Camera animations fit to viewport; pinch/zoom on mobile |
| **Google Slides / PowerPoint web** | Fixed slides | Scale-to-fit, pinch-zoom |
| **Tome** | Responsive pages | **Shut down April 30, 2025** (pivoted to CRM) — cautionary tale about consumer AI decks |
| **Framer / Webflow** | Per-breakpoint layout overrides | The model for "static info sites" |

### 6.2 Recommended Fluxion strategy (layered)
1. **Fit (default)**: letterbox-scale the fixed canvas (`min(vw/W, vh/H)`); portrait phones rotate hint or vertical stacking of screens.
2. **Breakpoint variants**: each screen can carry `layouts: { desktop: base, mobile?: overrides }` where overrides are per-element *patches* (position/size/visibility/font scale) on a portrait canvas (e.g., 390×844 logical). The AI generates the mobile variant; users can tweak it. (Framer/Webflow-style inheritance: unspecified props inherit from base.)
3. **Flow mode (info sites)**: elements optionally marked as *flow content* compile to a vertical HTML document (reading order = explicit order field), enabling real reflow for long-form static pages.
4. **Touch**: swipe (horizontal) between screens, tap zones, pinch-zoom + pan into diagrams (present mode camera, bounded), double-tap to zoom to element, `touch-action` CSS to prevent browser conflicts; `pointer events` unified model; minimal 44px targets for interactive components.
5. **Present-mode camera animations** (Prezi-like) are just camera transitions over the same scene — cheap with CSS transforms.

---

## 7. RECOMMENDATION for Fluxion

### 7.1 Build vs buy

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Build on tldraw SDK** | Fastest to a polished editor; best-in-class architecture; custom ShapeUtils are React | **Commercial license key per deployment/host**, quote-based pricing, watermark for hobby, domain-locked keys conflict with exporting static sites to customer domains; whiteboard-centric UX to fight (infinite canvas vs slide frames); vendor lock-in on core | **No** (unless business accepts license cost; revisit only for a quick PoC) |
| **Build on React Flow (MIT)** | Free, React-native nodes, big ecosystem | Graph-editor model; no rotation, weak grouping/align/text tooling; edges basic; would be heavily forked | **No as foundation**; OK for a node-graph *plugin* inside a screen |
| **Build on JointJS (MPL) / maxGraph (Apache)** | Rich connectors/routing | Non-React idioms, key editor features paid (JointJS+), maxGraph 0.x; React-component shapes second-class | **No**; mine for algorithms & draw.io import |
| **GoJS / Konva / Fabric / Pixi** | Mature graphics | Canvas/GPU → no React components/a11y/static HTML | **No** |
| **Own engine, DOM+SVG, React, signals** | Full control; WYSIWYG parity via same components; static-site export = SSR; AI-friendly schema; no license tax | More upfront work (6–10 engineer-months for a solid core) | **Yes** |

### 7.2 Proposed stack

| Concern | Choice | License |
|---|---|---|
| UI framework | React 19 + TypeScript | MIT |
| Reactive core | `alien-signals` (or `@preact/signals-core`) wrapped in own `Store` (records, diffs, marks, migrations) | MIT |
| Schema/validation | Zod v4 or Valibot (also generates JSON Schema for AI tool calls) | MIT |
| Ordering | `fractional-indexing` | CC0/MIT |
| Spatial index | `rbush` (edit), `flatbush` (present/export) | MIT / ISC |
| Geometry | own Geometry2d (port the *ideas* of tldraw's), `bezier-js` | MIT |
| Routing | built-in orthogonal + A* router; `libavoid-js` in a worker as optional plugin | own / **LGPL-2.1** (isolated) |
| Auto-layout | `elkjs` (EPL-2.0, isolated) / `@dagrejs/dagre` (MIT) | — |
| Rich text | TipTap/ProseMirror or Lexical | MIT |
| Icons | `@iconify/utils` + per-set `@iconify-json/*` with license filtering; Lucide default | MIT/ISC + per set |
| Stencils | own draw.io stencil XML → Fluxion shape converter; maxGraph as behavior reference | Apache-2.0 reference |
| Gestures | Pointer Events + `@use-gesture/react` for pinch/drag in present mode | MIT |
| Collaboration (later) | record-diff sync server, or Yjs/Loro adapter | MIT |
| Export | SSR (React `renderToString`/static) for sites; SVG via ShapeUtil `toSvg`; PDF via headless Chromium print | — |

### 7.3 Key architectural decisions
1. **One renderer, two modes**: the same React tree renders edit and present; edit mode only *adds* an overlay layer and routes pointer events to tools; present mode sets store read-only and gives components their own interactivity. This is how we get "nearly identical" WYSIWYG for free.
2. **Everything is a registered Util** (Shape, Connector, Binding, Router, Tool, Theme, Importer/Exporter, Layout) + **VS Code-style contribution manifest** for UI/commands. Built-ins use the same plugin API as third parties.
3. **Geometry-first hit-testing and routing**; DOM measurement only for React-component dynamic ports & text auto-fit (results stored as derived, not persisted, data — except baked output for export).
4. **Commands = AI tool surface**: every editor operation is a typed command with JSON-schema args, so AI generation/editing and human UI share one path (and undo).
5. **Namespaced, versioned schemas with migrations** per plugin; preserve unknown records.
6. **Performance budget**: target 60fps drag with 2k elements on a screen; techniques: per-record memoized components, CSS transform camera, culling via spatial index, connector re-route only for affected bindings, worker routing.
7. **Licensing hygiene**: no tldraw code copying (study only); MPL (JointJS) and LGPL (libavoid) kept as separate unmodified modules; track per-icon-set licenses & vendor icon terms (AWS: unmodified, AWS-only use).

### 7.4 Suggested spikes (2–3 weeks)
1. Store + signals + 3k DOM shapes drag benchmark (with/without culling).
2. Declarative parametric shape spec + 20 stencils converted from draw.io XML.
3. Connector: bound perimeter anchors, orthogonal router, libavoid worker PoC with nudging, line hops.
4. React-component shape with dynamic ports (`usePort`) + present/edit parity check.
5. Mobile: fit vs breakpoint-override prototype on 3 sample decks.

---

## 8. Sources

- tldraw license key docs — https://tldraw.dev/sdk-features/license-key
- tldraw pricing — https://tldraw.dev/pricing ; plans — https://tldraw.dev/get-a-license/plans
- tldraw LICENSE — https://github.com/tldraw/tldraw/blob/main/LICENSE.md ; community license page — https://tldraw.dev/community/license
- tldraw releases v4.0 / v4.3 / v4.4 — https://tldraw.dev/releases/v4.0.0 , https://tldraw.dev/releases/v4.4.0 , https://github.com/tldraw/tldraw/releases
- tldraw signals — https://tldraw.dev/sdk-features/signals ; signia — https://github.com/tldraw/signia
- HN discussion on tldraw license cost — https://news.ycombinator.com/item?id=45294916
- React Flow / xyflow license & Pro — https://xyflow.com/open-source , https://reactflow.dev/pro/pricing , https://github.com/xyflow/xyflow
- React Flow floating edges — https://reactflow.dev/examples/edges/floating-edges ; smart edge — https://www.npmjs.com/package/@tisoap/react-flow-smart-edge
- Edge routing deep-dive — https://www.workflowbuilder.io/blog/edge-routing-in-workflow-editors-technical-deep-dive
- JointJS licensing — https://www.jointjs.com/license ; open vs plus — https://www.jointjs.com/opensource ; pricing — https://www.componentsource.com/product/jointjs/prices
- JointJS libavoid demo — https://github.com/clientIO/joint/discussions/2627
- libavoid-js — https://www.npmjs.com/package/libavoid-js ; libavoid for Sprotty thesis — https://model-engineering.info/publications/theses/thesis-hnatiuk.pdf
- maxGraph — https://maxgraph.github.io/maxGraph/ , https://github.com/maxGraph/maxGraph/releases
- draw.io custom shapes / stencil XML — https://www.drawio.com/doc/faq/custom-shapes , https://www.drawio.com/docs/manual/shapes/shape-complex-create-edit/
- draw.io style reference — https://www.drawio.com/docs/reference/diagram-generation/style-reference/
- GoJS pricing — https://gojs.net/latest/pricing
- Excalidraw rendering pipeline — https://deepwiki.com/excalidraw/excalidraw/5.1-canvas-rendering-pipeline
- PixiJS v8 / DOMContainer / pixi-react v8 — https://pixijs.com/blog , https://pixijs.com/blog/pixi-react-v8-live
- Figma WebGPU — https://www.figma.com/blog/figma-rendering-powered-by-webgpu/ ; Figma on building pro tools on the web — https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/
- Penpot new render engine — https://penpot.app/blog/penpots-new-rendering-system/
- alien-signals — https://github.com/stackblitz/alien-signals
- IconifyJSON format — https://iconify.design/docs/types/iconify-json.html
- AWS Architecture Icons — https://aws.amazon.com/architecture/icons/
- Gamma vs Pitch — https://www.nextdocs.io/compare/gamma-vs-pitch , https://gamma.app/explore/content/guides/gamma-vs-powerpoint-card-based-format-presentations
- Tome shutdown — https://deckary.com/blog/tome-review , https://autoppt.com/blog/tome-app-pivot-away-from-presentations/
- Also relevant (not fetched this session, well-known): rbush https://github.com/mourner/rbush , flatbush https://github.com/mourner/flatbush , bezier-js https://github.com/Pomax/bezierjs , elkjs https://github.com/kieler/elkjs , fractional-indexing https://github.com/rocicorp/fractional-indexing
