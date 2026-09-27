---
status: accepted
date: 2026-09-27
decision-makers: harness (M2 "Decide before coding"; within FR-DOC-001, FR-DOC-005, NFR-SEC-001)
---

# ADR-0013 — Rich text is a ProseMirror-compatible JSON subset validated by Zod

## Context and Problem Statement

Shapes, text elements and screen notes carry rich text (02-document-model §"Rich text"). The
editor library that edits it is chosen in M7 (ADR-0019, TipTap/ProseMirror or Lexical per
docs/research/01), but the stored shape must be fixed now: `schema` validates documents
without an editor, the renderer (M4) and player draw it without one, and AI/DSL output
(FR-AI-*) produces it. Rich text is also untrusted input from files (NFR-SEC-001).

## Decision Drivers

- Portable JSON that any of the candidate editors can load without a lossy conversion.
- Validation in the pure `schema` package with Zod only (no editor dependency, player size).
- Safe by construction: no raw HTML, no script-capable URLs.
- Forward compatible: unknown attributes are preserved like any other unknown field (FR-DOC-005).

## Considered Options

1. **ProseMirror-compatible JSON subset**, defined as Zod schemas in `schema`.
2. **Lexical's serialized JSON.**
3. **Markdown strings** (CommonMark + extensions).
4. **HTML strings**, sanitized on load.

## Decision Outcome

Chosen option 1. ProseMirror's `{ type, attrs?, content?, marks?, text? }` JSON is what TipTap
stores natively and maps one-to-one onto Lexical's node tree, so M7 keeps either choice open.

### Node set

| `type` | Content | Attrs |
|---|---|---|
| `doc` | block+ | — |
| `paragraph` | inline* | `align?`: `left`/`center`/`right`/`justify` |
| `heading` | inline* | `level`: 1–6, `align?` |
| `bulletList` / `orderedList` | `listItem`+ | `orderedList.start?`: integer ≥ 1 |
| `listItem` | `paragraph` block* | — |
| `text` | — (`text`: non-empty string) | marks |
| `hardBreak` | — | — |
| `field` | — | `name`: `page` / `pageCount` / `screenName` / `date` / `title` (renders `{{page}}` etc.) |

### Mark set

`bold`, `italic`, `underline`, `strike`, `code`; `link` (`href`, `title?`); `color` and
`highlight` (`color`: a CSS hex colour or a `TokenRef`); `font` (`family`: string or `TokenRef`);
`size` (`size`: positive number of px or a `TokenRef`). A mark type appears at most once per text
node.

### Rules

- Unknown node or mark `type` values (from a newer minor version) are **preserved verbatim** and
  reported as one **warning** each, with its JSON pointer (FR-DOC-005, 08-file-format
  NFR-PORT-003): a newer file never loses text on an older reader. An unknown node must still be
  an object with a string `type`; its `content`, `marks` and `attrs` are kept but not interpreted.
  Renderers draw an unknown node as the plain text of its `text` descendants (an unknown block
  as a paragraph), ignore unknown marks, and never read an unknown node's attributes (so an
  unknown node cannot smuggle a URL past the link rule).
- Unknown **attributes** and extra keys on known nodes are preserved verbatim (FR-DOC-005).
- Structural errors on known nodes (a `heading` without a valid `level`, a `listItem` that does
  not start with a `paragraph`, a `text` node with empty `text`) are **errors** with a path.
- `link.href` accepts only `http:`, `https:` and `mailto:` URLs and in-document references
  `#screen:<id>`; `javascript:`, `data:` and anything else fail validation (NFR-SEC-001).
- No node carries raw HTML. Sanitisation of rendered output stays with `format`/`render`.

### Consequences

- Good: no editor dependency in `schema`; the JSON is ProseMirror document JSON for a schema
  built from the table above. TipTap needs small custom extensions in M7: `color`, `highlight`,
  `font` and `size` are separate marks here (TipTap's defaults fold them into `textStyle`
  attributes), and `field` is a custom inline atom.
- Good: link safety is enforced at the schema boundary for every consumer.
- Neutral: adding a node or mark (e.g. inline images) is a schema **minor** change: older
  readers preserve it and fall back to its text; it still needs its own ADR and fixture.
- Neutral: Lexical (if chosen in M7) needs a thin, testable converter.

### Confirmation

`packages/schema/src/rich-text.test.ts` (M2.7): valid documents for every node and mark pass;
an unknown mark yields exactly one warning with its JSON pointer and survives a round trip;
a `listItem` starting with a list fails; a `javascript:` link fails;
unknown attributes survive a parse/serialize round trip.

## Pros and Cons of the Options

### ProseMirror-compatible subset

- Good: native for TipTap/ProseMirror, trivially mapped to Lexical, well documented.
- Bad: nested `content` arrays are positional — acceptable inside one text value, which is a
  single record field (CRDT text types replace it later, research 04).

### Lexical serialized JSON

- Good: native for Lexical.
- Bad: carries editor-internal fields (`version`, `detail`, `format` bitmasks) and ties storage
  to one editor before M7 decides.

### Markdown

- Good: compact and AI-friendly.
- Bad: no colour, size, or font marks without non-standard extensions; parsing it in the pure
  core adds a parser dependency.

### HTML

- Good: universal.
- Bad: the largest XSS surface (NFR-SEC-001); needs a DOM or a heavy sanitiser to validate.

## More Information

FluxScript (M12) keeps a Markdown-like text shorthand compiled into this JSON; the stored form
remains this subset.
