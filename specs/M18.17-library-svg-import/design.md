# Design

Contract: ADR-0206's import transaction and rights model, hosted in the browser; no new file-format,
SDK, CLI or MCP contract. Format and editor gain public API (API reports and changesets).

**M18.174 — move, no behaviour change.** `packages/format/src/svg-pack-members.ts` takes the pure
parts of `packages/cli/src/pack-import-input.ts`: `INPUT_LIMITS`, `slugOf`, `categoryOf`, `escapes`,
`memberIds` and `zipMembers(bytes)` (`readZip` once under the limits with strict names, escaping
names refused). `packages/format/src/svg-witness-sessions.ts` takes `witnessSessions` from the CLI,
generic over the session type, with the clock injected (`now`), so format stays pure. The credits
file schema and scoping (`pack-import-rights.ts` minus file reading) move to format as
`parseImportCredits(json, notices)` and `scopedCredits`. The CLI keeps its file-system walk, file
reads and process wiring and imports the rest; its suites run unchanged and green.

**M18.175 — editor importer.** `packages/editor/src/library/import-svg.ts`:
- Input: `{ kind: 'files' | 'zip', items }`, each item `{ name, size, bytes(): Promise<Uint8Array> }`
  (a `File` fits). Files: the entry count, each `size` and their total are checked before any
  `bytes()` call. ZIP: its own `size` is checked before its `bytes()` is read; its entry count and
  declared entry sizes are then checked by `zipMembers` from the central directory before any entry
  is inflated (NFR-SEC-001). A tested fake counts `bytes()` calls.
- `convertSvgLibrary(input, options)` → `{ pack, report, colors }` or refusals by member path. It
  registers nothing. Options: `namespace`, `version`, `name`, `rights` (parsed credits, or the
  one-credit original/upstream form with a declared hash), `colors` (literal → token ref, checked
  against the theme's color tokens), `fonts` (fonts-core's Inter face and bytes with its declared rights: OFL-1.1, its copyright
  attribution, the `OFL.txt` notice and its upstream source, as the CLI's `interFont()` builds them),
  `startWitness()` and `now`.
  Order: member rules → rights coverage and license policy (before any witness) → `importSvgBatch`
  through `witnessSessions` → all accepted or refused → `importedShapePack`.
- `colors`: the distinct literal color strings of the accepted artwork's fill, stroke and stop-color
  values, from attributes and style declarations alike, keeping only values that pass `isCssColor`
  (so `none`, `currentColor` and `url(#…)` are never offered), exactly the keys the renderer looks up (`artwork-view.tsx`: an attribute value as written, a
  style declaration's value trimmed), with a unit case for a padded `style="fill: #F00 ;"`, sorted by code unit; at
  most 64, with `colorsOmitted` counting the rest, so none is dropped silently.
- Rights: parsed credits (`parseImportCredits(json, notices)`), or the one-credit form, `original`
  with an author or `upstream` with a reference and a typed hash. In the studio `notices` is empty:
  a credit with `noticeFile` is refused, naming the credit, and asks for an inline `notice`.
- `registerSvgLibrary(registry, pack, source)` → `{ entries, dispose }`, atomic, a held namespace
  refused (`registerImported`).

**M18.176 — the dialog.** `EditorRoot` gains `libraryImporter?: LibraryImporter` (public editor API),
passed through `edit-body.tsx` to `LibraryPanelProps.importer`. With it the panel shows **Import
SVG…**: a file input (`.svg`, `.zip`, multiple), then a dialog with namespace (default from the
first name), rights (**Credits file…**, a `.json` in the CLI format whose notices are inline;
**My own work** with the license (from the content policy's list, no default), the
attribution and the author's name; or **From a source** with license, attribution, reference
and the source's SHA-256 typed by the user), and **Convert**. Convert runs `convertSvgLibrary` once and
shows each refusal by member path, or the accepted count and the colors found, each with a token
select (default: keep) and the omitted count. **Import** re-converts only when a color is mapped
(the witness must see the mapped paint), then calls `registerSvgLibrary` with the final pack only;
the dialog's earlier pack is discarded, never registered or saved. Its states (idle, converting,
refused, converted with colors, importing, imported) have a component test with a fake importer,
including a declaration with no license refused before conversion.

**M18.17 — studio wiring and the e2e.** The studio supplies the
importer: `createSvgPaintWitness` (render) over the document, fonts-core's Inter face and bytes, the
studio registry, and it keeps every registered `pack.source` for `FileBar`'s `shapePackSources`,
so a save retains used definitions (FR-LIB-009) and their font (ADR-0192).

Rejected: a partial import (ADR-0188 counts every member); witnessing in a worker (the witness needs
the document); inferring or computing rights or hashes (ADR-0206); mapping colors without
re-witnessing; registering the first pass.

Risks: three-browser witness time for 50 members (bounded by sessions; measured in the e2e);
WebKit file input with multiple files (the e2e uses the ZIP).
