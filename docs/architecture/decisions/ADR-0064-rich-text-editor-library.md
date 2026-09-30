---
status: accepted
date: 2026-10-01
decision-makers: harness (M7 "Decide before coding"; within FR-TXT-003, FR-TXT-004, FR-TXT-001, NFR-SEC-001, NFR-LIC-*)
---

# ADR-0064 — The rich-text editor library is ProseMirror, used directly and loaded with the editor only

## Context and Problem Statement

M7 edits rich text in place (FR-TXT-003) with Markdown shortcuts (FR-TXT-004). ADR-0013 fixed
the stored shape: a ProseMirror-compatible JSON subset with its own node and mark set, validated
by Zod in `schema`. It left the editing library to M7, choosing from TipTap/ProseMirror or Lexical
(docs/research/01). The library must:
- read and write that JSON without loss;
- load only in the editor, never in the player (the M7 gate holds the player core ±1 kB across
  M7.12);
- offer input rules for the Markdown shortcuts;
- have a permissive licence.

Drawing text is not the editor's job. `render` draws the stored JSON itself in edit and present mode
(M7.8, M7.9), so edit and present match (FR-EDT-010). The library exists only while a text is
being edited.

## Decision Drivers

- **No conversion layer.** The editor's document model loads and saves ADR-0013 JSON as it is. A
  converter is a second schema to keep in step, and the plan's main risk is "the library's model
  diverges from the schema subset".
- **Exactly the ADR-0013 set.** `color`, `highlight`, `font` and `size` are separate marks there, and
  `field` is an inline atom. Unknown nodes and marks must survive an edit (FR-DOC-005).
- **Markdown input rules** (FR-TXT-004): `# `, `- `, `1. `, `**b**`, `_i_`, `` `code` ``.
- **Editor only, lazily.** The library is imported with a dynamic `import()` when editing starts,
  so neither the player nor the editor's initial chunk (EDITOR_INITIAL_GZIP) carries it.
- **Licence:** MIT/ISC/Apache-2.0 only (NFR-LIC-*). Paid extension tiers are not a dependency.
- **Few moving parts:** agents write the integration, so small, stable, well-documented APIs win.

## Considered Options

1. **ProseMirror used directly**: `prosemirror-model`, `-state`, `-view`, `-transform`,
   `-commands`, `-keymap`, `-inputrules` and `-schema-list`, with a schema built from ADR-0013's
   table.
2. **TipTap 3** (`@tiptap/core` plus extensions), which wraps ProseMirror.
3. **Lexical**, with a converter to and from ADR-0013 JSON.

## Decision Outcome

Chosen option 1, **ProseMirror used directly**. The editor owns one `Schema` whose node and mark
names, content expressions and attributes are ADR-0013's table. ADR-0013 JSON has ProseMirror's
`{type, attrs, content, marks, text}` shape and structure, so no structural conversion is needed.
`Node.fromJSON` and `toJSON` do not preserve everything on their own, though (M7.2 review F1, F2).
A thin, pure **load/save normalisation** (`pm-json.ts` in the editor) sits on both sides. It works
only on attributes, extra keys and unknown types, never on tree shape.

### The normalisation

**Load** (ADR-0013 JSON → ProseMirror JSON, before `Node.fromJSON`):
- Each known node and mark keeps its declared attributes. Its **unknown attributes and extra
  top-level keys** (FR-DOC-005) move into one declared attribute, `extra` (default `null`), as
  JSON.
- Unknown node types become one of three opaque specs, chosen by position. Each holds the original
  JSON in an `original` attribute:
  - `unknownBlock` is a block atom. Every block position in the schema allows it, following ADR-0013's
    rule that an unknown node satisfies the position it is in (M7.2 review F3):
    - wherever `block` is;
    - as the first child of `listItem`, whose content is `(paragraph | unknownBlock) block*`;
    - as a child of a list, where a `listItem` belongs: `bulletList` and `orderedList` content is
      `(listItem | unknownBlock)+`.
  - `unknownInline` is an inline atom, allowed in paragraph and heading content.
  - Both draw their `text` descendants read-only, as ADR-0013 prescribes.
  - An unknown node at the `doc` root cannot occur, because the root is always `doc`.
- An unknown mark type becomes `unknownMark` with its original JSON in `original` and
  `excludes: ''`. Several unknown marks can then sit on one text node, and they never exclude a
  known mark.

**Save** (ProseMirror JSON → ADR-0013 JSON, after `toJSON`):
- Declared **optional attributes still at their default** (`paragraph.align`, `heading.align`,
  `orderedList.start`, `link.title`) are omitted. An absent `attrs` object stays absent. A
  required attribute such as `heading.level` is always written.
- `extra` is spread back: unknown attributes return into `attrs`, extra keys onto the node or
  mark.
