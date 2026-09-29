---
status: accepted
date: 2026-09-29
decision-makers: Fluxion maintainers (M5 plan "Decide before coding", delegated to the driver)
---

# ADR-0016 — Shape outlines as path templates, and a safe expression language

## Context and Problem Statement

M5 draws the 21 basic shapes from parametric definitions supplied by `packs/basic` (FR-SHP-002,
FR-SHP-003). 03 §5 sketches a `ShapeDef` whose `outline` "evaluates to a normalized path (absolute
cubic beziers)", written as a path template or a geometry function by id. Packs are data that
travels inside documents later (FR-EXT-*), so an outline must never be code. How is an outline
written (closed shapes, open lines, per-element vertex lists), how are its numbers computed, how is
the work bounded, where does `ShapeDef` live, and what does an outline normalize to?

## Decision Drivers

- No code execution from a pack or a document: no `eval`, no `Function`, bounded work (NFR-SEC-*).
- One interpreter, reused later for bindings and data-driven styles (03 §5).
- Parametric vertex counts: a star's `points` changes how many vertices the outline has.
- Per-element geometry: a polyline's or freehand stroke's vertices belong to the element, not to
  its definition.
- Every consumer (render, hit-testing, perimeter projection, routing, export, morphing) reads one
  representation: geometry's cubic `Path`.
- Readable for pack authors and for AI authoring (FR-AI-*): close to SVG.

## Considered Options

- **A. SVG path templates with `{expr}` numbers, a polygon generator and a points outline**,
  evaluated by a small interpreter.
- **B. Outline functions by id** (`{ fn: 'basic.star' }`) implemented in TypeScript.
- **C. JavaScript snippets** run in a sandbox (worker or QuickJS).

## Decision Outcome

Chosen option **A**.

1. **Outline spec** (`ShapeDef.outline`), exactly one of:
   - `{ path: string }`: absolute SVG path data (`M L H V C Q A Z`) in which any number may be
     written as `{expr}`, e.g. `M {r} 0 L {w - r} 0 A {r} {r} 0 0 1 {w} {r} …`. It is **one
     subpath**: a second `M` is a diagnostic. It is closed when it ends with `Z`, open otherwise.
   - `{ polygon: { n: expr, x: expr, y: expr } }`: a closed polygon of `n` vertices; `x` and `y` are
     evaluated for `i = 0 … n-1` (with `n` bound). A star is `n: "2 * points"`,
     `x: "w/2 + (i % 2 ? inner : 1) * w/2 * sin(2*pi*i/n)"`, and so on.
   - `{ points: param, closed?: boolean, smooth?: boolean }`: the vertices of the element's param
     named `param` (a `points` param, item 5), scaled from fractions to the box; `smooth` turns
     them into a Catmull-Rom curve converted to cubics. Polyline (open) and freehand (open, smooth)
     use it; no format change is needed, since an element's `params` already holds any JSON.
   Coordinates are in the shape's own box (`0 … w`, `0 … h`), not a unit box: the size is an input
   of the expressions, so radii stay round under non-uniform scaling.
2. **Normalization**: `evaluateOutline(def, size, params)` in `@fluxion/core` evaluates the spec,
   converts arcs to cubics (geometry `arcToCubics`, at most 90° per cubic) and returns the geometry
   path commands and the normalized `Path` (lines as cubics; `closed` from the spec). Consumers read
   only that. **Open outlines** (a path without `Z`, `points` with `closed: false`) have no fill and
   no interior: hit-testing measures the distance to the curve (half the stroke width plus a hit
   tolerance), perimeter projection is the nearest point on the curve, and the renderer strokes them
   only.
