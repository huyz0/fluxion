---
status: accepted
date: 2026-10-17
decision-makers: harness (M16.2; within FR-ANC-003 to FR-ANC-007; no requirement changes; the schema change is a minor bump with a migration)
---

# ADR-0043 — Anchor model and auto-selection: four anchor kinds, scored choice with hysteresis, distribution along a side

## Context and Problem Statement

Today an `AnchorDef` is a named point (`name`, `x`, `y`, `dir`, `role`, `max`). FR-ANC-003 asks for fixed, side, perimeter and center anchors with limits and roles; FR-ANC-004 for an `auto` anchor that picks the best side after layout; FR-ANC-007 for several connectors on one side to spread out. The choice must not flicker while the user drags.

## Decision Drivers

- A saved document keeps opening: the change is additive.
- The choice is a pure function of geometry and options, so it is testable and deterministic.
- No visual jumps during a drag.

## Considered Options

1. **Keep named points only; model sides as sets of points.** No schema change, but a side with N connectors needs N pre-made points.
2. **Add a `kind` to `AnchorDef` (chosen).** `fixed` (today's behaviour and the default), `side` (a side of the box, with a position along it), `perimeter` (a fraction of the outline's length) and `center`.
3. **Compute everything in the router and keep the schema as is.** Hides the user's intent from the file and from other tools.

## Decision Outcome

Option 2.

**Schema.** `AnchorDef` gains optional `kind` (`fixed` | `side` | `perimeter` | `center`, default `fixed`), plus `side` (`n`|`e`|`s`|`w`) for `side` and `t` (0 to 1) for `side` and `perimeter`. `x` and `y` stay required for `fixed` (and for a def without `kind`) and are optional for the other kinds. Field names stay as the schema has them today, with no rename: `dir` is the direction, `role` the role and `max` the requirement's `maxConnections`, and they apply to every kind. This is a minor schema bump (1.3 to 1.4): a document without `kind` reads as `fixed`, and the migration changes nothing but the version.

**Kinds.**

- `fixed`: the point (`x`, `y`) in the box; `dir` is the declared direction.
- `side`: the point at fraction `t` (default 0.5) along side `side`; `dir` defaults to that side's outward normal.
- `center`: the box centre; `dir` points toward the other end.
- `perimeter`: a FLOATING anchor. It lands on the outline where the ray from the element centre toward the other end crosses it (the same projection as the floating anchor), and it is listed as a kind so it carries a name, a role and a limit. `t` is optional: when absent the anchor floats; when present it pins the point at that fixed fraction of the outline's length (measured along the outline path from its start; the box outline starts at the top-left corner and runs clockwise) instead of projecting.

**Resolution.** Each kind resolves to a point and an outward normal in the element's box, mapped through its placement as today (`anchor.ts`).

**Auto selection.** `auto` generates the four side midpoints (plus outline corners for diamonds and ellipses) and the floating projection. A candidate pair costs the weights of 05-layout-and-routing.md §8 (length, bends, pointing away, crowding, role mismatch). The weights are router options with those defaults. A hysteresis term of about 15 % of the current best cost is added to every candidate other than the previous choice, so a side changes only when another is clearly better. While a drag is in progress the choice is frozen, and it is re-scored on drop. An algorithm-assigned side (for example from ELK) gets a strong bonus.

**Distribution and spill.** Connectors on one side are sorted by the far end's coordinate and spaced evenly. When a side holds `max` connectors, the next one spills to the adjacent side.

### Consequences

- Good: the user's intent is in the file; the pure selector is easy to test on fixtures.
- Good: hysteresis plus freeze-during-drag removes flicker.
- Bad: the weights are guesses until tuned on fixtures; they are options so a pack can change them.
- Bad: one more minor schema version; a fixture round-trip and a migration test are required (check-api, format fixtures).

### Confirmation

M16.4 (`anchors.test.ts`, migration fixture), M16.8 (`auto-anchor.test.ts`, crossings metric 0 on the `auto-anchors` fixtures), M16.9 (distribution and spill), M16.17 (editor snap and custom anchors).

### Amendment (M16.34, 2026-10-20): a floating end carries its side's normal

A floating end's `dir` points from the element's centre at the other end, so the orthogonal routers, which snap it to the nearer axis, could leave a box by its bottom side horizontally and run along that side. A floating end now also carries `normal`, the outward normal of the box side the ray leaves by (the vertical sides when the ray's horizontal share of the half-width is the larger, mapped through the placement), on `ResolvedAnchor` and `RouteEnd`; the orthogonal router and the global pass leave and enter along it. It is additive: `dir` is unchanged, so curved routes keep their tangents, and a router that ignores `normal` routes as before. Other anchor kinds carry no `normal` (a side or fixed anchor's `dir` is already the side's).

## More Information

05-layout-and-routing.md §8, FR-ANC-003 to FR-ANC-007, ADR-0042.
