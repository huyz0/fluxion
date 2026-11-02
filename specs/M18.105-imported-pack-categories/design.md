# Design

## M18.210: Iconify and draw.io packs reach the save
- The editor gets `convertIconifyLibrary` and `convertDrawioLibrary`, beside `convertSvgLibrary`. Each returns
  `{ pack: ImportedPack, … }`.
  - The Iconify one calls `iconifyShapePack(report, { licensePolicy })`.
  - The draw.io one calls `importedShapePack` with the user's declared credit: the accepted definitions, `namespace` and
    `name` as typed, and `version` from the source hash.
- Registration reuses the SVG path: `shapePackSubsetOf(pack.source)` into the document registries.
- The panel's import menu gains **Import Iconify…** (a `.json` file) and **Import draw.io…** (an `.xml` mxlibrary or stencil
  file). They share the dialog shell of Import SVG…: a namespace/name, a rights step for draw.io, then a refusal list or
  confirm.
- The studio `LibraryImporter` gains the two kinds, and `studioLibraryImports().sources()` keeps their `pack.source` the way
  it keeps SVG's. `shapeSaveOptions` and `writePortableFlux` are unchanged.
- An Iconify collection with no declared SPDX licence, or one the content policy refuses, registers nothing and shows the
  refusal; nothing unsaveable is registered. The registry refuses a namespace already held.
- Rejected: registering unsaveable Iconify shapes with a save-time warning, because it silently drops shapes at save, which
  M18.17 already rejected. Rejected: inferring draw.io rights from the file, because it carries none (ADR-0050).

## M18.211: pack format 1.2 with category display names (ADR-0210)
- Contract: `ShapePackCategoryEntry` gains an optional `name`. It is non-empty text of at most 80 characters, NFC, with no
  control characters.
  - The encoder writes `formatVersion: '1.2'` exactly when some category has a name that is not its slug's own title form.
    Otherwise it writes 1.0 or 1.1 as today, so first-party pack bytes and goldens stay unchanged.
  - 1.2 is 1.1 plus `name`: fonts are allowed. A category file's `formatVersion` follows its index, as today.
- `parseShapePackIndex`, the subset parser and the portable embed accept 1.0, 1.1 and 1.2. A 1.0 or 1.1 index with `name`
  stays refused, because those schemas are strict. Every older file reads unchanged, so no migration is needed. The fixtures
  `fixtures/shape-pack/v1.2/` and a .flux with an embedded 1.2 subset are new and frozen.
- Every reader that branches on `formatVersion === '1.1'` treats 1.2 as 1.1 plus names, through one `hasFonts` predicate
  instead of string compares. That covers core registration, encode and font validation (`versionOf`), format prepare and
  the lock (`parseLock`, its subset parser choice and `fontAssetsMatch`, so a 1.2 embed's fonts are still size- and
  hash-checked), sdk loader and test files, and the player's and studio's credit readers (cp30 F5).
- The CLI `pack-import --json` reply admits `formatVersion: '1.2'`. That is a CLI contract change, which ADR-0210 also
  covers, with output.ts, the schema file and a CLI e2e case for a folder name that differs from its slug's title form.
- `categoryTitle(slug)` lives in core. The encoder drops a name equal to it, and the panel falls back to it, so the two
  rules cannot drift. A player case and a studio case each list a 1.2 subset's font credits.
- `importedShapePack` and `iconifyShapePack` pass each source category's text as `name`, beside its slug, and
  `checkCategories` validates names. Two source texts that collide on one slug keep the first text, and the encoder reports
  the collision as a diagnostic, not a silent merge.
- Rejected: a top-level `categoryNames` map, because a second keyed structure must stay in step with `categories`. Rejected:
  storing the name only in the document, because a pack reopened alone must also show it.

## M18.212: the panel shows category names
- `entryOf` and `entriesOfIndex` carry `categoryName`, which is the index name when present and otherwise core's
  `categoryTitle(slug)`, the encoder's rule (as `entryOf`'s comment already promises). They also carry `packName` from `index.name`.
- `library-panel.tsx` headings read `${packName} / ${categoryName}`. Search still matches slugs and names.
- The reopen path (`saved-shape-packs.ts`) registers the subset's index, so its names come through unchanged.
- The pinned Lucide collection has no categories, so the end-to-end check uses a new original Iconify fixture,
  `fixtures/iconify/category-names.json`, with category "Arrows & Pointers". Its slug `arrows-pointers` titles as "Arrows
  Pointers", so only a saved 1.2 name can show the original text after the reopen.

## Risks
- 1.2 changes a contract. ADR-0210, the fixtures and the api reports land in M18.211, and contracts.md rule 10 freezes the
  fixtures from then on.
- The Iconify Lucide corpus is 2198 icons. M18.126's perf bench covers the encode, and the name adds per category, not per icon.
