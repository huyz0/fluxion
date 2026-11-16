---
status: accepted
date: 2026-11-15
decision-makers: harness (M19.26; within FR-SHP-014, FR-SCR-005, FR-ARR-006, FR-DSL-001, FR-DSL-002; no requirement changes; the FluxScript change is additive)
---

# ADR-0219 — FluxScript keys for master screens, placeholders, tables and frames

## Context and Problem Statement

Schema 1.8 (ADR-0054) added master screens (`screen.role`, `screen.masterId`), placeholders (`element.placeholder`, `element.fills`) and
the `table` element; frames (`kind: 'frame'`, ADR-0052) exist since 1.0. M19.22–M19.24 draw and edit them. FluxScript, the authoring
language (ADR-0030), can write none of them, so a generated deck cannot share a master, hold a table or clip a frame, and the decompiler
leaves such elements out (`# kept: N records not shown`). The key table is a contract (the compiler, the JSON schema, the editor's
highlighting and completion, the cheat sheet), so new keys are decided here.

## Decision Drivers

- A file written for `flux: 1` keeps compiling to the same document: the change is additive.
- Each key names what the document stores, so the decompiler writes it back and the round trip holds (FR-DSL-002).
- Few tokens for an AI author; a table is written as rows of text, not as cell keys.
- Placement stays the engine's: a table is a node; a frame is a pinned container whose members are laid out inside its box.

## Considered Options

1. **Tables as `cells: { "r:c": … }`, as stored.** Exact, but an author must count keys and widths for every cell.
2. **Tables as `rows:` of cell lists (chosen).** `rows: [[Plan, Cost], [Build, 4 weeks]]`: what a person reads; spans are a cell map, a
   covered cell is `null`.
3. **Frames as a new `frames:` section.** A second container list with its own pointers, beside `groups:`.
4. **Frames as a group with `frame: true` (chosen).** One containment list (ADR-0052 shares the model with groups); `contains`, `label`,
   `style` and `layout` keep their meaning, and `pin` and `clip` are the frame's own.
5. **Masters as a `masters:` top-level list.** A master is a screen (ADR-0054 option b), so it is written as one: `role: master`.

## Decision Outcome

Options 2, 4 and 5.

- **Screen:** `role: master` makes the screen a master (any other value is `FLX_SCHEMA_INVALID`); `master: <screen id>` names the master
  it draws behind it (`masterId`). Resolve reports `FLX_REF_MISSING` when the id names no screen of the file, or a screen without
  `role: master`. The master rules that are drawing rules (one level, same size, ADR-0054) stay drawing rules: the problems panel
  reports them, the compiler does not.
- **Node:** `placeholder: <name>` sets `element.placeholder` (meaningful on a master's node); `fills: <slug>` sets `element.fills` to
  the node of that slug, which resolve requires to be a node with a `placeholder` on the screen's master (`FLX_REF_MISSING` otherwise).
- **Table node:** `table: { rows, widths?, heights?, tableStyle? }` is a node's content, in place of `shape`, `text` or `label`
  (writing both is `FLX_SCHEMA_INVALID`). `rows` is a list of rows, each a list of cells; a cell is text, `null` (no cell: empty, or
  covered by a span), or `{ text?, rowSpan?, colSpan? }`. The column count is the longest row (or `widths`' length); `widths` and
  `heights` are the column and row weights (default 1 each, positive). It compiles to `kind: 'table'` with `rows`, `cols` and `cells`
  keyed `r:c`; schema validation refuses overlapping spans and grids past 500 × 500. An unpinned table is `TABLE_CELL` (160 × 48) per
  cell, laid out like any node. `tone`, `style`, `pin`, `alt`, `placeholder` and `fills` keep their node meaning.
- **Frame:** a group with `frame: true` compiles to `kind: 'frame'`; it needs `pin: { x, y, w, h }` (a frame's box is its own, never
  fitted to its members: ADR-0052), and takes `clip: true | false` (absent: the frame's default, clipped). Its members are laid out
  inside its box by its `layout` (else the default), pinned members stay where they are, and what falls outside is clipped when drawn.
  `pin` or `clip` on a group without `frame: true` is `FLX_SCHEMA_INVALID`.
- **Decompile (v0)** writes all of these back: `role`, `master`, `placeholder`, `fills`, a table as `rows` (every row its full width,
  `null` where no cell is; `widths` and `heights` only when a weight is not 1), a frame as a group with `frame: true`, its `pin` and,
  when the record has one, `clip`. FluxScript has no key for a frame's `padding`, turn or flips, so a frame with any of them
  is left out of the subset, like any record the subset cannot say (M19.26 r1 follow-up, noted in M19.30). A table cell with a style, or rich text the subset cannot say, leaves the table out as before.
- The key table (`fluxScriptKeys`), the JSON schema (`specs/schema/fluxscript.schema.json`), the TextMate grammar, the cheat sheet and the
  authoring guide list the new keys.
- Not covered: `hideMasterElements`, region `texts` and `icons` (FR-SHP-007) and the edit language's patch ops; M20 row 19 holds them (M19 cp6 F2).

## Consequences

- Good: a FluxScript file can share a master, hold a table and clip a frame, and `examples/dsl/masters-tables.flux.yaml` is drawn as a
  golden and joins the edit/present parity examples.
- Neutral: `NodeAst`, `GroupAst` and `ScreenAst` gain optional fields, so the dsl API report changes.
- Bad: a table's row lists grow with its width; a 500-column table is a long line (the editor's table tools stay the way to build one).
