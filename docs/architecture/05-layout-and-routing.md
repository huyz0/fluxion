# 05 — Layout & Routing (`@fluxion/layout`, `@fluxion/routing`)

> Read when: adding or changing a layout algorithm, template, router, anchor logic, overlap/
> constraint pass, the layout worker, text measurement for sizing, line jumps and corners, or
> anything that affects determinism or layout/routing performance.
> Research basis: `research/02` §2.3 (routing concerns), §3.3 (anchor reselection), §4 (overlap &
> constraints), §5 (templates), §6 (animation, workers, determinism), §7 (text measurement), §8
> (recommended architecture). Requirements: `13-layout-and-arrange.md`, `12-…` (ANC, CON, RTE),
> NFR-PERF-005, NFR-REL-005, NFR-SIZE-005, NFR-LIC-002. Decision: ADR-0005.

## 1. Shape of the solution

Both packages are **pure L2** libraries. Neither imports the other. They meet through `core`
registries (`layouts`, `routers`) and snapshot types defined in this document. Two parties
compose them:

- the **`arrange` command** (editor, CLI, MCP), which runs the full pipeline and commits one
  transaction;
- **derived signals** in `core`, which call the registered router for each connector, so `render`
  gets routes without depending on `routing` (01 §3, 02 §6).

```
          ┌────────────── layout ──────────────┐   ┌────────────── routing ─────────────────┐
snapshot ─▶ [1] measure → [2] place → [3] pins  ─▶ [5] anchors → [6] route → [7] nudge/simplify
 (JSON)   │     & constraints → [4] overlap     │   │  → [8] label placement                  │
          └──────────────────┬─────────────────┘   └───────────────┬─────────────────────────┘
                             ▼                                     ▼
                     boxes (baked on commit)            routes (derived; optional cache)
                             └───────────────┬─────────────────────┘
                                             ▼
             [9] animate: FLIP boxes + route morph (anim, 07 §3) → commit (one tx)
 render time only: rounded corners, line jumps, markers (geometry helpers, §8)
```

Every stage is a pure function over a serializable snapshot. Any stage can therefore run in the
worker, be cached, be golden-tested, and replay byte-identically (research 02 §8.1).

## 2. Core interfaces

