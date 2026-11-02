---
status: accepted
date: 2026-11-02
decision-makers: import stream (M18.211 for M18.105; ADR-0048/0192/0196/0206 follow-up, subject to independent review)
---

# ADR-0210 — Shape pack format 1.2: category display names, as 1.1 plus `name`

## Context and Problem Statement

The shared encoder (ADR-0196) turns any category text into a slug and keeps only the slug: the
index's `categories` map is keyed by slug, and every stored definition's `category` is that slug.
The 1.0 and 1.1 schemas are strict, so neither can hold the text. An imported Iconify collection
with the category "Arrows & Pointers", a draw.io library or a `pack-import` folder of that name is
therefore listed as `arrows-pointers` (or a title form, "Arrows Pointers") once it is saved and
reopened, and a pack opened alone has lost the name for good (M18.105). Every reader that keeps
fonts compares `formatVersion === '1.1'`, so any new version would silently read as a fontless 1.0
in those places (cp30 F5).

## Decision Drivers

FR-LIB-003 (categories browsed by their names), FR-LIB-005/006 (Iconify and draw.io categories
kept), FR-LIB-009 (a saved file is complete), contracts.md (file format changes only with an ADR,
fixtures and tests; old files read unchanged), ADR-0192 (exact fonts retained and checked at the
lock), byte stability of first-party packs and goldens.

## Considered Options

1. **Format 1.2 = 1.1 plus an optional `name` on each index category entry, and `categoryNames`
   on a saved subset.** Chosen.
2. **A top-level `categoryNames` map on the index.** A second structure keyed by slug must stay in
   step with `categories`; rejected.
3. **Names in the document only.** A pack reopened or installed alone would still lose them;
   rejected.
4. **Store the text as the definition's `category`.** Breaks the slug key every index, category file
   and loader uses; rejected.

## Decision Outcome

- **Envelope.** A 1.1 or 1.2 index's category entry is `ShapePackNamedCategoryEntry`, the 1.0
  `ShapePackCategoryEntry` (unchanged, as is the published 1.0 JSON Schema) plus an optional `name`: non-empty, at most 80 UTF-16
  code units, NFC, no C0/C1 control or DEL (`categoryNameProblem`). A 1.2 saved subset may carry
  `categoryNames` (slug to name), each naming a category one of its definitions uses. 1.2 is 1.1
  plus names: the font metadata (`fontResources`, `fontFaces`, `definitionFonts`, `fontCredits`)
  is required as in 1.1 (empty when nothing draws text), and a category file's `formatVersion` is
  its index's. A `name` or `categoryNames` in 1.0 is refused by its closed schema (an unrecognized key)
  and in 1.1 by the parser ("a category name needs format 1.2"); `1.3` and later are unknown.
- **When 1.2 is written.** The encoder keeps a category's text as its `name` (in NFC, each run of
  whitespace as one space) only when it is neither the text's own slug nor that slug's
  `categoryTitle` (words capitalised, joined by spaces), and is a valid name; otherwise no name,
  and the category shows its title form as before. Any name makes the pack 1.2; a pack without one
  is written exactly as before as 1.0 or 1.1, so every first-party pack (all slug-form texts) and
  golden is byte-identical. Texts that slug alike are already numbered, never merged (ADR-0196), so
  one slug never has two texts and the planned collision diagnostic has nothing to report; a
  numbered twin (`uncategorized` beside the default, `Charts Graphs` beside `Charts & Graphs`) keeps
  no name. Texts that are alike only once folded (spacing, NFC) slug apart, and only the first keeps
  the name (M18.212), so no two headings read alike. Over 80 characters, a text keeps no name rather than refusing the import (slugs are
  already cut at 60).
- **One predicate.** `packHasFonts` / `isFontFormat` (core) answer "1.1 or 1.2" for every reader that
  keeps fonts: core registration, encode and font validation; format's lock (`parseLock`, the
  subset parser choice and `fontAssetsMatch`, so a 1.2 embed's font assets are still size- and
  hash-checked), prepare and retention; sdk's artwork loader and test pack files; the player's
  `creditedPacks` and the studio's credit reader. No reader compares a version string.
- **Portable files.** A used 1.2 source saves as a 1.2 subset under a lock with `packFormat: '1.2'`,
  keeping the names of only the categories its used definitions are in (none left: the subset is
  still 1.2, never downgraded). A 1.2 distribution saves its index's names the same way.
- **CLI.** `fluxion pack-import --json` may reply `pack.formatVersion: '1.2'`
  (packages/cli/schemas/pack-import.output.json), when a folder is named unlike its slug's title.
- **Shared rule.** `categoryTitle` is exported from core; the library panel (M18.212) shows a
  category's `name` when present and `categoryTitle(slug)` otherwise, the encoder's own rule.

Fixtures, frozen from this commit (contracts.md): `fixtures/shape-pack/v1.2/` (index with the
`labels` category named "Labels & Badges", its 1.2 category file, a 1.2 subset) and
`fixtures/shape-pack/v1.2/labels.flux`, a portable file embedding that subset with Inter retained.

### Consequences

- Good: names survive save, reopen and a pack opened alone; old files and packs read unchanged
  (no migration); first-party bytes do not move; a later version is one predicate to extend.
- Bad: a 1.2 reader is required to open an imported pack with names; a 1.1-only reader refuses it
  rather than dropping names silently.
- Neutral: a fontless pack with names carries empty font arrays.

### Confirmation

core `pack-format.test.ts` (title rule, name rules, parsers, encoder byte stability),
`pack-encode.test.ts`, `pack-font-validation.test.ts`; format `shape-pack-names.test.ts`; editor
`shape-pack-format-compat.test.ts` (the frozen file through both loaders, its font asset checked
at the lock); player and studio credit cases for a 1.2 subset; CLI e2e `cli.pack-import.test.ts`
(a folder "Arrows & Pointers" gives a 1.2 pack that loads clean); the api reports.
