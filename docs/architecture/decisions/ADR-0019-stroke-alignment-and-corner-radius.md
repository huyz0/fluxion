---
status: accepted
date: 2026-09-29
decision-makers: Fluxion maintainers (M5.28, delegated to the driver)
---

# ADR-0019 — Stroke alignment and corner radius on any outline

## Context and Problem Statement

FR-SHP-004 lists a stroke `align` (centre, inside, outside) and a `corner radius` for shapes. SVG
strokes are centred on the path and SVG has no radius for a path, while shape outlines are arbitrary
cubic paths from definitions (ADR-0016). The schema's `Stroke` has no `align`; `Style.radius` exists
but nothing draws it. Connectors need rounded bends too (M5.21, FR-CON-005). How are both drawn, and
where does the rounding live?

## Decision Drivers

- One outline for every consumer (ADR-0016): whatever the view draws, hit-testing and anchors read
  the same path.
- Pure geometry: rounding is computed, testable and shared with connector routes.
- Static output: no script, the same markup in SSR and the browser (ADR-0015).

## Considered Options

- **A. Emulate alignment with SVG clipping, round straight corners in geometry.**
- **B. Offset the outline** (inside: inset path; outside: outset path) with a stroke of the width: exact,
  but offsetting cubic paths needs a robust offset algorithm that geometry does not have yet.
- **C. Radius as a definition param only** (as `basic:rounded-rect` does): leaves every other shape
  unrounded and ignores the style field.

## Decision Outcome

Chosen option **A**.

1. **Schema**: `Stroke` gains an optional `align: 'center' | 'inside' | 'outside'` (default `center`),
   resolved by theme like the other stroke fields. Under ADR-0018 item 5 the addition extends the
   unreleased format 1.0 without a migration.
2. **Drawing alignment**: `inside` draws the stroke at twice its width clipped to the outline (a clip
   path of the outline itself), so only its inner half shows; `outside` draws it at twice its width
   under the fill, masked so the half inside the outline is hidden. `center` is SVG's own. An open
   outline has no inside: it is always stroked centred.
3. **Corner radius**: geometry's `roundCorners(commands, radius)` replaces each corner between two
   straight segments with a circular arc of radius `min(radius, half of each segment)`, as cubics;
   curved joins stay as they are. The shape view draws the rounded outline and stroke; hit-testing
   and anchors keep the definition's outline (a radius is a style, not geometry of the element).
   Connectors round their bends with the same function (M5.21).

### Consequences

- Good, because alignment works on any outline with no offset algorithm.
- Good, because rounding is pure, tested once and shared with connectors.
- Bad, because a rounded corner's hit area is the sharp corner's, up to `radius` too generous; an
  offsetting geometry (later) can replace both emulations without a format change.

### Confirmation

T1: inside and outside strokes draw inside and outside the outline (pixel probes); geometry tests of
`roundCorners`; the M5.21 connector test of rounded bends.

## More Information

FR-SHP-004, FR-CON-005, ADR-0015, ADR-0016, ADR-0018 (versioning before the first release).
