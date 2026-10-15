---
status: accepted
date: 2026-10-13
decision-makers: harness (M13.3; within FR-LAY-004/008, NFR-LIC-002 and ADR-0005; no requirement changes; one new runtime dependency, permissive)
---

# ADR-0034 — Overlap removal, determinism rules, and the `@dagrejs/dagre` dependency

## Context and Problem Statement

M13 must guarantee that no two unpinned boxes overlap after a layout (FR-LAY-004) and that the same input and seed give the same output (FR-LAY-008), in the browser, the worker and Node. The `layered` algorithm is backed by dagre (ADR-0005, 05-layout-and-routing.md §3), which places by rank and does not know about pinned nodes, container margins or measured text drift. 05 §3 names VPSC from WebCola for the overlap pass. The staged pre-commit ladder is near its budget (446 s of 480 s when this was written, ADR-0163; the budget is now 600 s, ADR-0165), so each dependency has a cost.

## Decision Drivers

- FR-LAY-004: zero overlap among laid-out boxes, pinned boxes never moved. FR-LAY-008 and NFR-REL-005: byte-equal output.
- NFR-LIC-002: permissive licences in core. NFR-SIZE-005: no layout code in saved files; layout stays out of the player.
- Ladder budget: a new package changes `pnpm-lock.yaml`, which re-runs the install-dependent steps and requires a budget re-record.
- The post-pass must be small enough to review and to cover with a property test.

## Considered Options

1. **VPSC from WebCola (`webcola` 3.4.0, MIT) as the overlap pass.** The projection solver the research recommends, with constraints for M17. It brings four `d3-*` v1 packages (`d3-dispatch`, `d3-drag`, `d3-timer`, `d3-shape`) and about 2 MB unpacked for one function we would use; fixed (pinned) variables need careful weighting; its output must still be quantized and its iteration order checked for determinism.
2. **An own two-stage sweep.** Stage 1 separates overlapping pairs along the axis of least penetration for a fixed number of passes, in canonical order, moving only unpinned boxes. Stage 2 relocates any unpinned box that still overlaps, in canonical order, to the nearest free position found by scanning a deterministic candidate list around its place (pinned and already placed boxes are obstacles); if the list is exhausted, the box is appended at a fixed step beyond the bounding box of every box, a position that is always free. Stage 2 makes the guarantee below hold whatever stage 1 left. No dependency, about 150 lines, easy to property-test.
3. **Only dagre's own separation** (`nodesep`, `ranksep`). Cannot honour pins or containers and gives no guarantee after pins move boxes.

## Decision Outcome

**Overlap: option 2.** The `overlap` post-pass is the own sweep above, with a 1 px margin between every pair of boxes, pinned ones included, for text-measure drift (the risk row of M13.md). **The guarantee** (FR-LAY-004): after the pass, no unpinned box overlaps or comes within 1 px of any other box. Two pinned boxes that overlap each other are the document's own placement: they never move, they are not part of the guarantee, and they are counted in `metrics.overlaps` so a diagnostic can name them. The frame is a size hint, not a constraint: a dense or small frame makes the layout extend past it rather than overlap. **Amends** ADR-0005 (which names VPSC for the overlap pass) and 05-layout-and-routing.md §3 and §6 (M13.22 updates both). No VPSC dependency in M13. VPSC returns with M17, where the `constrained` layout needs constraints (align, order, within); WebCola is added then, behind its own ADR, as a lazy worker chunk.

**Layered: `@dagrejs/dagre` 3.1.1 (MIT, with `@dagrejs/graphlib` 4.0.5, MIT)**, as 05 §3 and ADR-0005 already name. Licence check: both are MIT, so `check-licenses` passes without an allow-list entry. It is a dependency of `packages/layout` only, never of the player (the player core size limit and the NFR-SIZE-005 test guard that). The version is pinned in the pnpm catalog. dagre uses no randomness; determinism is kept by feeding it nodes and edges in canonical order and reading results back in the same order.

**Ladder cost.** Adding the two packages changes the lockfile once (M13.8). The cost is **unmeasured**: a lockfile change re-runs the install-dependent steps, and nothing here times it. M13.8 measures it, re-records the budget in the same commit, and stops for a human decision if the staged worst case then leaves less than 15 s of the current `PRECOMMIT_BUDGET_MS` (900 s, ADR-0166).

**Determinism rules** (every algorithm and post-pass):
1. **PRNG**: `sfc32`, own code in `packages/layout`. The integer seed expands to sfc32's four 32-bit words by four successive `splitmix32` outputs starting at `seed | 0`, then twelve discarded draws. `ctx.rng` satisfies the `Random` port (`next(): number` in [0, 1)). `Math.random` is forbidden (layering rule). Algorithms get it as `ctx.rng` (ADR-0033).
2. **Ordering**: nodes and edges are sorted by (`order`, id) before any algorithm or library call (ADR-0033's canonical input); no `Map` or `Set` iteration order and no object key order reaches the output.
3. **Fixed iteration counts**: no time budget, no convergence test on floating-point error. The overlap sweep runs 8 passes of stage 1; stage 2 is bounded by the number of boxes times a fixed candidate list plus one append.
4. **Quantization**: the `snap` post-pass rounds the position (`x`, `y`) of every unpinned box to 0.5 px with `q(v) = Math.round(v * 2) / 2 + 0` (halves toward +infinity, `-0` normalized to `0`); sizes and pinned boxes keep their exact values. Rounding moves an edge by at most 0.25 px, and the overlap pass leaves at least 1 px between boxes, so at least 0.5 px remains after `snap`: it needs no repair step and cannot break the guarantee.
5. **No hidden inputs**: no clock, no environment, no locale; text sizes come only through `ctx.measure` (and their hash through `fontHash`, ADR-0033).

### Consequences

- Good: no new dependency for the overlap guarantee; the property "overlap count is 0 and pinned boxes unchanged" holds by construction and is tested over random graphs.
- Good: the ladder takes one dependency change (dagre), estimated and bounded.
- Bad: the own sweep moves boxes less gracefully than VPSC (it may displace a box farther than an optimal projection would). The `layered` golden fixtures record crossings and displacement as a scorecard. The pass takes an option `preferAxis` (`'x' | 'y'`, default: least penetration); `layered` sets it to the axis along which the boxes of one rank are spread, so siblings slide apart instead of crossing ranks.
- Bad: M17 adds WebCola later for constraints, so two overlap mechanisms may exist for a while; the own sweep stays the default and the FR-LAY-004 guarantee.

### Confirmation

`no-overlap.prop.test.ts` over random graphs with pins (no unpinned box overlaps or touches any other within 1 px; pinned boxes unchanged; pinned-versus-pinned overlaps counted, not fixed; run twice equal); `snap` and `pins` unit tests; `check-licenses` and `check-budget` green in M13.8's commit; `check-layering` (no `Math.random`, no DOM in `packages/layout`).

## More Information

ADR-0005, ADR-0033, ADR-0163; 05-layout-and-routing.md §3 and §6; research/02 §4.

## Amendments

- Amendment 2026-10-15 (M13.22): the `preferAxis` option of the overlap pass exists (`LayoutRequest.overlap.preferAxis`), but `layered` does not set it in v1: the pipeline passes the caller's overlap options unchanged. Siblings of a rank that overlap after dagre are separated along the axis of least penetration, as for any algorithm. Setting it from the algorithm is left to a later milestone if the `layered` scorecard asks for it. No other decision changes.
