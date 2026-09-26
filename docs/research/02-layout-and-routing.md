# 02 — Automatic Layout, Anchors & Connector Routing

> Research for **Fluxion**: a TypeScript/React browser editor for interactive presentations and diagrams. Shapes live on screens/slides and are linked by straight, bezier and orthogonal connectors.
> Status: research, September 2026. Version numbers and sizes were checked against npm, GitHub or the official docs where a source is cited. Sizes marked "~" are approximate and should be re-measured with the real bundler.

---

## 0. TL;DR

- **One layout library cannot do all of this.** The best result comes from a *pipeline*: **measure → place → remove overlaps → choose anchors → route → place labels → animate**. Each stage is a pluggable strategy.
- **ELK (elkjs)** is the most capable open-source placement engine. It offers layered, stress, force, mrtree, radial, rectpacking, disco, compound nodes, full port constraints, orthogonal edge routing and edge-label placement. It is large (~1.6 MB minified / ~500 KB gzip), so **load it lazily inside a Web Worker**. License: EPL-2.0.
- **@dagrejs/dagre** (v3.x, maintained again, MIT, small) is the fast, simple default for flowcharts. **d3-hierarchy / d3-flextree** cover trees, org charts and mind maps. **d3-force** (deterministic by default) plus **WebCola** (constraints, non-overlap) cover organic layouts and "pin some, arrange the rest".
- **Connector routing belongs in its own stage.** Use a **custom sparse-grid A\* orthogonal router** (the Excalidraw/tldraw approach) for interactive editing. Add **libavoid-js (WASM, LGPL-2.1)** as an optional "high quality" router that handles nudging of parallel segments and incremental rerouting. When ELK layered already produced routes, reuse them.
- **Anchors:** model ports as `side + fraction` (plus optional fixed ports). After placement, a **cost-based anchor selector** re-picks dynamic anchors to minimise length, bends and crossings. Floating (perimeter-projection) anchors are for straight and bezier edges.
- **Non-graph "SmartArt-style" templates** (grid, stack, timeline, cycle, pyramid, swimlane, matrix, org chart, mind map) should be first-class named layouts. AI can pick them by name, and they are cheap, deterministic, pure TS.
- **Determinism:** seeded PRNG everywhere, stable ordering of nodes and edges (sort by id / model order), fixed iteration counts, no `Math.random`, no time-based cut-offs in AI mode.
- **Animation:** FLIP-style tween of node boxes. Connectors are re-routed at the end state and morphed with point-resampling (or re-routed per frame for cheap routers).
- **Text measurement:** **Pretext** (chenglou/pretext, ~15 KB, canvas-based, DOM-free after `prepare`) or a canvas `measureText` + line-breaker, so nodes are sized *before* layout, including inside workers (OffscreenCanvas).

---

## 1. Graph layout libraries (JS/TS)

### 1.1 ELK / elkjs (Eclipse Layout Kernel)

- **What:** A Java layout kernel from Kiel University / Eclipse, transpiled to JS with GWT. elkjs **0.12.0** is current (published ~Aug 2026). ELK core 0.11 came with a 2025 series of blog posts that explain the Layered phases.
- **Algorithms in elkjs:** `layered` (Sugiyama), `stress`, `mrtree`, `radial`, `force`, `disco` (disconnected component packing), plus `box`, `fixed` and `random`. `rectpacking`, `sporeOverlap`/`sporeCompaction` and `topdownpacking` are also in the ELK distribution. Check `elk.knownLayoutAlgorithms()` at runtime for the exact list in a given build.
- **Layered phases** (each one configurable): cycle breaking → layer assignment → crossing minimisation → node placement → edge routing. The ELK 2025 "Layered overview" post is the map of which option belongs to which phase.
- **Ports:** first-class. `elk.portConstraints` = `UNDEFINED | FREE | FIXED_SIDE | FIXED_ORDER | FIXED_RATIO | FIXED_POS`, with `elk.port.side` (`NORTH/EAST/SOUTH/WEST`) and `elk.port.index` per port. React Flow's "elkjs multiple handles" example uses `FIXED_ORDER` to keep handle order. `allowNonFlowPortsToSwitchSides` lets ELK move ports to reduce crossings.
- **Compound / hierarchical graphs:** nested `children`. Set `elk.hierarchyHandling: INCLUDE_CHILDREN` to lay out across levels, so edges can cross hierarchy boundaries.
- **Edge routing (layered):** `ORTHOGONAL | POLYLINE | SPLINES`. Orthogonal output comes as `sections[].bendPoints`, and layered separates parallel segments. The `elk.alg.libavoid` algorithm exists in ELK, but it runs libavoid as an **external process** (Java/C++), so it is **not usable in elkjs in the browser**. For browser use, pair elkjs with libavoid-js (see `@mr_mint/elkjs-libavoid`).
- **Labels:** `elk.edgeLabels.placement` (`HEAD/CENTER/TAIL`), `edgeLabels.inline`, `layered.edgeLabels.centerLabelPlacementStrategy`, `spacing.edgeLabel`. Labels are given sizes and ELK reserves space for them.
- **Stability / pinning:**
  - Model-order options preserve the user's ordering: `considerModelOrder.strategy`, `cycleBreaking.strategy: MODEL_ORDER/GREEDY_MODEL_ORDER`, `forceNodeModelOrder`, `crossingMinimization.semiInteractive`.
  - "Interactive" strategies derive the layering and ordering from current coordinates: `layering.strategy: INTERACTIVE`, `cycleBreaking.strategy: INTERACTIVE`, `interactiveLayout: true`.
  - Per-node `layerConstraint`, `layerChoiceConstraint` and `positionChoiceConstraint`, plus partitioning (`partitioning.activate`, `partitioning.partition`).
  - Stress supports `stress.fixed` nodes. `fixed` keeps given positions.
  - Layered has **no true "pinned node" option**. Pinning with layered = move the result, or fall back to stress/force with fixed nodes.
- **Rectpacking:** packs boxes into a target aspect ratio or `widthApproximation.targetWidth`. `inNewRow` forces row breaks. This is ideal for "tidy these loose shapes on a slide" and for portrait re-layout.
- **Worker:** `new ELK({ workerUrl })` or `workerFactory`. `elk-api.js` is a thin proxy, and `elk-worker.min.js` does the work. The bundled build runs on the main thread (a fake worker). All calls are async (`elk.layout(graph) → Promise`).
- **Size:** `elk.bundled.js` ≈ **1.6 MB minified / ~500 KB gzip**. It is not tree-shakable, because the GWT output is monolithic.
- **Determinism:** Layered is deterministic for identical input order. Force/stress take `elk.randomSeed`.
- **License:** EPL-2.0. Weak copyleft at file level, so linking from proprietary code is fine.
- **Cons:** big bundle. The option space is huge and poorly discoverable (the React Flow team calls it hard to support). JSON in/out is verbose. GWT stack traces are hard to debug.

### 1.2 dagre / @dagrejs/dagre