```ts
// ---- input snapshot (built from records by `layout/snapshot.ts`) ----
interface LayoutNode {
  id: RecordId; box: Box;               // current box; w/h already measured
  outline?: Path;                       // for non-rect projection (from ShapeDef.outline)
  anchors?: AnchorDef[];                // 02 §2 Anchors
  parentId?: RecordId;                  // nested container → bottom-up (FR-LAY-005)
  pinned?: boolean;                     // element.locks.position or layout.pins
  order: number;                        // canonical model order (fractional index rank)
  hints?: Record<string, unknown>;      // rank, lane, partition, side, template slot…
}
interface LayoutEdge { id: RecordId; source: RecordId; target: RecordId;
  sourceAnchor: AnchorRef; targetAnchor: AnchorRef; routeType: RouteType;
  labels?: { id: string; size: Size; t?: number }[]; order: number; }
type LayoutConstraint =
  | { type: 'align'; axis: 'x' | 'y'; nodes: RecordId[]; at?: 'start' | 'center' | 'end' }
  | { type: 'order'; axis: 'x' | 'y'; before: RecordId; after: RecordId; gap?: number }
  | { type: 'sameRank'; nodes: RecordId[] }
  | { type: 'spacing'; min?: number; max?: number }
  | { type: 'within'; nodes: RecordId[] | '*'; bounds: Box };   // safe area (FR-LAY-012)

interface LayoutInput { nodes: LayoutNode[]; edges: LayoutEdge[]; constraints: LayoutConstraint[];
  frame: Box; scope: 'screen' | 'selection' | { containerId: RecordId }; }
interface LayoutOutput {
  boxes: Record<RecordId, Box>;
  anchors?: Record<RecordId, { source?: AnchorRef; target?: AnchorRef }>; // algorithm-chosen sides
  routes?: Record<RecordId, Vec2[]>;    // when the algorithm routes (ELK layered, dagre points)
  metrics: { overlaps: number; crossings: number; bends: number; ms: number };
  fingerprint: string;                  // §6
}

interface LayoutCtx { rng: () => number; measure: TextMeasurer; signal: AbortSignal;
  mode: 'full' | 'incremental'; changed?: ReadonlySet<RecordId>;
  onProgress?(partial: LayoutOutput): void; }

interface LayoutAlgorithm<O = unknown> {
  id: string; version: string;          // e.g. 'layered', 'layouts-elk:layered'
  options: ZodType<O>;                  // → inspector, DSL, AI catalog, MCP (FR-LAY-001)
  capabilities: { pins: boolean; incremental: boolean; compound: boolean; routes: boolean;
                  constraints: LayoutConstraint['type'][]; runsIn: 'main' | 'worker' | 'either' };
  adapt?(o: O, frame: Box): O;          // portrait / narrow (§7)
  run(input: LayoutInput, o: O, ctx: LayoutCtx): LayoutOutput | Promise<LayoutOutput>;
}

interface LayoutEngine {
  run(req: { input: LayoutInput; algorithm: string; options?: unknown; seed?: number;
             mode?: 'full' | 'incremental'; post?: PostPassId[]; revision: number },
      signal?: AbortSignal): Promise<LayoutOutput>;          // rejects with AbortError when cancelled
  tidy(input: LayoutInput, seed?: number): Promise<LayoutOutput>;  // FR-LAY-011, min-movement
}
type PostPassId = 'pins' | 'constraints' | 'overlap' | 'snap' | 'fit';

// ---- routing ----
interface ResolvedAnchor { point: Vec2; normal: Vec2; side?: 'n' | 'e' | 's' | 'w'; ref: AnchorRef }
interface AnchorSelector {
  select(edge: LayoutEdge, src: LayoutNode, tgt: LayoutNode, ctx: AnchorCtx):
    { source: ResolvedAnchor; target: ResolvedAnchor };
}
interface Router {
  id: RouteType;                        // 'straight' | 'curved' | 'orthogonal' | 'polyline' | `${pack}:${name}`
  incremental: boolean; runsIn: 'main' | 'worker' | 'either';
  route(req: RouteRequest[], obstacles: SpatialIndex, ctx: RouteCtx): RouteResult | Promise<RouteResult>;
}
interface RouteRequest { connectorId: RecordId; source: ResolvedAnchor; target: ResolvedAnchor;
  waypoints?: Vec2[]; fixedSegments?: SegmentConstraint[]; ignore: RecordId[] } // endpoint shapes
type RouteResult = Record<RecordId, Path>;
interface RoutePostProcessor { id: 'nudge' | 'simplify' | 'labels' | string;
  apply(routes: RouteResult, ctx: RouteCtx): RouteResult; }

interface TextMeasurer {                // the core port (03 §7); layout adds a size policy on top
  measure(text: RichTextDoc | string, style: FontStyle, maxWidth?: number):
    { width: number; height: number; lines: number };
}
```

`AnchorRef` is the persisted **intent** (02 §2). `ResolvedAnchor` is always derived.

## 3. Built-in algorithms and backing libraries

| id | Purpose (FR) | Backing | Thread |
|---|---|---|---|
| `grid`, `stack` | Cells / flex row-column with gap, align, wrap (LAY-002) | own TS | main |
| `timeline` | Horizontal/vertical with lanes (LAY-003) | own TS | main |
| `template.*` | Smart templates (§7) | own TS | main |
| `layered` (**default**) | Flow/hierarchical TB/LR/BT/RL (LAY-002) | `@dagrejs/dagre` | main (<300 nodes) / worker |
| `tree`, `orgchart`, `radial` | Tidy trees, variable node sizes | `d3-hierarchy` + `d3-flextree` | main |
| `mindmap` | Two-sided balanced tree | `d3-flextree` ×2, mirrored | main |
| `circular`, `packing` | Ring; rect packing (shelf/skyline) | own TS | main |
| `force` | Organic networks, pin-friendly, seeded | `d3-force` (`randomSource(rng)`) + rect collide | worker if >200 nodes |
| `constrained` / tidy | Minimal-movement cleanup, align, non-overlap (LAY-011) | WebCola (VPSC, constraints) | worker |
| `swimlane` | Lanes × phases, `layered` per lane + lane pass | dagre + own | main |
| `layouts-elk:*` (pack) | `layered` with ports, compound, labels; `stress`; `rectpacking`; `mrtree` | `elkjs`, **unmodified**, lazy worker chunk (EPL-2.0) | worker |

Post-passes: **pins** (least-squares fit to pins, then pinned nodes fixed), **constraints**
(align/order/within; Cassowary via `@lume/kiwi` is reserved for R3+), **overlap** (VPSC from
WebCola, the FR-LAY-004 guarantee), **snap** (0.5 px or grid), **fit** (FR-LAY-012).

