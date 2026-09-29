---
status: accepted
date: 2026-09-29
decision-makers: Fluxion maintainers (M5.33, delegated to the driver)
---

# ADR-0018 — Shape text fitting: an optional `textFit` on shapes, pure layout in core

## Context and Problem Statement

FR-SHP-006 asks for text inside shapes with padding, horizontal and vertical alignment, auto-fit
modes (none, shrink the text, grow the shape) and overflow handling. The schema has none of it:
alignment exists (`style.font.align`, `verticalAlign`), but a shape has no padding, no fit mode, no
minimum size and no overflow rule, and `ShapeDef.textRegions` are fixed fractions, so a region
cannot follow a param (the callout's body shrinks as its `tail` grows: M5.11 review). Where do the
settings live, who computes a fit, and how does a view stay pure (04 §2) while "grow" changes an
element's height?

## Decision Drivers

- Views are pure: the same record draws the same markup in every mode; they never write the store.
- One measurement path for editor, player, layout and exporters (FR-TXT-002): the core
  `TextMeasurer` port, with a browser implementation and fixed metrics in tests.
- Minimal format growth: optional fields with defaults; unknown fields keep round-tripping.
- The format is unreleased: 1.0 ships first in M11 (roadmap), and no document exists outside the
  repo's fixtures.

## Considered Options

- **A. `textFit` on the shape element**, the fit computed in core from the measurer; `grow` applied
  by whoever edits the text (a command), the view drawing what the record holds.
- **B. Fit settings in `style.font`**: styles cascade from themes, but a fit mode is a property of
  one element's box, not of its look, and a theme default of `grow` would move boxes on a theme
  switch.
- **C. The view grows the shape as it draws**: impure; connectors, anchors and layout would read a
  height the view never wrote back.

## Decision Outcome

Chosen option **A**.

1. **Schema**: a shape element gains an optional `textFit`:
   `{ mode?: 'none' | 'shrink' | 'grow', padding?: number, minSize?: number, overflow?: 'visible' | 'clip' }`
   (defaults: `none`, 8 px, 8 px, `visible`). Alignment stays in `style.font`.
2. **Text regions**: `ShapeDef.textRegions[]` fields may be a number (a fraction of the box, as
   before) or an expression string (ADR-0016) evaluating to that fraction, with the outline's names;
   validation checks them like the outline's expressions. A shape without regions uses its whole box.
3. **Core (pure)**: `wrapText` breaks paragraphs into lines by words with the `TextMeasurer`
   (a word wider than the line stands alone); `fitText` returns, for a region, padding and fit mode,
   the font size to draw at (`shrink`: the largest size from the style's down to `minSize` whose
   lines fit the padded region), the lines, and the box height the text needs (`grow`).
4. **Grow is a write, not a view**: a view never changes the record. The command that edits a
   shape's text (M7) or the host applies `fitText`'s height to the element; the view draws the
   stored height. A view with `shrink` computes its font size from the measurer it is given (the
   browser measurer from M5.14); without one (server rendering) it draws the style's size.
5. **Versioning**: the file format is unreleased, so fields added before the first release (M11)
   extend version 1.0 without a migration. The schema's round-trip and validation tests land in the
   same commit, and the shapes-gallery fixture (M5.24) uses the field; no JSON Schema is generated
   before M10. From the first release, contracts.md §4 rules 7 to 10 apply unchanged.

### Consequences

- Good, because views stay pure and every host measures the same way.
- Good, because a region can follow its shape's params (the callout).
- Bad, because server-rendered pages draw `shrink` text at the style's size until a measurer exists
  for Node (fontkit, M7).

### Confirmation

Schema round-trip and validation tests for `textFit`; core tests of `wrapText` and `fitText` with
the fixed-metrics measurer; the T1 tests of M5.14 (grow-shape height equals the measured text within
1 px; shrink keeps the bounds and the font at or above its minimum).

## More Information

FR-SHP-006, FR-TXT-002, 02-document-model §2, 04 §2.4, ADR-0016 (expressions), contracts.md §4.