- `unknownBlock`, `unknownInline` and `unknownMark` are replaced by their `original` JSON.
- **Mark order:** ADR-0013 allows each mark type at most once per text node, so marks are a set.
  Save writes them in ProseMirror's schema rank order, which is ADR-0013's table order with
  unknown marks last, in their original relative order. Loading and saving a document whose marks
  are already in that order changes nothing.

The mapping is therefore lossless up to mark order, and idempotent after one save. The editing
commands are ProseMirror's own:
- `toggleMark` handles Ctrl+B, Ctrl+I and Ctrl+U;
- `prosemirror-schema-list` handles list indentation;
- `prosemirror-inputrules` handles the Markdown rules.

### Rules

- The ProseMirror packages are dependencies of `@fluxion/editor` only, and are imported through a
  dynamic `import()` in the inline-editing module. No other workspace package lists them. The M7
  gate checks this across every `packages/*/package.json`, together with the player core size
  across M7.12.
- The editing surface is a `contenteditable` that ProseMirror mounts inside the element's text box.
  It uses the same `fx-` content CSS as `render` (ADR-0015), so the text does not reflow on entering
  or leaving edit mode.
- Esc and clicking outside commit the edited document as **one** store transaction. When the shape's
  `textFit` is `grow`, the transaction also applies `fitShapeText`'s height (ADR-0018 item 4). Input
  inside ProseMirror uses ProseMirror's own history, which is discarded on commit. The editor's undo
  sees one step.
- Links go through the same allowlist as `schema` (ADR-0013). A pasted or typed `javascript:` href
  never becomes a `link` mark.
- The normalisation is covered by a property round-trip test over arbitrary schema-valid rich
  text. The generated text includes:
  - absent optional attributes;
  - unknown attributes and extra keys on known nodes;
  - unknown nodes in every position `checkRichText` accepts them: block, first child of a
    `listItem`, child of a list in place of a `listItem`, and inline;
  - several unknown marks on one text node.

  Load then save must deep-equal the input with each text node's marks compared as a set, and a
  second save must be byte-identical to the first. Its unit tests pin one example per rule above.

### Consequences

- Good: there is no structural converter and no second model. The schema subset and the editor
  schema are one table. The normalisation covers only attributes, extra keys, unknown types and
  mark order, in about 100 pure lines, and one property test proves the round trip.
- Good: every package is MIT, maintained by the same author, and stable at 1.x.
- Good: the cost is paid only while editing. The player and the editor's first paint are untouched.
- Bad: there is more glue than with TipTap. The mark and node specs, keymaps and input rules are
  written by hand, about 300 lines. TipTap's extensions for these marks would need the same custom
  work anyway (ADR-0013 notes `color`, `highlight`, `font` and `size` do not match TipTap's
  `textStyle`).
- Bad: ProseMirror's view is imperative, not React. The inline editor is a small React wrapper that
  mounts and destroys an `EditorView` in an effect.
- Neutral: collaborative editing (R5, CRDT text) can use `y-prosemirror` over the same schema.

### Confirmation

- M7.12's round-trip property test and `e2e/text.inline-edit.spec.ts` (Ctrl+B/I/U, Esc as one
  undo step, grow in the same step).
- `e2e/text.markdown-shortcuts.spec.ts` (M7.13).
- m7-complete's bundle leg: the player core stays within ±1 kB of the size measured at M7.12's
  parent, and only `packages/editor` depends on the library.

## Pros and Cons of the Options

### ProseMirror directly

- Good: the stored JSON has the native shape. Only an attribute and unknown-type normalisation
  remains, with no tree conversion. Input rules,
  keymaps and list commands are first-party. The library is small, at roughly 70–80 kB gzip for
  model, state, view, transform, commands, inputrules and keymap, all loaded lazily.
- Bad: lower-level APIs, so the specs and commands are ours to write and test.

### TipTap 3

- Good: ergonomic extension API, React bindings, and a StarterKit that covers most nodes.
- Bad: another layer over ProseMirror with its own releases and a larger lazy chunk. The ADR-0013
  marks still need custom extensions. Some useful extensions are in a paid Pro tier, which is a
  licence trap to police. StarterKit's defaults, such as `textStyle` and its node names, differ from
  ADR-0013 and would need overriding.

### Lexical

- Good: MIT, a fast reconciler, and good React integration.
- Bad: its node tree is not ADR-0013 JSON. It needs a **structural** converter: text runs with
  `format` bitmasks and styles instead of mark lists, lists as `list`/`listitem` with `listType`, and
  a root node. That converter needs everything ProseMirror's normalisation does (extra keys, unknown
  types, optional attributes) on top, and becomes the divergence risk the plan names. It carries editor-internal serialized fields, such as `format`
  bitmasks and `version`. Preserving unknown nodes needs custom decorator nodes.

## More Information

- docs/research/01-rendering-and-editor-engines.md §rich text (TipTap/ProseMirror or Lexical, MIT)
- ADR-0013 (stored subset), ADR-0015 (content CSS), ADR-0018 (text fitting)
- docs/milestones/M7.md "Decide before coding"