| Router id | Algorithm | Notes |
|---|---|---|
| `straight` | Two points; floating anchors re-projected on the outline | Per frame |
| `curved` | Cubic; controls from anchor normals, `k = clamp(d/2, 20, 150)` | Parallel edges fan out (FR-CON-011) |
| `polyline` | User waypoints | Waypoints are constraints |
| `orthogonal` (**own**) | A* on a sparse non-uniform grid (obstacle edges ± margin, anchor stubs, midlines); cost = length + bend·B + crossing·C | Then nudge + simplify |
| `routing-libavoid:orthogonal` (pack) | libavoid-js wasm, incremental, pins, built-in nudging | LGPL-2.1: separately loaded, replaceable module, notices shipped |

ELK and libavoid never enter the player bundle unless a live container needs them
(NFR-SIZE-005). Baked positions and an optional route cache make static documents
router-free at view time. Both are listed as the only EPL/LGPL exceptions (NFR-LIC-002).

## 4. Worker host & cancellation

```
main thread                          layout worker (module worker; Blob URL in .flux.html)
LayoutEngine.run(req, signal) ──post {id, revision, algId, input, seed}──▶ loader.import(algId)
   │ signal.abort() ──post {cancel,id}──▶ ctx.signal aborts → algorithm checks per iteration
   ◀── {progress,id,partial} (force/cola) ── ◀── {done,id,output} | {error,id,diag}
   └ drops results whose revision < latest (last-write-wins)
```

- The host is **generic** (`layout/worker`). Algorithms and routers declare
  `load: () => import('…')`, so a pack (ELK, libavoid) adds worker jobs without `layout`
  importing it.
- Only one job runs per scope; a newer revision supersedes older ones. Snapshots are
  structured-clone JSON, and large box sets use a transferable `Float64Array`.
- **Two-phase UX**: the fast main-thread result (dagre / A*) shows immediately. The refined
  worker result animates in only if `revision` is unchanged.
- Node (CLI/MCP) runs the same engine inline or via `worker_threads` with the fontkit measurer,
  so the output matches the browser given the same fonts and seed.

## 5. Live containers, incremental & pinned layout

- **Live container** (FR-LAY-010): a `frame` with `layout: { algorithm, options, live: true }`.
  A post-commit reactor watches the container's children index (add/remove/resize/text-size
  change), debounces to one per frame, runs the layout, and commits the positions with the
  originating transaction's `mergeKey`. The user's edit and its re-layout undo as one step.
  Nested containers run bottom-up: child containers are sized first and become fixed nodes for
  the parent (FR-LAY-005). Positions are always stored (02 §6), so files open without layout.
- **Incremental** (FR-LAY-006): `mode:'incremental'` passes the `changed` set. Algorithms with
  native support warm-start from current boxes (force, cola). Others run full and then go
  through a displacement-minimizing reconciliation. The CI metric is ≤ 30 % of nodes moved on
  the fixture.
- **Pinned** nodes are never moved (a property test asserts it).

## 6. Determinism (FR-LAY-008, FR-RTE-004, NFR-REL-005)

1. **Seeded PRNG** from the `Random` port (sfc32). Every algorithm uses only `ctx.rng`, and
   lint forbids `Math.random` in L2.
2. **Stable ordering**: nodes and edges are sorted by `order` (fractional index rank), then id,
   before any library call. Map iteration order never leaks.
3. **Fixed iteration counts**; no time-budgeted early exit in deterministic mode.
4. **Rounding**: outputs are quantized to 0.5 px (boxes, bend points) before diffing and
   committing.
5. **Input-hash cache**: `fingerprint = sha256(algId@version, options, seed, canonical input,
   measured sizes)` via the `Hasher` port. A hit returns the cached output, so "make it neat"
   is idempotent. Measured sizes depend on fonts, so the font-subset hash is part of the input.

## 7. Responsive re-layout & smart templates

- **Responsive** (FR-LAY-013, FR-RSP-003/004): `screen.breakpoints[bp]` may name an alternative
  layout, or just let `algorithm.adapt(options, frame)` derive one (layered LR→TB, grid fewer
  columns, timeline horizontal→vertical, radial→list). Results are written as
  `element.overrides[bp]` and never over the base. They are cached per `(screenId, bp,
  fingerprint)`, so an orientation change animates between two cached layouts.
- **Smart templates** (FR-LAY-014) are named presets that the DSL and AI call by id:

