---
status: accepted
date: 2026-11-14
decision-makers: harness (M19.8; within FR-SCR-005, FR-SHP-007, FR-SHP-008, FR-SHP-009, FR-SHP-010, FR-SHP-014; additive minor, no major change)
---

# ADR-0054 — Schema 1.8: master screens and placeholders, the `table` element, text regions and icon slots, aspect and selection locks, the path field

## Context and Problem Statement

M19 needs fields the 1.7 schema lacks or leaves untyped:

- **Masters (FR-SCR-005).** `screen.masterId` exists since 1.0 (a reference to a screen) but nothing says which screens are
  masters, what a screen inherits, how a placeholder is filled, or what overrides what.
- **Tables (FR-SHP-014).** `table` is "planned for R3": today an unknown kind, kept with only its envelope checked.
- **Text regions and icon slots (FR-SHP-007).** A `ShapeDef` may declare `textRegions` (name and fractional box,
  `packages/core/src/shape/shape-def.ts`), but an element holds one `text`, so only one region can carry text; icon slots do not
  exist.
- **Locks (FR-SHP-008).** `locks` is a loose object typing `position`, `size`, `rotation`, `delete`, `edit`; FR-SHP-008 also asks
  for aspect ratio and selection.
- **Flips (FR-SHP-009).** `transform.flipX`/`flipY` exist since 1.0 (`transformSchema`). Nothing to add.
- **Path shapes (FR-SHP-010/011).** ADR-0053 stores boolean results as `defId: 'core:path'` with a `path` field.

## Decision Drivers

- One additive minor, 1.7 → 1.8 (contracts.md rule 6): a 1.7 file means the same in 1.8; a 1.8 file's new fields are optional.
- Masters render through the same `ScreenView` path in edit, present and export (M19 risk table; ADR-0015).
- A field per concern, readable by the DSL decompiler (M19.26) and the MCP/CLI JSON (no hidden encodings).

## Considered Options

- **Masters**: (a) a separate `master` record type; (b) a screen with `role: 'master'` (chosen). (a) duplicates every screen field
  (size, background, layout, theme) and every screen tool; (b) reuses them, and `masterId` already points at a screen.
- **Placeholders**: (a) placeholders as a separate record; (b) a `placeholder` name on a master's element, filled by a screen
  element naming it (chosen): one record per thing drawn, and the layers panel shows it.
- **Table cells**: (a) one record per cell; (b) cells inside the table element (chosen). Tables are edited as a unit (add a row
  shifts every cell), and a whole-table transaction keeps undo to one step without hundreds of records; a 50 × 20 table stays
  well under the record-size budget.
- **Region text**: (a) one element per region (a group of texts); (b) a `texts` map on the element keyed by region name (chosen):
  the card stays one shape, its anchors and connectors unchanged.

## Decision Outcome

### Masters and placeholders

- `screen.role?: 'master'`. A master is not a slide: present mode, navigation, export page lists and the navigator's play order
  skip it; the editor lists masters in their own section of the navigator.
- `screen.masterId` on an ordinary screen names a master. The screen draws, bottom to top: the master's background (unless the
  screen sets its own `background`), the master's elements that are not placeholders and not filled, then the screen's own
  elements. `screen.hideMasterElements?: boolean` hides the master's elements (not its background) on that screen.
- A master's element may carry `placeholder?: string`. A screen element with `fills?: <master element id>` takes that
  placeholder's place on that screen: the placeholder is not drawn there, and the filling element keeps its own transform (the
  editor creates it at the placeholder's box with the placeholder's style). An unfilled placeholder draws in edit mode only
  (dashed, its name as hint) and nowhere in present or export.
- Precedence: the screen's own fields override the master's (background, theme); an element's style resolves as today, with no
  inheritance from the placeholder after creation.