- **Status:** the original `dagre` package is unmaintained. `@dagrejs/dagre` is the maintained fork: **v3.x (3.1.0, Mar 2026)**, ships its own TS types, and its graphlib fork has zero dependencies. MIT.
- **Features:** Sugiyama layered layout; `rankdir` TB/BT/LR/RL; `nodesep/ranksep/edgesep`; `ranker` (network-simplex, tight-tree, longest-path); compound nodes via `setParent` (clusters); edge label dimensions with `labelpos`. Output is node centres plus edge polyline `points`.
- **Missing:** no ports or port constraints (edges attach to centres), no orthogonal routing (points are a polyline you smooth yourself), no incremental or pinned mode.
- **Size:** ~30 KB min+gzip for dagre + graphlib together. Fast: synchronous and fine on the main thread for < ~500 nodes.
- **Use:** default "flowchart" layout when ports don't matter; quick previews while ELK loads.

### 1.3 d3-force

- Velocity-Verlet simulation with pluggable forces: link, many-body (Barnes–Hut), collide (circle), x/y, radial, centre.
- **Deterministic by default:** d3-force v3 uses a fixed-seed LCG for initial phyllotaxis placement and jiggle. `simulation.randomSource(fn)` swaps in your own seeded PRNG.
- **Pinning:** set `node.fx/fy` to fix a node. This is the canonical "pin some nodes, arrange the rest" primitive.
- `forceCollide` only knows circles. For rectangles, use a custom rect-collide force or a VPSC pass afterwards (§4).
- Headless: `simulation.stop(); for (i…) simulation.tick()`. Runs anywhere, workers included. ISC license, ~7 KB gzip.

### 1.4 d3-hierarchy (+ d3-flextree, entitree-flex)

- `tree` (Reingold–Tilford tidy tree), `cluster` (dendrogram), `pack` (circle packing), `treemap` (squarify, binary, slice/dice), `partition` (sunburst/icicle), `stratify` (table → tree).
- `d3.tree` assumes uniform node size (`nodeSize`). **d3-flextree** handles variable node sizes (needed for org charts with text). **entitree-flex** adds sibling/partner nodes (family trees) and variable sizes. The React Flow docs recommend both.
- Tiny, deterministic, sync. ISC (d3). d3-flextree is WTFPL-style; check before use.
- Use for org chart, mind map (two-sided tree = two `tree` runs mirrored), hierarchy/decomposition diagrams and treemap slides.

### 1.5 WebCola (cola.js)

- A JS rewrite of **libcola** (Tim Dwyer, Monash). It does stress-majorisation / gradient-projection layout with **hard separation constraints** solved by **VPSC**.
- **Features:**
  - `avoidOverlaps` (rectangular non-overlap, true box sizes)
  - `constraints`: `separation` (`left/right/gap`, `equality`), `alignment` (axis x/y with offsets)
  - `groups` (compound, with padding, non-overlapping groups)
  - `flowLayout('y', gap)` (directed downward flow)
  - `symmetricDiffLinkLengths` / `jaccardLinkLengths`
  - `handleDisconnected`, `fixed` nodes
  - **grid-snap routing** via `cola.GridRouter` (orthogonal edge routing on a grid with nudging)
  - standalone `cola.removeOverlaps(rects)` (VPSC)
- **Status:** mature but slow-moving (the last significant releases are years old). MIT. ~40 KB gzip. There are community WASM forks. Cytoscape's `cytoscape-cola` wraps it.
- **Why it matters for Fluxion:** it expresses "align these, keep A left of B, don't overlap, keep pinned ones fixed" natively. That is exactly the tidy-up-a-hand-drawn-diagram use case.

### 1.6 Cytoscape.js layouts

- Core: `grid`, `circle`, `concentric`, `breadthfirst`, `cose`, `random`, `preset`.
- Extensions:
  - **fcose** (fast compound spring embedder, Bilkent iVis). It supports compound nodes and a spectral init + CoSE refinement, and it has **constraints**: `fixedNodeConstraint`, `alignmentConstraint` (vertical/horizontal groups) and `relativePlacementConstraint` (`{top,bottom,gap}` / `{left,right,gap}`). Incremental mode (`randomize:false`) preserves the mental map.
  - **cola** (the WebCola wrapper), **cise** (circular clusters), **dagre**, **elk**, **klay** (legacy), **avsdf**, **euler**, **spread**.
- **Coupling:** layouts need a cytoscape core instance. You can run it headless (`cytoscape({ headless:true })`), but the core adds ~110 KB gzip. MIT.
- **Takeaway:** fcose's constraint model is a good API reference. Using it means pulling in cytoscape headless inside a worker, which is acceptable as an optional plugin.

### 1.7 graphology layouts

- `graphology-layout` (circular, random, circlepack, rotation), `graphology-layout-forceatlas2` (Barnes–Hut, **worker supervisor** built in), `graphology-layout-force`, `graphology-layout-noverlap` (anti-collision, has a worker), `graphology-layout-forceatlas2` inference of settings.
- Aimed at *large* network visualisation (Sigma.js), not diagram aesthetics: it has no ports and no orthogonal routing. MIT.
- Fluxion use is limited to "network map" slides with 500–50k nodes.

### 1.8 MSAGL-JS (@msagl/core)

- A Microsoft TypeScript port of MSAGL (.NET). `@msagl/core` **1.1.24** (mid-2026). MIT. Modules: core, drawing, parser (DOT/JSON), renderer-svg, renderer-webgl.
- Layouts: Sugiyama (TB/LR/BT/RL), **IPSepCola** (constraint stress, non-overlap), **MDS**. Undirected graphs default to IPSepCola, directed ones to Sugiyama.
- **Edge routing:** its strongest part. **Spline routing around obstacles** (visibility graph + spline smoothing, "sleeve" routing), **rectilinear routing** (orthogonal around obstacles, with nudging), bundling.
- Native TypeScript, so it is easier to debug than GWT output. The docs and community are smaller than ELK's. JointJS+ ships an MSAGL layout integration.
- Worth evaluating as an **alternative router** (rectilinear + spline) that is pure TS and MIT-licensed, unlike LGPL libavoid.

### 1.9 Commercial references: yFiles for HTML, GoJS, JointJS+

- **yFiles for HTML (3.x):**
  - The industry reference. Hierarchical, organic, orthogonal, tree, circular, radial, series-parallel, compact disk, tabular, partial layouts.
  - **Incremental hints**: HierarchicalLayout `incrementalHints` and OrganicLayout `scope` (`AFFECTED`, `FIXED`, `INCLUDE_CLOSE_NODES`…).
  - Port candidates with costs, label placement (generic labeling), EdgeRouter (orthogonal/octilinear/curved, with bus routing), LayoutMorpher animations.
  - Expensive per-developer licenses. **Use it as the design benchmark**: its concepts (PortCandidate with cost, LayoutData, scope, LayoutExecutor with animation) map directly onto the recommendation below.