```ts
interface TemplateDef {
  id: string;                               // 'process.chevron', 'cycle.basic', 'hierarchy.org', 'matrix.2x2',
                                            // 'pyramid', 'funnel', 'venn', 'timeline.milestones', 'comparison'
  items: ZodType<TemplateItem[]>;           // outline of labelled items (nested for hierarchy)
  build(items: TemplateItem[], frame: Box, ctx): { nodes: ElementDraft[]; edges: ConnectorDraft[] };
  algorithm: string; options: unknown;      // e.g. 'timeline' | 'tree' | own parametric geometry
  shapes: Record<string, string>;           // slot → shape def ('item' → 'basic:chevron')
  variants?: Record<string, string>;        // slot → theme variant (styling, FR-THM-006)
  adapt?(frame: Box): Partial<TemplateDef>; // portrait form
}
```

## 8. Anchors, routing post-passes, render-time decoration

**Anchor scoring** (FR-ANC-004). Named and point anchors pass through. `side` generates k
fractions, and `auto` generates the 4 side midpoints (plus outline corners for diamonds and
ellipses) and the floating projection. Each (source, target) candidate pair costs:

```
cost = 1.0·len(manhattan|euclid) + 40·bends(exitDir, entryDir, quadrant)
     + 80·[exit points away from target] + 25·crowding(side) + 30·[role mismatch]
     + H·[differs from previous choice]         // hysteresis, H ≈ 15 % of the current best cost
```

The minimum wins. An algorithm-assigned side (e.g. ELK) gets a strong bonus. Edges sharing a
side are then **distributed**, sorted by the far end's coordinate (FR-ANC-007), and
`maxConnections` spills to the adjacent side. Weights live in the router options, and the
numbers above are defaults to tune against fixtures.

**Post-passes**: *nudge* orders collinear overlapping segments per channel by their next turn,
then spreads them by `spacing` (FR-RTE-003). *simplify* drops collinear points, merges jogs
under 4 px, and enforces a minimum end stub. *labels* tries candidates along arc length (0.5,
0.33, 0.66, …; the longest orthogonal segment first) and scores them by overlap with
nodes, labels and edges.

**Render time** (research 02 §2.3), in `geometry` helpers called by the connector view:
- *rounded corners*: each bend becomes an arc of `min(r, seg/2)` (FR-CON-005);
- *line jumps*: a sweep-line over the screen's route segments (pruned by the spatial index)
  gives crossings. The connector later in z-order draws an arc or gap
  (`document.settings.lineJumps`, FR-CON-008). The result is cached per route revision.

**Animation** (FR-LAY-009): the layout diff becomes an `anim` tween. Boxes use FLIP (model
boxes, no DOM measurement). Routes morph via `d3-interpolate-path` with endpoints attached to the
animated anchors, then snap to the final route at t = 1. New nodes fade in and removed nodes
fade out (07 §3, §4.4).

## 9. Performance budgets

| Budget | Requirement | Strategy |
|---|---|---|
| 100-node layered < 200 ms | NFR-PERF-005 | dagre on main thread, cached fingerprints |
| 500-node layered < 2 s, main-thread long tasks < 50 ms | FR-LAY-007 | worker, cancellation, progress |
| 200 orthogonal routes < 300 ms | NFR-PERF-005 | sparse grid, shared spatial index, one grid per batch |
| Drag with 200 connectors ≥ 50 fps | FR-RTE-002 | reroute only connectors bound to moved elements (bindings index); during drag skip nudge and labels; full global pass in the worker on drop |

## 10. Testing

- **Property tests** (fast-check, random graphs and sizes):
  - no two non-grouped nodes overlap after any algorithm plus post-passes (FR-LAY-004);
  - orthogonal routes never intersect non-endpoint obstacles inflated by the margin
    (FR-CON-004);
  - endpoints lie on resolved anchors after random transforms (FR-CON-012);
  - pinned nodes do not move;
  - the same input and seed produce identical output (FR-LAY-008, FR-RTE-004);
  - nudged collinear segments are ≥ spacing apart.
- **Golden snapshots**: fixture graphs per algorithm and template → rounded `LayoutOutput` and
  SVG. Each fixture also records a metric scorecard (crossings, bends, edge-length variance,
  aspect ratio in frame). The scorecard is exposed to AI via `fluxion layout --score`.
- **Benchmarks** for each §9 row in the CI perf job; regressions over 10 % fail. Coverage floor
  ≥ 90 % lines and mutation score ≥ 70 % (NFR-MNT-004/005).