- **Master rules are drawing rules, not file validity.** Referential validation checks that `masterId` names a screen (as
  today) and, new in 1.8, that `fills` names an element and an `icons` entry's `assetId` names an asset; nothing else about
  masters is a validation error. Deletion follows the hooks' existing policy (`packages/core/src/hooks.ts`): `fills` is an
  optional reference, so a new built-in entry `['element', 'fills', 'clear']` clears it when its placeholder goes (deleting a
  master screen deletes its elements and clears its dependants' `masterId` and their elements' `fills`, and the transaction
  commits); an icon's asset is a used asset like any other, so deleting an asset an icon slot still uses is refused by
  validation (no hook guesses a replacement), and what counts as a used asset (`usedAssetIds` in
  `packages/format/src/asset-store.ts`, whose fixed `ASSET_FIELDS` list cannot name a varying slot) also walks every `icons`
  entry's `assetId`, so a save writes its bytes and the asset manager never lists it as unused. Both paths join `REFERENCE_PATHS`
  (`packages/core/src/transaction.ts`): `['fills']` and `['icons']` (the whole map, since slot names vary), so a patch that
  changes either is re-checked. A master applies to a screen only when the target has
  `role: 'master'`, has no `masterId` of its own (one level), and both are `kind: 'fixed'` with the same `size` (an unbounded
  canvas has no frame to draw a master behind). When any of these fails, the screen draws without the master, and the problems
  panel reports why. A `fills` that names no placeholder of the screen's applied master leaves the element drawn as an ordinary
  element (reported); two placeholders with one name on a master are reported, and both stay fillable by id. The editor's
  commands never create these states (setting a master takes the master's size and refuses a chain or an infinite screen);
  files edited by hand, MCP or a 1.7 writer can hold them and still open.
- Master elements are not copied: editing a master updates every dependent screen (FR-SCR-005), as a derived view.

### The `table` element

`kind: 'table'`, boxed (`transform`, `text?` unused), a leaf (it joins `CORE_LEAVES` in `packages/schema/src/references.ts`:
its content lives in `cells`, so no element can name it as `parentId`), with:

- `rows: { h: number }[]` and `cols: { w: number }[]`, weights (> 0) whose share of the transform's height and width sizes each
  row and column, so resizing the table scales them; at least one and at most 500 of each, so the grid check (an occupancy
  array over rows × cols that stops at the first overlap) does bounded work on a hostile file (security.md §1; M19.9 review F1).
- `cells: { [key: "r:c"]: { text?: RichTextDoc; rowSpan?: number; colSpan?: number; style?: Style } }`, zero-based keys. A cell
  with spans covers the cells to its right and below; a covered key must be absent; spans stay inside the grid. Validation refuses
  overlaps and out-of-range keys.
- `tableStyle?: string`, a name in the theme's `tableStyles`; theme records gain `tableStyles?: { [name]: { header?, band?,
  border?, cell? } }` (each a style fragment), and the built-in themes ship three: `plain`, `banded`, `grid`. Cell style resolves
  `cell.style` → table style part (header row, banded row, body) → theme defaults.
- No new style-bearing field holds an asset: a cell's `style` and each `tableStyles` part refuse an image paint (`{ type: 'image' }`,
  `packages/schema/src/paint.ts`) in every paint slot, so the only new references in 1.8 are `fills` and `icons` (below) and the
  fixed-path asset readers (`ASSET_FIELDS`, `checkReferences`, `REFERENCE_PATHS`) need no `cells` walk. A 1.7 `table` with an
  image-filled cell does not validate as a 1.8 table and becomes `legacy-table` (migration, below).

### Text regions and icon slots

- `ShapeDef.iconSlots?: { name, x, y, w, h }[]` (fractions of the box, exactly as `textRegions`). The definition schema is closed
  (`z.strictObject`) and definitions travel inside files (ADR-0048 saved subsets) and packs, so this is a shape-pack format
  minor, not part of the document's 1.8: the pack and subset envelopes gain `formatVersion: '1.3'`, and a definition with
  `iconSlots` is refused under any earlier envelope version (as category names are before 1.2). Writers emit 1.3 only when a
  definition they write uses `iconSlots`, so a file or pack without icon slots stays readable by older readers; an older reader
  refuses a 1.3 envelope by its version with a clear diagnostic instead of dropping a definition.
- Element `texts?: { [regionName]: RichTextDoc }` holds the text of every region but the first; the first region's text stays in
  `text`, so a 1.7 file's single text is the first region's and every reader of `text` keeps working. A `texts` key naming the
  first region is never drawn: `text` wins, the problems panel reports the key, and the DSL decompiler and MCP omit it, so
  every reader picks the same text.
- Element `icons?: { [slotName]: { defId: string } | { assetId: string } }` fills icon slots with a shape definition (an icon pack
  entry) or an image asset.
- A name not declared by the element's definition is kept (loose) but not drawn; the problems panel reports it.

### Locks

`locks` gains typed `aspect?: boolean` (resizes keep the aspect ratio) and `select?: boolean` (the element cannot be selected by
click or marquee on the canvas; the layers panel can still select it). The loose object stays loose.

### Path

`path?: { d: string; w: number; h: number; fillRule?: 'nonzero' | 'evenodd' }` on a `shape` (ADR-0053); meaningful with
`defId: 'core:path'`, ignored with a warning otherwise.

### The 1.7 → 1.8 migration

Additive: it sets `schemaVersion: '1.8'` and, since records are loose, removes from a 1.7 file any of the new fields that does not
conform (as the 1.6 → 1.7 step did): a non-conforming `role`, `hideMasterElements`, `placeholder`, `fills`, `texts`, `icons`,
`locks.aspect`/`select`, `path`, `tableStyle`, `tableStyles`. A 1.7 element of kind `table` that does not validate as a 1.8 table,
or that some element names as its `parentId` (a 1.7 unknown kind could contain elements; a 1.8 table cannot), becomes kind
`legacy-table`: not a core kind and not a qualified name (`schemaForRecord` reads `<ns>:<name>` as a plugin kind,
which needs a `transform`), so it keeps the envelope-only unknown-kind schema a 1.7 `table` had and is shown as a placeholder
(ADR-0007); nothing is lost and the file stays valid, with or without a `transform`. Because the `fills` and icon-asset checks are new, the step also removes a `fills` whose target is missing or not an element and an
`icons` entry whose `assetId` is missing or not an asset (both were loose and meant nothing in 1.7). The step changes no `masterId`: it
was a typed field since 1.0 that no renderer drew, so a 1.7 `masterId` naming an ordinary screen, a size mismatch or a chain
still draws nothing in 1.8 (the master rules above) and is reported; one that meets every rule (a loose conforming
`role: 'master'` on the target) starts drawing the master, the meaning 1.0 documented for the field. So no 1.7 file fails
validation in 1.8 and none loses a field that conforms. Fixture: `packages/schema/src/__fixtures__/v1.8/document.flux.json` plus a 1.7 input with each case.

## Consequences

- Good: one additive minor; masters reuse screens; tables are one record and one undo step; regions keep `text` compatible.
- Good: every new field is plain JSON the DSL and MCP can read and write.
- Bad: large tables make one large record (diffs and collaboration merge at the record level); acceptable for R3, revisit with
  collaboration (M32) if needed.
- Bad: a master's size fixes its screens' size; a screen that needs another size needs another master.
- Bad: a hand-edited file can name a master that does not apply; it opens, draws without it, and the problems panel says why.

## Confirmation

- M19.9: `migrate.test.ts` case '1.7→1.8' (each removal; the `legacy-table` rename of a table with and of one without a
  `transform` and of a valid table with a child, and of a table with an image-filled cell, all valid after; a dangling or wrong-type `fills` and icon `assetId` removed; a `masterId` to a non-master, with a size mismatch, on an infinite screen and in a chain kept as is; a
  conforming file unchanged but its version); JSON Schema and api report regenerated; validation refuses table overlaps,
  out-of-range cells and an image paint in a cell style or a `tableStyles` part; `core/masters.test.ts` (M19.22) resolves which master applies: none for a non-master target, a chain, a
  size mismatch or an infinite screen, each with its problem, and a `fills` naming no placeholder of the applied master drawn as
  an ordinary element.
- M19.34 (shape-pack format 1.3, split from M19.9): a definition with `iconSlots` parses under a 1.3 envelope, is refused under
  1.2, and a 1.2 reader refuses the 1.3 envelope by version.
- M19.9 core cases (`packages/core/src/hooks.test.ts`, `reference-paths.test.ts`): deleting a filled placeholder clears
  `fills`; deleting a master screen clears its dependants' `masterId` and their elements' `fills` and commits; deleting an asset
  only an icon slot uses is refused; a patch pointing `fills` or an icon `assetId` at a missing record is refused by the
  incremental check; `REFERENCE_PATHS` lists both.
- M19.9 format case (`packages/format/src/asset-store.test.ts`): an asset used only by an icon slot is in `usedAssetIds` and
  `referencedAssetHashes`, so a save writes it.
- M19.20–M19.23 and M19.17: render and e2e tests of tables, masters and regions; m19-complete's schema, table, masters and region legs.
- M19.17: a `texts` key naming the first region is reported and not drawn.

## Links

- FR-SCR-005, FR-SHP-007, FR-SHP-008, FR-SHP-009, FR-SHP-010, FR-SHP-014; ADR-0007 (unknown kinds), ADR-0015 (one render path),
  ADR-0047 (previous minor), ADR-0053 (path field); 02-document-model.
