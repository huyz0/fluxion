---
status: accepted
date: 2026-11-14
decision-makers: harness (M19.7; within FR-SHP-010, FR-SHP-011 and NFR-LIC-001; no requirement or licence-policy change)
---

# ADR-0053 — Boolean path operations: polybooljs on adaptively flattened outlines in `geometry`, re-fitted to cubics, stored as a `core:path` shape

## Context and Problem Statement

FR-SHP-010 asks for union, subtract, intersect and exclude on vector shapes, producing a path shape; FR-SHP-011 asks for editing a
path shape's vertices and Bézier handles. Every shape already has an outline path (FR-SHP-005, `packages/geometry/src/path.ts`:
M, L, Q, C, Z commands in absolute coordinates). Nothing stores a path an instance owns: a `shape` draws its definition's
geometry (`defId`, `params`), so there is no "path shape" for an operation to produce or for the path tool to edit. The plan names
two libraries; the M19 risk table warns that booleans on flattened curves can produce jagged or huge paths.

## Decision Drivers

- Correct results on the fixtures: area within 0.5 % of an analytic reference (M19.18 acceptance), closed rings, holes kept.
- Bounded output: no point-count explosion from flattening (M19 risks).
- Purity and determinism (non-negotiable 5): same inputs, same bytes, in Node and every browser.
- Licence policy unchanged (NFR-LIC-001; `thresholds.mjs` allow list: MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, MPL-2.0).
- The player does not grow (PLAYER_CORE_GZIP): booleans are an editing operation.

## Considered Options

1. **polygon-clipping (MIT) on flattened curves, re-fitted.** Robust (Martinez–Rueda with exact predicates), widely used. But it
   depends on `robust-predicates`, licensed Unlicense, which the allow list does not name; adding it would change licence policy,
   a human's decision. Rejected for that reason alone.
2. **paper.js path booleans (MIT) in a lazy editor chunk.** Operates on curves directly, so no flattening error. But it brings its
   own scene graph (about 9 MB unpacked, a large chunk even minified), expects a canvas/DOM-like host (`paper-full`, jsdom shims for
   Node), and its results depend on floating-point paths through its curve intersection code that we cannot pin in `geometry`'s
   pure tests. Too heavy for one operation, and not pure.
3. **clipper2 ports.** Fast, integer-robust; BSL-1.0 licence (not on the allow list). Rejected.
4. **polybooljs (MIT, no dependencies) on adaptively flattened outlines, re-fitted to cubics, in `geometry` (chosen).** A small
   pure-JS Martinez-style polygon boolean with an epsilon model, no transitive dependencies, so the licence check needs no policy
   change. It works on polygons, so curves are flattened first and fitted back after.
5. **Our own polygon boolean.** No dependency, but a robust sweep-line implementation is weeks of work and a long tail of
   degenerate cases; kept as the fallback if polybooljs fails the fixtures.

## Decision Outcome

Option 4.

### Pipeline (`packages/geometry/src/boolean.ts`, pure)

1. Each operand's outline (its definition's path, or its `path`, below) is placed by its element transform (turn and flips
   included) into screen coordinates.
2. **Adaptive flattening**: each Q/C segment is subdivided until every chord both deviates from the curve by less than
   `ε = min(0.001 × D, 0.002 × L)` and turns the tangent by at most 10°, where `D` is the larger side of the operands' union box
   and `L` the length of the segment's own control polygon. The second term and the angle limit keep small features round: a
   circle of r = 10 inside a 1000 px rect flattens to at least 36 chords, not 7 (plan review r1 F1).