- **GoJS (Northwoods):**
  - `Layout` base class with `doLayout(coll)` overridable. `LayeredDigraphLayout`, `TreeLayout` (very rich: alignments, compaction, alternate layouts per level), `ForceDirectedLayout`, `CircularLayout`, `GridLayout`, extension `PackedLayout`, `ArrangingLayout`, `TableLayout`, `SwimLaneLayout`.
  - `Link.routing = AvoidsNodes` is a grid-based orthogonal router. `isOngoing`, `isInitial` and `isValidLayout` flags control when layout reruns (a good model for "auto layout on change vs. manual").
  - Commercial license (free with watermark for evaluation).
- **JointJS / JointJS+:**
  - The open-source core (MPL-2.0) has routers `normal`, `orthogonal`, `rightAngle`, `manhattan` (smart orthogonal A\* on a grid, obstacle avoidance, `startDirections/endDirections`, `padding`, `maximumLoops`) and `metro` (octilinear).
  - Connectors: `straight`, `rounded`, `smooth`, `jumpover` (line hops!), `curve`.
  - Anchors: `center`, `modelCenter`, `perpendicular`, `midSide`, `bottom/top/…`. ConnectionPoints: `boundary`, `bbox`, `rectangle`, `anchor`.
  - JointJS+ adds DirectedGraph (dagre), MSAGL and TreeLayout, plus a libavoid demo in a Web Worker. **The separation of anchor / connectionPoint / router / connector is the best open model to copy.**

### 1.10 Comparison table

| Library | Algorithms | Ports | Compound | Incremental / pinned | Edge routing | Size (min+gz) | Perf | Types | License |
|---|---|---|---|---|---|---|---|---|---|
| **elkjs 0.12** | layered, stress, force, mrtree, radial, rectpacking, disco | ★★★ full constraints | ★★★ | model-order, interactive strategies, stress fixed | orthogonal/poly/spline (layered) + labels | ~500 KB | good; worker | bundled .d.ts | EPL-2.0 |
| **@dagrejs/dagre 3** | layered | ✗ | clusters | ✗ | polyline points | ~30 KB | very fast | yes | MIT |
| **d3-force** | force sim | ✗ | ✗ | `fx/fy` pin, warm start | ✗ | ~7 KB | fast | @types | ISC |
| **d3-hierarchy / flextree** | tree, cluster, pack, treemap, partition | ✗ | n/a | ✗ (deterministic) | ✗ | ~10 KB | very fast | @types | ISC / WTFPL |
| **WebCola** | constrained stress, flow | ✗ | groups | fixed + constraints | GridRouter (ortho) | ~40 KB | medium | yes (TS src) | MIT |
| **cytoscape fcose/cola/cise** | spring, constrained, circular clusters | ✗ | ★★ | fixed/align/relative constraints | ✗ (bezier/taxi styles in renderer) | core ~110 KB + ext | good | yes | MIT |
| **graphology FA2/noverlap** | force atlas, noverlap | ✗ | ✗ | via fixed attr | ✗ | small | large graphs; worker | yes | MIT |
| **@msagl/core** | Sugiyama, IPSepCola, MDS | limited | ★★ | ✗ | ★★★ spline & rectilinear obstacle routing, bundling | ~200 KB | good | native TS | MIT |
| **yFiles** | everything | ★★★ candidates | ★★★ | ★★★ | ★★★ | large | excellent | native | commercial |
| **GoJS** | layered, tree, force, circular, grid, packed | ★★ | ★★ | layout flags | AvoidsNodes | ~300 KB | good | yes | commercial |

---

## 2. Edge (connector) routing

### 2.1 Approaches

| Technique | Idea | Quality | Cost | Examples |
|---|---|---|---|---|
| Direct / heuristic "elbow" | Pick exit/entry directions and compose 1–3 bends from a lookup of relative positions | OK for 2 shapes, ignores obstacles | O(1) | JointJS `rightAngle`, draw.io `orthogonalEdgeStyle`, tldraw elbow (plus heuristics) |
| **Sparse orthogonal grid + A\*** | Build grid lines only at obstacle edges ± margin, port stubs and midpoints. A\* with cost = length + bend penalty (+ crossing penalty) | Good. Human-like with tuned heuristics | O(g log g) per edge | **Excalidraw elbow arrows** (non-uniform grid, Manhattan + bends), JointJS `manhattan` (uniform grid) |
| Orthogonal visibility graph (OVG) | Wybrow–Marriott–Stuckey: the OVG is built from interesting points; shortest path with bend penalty; then **nudging** separates shared segments | Excellent. Near-optimal and stable | Heavier, incremental | **libavoid**, MSAGL rectilinear |
| Polyline visibility graph + spline | Tangent visibility graph around obstacles → shortest path → fit splines inside "channels"/sleeves | Excellent curves | Heavier | Graphviz `splines=true` (Dobkin et al.), MSAGL spline routing |
| Layout-integrated routing | The router knows the layering and routes in the gaps between layers | Excellent for layered graphs | Free with layout | ELK layered ORTHOGONAL/SPLINES, dagre points |
| Grid routing with nudging | Route on a coarse grid of node centres, then order and separate parallel segments | Tidy "metro" look | Medium | WebCola GridRouter |

### 2.2 libavoid & ports

- **libavoid** (Adaptagrams, Wybrow; C++). Object-avoiding **orthogonal and polyline** routing for interactive editors, used in Inkscape and Dunnart. It supports:
  - incremental rerouting (only affected connectors are recomputed when a shape moves)
  - **connection pins** (`ShapeConnectionPin` with class ids, so a connector can pick "any pin of class X", the best one being chosen by cost)
  - `ConnDirFlags` (allowed exit directions)
  - checkpoints (forced waypoints)
  - clusters
  - orthogonal **hyperedge** routing
  - routing penalties: segment, angle, crossing, cluster crossing, shared path, port direction, reverse direction
  - **nudging** options: `nudgeOrthogonalSegmentsConnectedToShapes`, `nudgeSharedPathsWithCommonEndPoint`, `performUnifyingNudgingPreprocessingStep`, `idealNudgingDistance`
- **libavoid-js** (Aksem): an Emscripten WASM port. npm `libavoid-js` 0.5.0-beta.x. **LGPL-2.1**, which means shipping it as a separately loaded WASM module is compatible with proprietary apps if it stays replaceable. Loading is async only. Used by `sprotty-routing-libavoid`, a React Flow router example and `@mr_mint/elkjs-libavoid`. JointJS published a "standalone link routing with libavoid" demo that runs it in a Web Worker.
- **Rust ports** (e.g. `libavoid-rust`) are emerging but young.
- **Recommendation:** make it an optional plugin router, "avoid-hq", in a worker.

### 2.3 Practical routing concerns