3. **Decorations** (`ShapeDef.decorations`): a list of `{ path: string }` templates evaluated with
   the same identifiers, drawn as strokes only and never part of the outline (the cylinder's top
   ellipse, the document's fold).
4. **Expression language** (`@fluxion/core` `expr/`): numbers; identifiers from an allow-list (`w`,
   `h`, the definition's number, int and enum params, `i`, `n`, `pi`); `+ - * / %`, unary `-`,
   comparisons, `? :`, parentheses; functions `min max abs sqrt sin cos tan atan2 floor ceil round
   clamp`. There are no string literals: an **enum param evaluates to the index** of its value in
   `values`. A hand-written tokenizer and parser build an AST that a tree-walking evaluator runs.
   Unknown identifiers or functions, a division by zero, a non-finite result and an exhausted budget
   return a diagnostic (`Result`), never throw. There is no `eval` and no `Function` anywhere in
   shipped sources (the M5 gate greps for them).
5. **Params**: `{ type: 'number' | 'int', min, max, default }`, `{ type: 'enum', values, default }`,
   or `{ type: 'points', min?, max?, default }` (a list of `[x, y]` fractions, 2 … 10 000 items). An
   element's params are clamped into range (points into `0 … 1`) before evaluation; a missing or
   invalid param uses its default.
6. **Bounded work**: one budget per `evaluateOutline` call covers every evaluation of the outline and
   its decorations (default 100 000 AST steps); a polygon's `n` must be an integer in `2 … 1024`, a
   template may expand to at most 1 024 segments, and a points outline to at most 10 000 vertices.
   Exceeding any of them is a diagnostic, not work.
7. **Where `ShapeDef` lives**: the type and its Zod schema in `@fluxion/core` (`shape-def.ts`), next
   to the `shapeDefs` registry it types. Render's R0 `ShapeOutline` registry and its built-in
   `basic:rect` go (ADR-0015 amendment of M4.14): hosts register packs (the CLI loads `packs/basic`),
   and render tests register their own definitions.

### Consequences

- Good, because a pack is pure data: it can be validated, embedded in a file and shown to an AI.
- Good, because every consumer shares one normalized path, open or closed.
- Good, because the interpreter is reusable for bindings (M18) with a different identifier set.
- Bad, because shapes that need loops beyond one polygon (a cloud of arcs) are written as longer
  templates; a later `repeat` construct is an additive change.
- Bad, because the interpreter is ours to maintain; fuzzing (10 000 templates per run) guards it.

### Confirmation

`core/src/expr` tests (diagnostics, fuzz, enum indices), `shape-def` tests (closed and open outlines,
a polygon over the vertex cap, a budget exhausted across evaluations), per-shape outline tests in
`packs/basic`, and the M5 gate's no-`eval` leg.

## Amendment (M5.7, implementation)

- **One subpath, closed last**: a template starts with `M`, has no second `M`, and nothing follows
  `Z` (the M5.5 review's rule). Template problems are `FLX_SHAPE_PATH` (also relative commands,
  a missing or extra number, an unclosed `{`); a definition breaking its schema is
  `FLX_SHAPE_DEF_INVALID` (`parseShapeDef`); a cap exceeded is `FLX_SHAPE_LIMIT`.
- **Caps**: a points list of more than 10 000 vertices is `FLX_SHAPE_LIMIT`. A list that is
  malformed or outside its param's `min … max` uses the default (item 5). The segment cap applies
  twice: to the commands as written, and to the commands after arcs expand to cubics.
- **Budget**: every number of a template spends a step, literals too.
- **Smooth points outlines** give each vertex one Catmull-Rom tangent, shared by its two segments
  (C1). The tangent is fitted to the box: at a vertex on the box's edge, a component pointing out
  of it is dropped, and the rest is scaled until both control points are inside. A stroke that
  turns at an edge of its box stays inside it (M5.11, M5.12).
- **Hit-testing and projection** (`hitTestShape`, `projectToOutline`, `outlineDistance`) read the
  evaluated path. A closed outline hits inside (nonzero rule) or within a tolerance of its edge; an
  open one only within the tolerance. Projection lands on the outermost crossing of a ray (or the far
  end of an edge the ray runs along), snapped onto the outline, or on the nearest outline point when
  the ray misses (M5.12).
- **`ShapeDef` fields**: `anchors` are the schema's `AnchorDef` (box fractions, a direction, a
  role); `textRegions` are named box fractions; `handles` are `{ param, x, y }`, with `x` and `y`
  expressions, bound to a number or int param. Param names are identifiers that shadow none of
  `w h i n pi`. There are at most 16 decorations. `evaluateOutline` takes a definition that
  `parseShapeDef` has already accepted.
- **Arcs**: `arcToCubics` works in the ellipse's unit frame. Radii too small are scaled up to
  reach the end point, even when they are close to zero. Radii so large, or so unequal, that the
  centre or the ratio overflows give the straight line (the chord). The output is finite for finite
  input. `evaluateOutline` still checks every coordinate of its paths, because finite numbers can
  overflow once combined (a line from `-1e308` to `1e308`); such an outline is `FLX_SHAPE_LIMIT`.

## More Information

03-core-engine §5, ADR-0015 (render path), ADR-0005 (layout/routing stack), FR-SHP-002/003/005.