3. **Fill rules in**: polybooljs works on even-odd regions. An `evenodd` operand goes in as its rings. A `nonzero` operand (the
   default) is first resolved to its nonzero region, the same set `pointInPath(…, 'nonzero')` reports (winding ≠ 0): its rings
   (a self-intersecting ring split at its crossings first) are nested by containment; each ring `R` gets the winding number of the
   area just inside it, `w(R) = w(parent) + sign(R)` (sign by its signed area, the outermost rings' parent being 0); the region is
   the union, over rings with `w(R) ≠ 0`, of `R` minus its child rings. So a flipped operand (every ring reversed), an outer ring
   wound either way, and separate blobs wound oppositely all keep their filled area; a counter-wound inner ring is a hole only
   when it brings the winding to 0 (plan review r2 F1).
4. **polybooljs** computes union, difference (first operand minus the rest, in z-order), intersection or xor (exclude).
5. **Fill rule out**: the result's rings are oriented outer counter-clockwise and holes clockwise (by nesting depth), and the
   stored `path.fillRule` is `'evenodd'`, so the result draws and hit-tests the same under either rule (r1 F2).
6. **Re-fit**: each result ring is split at corners and each run between corners fitted with cubic Béziers (Schneider's
   algorithm) to a maximum error of `2ε`; runs of collinear points become one line. A corner is a vertex whose turn exceeds 30°;
   flattening never makes one (its chords turn ≤ 10°), so corners are the operands' own corners and the intersection points.
   Rings are closed.
7. The result is normalised into its own bounding box (below) with coordinates rounded to 2 decimals (FR-EDT-022).

Bounds: a result has at most `2 × (input segments) + 8 × (result rings)` segments, and at most 4 cubics per quarter of any circular
arc in the fixtures. A result with no area (disjoint intersect, a subtract that removes everything) is an error the command reports;
nothing is changed.

### The path shape

- The result is a `shape` with `defId: 'core:path'` and a new optional field `path: { d, w, h, fillRule? }`: `d` an SVG path
  string (M, L, C, Q, Z, absolute) in a reference box `w × h`, drawn scaled to the element's `transform` box as a `viewBox` would
  be; `fillRule` `'nonzero'` (default) or `'evenodd'`. Resizing scales it; turn and flips come from the transform as for any shape.
  Its outline (hit-testing, connector perimeter, morphing, FR-SHP-005) is `d` scaled.
- `core:path` has default anchors at its box sides like `basic:rect` and no params. The path tool (FR-SHP-011, M19.19) edits `d`
  (and refits `w`, `h` and the transform when the bounds change) in one undoable step.
- The field is part of schema 1.8 (ADR-0054, M19.9), additive: a 1.7 reader ignored no such field because none existed.
- The operation's command (core) replaces the operands by the new shape in one transaction (one undo step): the result takes the
  bottom-most operand's z-index, container and style; bindings to removed operands are moved to the result at the same anchor
  side when the anchor still lies on the result's outline, else to `auto`.

### Packaging

- `polybooljs` becomes a runtime dependency of `@fluxion/geometry` (reason and licence in the commit, `check-licenses`). The player
  never imports `boolean.ts`; size-limit's player entries confirm it stays out (tree-shaken), and PLAYER_CORE_GZIP is unchanged.
- If polybooljs fails a fixture's area or bound, the fallback is Option 5 behind the same `boolean.ts` signature; the choice of
  backend is not part of any contract.

## Consequences

- Good: no licence-policy change; pure and deterministic; a stored path any later operation, the path tool and the DSL can use.
- Good: flattening error is bounded relative to size, and re-fitting keeps paths small and editable.
- Bad: curves are approximated (≤ `2ε` from the exact result); repeated booleans accumulate that error. Acceptable at 0.2 % of the
  operand size.
- Bad: polybooljs is little maintained (last release 2024); we pin it and own the fallback.

## Confirmation

- `packages/geometry/src/boolean.test.ts` (M19.18): goldens for each operation on rect/circle/star/rounded-rect fixtures, area
  within 0.5 % of the analytic reference, segment counts within the bound, deterministic bytes across runs, empty results refused;
  a small circle (r = 10) subtracted from and intersected with a 1000 px rect keeps its area within 0.5 % and is drawn by cubics,
  not chords; a hole (circle subtracted from the middle of a rect) is not inside the result by `pointInPath` under the stored
  rule and its rings are oppositely wound; a nonzero operand with a counter-wound inner ring keeps its hole, and a horizontally
  flipped operand, one whose outer ring is reversed, and two oppositely wound blobs keep their full area in a union.
- `check-licenses` passes with polybooljs listed; size-limit shows player core unchanged.
- m19-complete leg 'FR-SHP-010 boolean ops match their goldens' and geometry coverage ≥ COVERAGE_PURE_LINES/BRANCHES.

## Links

- FR-SHP-005, FR-SHP-010, FR-SHP-011, NFR-LIC-001; ADR-0054 (schema 1.8); ADR-0014 (one undo step); tech-stack.md.
- polybooljs (MIT, no dependencies); polygon-clipping, robust-predicates (Unlicense); paper.js; Schneider, "An Algorithm for
  Automatically Fitting Digitized Curves" (Graphics Gems, 1990).