- **Nudging parallel segments:** after routing, collect collinear overlapping segments per channel, order them to avoid crossings (compare where each edge goes next), then spread them by `nudgeDistance` within the free channel width. libavoid, MSAGL, WebCola GridRouter and ELK layered all do this. A custom A\* router needs its own nudging pass.
- **Line jumps / hops:** do these at render time, not routing time. For each pair of crossing segments, the later edge (by z-order) draws a semicircle or gap at the intersection (JointJS `jumpover` connector, draw.io "line jumps", Visio). Needs an O(n²) or sweep-line segment-intersection pass. Cache per frame.
- **Rounded corners:** render-time too. Replace each bend with an arc or quadratic curve of radius `min(r, seg/2)`.
- **Bezier connectors:** control points come from the anchor normals. `c1 = p0 + n0 * k`, `c2 = p1 + n1 * k`, with `k ≈ clamp(dist/2, 20, 150)`. Obstacle avoidance for curves is usually solved by routing a polyline (visibility graph) and then fitting a Catmull-Rom or cubic spline through it (MSAGL/Graphviz style).
- **Edge bundling:** force-directed edge bundling (Holten & van Wijk) and hierarchical edge bundling (d3 `curveBundle`). Rarely wanted in slide diagrams; worth offering only for dense network slides.
- **Edge labels:**
  - Default is the midpoint of the path by *arc length*, not the middle bend.
  - For orthogonal edges, prefer the longest segment.
  - Labels are obstacles for other edges ("label as a node" trick: ELK reserves space, yFiles treats labels as dummy nodes).
  - After routing, run a small greedy search per label: candidate positions along the path (t = 0.5, 0.33, 0.66, …, above/below/inline), scored by overlap with nodes, labels and edges. yFiles' generic labeling is the benchmark.
- **Self-loops and multi-edges:** multi-edges get parallel offsets (orthogonal) or spread curvature (bezier). Self-loops leave and enter on the same side through two distinct anchor fractions.

---

## 3. Port / anchor models

### 3.1 Taxonomy

