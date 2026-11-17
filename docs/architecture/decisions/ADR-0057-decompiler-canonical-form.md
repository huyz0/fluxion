---
status: accepted
date: 2026-11-17
decision-makers: harness (M20.4, under Huy's 2026-11-05T11:04:52Z delegation), subject to independent review
---

# ADR-0057 — Decompiler canonical form and the FluxScript keys ADR-0219 left out

Amends ADR-0219 (its decompile paragraph, a frame's `pin`, "Not covered"), ADR-0035 (node payloads, `add`, `update`), ADR-0030
(`raw` moves from deferred to compiled; new keys below), ADR-0031 (salt precedence), ADR-0032 (`# kept:` comments) and one
sentence of ADR-0054 (below).

## Context and Problem Statement

FR-DSL-008 asks for a decompiler that writes every document, lossy parts as raw JSON escape blocks, with
`compile(decompile(doc))` idempotent. The v0 decompiler (`packages/dsl/src/decompile/`) writes the subset it can say and
leaves the rest out (`# kept: N records not shown`); its round trip holds only for documents a compile made, compiled into
themselves as base. Studio documents break it: `newDocument` writes a document record with no title, theme, `themeId` or
`source` and a screen with `size`; tools write elements with random ids (`newId()`), no `placement`, no `semantic`, indexes from
`keyBetween`; the text tool writes `textFit: { mode: 'grow' }`; the connector tool writes bindings with random ids. Some records
carry fields no key says (locks, turns, marks). ADR-0219 left `hideMasterElements`, region `texts`, icon slots and patch ops for
masters, placeholders, tables and frames to M20 (plan row 19). The key table, the patch format and the decompiler's output are
contracts (contracts.md rule 6), so the canonical form is decided here, before M20.16, M20.17 and M20.18 code it.

## Decision Drivers

- FR-DSL-008: no record is dropped; idempotence is a byte-level property a test checks without a base document.
- FR-DSL-002 / NFR-AI-003: the text stays readable and cheap; documents v0 wrote fully read the same and cost no more tokens.
- Raw is a measured fallback: a key emitter that sends records to raw fails tests.
- FR-SCR-005, FR-SHP-007, FR-SHP-014: masters, region texts, icon slots, tables and frames are written as keys, not raw.
- FR-AI-003: the edit language (ADR-0035) edits what the authoring language writes, with one vocabulary.
- `flux: 1` stays additive: every file that compiles today compiles to the same document, except a screen `raw:` key, which
  ADR-0030 reserved for this and deferred (no example or fixture in the repo uses it).

## Considered Options

1. **Keys plus a per-field overlay** (`extra: { locks: … }` on a node). Cheapest for a node with one odd field, but a key and a
   field can disagree (`pin` vs `transform.x`), and the overlay is a second, schema-shaped language inside the first.
2. **Keys plus whole-record raw, chosen by a check compile, with raw counted (chosen).** A record is written with keys only when
   they compile back to its exact bytes; otherwise whole in `raw:`. Exact by construction; the raw count keeps it honest.
3. **Equivalence modulo ids and layout.** Easy, but ids are referenced from outside a screen (timelines, comments,
   interactions), so a "round trip" that renames them damages the file.

Ids: per-record `record:`/`bindings:` keys (measured: a node 12 → 54 tokens, an edge 6 → 79) or one trailing `ids:` map listing
only ids the compiler would not derive (chosen: a compiled document has none, and the body stays as v0 writes it).
Patch ops: new ops per concept (`setMaster`, `setCell`, `addFrame`), or the nine ops of ADR-0035 with the new keys in their
payloads, `update` on screens and an `add` that takes a group (chosen: one vocabulary, the provider-strict union keeps nine variants).

## Decision Outcome

### Idempotence contract

- **normalize(doc)** writes out, from the document's own content, each field the compiler always writes and the document lacks:
  an element's `placement: 'auto'` (absent reads as not pinned everywhere: layout snapshot, arrange), `semantic.slug` (the slug
  the decompiler gives, below) and a screen's `meta.slug` (its screen id). It adds only fields equal in meaning to their absence
  (a schema default, or a name nothing draws), changes no existing field, is pure, and `normalize(normalize(d)) = normalize(d)`.
  The list is one table in `decompile/normalize.ts`; a field joins it only under this rule. `semantic.label` is not in it:
  expand writes it only from `label`/`alt`, and the v0 text rule writes an element with text and no accessible name as `text:`,
  which compiles to no `semantic.label`.
- **I1.** For a valid `doc` and registries holding every shape it uses, with no base:
  `serializeDocument(compile(decompile(doc).text, { registries }).doc) === serializeDocument(normalize(doc))`, no error
  diagnostic: byte equality of the canonical serialisation, every record compared (document and theme, indexes, binding ids).
  `compile(text, { base: doc })` is an optimisation for the Source view (ADR-0031 upsert) and must give the same bytes.
- **I2.** For `src` that compiles without errors, `t = decompile(compile(src).doc).text` is canonical: a function of the
  document alone (deferred sections are kept text) and a fixpoint: `decompile(compile(t).doc).text === t`.
- **Check compile.** `decompile` emits, compiles the text with no base, and compares each record with `normalize(doc)`. An
  element that differs only in its transform gets `box` (below) in the next round; any other differing record moves to `raw:`.
  It repeats until nothing differs; each round adds a `box` or a raw record and an all-raw document reproduces exactly, so it
  terminates (most documents: one round).
- **Raw is counted.** `DecompileResult.raw` is `{ total, byKind }` (keyed by record type, element kind for elements:
  `element:shape`, `binding`, `document`). It replaces `kept` (dsl API report changes); the `# kept:` comment goes.

### Restore mode

A file whose `ids:` map has a `document` entry compiles in restore mode. Decompile writes that entry when the document record's
id is not derived (no compile made it), and also, with the derived id, whenever the document lacks `title`, `themeId` or
`source`, so a compiled document that later lost one of them still compiles back exactly (review r3 F1; the property test's
generator includes such documents). It turns off exactly three compiler defaults: read's `FLX_SCHEMA_INVALID` at `/title` when `title` is missing;
expand's theme record and `document.themeId` when there is no `theme:` key; expand's `document.source` when there is no `salt:`
key and no deferred section. Every document field then comes from keys (or a raw document record) only. In restore mode the
decompiler writes `title` iff the record has one, `theme:` iff the document has a theme record (the built-in light one included),
and `salt:` iff it has a `source` (`salt: ""` when that salt is empty). Authored FluxScript (no `ids:`) keeps every default.

### Keys that make records exact (named as the record stores them; written only when needed)

- **`salt: <string>`** (top level). Precedence: the source's `salt:` key, then the base's, then `CompileOptions.salt` (the
  public option stays "the id salt of a document that has none yet", so streaming into an existing document never re-keys it;
  review r3 F2; amends ADR-0031 only in that a `salt:` key now wins over the base's). Decompile always writes `salt:` when the document's salt is not empty, so every
  host derives the same ids.
- **Document fields** (top level): `lang`, `description`, `authors`, `tags`, `custom`, `created`, `modified`, when set. Other
  `settings` than `lineJumps`, and `meta`, make the document record raw.
- **`ids: { <key>: <RecordId> }`** (top level, last): the stored id of each record whose id is not `stableId(salt, key)`.
  Keys: a node's or group's slug; `screen:<id>`; `document`; `theme:<name>`; an edge as `<from><op><to>` (`api->db`, `pay~>queue`,
  `@<n>` for the n-th repeat); its bindings as `<edge>.from` and `<edge>.to`. A node slugged `document` is written `node:document`.
  Values are plain when YAML reads them back as the same string, else quoted. A compiled document has no `ids:`. Two records with
  one id are `FLX_DSL_RAW_DUP_ID` (new code). `decompileScreen` returns its screen's entries beside the text, and the Source view
  passes them back as `CompileOptions.ids`, with the same meaning.
- **`index: <key>`** (screen, node, group, edge): only when order does not imply it, that is, when the stored index is not the
  one expand assigns at that position (`nKeysBetween(null, null, n)[i]` over the sibling set in text order). Siblings' keys must
  be unique (`FLX_SCHEMA_INVALID`).
- **`box: { x, y, w?, h? }`** (node, group, frame): only when place would move the element. The stored box of an element that is not
  pinned: compiles to `placement: 'auto'` with that transform; place keeps it this compile (a fixed obstacle for the others), and
  a later arrange may move it. `w`, `h` follow `pin`'s default-size rule.
- **`fit: none | shrink | grow`** (node), `textFit.mode`; `fit: { mode, padding, minSize, overflow }` when another field is set.
  Written whenever `textFit` is set (the compiler writes none by default).
- **`size: { w, h }`** (screen), when set. Any other screen field without a key (`kind`, `viewport`, `hidden`, `sectionId`,
  `themeId`) makes the screen record raw.
- **Themes.** `theme:` (preset and token `overrides`, v0); a theme the studio edited beyond what overrides say (`defaults`,
  `tableStyles`, other fields) is a raw theme record.

### Canonical emission order

- Header: `flux`, `title`, `salt`, `lang`, `description`, `authors`, `tags`, `custom`, `created`, `modified`, `theme`, `uses`
  (packs in order of first use: shapes, then icon slots, element z-order), `lineJumps`, deferred top-level sections (pointer
  order), `screens`, `raw`, `ids` (entries in document order: document, theme, then each screen and its nodes, groups, edges).
- Screens in `index` order, then id; masters sit where their index puts them (resolve is order-free). Screen keys: `id`,
  `title`, `role`, `master`, `hideMasterElements`, `size`, `layout` (or `template`, `items`, `options`), `background`, `nodes`,
  `groups`, `edges`, `notes`, `index`, deferred keys (pointer order), `raw`.
- Z-order is `index`, then id. `nodes`: top-level nodes in z-order, then each group's members, groups in z-order. Node keys:
  `shape` or `table`, `text`/`label`/`alt` (v0 rule), `texts`, `icons`, `fit`, `tone`, `style`, `pin` or `box`, `placeholder`,
  `fills`, `index`, deferred keys. `groups`: `label`, `contains`, `style`, `layout`, `frame`, `pin` or `box`, `clip`, `index`.
  `edges` in z-order: shorthand, then `label`, `style`, `route`, `jumps`, `index`, deferred keys; the one-key label form as v0.
- `raw:` items: a screen's elements in z-order, then bindings by their connector's z-order, `source` before `target`; top-level
  items by `type`, then id. Each item is one line of JSON with sorted keys and `canonicalNumber` numbers.

### Short names

- Slugs: an element's own valid `semantic.slug` when no earlier element (screens by index, elements by z-order) took it;
  then `toSlug(label ?? text)`, else the kind's base (`node`, `text`, `group`, `table`, `frame`); collisions get `-2`, `-3`… in
  that order, after every own slug is claimed. normalize writes them into `semantic.slug`, so after one round trip they are own
  slugs and stable. Screen ids: `meta.slug`, else `toSlug(name)`, else `screen`, same rule. A raw element joins the slug table by
  its own `semantic.slug`, so edges and `fills` can name it.
- Shape and icon names: short when exactly one used pack has a shape of that short name, else qualified (`basic:rect`).

### `pin:`

Written only for `placement: 'pinned'`, frames included, as `{ x, y }`, with `w`, `h` only when they differ from the shape's
default size (a table: `tableSize`). An element that is not pinned writes `box` when place would move it, else nothing. A frame
needs `pin` or `box` (amends ADR-0219's "needs `pin`"; neither is `FLX_SCHEMA_INVALID`).

### `raw:` escape blocks

- Top level and screen level, a sequence of records: `raw: [{"id":"Ab3…","type":"element","kind":"shape",…}]`. Each item must be a
  mapping with `id` and `type`; YAML block style is accepted, anchors, aliases and tags are not.
- Inexpressible: a record that differs in the check compile in more than its transform (fields with no key: locks, turns, flips,
  opacity, rich text with marks, cell styles, a frame's padding, an asset-filled icon slot, a region text named after the shape's
  first region, unknown kinds, the screen and document fields named above); a node whose parent is raw; a connector whose end has
  no slug, with its bindings; records of no screen (assets, sections, comments, timelines).
- Compile: raw records skip expand and place; a screen's raw elements are fixed obstacles to its layout. They join validate:
  each passes its `@fluxion/schema` record schema and the referential checks, diagnostics pointing into the item
  (`/screens/0/raw/2/transform`). A screen raw item must have that screen's `screenId` (else `FLX_SCHEMA_INVALID`). A raw record
  with the id of a record the keys compile replaces it (the screen, document or theme record); `flux` and a screen's `id` stay.
- `raw` is not part of the patch format; a patch edits a raw record only by `remove`.

### New FluxScript keys (ADR-0219 "Not covered")

- **Screen `hideMasterElements: true | false`**, the stored field, written whenever set. Without `master` it is allowed and
  inert (drawing rule, ADR-0054). `- id: agenda\n    master: base\n    hideMasterElements: true`
- **Node `texts: { <region>: <text> }`**, plain text per region but the first (that one is `text`/`label`): a shape node only
  (else `FLX_SCHEMA_INVALID`); naming the first region is `FLX_SCHEMA_INVALID`; an undeclared name compiles and the problems
  panel reports it. `card: { shape: card, label: Q3, texts: { body: Revenue up 12%, footer: Draft } }`. Amends ADR-0054: the
  decompiler writes a record with a first-region `texts` key raw, instead of omitting the key (omitting breaks I1).
- **Node `icons: { <slot>: <shape> }`**, a shape name per slot, resolved through `uses` like `shape` (`FLX_DSL_UNKNOWN_SHAPE`,
  `FLX_DSL_AMBIGUOUS_SHAPE`); compiles to `icons: { slot: { defId } }`. An asset-filled slot has no key (FluxScript has no asset
  vocabulary; `image` stays deferred), so its record is raw. `icon` (ADR-0030, singular) stays deferred.
  `svc: { shape: service, label: Auth, icons: { lead: lucide:lock } }`

### Patch ops (ADR-0035, still nine)

- **Payloads.** `NodeSpec` (`add.node`, `update.set`) gains `table`, `placeholder`, `fills`, `texts`, `icons`, `fit` with their
  FluxScript meaning. `fills` names a placeholder's slug on the master of the op's screen (`FLX_PATCH_REF_UNKNOWN` otherwise).
- **Masters.** `update` takes a screen as target with `set: { title?, role?: 'master' | 'none', master?: <screen ref> | 'none',
  hideMasterElements? }` (`none` clears, as `jumps: default` does; a screen whose id is `none` is written `#<RecordId>`).
  `{ "op": "update", "target": "agenda", "set": { "master": "base", "hideMasterElements": true } }`
- **Tables.** `set.table` replaces the table (`rows`, `widths`, `heights`, `tableStyle`), or edits cells with `cells`, a list of
  `{ key, text?, rowSpan?, colSpan?, remove? }` (a list, so the provider-strict schema stays closed and needs no `null`).
  `remove: true` deletes the cell and takes no other field; `rows` with `cells`, or a key outside the grid, is `FLX_SCHEMA_INVALID`.
  `{ "op": "update", "target": "plan", "set": { "table": { "cells": [{ "key": "1:1", "text": "6 weeks" }, { "key": "2:0", "remove": true }] } } }`
- **Groups and frames.** `add` takes exactly one of `node` or `group` (`GroupSpec`: `label`, `contains`, `style`, `layout`,
  `frame`, `pin`, `clip`); `update` of a group or frame takes `GroupSpec` (`contains` moves members); `remove` keeps its cascade.
  `{ "op": "add", "screen": "intro", "slug": "hero", "group": { "frame": true, "pin": { "x": 0, "y": 0, "w": 800, "h": 400 }, "contains": ["logo"] } }`
- The strict JSON Schema and `provider-rules.ts` fixture test are regenerated; `NODE_SPEC_KEYS` stays tied to the key table.

### The editor-built fixture

`packages/dsl/src/decompile/editor-built.fixture.ts` builds a document from `newDocument` through the core commands and payloads
the studio tools use (`element.create` with `shapeMaker`, `textMaker`, `frameMaker`; the connector tool's create and bind
payloads; the table, master and placeholder commands of M19.22–M19.24; `element.update` as the inspector sets `texts` and
`icons`), with random ids from a seeded `Random`, no DOM. It holds at least: a rectangle; a text box from the text tool; a frame
with a member; a connector bound at both ends; a table; a master screen with a placeholder and a screen using it; a region text
and an icon slot. The editor-built case asserts `raw.total === 0` and that every id survives the round trip.

### Token cost

Measured with the repo tokenizer (o200k): a v0 node line is 8–12 tokens, an edge line 6. After this ADR a compiled document's
text is unchanged. An editor-drawn node adds `box` (about 14 tokens with a default size, 23 with `w`, `h`) and one `ids:` entry
(about 26: a 128-bit id is about 22 tokens in any text form); `index` is usually absent, as `keyBetween` appends match
`nKeysBetween`. An editor-drawn edge adds three `ids:` entries (about 80). Estimated: node about 45–60 tokens against about 119
in canonical JSON (2–2.6×), edge about 85 against about 294 (3.4×). NFR-AI-003's 3× stays measured on the example corpus, as
the requirement says (the examples carry no `ids:`, so v1 costs what v0 did there and 'outline tokens not worse than v0' holds
it). Random ids cost the same in both forms, so editor-built text is not held to 3×; extending NFR-AI-003 to editor documents
would be a scope change this ADR does not make. Instead the editor-built fixture's FluxScript-to-JSON token ratio is a recorded
metric: M20.16 writes it to `decompile-baseline.json`, and the case below fails if a later commit lowers it.

### Contract change discipline

The grammar additions (`raw` compiled at screen and top level; `salt`, the document field keys, `ids`, `index`, `box`, `fit`,
`size`, `hideMasterElements`, `texts`, `icons`; restore mode; `FLX_DSL_RAW_DUP_ID`) and the patch payload changes ship, in their
implementing commits, with: the key table (`KEYS`), `specs/schema/fluxscript.schema.json`, the TextMate grammar, cheat sheet and
authoring guide, patch JSON Schemas, round-trip fixtures (`examples/dsl/masters-tables.flux.yaml` extended with each M20.17 key;
the editor-built fixture), their tests, and a dsl changeset. 06-ai-authoring.md §3.1/§5 and testing.md's dsl row ("for the
supported subset" becomes "for every valid document") change in the M20.16 commit.

### Consequences

- Good: no record is lost; the Source view and `get_screen` show every record; studio documents round-trip with their ids, as keys.
- Good: a document v0 wrote fully gets the same text (no new keys, no `ids`, no `raw`); raw is measured.
- Neutral: `DecompileResult.kept` becomes `raw`; `NodeAst`, `GroupAst`, `ScreenAst`, `PatchOp`, `CompileOptions` gain fields.
- Bad: decompile runs a compile per round (most documents one, `box` adds one); the Source view decompiles one screen.
- Bad: random ids hold editor-built text to an estimated 2–3.4× fewer tokens than JSON (a recorded, non-regressing metric, not NFR-AI-003's 3×); one
  odd field makes a whole record a raw JSON line.
- Bad: the stream compiler reads `ids:` only at the end, so a streamed restore-mode file has final ids only once complete (AI
  generation writes no `ids:`). `icon` and `icons` sit side by side until `icon` is decided; table row inserts rewrite `rows`.

### Confirmation

The test cases below, the `m20-complete.mjs` legs for ADR-0057 and decompiler v1, and `check-api.mjs` for the API reports. The
two "is doc" cases compare against `normalize(doc)` (I1) with no base, and also check that compiling with `base` gives the same
bytes. The corpus is `examples/dsl/*.flux.yaml`; generated documents are record-level (random ids and indexes, no slugs, no
placement, rich text, locks, frames, tables, masters). Every no-raw case also checks each fixture's raw count against
`packages/dsl/src/decompile/__fixtures__/decompile-baseline.json`, which holds, per example, the raw count (must not grow) and
the v0 token count of its decompiled FluxScript text (o200k, not `get_document_outline`), recorded in M20.16 before M20.17
extends masters-tables.flux.yaml. The M20.17 round-trip cases also assert `raw.total === 0`.

### Test cases

- `packages/dsl/src/decompile/decompile.prop.test.ts`
  - `FR-DSL-008: compile(decompile(doc)) is doc over the fixture corpus`
  - `FR-DSL-008: compile(decompile(doc)) is doc over generated documents`
  - `FR-DSL-008: decompile(compile(src)) is a fixpoint`
  - `FR-DSL-008: compiled documents decompile with no raw records`
  - `FR-DSL-008: key-expressible generated documents decompile with no raw records`
- `packages/dsl/src/decompile/decompile.test.ts`
  - `raw: escape block`
  - `outline tokens not worse than v0`
  - `FR-DSL-008: examples decompile with no raw records`
  - `FR-DSL-008: normalize is idempotent and adds only defaults`
  - `FR-DSL-008: an editor-built document decompiles with no raw records and keeps its ids`
  - `FR-DSL-008: a studio-made document compiles back in restore mode`
  - `FR-DSL-008: an editor-built document's token ratio to canonical JSON does not fall below its recorded baseline`
  - `hideMasterElements round-trips`
  - `region texts round-trip`
  - `icon slots round-trip`
- `packages/dsl/src/patch/apply.test.ts`
  - `patch masters`
  - `patch placeholders`
  - `patch tables`
  - `patch frames`

## More Information

- FR-DSL-008 (docs/requirements/20-ai-authoring.md), NFR-AI-003; M20 plan rows 13, 14, 19; backlog M20.4, M20.16–M20.18.
- ADR-0030, ADR-0031, ADR-0032, ADR-0035, ADR-0052, ADR-0054, ADR-0142, ADR-0169, ADR-0219; 06-ai-authoring.md §3.1, §5.
- Research: docs/research/04-file-format-ai-generation-theming.md (escape hatch: `raw:` block of canonical records).