| Model | Definition | Behaviour on layout | Used by |
|---|---|---|---|
| **Fixed port by side + fraction** | `{ side: 'N'\|'E'\|'S'\|'W', t: 0..1 }` relative to the shape bbox (or outline) | Moves with the shape. Never changes side | ELK FIXED_POS / FIXED_RATIO, draw.io `constraints`, React Flow handles |
| **Named port** | Shape-type defines ports (`in1`, `out`, `top`) with position + allowed directions + capacity | Fixed geometry, semantic identity | BPMN/UML tools, GoJS `portId`, ELK ports |
| **Side-constrained dynamic** | The user fixes the side; the fraction is chosen by the layout (spread, ordered) | ELK FIXED_SIDE / FIXED_ORDER | ELK, yFiles PortConstraint |
| **Candidate set** | A list of allowed ports, each with a cost; the router picks the best | Re-chosen each route | yFiles PortCandidate, libavoid pin classes |
| **Floating / perimeter projection** | The anchor is where the line between the centres (or towards the other end's anchor) meets the outline | Continuously changes | JointJS `boundary` connectionPoint, tldraw "precise=false" binding, Excalidraw arrows |
| **Fixed point on shape** | Normalised `(u, v)` inside the bbox, projected to the outline if needed | Stable relative spot | tldraw `normalizedAnchor` with `isPrecise`, draw.io exact constraint |

### 3.2 ELK port constraints (for the ELK-backed layouts)

- `FREE`: ELK chooses side and position.
- `FIXED_SIDE`: side given, order and position free.
- `FIXED_ORDER`: side and order given (`elk.port.index`).
- `FIXED_RATIO`: relative position kept when the node is resized.
- `FIXED_POS`: exact position.

`allowNonFlowPortsToSwitchSides` lets NORTH/SOUTH ports move to reduce crossings. **Mapping:** Fluxion `fixed` port → FIXED_POS; `side`-locked dynamic anchor → FIXED_SIDE; `auto` → FREE (then read ELK's choice back).

### 3.3 Automatic anchor (re)selection after layout

A proven strategy, combined from yFiles port candidates, libavoid pins, draw.io and tldraw:

1. **Candidate generation** per connector end:
   - Fixed → 1 candidate.
   - Side-locked → k fractions on that side (for example 0.5 first, then an evenly spread set).
   - Auto → the midpoints of the 4 sides (plus corners for diamonds/ellipses via outline sampling), plus the "floating" projection towards the other end.
2. **Score** each (sourceCandidate, targetCandidate) pair with a cheap estimate:
   `cost = w_len·manhattanOrEuclid + w_bend·estimatedBends(dirs) + w_back·(exit direction points away from target) + w_side·(side already crowded) + w_stab·(differs from previous anchor)`.
   The estimated bends come from a lookup of the exit/entry directions and the relative quadrant, the same table the "rightAngle" heuristic uses.
3. **Pick the minimum.** For edges that share a node side, **distribute**: sort the edges on that side by the angle/coordinate of their far end and assign evenly spaced fractions in that order. That removes local crossings, which is what ELK's port ordering does.
4. **Optionally refine** with the real router for the top-N pairs when the estimate is ambiguous.
5. **Hysteresis:** keep the previous anchor unless the new one is better by more than X%. This prevents jitter while dragging and during animations (the mental map idea).

For layered layouts (direction LR), the natural default is outgoing edges on E and incoming on W. Let ELK assign and then persist its choice as the dynamic anchor state.

---

## 4. Overlap removal & constraint solving

- **VPSC** (Variable Placement with Separation Constraints; Dwyer, Marriott, Stuckey 2005):
  - Solves a quadratic program: minimise displacement from the desired positions, subject to `x_j − x_i ≥ gap` constraints.
  - Overlap removal = generate separation constraints for overlapping pairs (a sweep-line decides x or y), then solve x and y passes.
  - Fast (O(n log n) constraint generation), minimal movement, so it **preserves the mental map**. It is in WebCola (`cola.removeOverlaps`, `cola.vpsc`) and libcola.
  - **Primary Fluxion overlap-removal pass.**
- **PRISM** (Gansner & Hu, 2008): proximity-stress model on a Delaunay-triangulation proximity graph; iteratively grows overlapping edges and preserves relative positions. Graphviz uses it (`overlap=prism`). Better shape preservation for large scattered layouts. Can be implemented or ported if needed; VPSC is enough for slide-scale diagrams.
- **Simpler options:**
  - "Force scan" / ODNLS (push apart along the centre line).
  - graphology `noverlap`.
  - Grid snapping (round to the grid, then resolve collisions by BFS to the nearest free cell). Good for "tidy" grids and very deterministic.
- **Cassowary (kiwi.js → @lume/kiwi):**
  - Incremental linear-arithmetic constraint solver with **strengths** (required/strong/medium/weak) and edit variables. Kiwi is ~2.3× faster than cassowary.js. `kiwi.js` is unmaintained; **`@lume/kiwi`** is the maintained fork (TS; BSD-3).
  - Perfect for **alignment / distribution / "keep equal gaps" / "stick to slide margin" / responsive rules**. For example: `left(A) == left(B)` (strong), `B.y - A.bottom == gap` (medium), `x >= margin` (required). Apple Auto Layout is built on Cassowary.
  - Not for non-overlap, which is disjunctive. Combine with VPSC or pre-decided ordering.
- **Incremental / stable layout, mental map:**
  - Techniques: warm-start from current positions (force/stress), fix unchanged nodes, penalise displacement (stress with anchoring term), model-order preservation (ELK), yFiles-style scope/incremental hints, and "foresighted" layout for sequences.
  - Empirical work (Archambault & Purchase) shows that stability helps in tasks that need node tracking, which fits presentation step animations.
- **Pinned nodes:**
  - Force/stress: `fx/fy`, `fixed`, `stress.fixed`, fcose `fixedNodeConstraint`.
  - Layered: run the layout, compute the translation that best aligns the pinned nodes (least squares), and if residuals remain, run VPSC with pinned nodes as immovable (infinite weight).
  - Constraint layouts (WebCola): `fixed:true`.

---

## 5. Non-graph layouts for slides ("SmartArt-style" templates)

PowerPoint SmartArt organises its templates into List, Process, Cycle, Hierarchy, Relationship, Matrix, Pyramid and Picture. Each template is **a named layout algorithm + parameters + a shape style**, driven by a text outline. This is exactly the abstraction AI needs: *"use `process.chevron` with these 5 items"*.

| Template family | Algorithm | Backing |
|---|---|---|
| Grid / matrix (2×2, n×m) | Row/column packing with equal cells, gap, alignment | pure TS; or Yoga |
| Stack / list (vertical, horizontal, wrap) | Flexbox semantics | **Yoga** (`yoga-layout` 3.2, WASM, sync-looking API via top-level await) or **Flexily** (pure-JS Yoga-compatible, smaller/faster) or a tiny custom flex |
| Process / timeline / chevron | 1-D distribution along a line/arc, milestone labels alternate above/below | pure TS |
| Cycle / radial / hub-and-spoke | Items on a circle (angles evenly or weighted), hub at centre; edges as arcs | pure TS; ELK `radial` for trees |
| Hierarchy / org chart | Tidy tree with variable node sizes, compact leaf rows ("vertical leaves") | d3-flextree / entitree-flex; ELK `mrtree` |
| Mind map | Two-sided tree (split children left/right by balanced subtree size), curved bezier edges | d3-flextree ×2 mirrored |
| Swimlanes / pools | Lane bands (rows) × phases (columns), then layered layout within lanes via ELK partitioning or layered + lane constraints | ELK layered with `partitioning` + post-pass; or custom |
| Table / tabular | Cell grid with spanning | pure TS |
| Pyramid / funnel / venn | Parametric geometry | pure TS |
| Packing / "tidy loose shapes" | Rectangle packing to aspect ratio | ELK `rectpacking` or custom shelf/skyline packer (potpack-style) |
| Treemap / circle pack | Squarify / pack | d3-hierarchy |

**Mobile portrait re-layout:** re-run the *same* named layout with a portrait target aspect. Layered: LR → TB. Grid: fewer columns. Rectpacking: `targetWidth` = the viewport width. Timeline: horizontal → vertical. Radial: shrink the radius / switch to a list. The template registry should declare how each algorithm adapts to an aspect ratio (`adapt(aspect) → options`).

---

## 6. Animation, workers, determinism

### 6.1 Animating layout transitions

- **FLIP** (First, Last, Invert, Play): record the old boxes, apply the new layout, compute deltas, animate from inverted to identity. On a canvas/SVG scene graph, this is just **interpolating the model boxes** (x, y, w, h, rotation) with an easing curve (spring or cubic). The React side should drive it from a single `requestAnimationFrame` loop, not per-component transitions.
- **Connectors during the tween:**
  1. *Re-route every frame* with the cheap router (heuristic elbow / floating straight). Looks alive, but orthogonal routes can "pop" topology mid-animation.
  2. *Morph between the start and end routes:* resample both polylines to the same number of points by arc length, then lerp. For orthogonal paths, morph **bend by bend**: pad the path with fewer bends using duplicate zero-length segments so the counts match, then lerp corresponding vertices. This keeps segments axis-aligned for most of the tween (d3-interpolate-path does the pad-and-lerp for SVG paths; flubber is for closed shapes and is overkill).
  3. *Hybrid (recommended):* morph from start to end route, with endpoints attached to the animated anchor positions, and re-snap to the final route at t=1.
- **Staggering and ordering:** move pinned or unchanged nodes 0 px, fade new nodes in, fade removed nodes out, and optionally stagger by layer. yFiles `LayoutMorpher` and GoJS `AnimationManager` are references.
- Respect `prefers-reduced-motion` (jump-cut or crossfade).

### 6.2 Web Workers

- Run ELK, libavoid-WASM, WebCola/fcose, force and large routing jobs in a **dedicated layout worker** (module worker). Talk to it through a typed RPC (Comlink-style or a small hand-rolled message protocol).
- **Protocol:**
  - Send plain JSON snapshots (node boxes, ports, edges, constraints), not live model objects.
  - Include a `requestId` and a `revision`. The main thread discards stale results (last-write-wins).
  - Support cancellation: `AbortSignal` → `{type:'cancel', id}`. For long force runs, stream intermediate positions for a live preview.
- **Lazy loading:** ELK (~500 KB gz) and libavoid.wasm load only when an algorithm needs them. dagre, hierarchy and templates stay in the main bundle and run synchronously for instant feedback.
- **OffscreenCanvas** in the worker allows text measurement there too (Chrome/Firefox/Safari 17+ support OffscreenCanvas 2D). Font loading must be mirrored in the worker (`FontFace` + `self.fonts.add`).
- In SSR/Node (for AI server-side generation) the same engine should run via `worker_threads` / the `web-worker` package (elkjs supports it) or synchronously.

### 6.3 Determinism for AI "make it neat"

- **Seeded PRNG** (mulberry32 / sfc32 / xoshiro128\*\*) passed into every algorithm: `d3.forceSimulation().randomSource(rng)`, `elk.randomSeed`, fcose `randomize:false` + a deterministic initial placement, WebCola initial positions from a seeded RNG.
- **Canonical input order:** sort nodes and edges by stable id (or by explicit model order), because Sugiyama crossing minimisation and ELK depend on input order.
- **Fixed iteration counts** instead of wall-clock budgets. Avoid `performance.now()`-based early exits in deterministic mode.
- **Quantise output** (round to 0.5 px or snap to a grid) so float noise across engines and browsers doesn't produce diffs. Use the same text-measurement fonts (see §7), since node sizes feed the layout.
- **Layout fingerprint:** hash(algorithm id + version + options + canonical graph + measured sizes) → cached result. Makes "make it neat" idempotent and cacheable.

---

## 7. Text measurement for sizing nodes before layout

| Method | Accuracy | Speed | Worker-safe | Notes |
|---|---|---|---|---|
| DOM measurement (hidden div, `getBoundingClientRect`, `Range.getClientRects`) | Exact vs. the final DOM render | Slow (reflow), main thread only | ✗ | Ground truth for HTML-rendered text. Batch reads to avoid layout thrash |
| Canvas `measureText` (2D / OffscreenCanvas) | Advance widths exact for the same font. You do line breaking yourself | Fast | ✓ (OffscreenCanvas) | `actualBoundingBoxAscent/Descent`, `fontBoundingBox*` for line metrics. Kerning and ligatures are included at the string level |
| **Pretext** (chenglou/pretext) | Close to browser line breaking, multilingual (Intl.Segmenter), bidi | `prepare()` measures segments once with canvas; `layout(width)` is pure arithmetic (~µs) | ✓ | ~15 KB, zero deps, MIT. `layoutNextLine()` for flowing around shapes. **Ideal for "what height is this node at width W?" inside layout loops** |
| fontkit / opentype.js / harfbuzzjs | Exact shaping from font files (GSUB/GPOS) | Medium; needs font binaries | ✓ | Required for server-side / Node determinism and for exporting (PPTX/PDF). harfbuzzjs (WASM) is the most accurate shaper |

**Recommendation:** a `TextMeasurer` interface with a **Pretext-backed** browser implementation (main thread + worker), and a harfbuzz/fontkit implementation for Node/AI server generation. Layout calls `measure(text, style, maxWidth) → {width, height, lines}` to compute node sizes (with padding and min/max size policies) **before** placement. Cache by `(text, fontKey, maxWidth)`.

---

## 8. RECOMMENDATION — Fluxion layout engine architecture

### 8.1 Pipeline

```
 Scene snapshot (nodes, ports, edges, groups, pins, constraints)
   │
   ▼
 [1] Measure         TextMeasurer → node intrinsic sizes (auto-size policy)
   ▼
 [2] Place           LayoutAlgorithm (pluggable: dagre | elk.* | tree | force | cola | template.*)
   ▼
 [3] Constrain       Pins reconciliation → Cassowary (align/distribute/margins) → VPSC overlap removal → grid snap
   ▼
 [4] Anchor          AnchorSelector (fixed / side / auto / floating; cost-based; hysteresis)
   ▼
 [5] Route           Router per connector kind (straight | bezier | orthogonal-astar | avoid-hq | from-layout)
   ▼                 → Nudger (separate parallel segments) → Label placer
 [6] Diff & animate  LayoutResult vs. current → Transition (FLIP boxes, route morph)
   ▼
 Commit to document (single undoable transaction)
```

Each stage is a **pure function of a serialisable snapshot**, so any stage can run in the worker, be cached, be unit-tested with golden files, and be replayed deterministically.

### 8.2 Core types (TypeScript sketch)

```ts
// ---------- geometry ----------
export interface Point { x: number; y: number }
export interface Rect  { x: number; y: number; width: number; height: number }
export type Side = 'top' | 'right' | 'bottom' | 'left';

// ---------- anchors / ports ----------
export type AnchorSpec =
  | { kind: 'port'; portId: string }                         // named, fixed port on the shape
  | { kind: 'side'; side: Side; t?: number }                 // side locked; t fixed or auto if omitted
  | { kind: 'point'; u: number; v: number; project?: boolean } // normalised point, optionally projected to outline
  | { kind: 'floating' }                                     // perimeter projection toward the other end
  | { kind: 'auto'; allowedSides?: Side[] };                 // engine picks (cost-based)

export interface PortDef {
  id: string;
  side: Side;
  t: number;                          // 0..1 along the side
  direction?: 'in' | 'out' | 'both';
  maxConnections?: number;
}

export interface ResolvedAnchor {
  point: Point;
  normal: Point;                      // outward unit vector (exit direction)
  side?: Side;
  portId?: string;
}

// ---------- layout input ----------
export interface LayoutNode {
  id: string;
  box: Rect;                          // current box (width/height = measured size)
  shape: 'rect' | 'ellipse' | 'diamond' | 'path';
  outline?: Point[];                  // for non-rect perimeter projection
  ports?: PortDef[];
  parentId?: string;                  // compound / group
  pinned?: boolean;                   // must not move
  order?: number;                     // model order for stable layouts
  layoutHints?: Record<string, unknown>; // per-algorithm hints (layer, partition, lane…)
}

export interface LayoutEdge {
  id: string;
  source: string; target: string;
  sourceAnchor: AnchorSpec; targetAnchor: AnchorSpec;
  routing: 'straight' | 'bezier' | 'orthogonal';
  labels?: { id: string; width: number; height: number; position?: number }[];
  order?: number;
}

export type LayoutConstraint =
  | { type: 'align'; axis: 'x' | 'y'; nodes: string[]; at?: 'start' | 'center' | 'end' }
  | { type: 'distribute'; axis: 'x' | 'y'; nodes: string[]; gap?: number }
  | { type: 'order'; axis: 'x' | 'y'; before: string; after: string; gap?: number }
  | { type: 'within'; nodes: string[]; bounds: Rect }        // e.g. slide safe area
  | { type: 'fixed'; node: string; at?: Point };

export interface LayoutGraph {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  constraints?: LayoutConstraint[];
  frame: Rect;                        // slide / viewport area
}

// ---------- algorithms ----------
export interface LayoutContext {
  seed: number;                       // deterministic RNG seed
  rng: () => number;
  signal: AbortSignal;
  measure: TextMeasurer;
  mode: 'full' | 'incremental';       // incremental = preserve mental map
  changed?: ReadonlySet<string>;      // ids added/edited since last layout (scope)
  onProgress?: (partial: LayoutResult) => void; // live preview (force etc.)
}

export interface LayoutResult {
  boxes: Record<string, Rect>;
  anchors?: Record<string, { source?: ResolvedAnchor; target?: ResolvedAnchor }>;
  routes?: Record<string, Point[]>;   // if the algorithm also routed (ELK layered)
  labelPositions?: Record<string, Point>;
  meta?: { algorithm: string; version: string; ms: number; fingerprint: string };
}

export interface LayoutAlgorithm<O = Record<string, unknown>> {
  readonly id: string;                // 'layered.dagre', 'layered.elk', 'tree', 'force', 'template.timeline'…
  readonly version: string;           // part of the cache fingerprint
  readonly capabilities: {
    ports: boolean; compound: boolean; incremental: boolean;
    pinned: boolean; routesEdges: boolean; constraints: LayoutConstraint['type'][];
    runsIn: 'main' | 'worker' | 'either';
  };
  readonly optionsSchema: JSONSchema;   // exposed to AI tool-calling + property panel
  defaults(graph: LayoutGraph): O;
  adapt?(options: O, frame: Rect): O;   // e.g. portrait → direction TB, fewer columns
  layout(graph: LayoutGraph, options: O, ctx: LayoutContext): Promise<LayoutResult> | LayoutResult;
}

// ---------- post-processing & routing ----------
export interface LayoutPostProcessor {       // pins, cassowary, VPSC, grid snap
  readonly id: string;
  apply(graph: LayoutGraph, result: LayoutResult, ctx: LayoutContext): LayoutResult;
}

export interface AnchorSelector {
  select(edge: LayoutEdge, src: LayoutNode, tgt: LayoutNode,
         prev: ResolvedAnchor | undefined, all: SceneIndex): { source: ResolvedAnchor; target: ResolvedAnchor };
}

export interface Router {
  readonly id: string;                  // 'straight' | 'bezier' | 'ortho.astar' | 'ortho.libavoid' | 'fromLayout'
  readonly incremental: boolean;
  route(edges: RoutedEdgeInput[], obstacles: SpatialIndex, ctx: LayoutContext): Promise<Record<string, Point[]>> | Record<string, Point[]>;
}

export interface RoutePostProcessor {   // nudger, label placer, simplifier
  readonly id: string;
  apply(routes: Record<string, Point[]>, ctx: LayoutContext): Record<string, Point[]>;
}

export interface TextMeasurer {
  measure(text: string, style: TextStyle, maxWidth?: number): { width: number; height: number; lines: number };
}

// ---------- engine ----------
export interface LayoutEngine {
  register(alg: LayoutAlgorithm): void;
  registerRouter(r: Router): void;
  run(req: {
    graph: LayoutGraph; algorithm: string; options?: object;
    seed?: number; mode?: 'full' | 'incremental';
    post?: string[];                    // default: ['pins', 'constraints', 'vpsc', 'snap']
  }): Promise<LayoutResult>;
  /** convenience for AI: deterministic tidy-up with auto-picked algorithm */
  tidy(graph: LayoutGraph, opts?: { style?: 'auto' | string; seed?: number }): Promise<LayoutResult>;
}
```

### 8.3 Built-in algorithms and backing libraries

| Fluxion id | Purpose | Backing | Thread |
|---|---|---|---|
| `layered.fast` | Default flowchart, instant | @dagrejs/dagre | main |
| `layered` | High-quality flowchart / architecture with ports, compound, labels, orthogonal routes | elkjs `layered` | worker (lazy) |
| `tree` / `orgchart` | Hierarchies with variable sizes, compact leaves | d3-flextree (+ custom compaction); ELK `mrtree` as alt | main |
| `mindmap` | Two-sided balanced tree, bezier edges | d3-flextree ×2 | main |
| `radial` | Radial tree / hub-spoke | ELK `radial` or custom | either |
| `force` | Organic networks, pin-friendly | d3-force (seeded) + rect collide + VPSC | worker for >200 nodes |
| `constrained` | Tidy an existing hand-made diagram: align, keep order, no overlap, pins | WebCola (constraints + avoidOverlaps) | worker |
| `stress` | Undirected graphs, stable | ELK `stress` (with `stress.fixed`) | worker |
| `pack` | Tidy loose shapes to an aspect ratio | ELK `rectpacking` (or potpack-like custom for main-thread) | either |
| `template.*` | grid, stack, timeline, process, cycle, pyramid, matrix, swimlane, table, funnel, venn | pure TS (+ Yoga/Flexily for stack/wrap) | main |
| `network.large` (optional plugin) | 1k+ node network slides | graphology FA2 + noverlap | worker |

**`tidy()` auto-pick heuristic (deterministic):**
- DAG with ≤ 1 parent per node → `tree`.
- DAG / mostly directed → `layered` (fall back to `layered.fast` until ELK loads).
- Undirected, dense → `stress`.
- No edges → `pack` or `template.grid`.
- Existing positions + small edit → `constrained` in incremental mode.

### 8.4 Worker strategy

- One **layout worker** (module worker) that hosts ELK, WebCola, force and libavoid-WASM. Dynamic `import()` per algorithm keeps the initial worker small.
- The main thread keeps the synchronous, cheap algorithms (dagre, tree, templates, straight/bezier/A\* routers) for **instant feedback while dragging**.
- **Request/response rules:**
  - Snapshots are structured-clone JSON, or a transferable `Float64Array` for boxes in large graphs.
  - Coalesce requests so only one runs at a time; newer requests supersede older ones by `revision`.
  - `AbortSignal` cancellation.
  - Progress streaming for iterative algorithms.
- **Two-phase UX:** show the fast result (dagre / A\* routes) immediately, then animate to the refined result (ELK / libavoid) when it arrives, but only if the user hasn't edited in between (compare `revision`).
- Server-side AI generation runs the same `LayoutEngine` package in Node (worker_threads or inline), with a font-file–based `TextMeasurer`, so the output is byte-identical given the same fonts and seed.

### 8.5 Anchor-selection strategy

1. Respect `port` / fixed `point` anchors verbatim.
2. For `side` and `auto`: generate candidates and score them. Cost = length + bend estimate + "exit points away" penalty + side-crowding + change-from-previous (hysteresis ≈ 15%).
3. **Distribute** multiple edges on one side, ordered by their far-end coordinate (removes local crossings). Keep a minimum spacing and fall back to adjacent sides when crowded.
4. When the layout algorithm assigned ports (ELK FREE/FIXED_SIDE), take its choice as the candidate with a strong bonus, so ELK's crossing minimisation wins.
5. `floating` anchors (straight/bezier) are recomputed live every frame by outline intersection (rect, ellipse, polygon, or sampled path). They are not persisted.
6. **Persist** only user intent (`AnchorSpec`). Resolved anchors are cached derived state, which keeps documents stable and diffable for AI.

### 8.6 Router pipeline

```
RoutedEdgeInput(src ResolvedAnchor, tgt ResolvedAnchor, kind, waypoints?)
 ├─ straight   → [p0, p1] (floating anchors re-projected)
 ├─ bezier     → control points from anchor normals (k = clamp(d/2, 20, 150)); optional obstacle-aware
 │               variant = polyline route → Catmull-Rom/cubic fit
 ├─ orthogonal
 │    ├─ fromLayout      (reuse ELK layered bend points if nodes unchanged since layout)
 │    ├─ ortho.astar     (default; sparse non-uniform grid from obstacle edges ± margin, anchor stubs,
 │    │                   midlines; A* cost = length + bendPenalty·bends + crossPenalty; direction-aware;
 │    │                   obstacle exclusion disabled for the source/target shapes' overlap cases)
 │    └─ ortho.libavoid  (optional plugin, worker/WASM; incremental; pins; nudging built in)
 ▼
 Nudger        separate collinear overlapping segments within channels (order by next turn), min spacing
 Simplifier    remove collinear points, merge tiny jogs (< 4px), enforce min first/last stub length
 LabelPlacer   candidates along arc-length; score overlaps with nodes/labels/edges; greedy
 ▼
 Render-time only: rounded corners, line jumps (sweep-line intersections, z-order rule), arrowheads
```

- **User-edited waypoints** are stored as *constraints* on the route (checkpoints / segment offsets like Excalidraw's "fixed segments"). The router honours them and the nudger does not move them.
- The **SpatialIndex** (R-tree, e.g. `rbush`) is shared by the routers, the label placer and hit-testing.

### 8.7 Pins, constraints and responsive re-layout

- **Pins:** algorithms with native support (force, stress, cola, fcose) receive pins directly. For the others, the engine applies a **pin reconciliation** post-pass: least-squares translate/scale of the result to fit the pins, then VPSC with pinned nodes immovable.
- **Alignment / distribution / margins:** apply `@lume/kiwi` (Cassowary) as a post-processor with strengths (user constraints = strong, layout result = weak).
- **Portrait/mobile:** `algorithm.adapt(options, frame)` per algorithm. Results are cached per `(slideId, aspectClass)`, so switching orientation animates between two cached layouts.

### 8.8 Determinism & testing

- The engine owns the seeded RNG. Every algorithm must use `ctx.rng`. Canonicalise input order and quantise outputs.
- **Golden tests:** fixture graphs → snapshot `LayoutResult` (rounded). Metrics tests: overlaps = 0, crossings ≤ N, bends, edge length variance, aspect ratio within the frame. This quality scorecard can also be exposed to the AI so it can compare alternatives ("try layered vs. tree and choose the lower-cost one").

### 8.9 Phasing

1. **MVP:**
   - dagre, flextree and templates (grid/stack/timeline/cycle)
   - VPSC (from WebCola or a port), pins post-pass
   - straight/bezier/A\* orthogonal routers with nudging
   - Pretext measurement, FLIP animation
2. **v2:** elkjs worker (layered with ports and compound, rectpacking, stress), anchor distribution using ELK port results, WebCola `constrained` tidy, label placer, line jumps.
3. **v3:** libavoid-js HQ router plugin, Cassowary constraints UI, portrait adaptation cache, MSAGL spline routing evaluation, graphology plugin for big networks.

### 8.10 License notes

- MIT/ISC/BSD: dagre, d3, WebCola, cytoscape/fcose, graphology, MSAGL-JS, Yoga, Pretext, kiwi.
- **EPL-2.0** (elkjs): fine for proprietary use when unmodified. If ELK sources are modified, those modifications must be published.
- **LGPL-2.1** (libavoid-js): keep it as a separately loaded, replaceable WASM module and ship the license and notices.
- Commercial (yFiles, GoJS, JointJS+): used here as benchmarks only.

---

## 9. Sources

**Layout libraries**
- elkjs: https://github.com/kieler/elkjs · https://www.npmjs.com/package/elkjs · https://bundlephobia.com/package/elkjs · https://pkg-size.dev/elkjs
- ELK Layered overview (2025): https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html
- ELK constraining the model: https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html
- ELK options: https://eclipse.dev/elk/reference/options/org-eclipse-elk-port-side.html · https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-allowNonFlowPortsToSwitchSides.html · https://eclipse.dev/elk/reference/options/org-eclipse-elk-interactiveLayout.html
- ELK rectpacking: https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-rectpacking.html · https://eclipse.dev/elk/blog/posts/2022/22-08-31-rectpacking.html
- ELK edge labels: https://eclipse.dev/elk/reference/options/org-eclipse-elk-edgeLabels-placement.html · https://eclipse.dev/elk/reference/options/org-eclipse-elk-edgeLabels-inline.html
- ELK libavoid algorithm: https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-alg-libavoid.html
- React Flow ELK multiple handles: https://reactflow.dev/examples/layout/elkjs-multiple-handles
- React Flow layouting overview: https://reactflow.dev/learn/layouting/layouting
- @dagrejs/dagre: https://github.com/dagrejs/dagre · https://www.npmjs.com/package/@dagrejs/dagre · https://github.com/dagrejs/dagre/issues/469
- d3-force simulation / randomSource: https://d3js.org/d3-force/simulation · https://github.com/d3/d3-force/issues/121
- WebCola: https://github.com/tgdwyer/WebCola · https://ialab.it.monash.edu/webcola/
- cytoscape fcose: https://github.com/iVis-at-Bilkent/cytoscape.js-fcose · https://blog.js.cytoscape.org/2021/02/08/fcose-2.0.0-release/
- graphology layouts: https://graphology.github.io/standard-library/layout-forceatlas2.html · https://graphology.github.io/standard-library/layout-noverlap.html
- MSAGL-JS: https://microsoft.github.io/msagljs/docs/intro/ · https://www.npmjs.com/package/@msagl/core · https://github.com/microsoft/automatic-graph-layout
- yFiles: https://docs.yworks.com/yfiles-html/dguide/layout/organic_layout.html · https://www.yfiles.com/demos/layout-features/hierarchical-incremental/ · https://www.yfiles.com/the-yfiles-sdk/features/automatic-layouts
- GoJS layouts: https://gojs.net/latest/intro/layouts.html · https://gojs.net/latest/api/symbols/LayeredDigraphLayout.html · https://gojs.net/latest/samples/PackedLayout.html

**Routing**
- libavoid: https://www.adaptagrams.org/documentation/libavoid.html
- libavoid-js: https://github.com/Aksem/libavoid-js · https://www.npmjs.com/package/libavoid-js · https://github.com/Aksem/sprotty-routing-libavoid
- JointJS libavoid demo: https://github.com/clientIO/joint/discussions/2627
- JointJS routers: https://docs.jointjs.com/api/routers/ · https://docs.jointjs.com/learn/features/diagram-basics/links/
- Excalidraw elbow arrows: https://plus.excalidraw.com/blog/building-elbow-arrows-part-one · https://plus.excalidraw.com/blog/building-elbow-arrows-part-two
- tldraw elbow arrows: https://tldraw.dev/reference/tldraw/ElbowArrowInfo · https://github.com/tldraw/tldraw/issues/6664
- yWorks label placement: https://www.yworks.com/pages/automatic-label-placement-in-diagrams

**Constraints / stability**
- kiwi / @lume/kiwi: https://github.com/lume/kiwi · https://github.com/IjzerenHein/kiwi.js/
- Mental map research: https://www.sciencedirect.com/science/article/abs/pii/S107158191300102X · https://inside.java/2023/06/12/preserving-mental-map/

**Slides, text, animation**
- Yoga: https://www.yogalayout.dev/ · https://www.npmjs.com/package/yoga-layout · Flexily: https://github.com/beorn/flexily
- Pretext: https://github.com/chenglou/pretext
- flubber: https://github.com/veltman/flubber
- Algorithm background (from general literature, not fetched): VPSC (Dwyer, Marriott & Stuckey, "Fast Node Overlap Removal", GD 2005); PRISM (Gansner & Hu, "Efficient Node Overlap Removal Using a Proximity Stress Model", GD 2008); Orthogonal connector routing (Wybrow, Marriott & Stuckey, GD 2009); Graphviz spline routing (Dobkin et al. 1997); FLIP (Paul Lewis, 2015).
