---
status: accepted
date: 2026-10-02
decision-makers: harness (M8.3; within FR-SCR-004, FR-LIB-001, NFR-PERF; a minor schema bump with migration and fixture, contracts.md rules 8-9)
---

# ADR-0021 — Screen sections are `section` records, and the library is searched by an own prefix and keyword index

## Context and Problem Statement

Two M8 features need a decision before code. FR-SCR-004 groups screens into sections for the navigator now and for site
navigation later (FR-SITE-001: sidebar and top nav from sections). The schema already has `screen.sectionId?: RecordId`
(02-document-model §3) but nothing for it to point at. FR-LIB-001 asks for a library panel whose search finds "database" for
the cylinder among 10 000 entries in under 100 ms, over the `keywords`, `category` and name of each `ShapeDef`.

## Decision Drivers

- A section needs a name, an order among sections and a collapsed state, and must survive undo, copy and AI patches like
  any other record (one command, minimal diffs).
- Ordering uses the fractional `index` everywhere (02 §1): moving a screen or a section changes one record.
- Site navigation (R7) is a consumer: it must read sections, in order, with the screens in each, from the document alone.
- Schema changes are deliberate: minor bump, migration, fixture (contracts.md rules 8 and 9).
- Search must be fast on 10k entries, work offline in the editor bundle, and add no player dependency (the library is
  editor-only).

## Considered Options

Sections:

1. **`screen.sectionId` plus document-level section metadata** (a list of `{id, name}` on the `document` record). One
   record holds every section: reordering, renaming and collapsing all rewrite the one `document` record, which also
   carries settings; concurrent edits and AI patches collide on it, and a section has no record id for bindings, comments
   or the site's page ids to refer to.
2. **A `section` record** `{id, type: 'section', name, index, collapsed?}`, with `screen.sectionId` referencing it. A section
   is a first-class record: one-record diffs, ids that other records can cite, validation of the reference
   (FLX_REF_MISSING) for free, and ordering by `index` like screens and elements.

Search:

1. **MiniSearch** (or another search library). Full-text, fuzzy and field boosts, but a runtime dependency (licence and
   size check, an ADR for any player use), a built index to serialise or rebuild on every pack load, and more than a
   100-entry keyword lookup needs.
2. **An own index**: lower-cased tokens (split on non-letters, accents folded) of name, category, pack and keywords map to
   entries; a sorted token array answers prefix queries by binary search; entries are ranked exact, then prefix, then
   substring, ties by name. Built once per set of packs in O(total tokens).

## Decision Outcome

Sections: option 2. `section` is a record type in `@fluxion/schema` (`SectionRecord`, with `name`, `index`, optional
`collapsed`); `screen.sectionId` keeps its type and must name a `section` record or be absent. Schema version `1.0` becomes
`1.1`. The field exists in 1.0 but names nothing, because no section record could exist; the migration `1.0 → 1.1`
(`packages/schema/src/migrations/1.0-to-1.1.ts`) therefore removes `sectionId` from every screen, and a 1.0 fixture with a
dangling `sectionId` migrates and validates. The reference check is new work: `checkScreens` (references.ts) starts to
verify that `sectionId` names a `section` record (FLX_REF_MISSING, with a suggestion), and sibling `index` uniqueness is
checked for sections as it is for screens. M8.14 delivers, with the record: the migration and a `fixtures/v1.1/` document
with sections, the regenerated JSON Schema, the format reference page in apps/docs, the API report for `SectionRecord` and a
changeset (contracts.md rules 8 and 9). A reader of an older version keeps the unknown `section` records and the
`sectionId` it does not understand (FR-DOC-005).
Commands: `section.create`, `section.rename`,
`section.reorder`, `section.delete` (its screens become unsectioned), `screen.setSection` (core, M8). Site navigation reads
`section` records by `index` and the screens whose `sectionId` names them, screens in `index` order; a screen without a
section forms the unsectioned group first. Collapsed state is editor presentation kept on the record (shared with
collaborators is acceptable; revisit when the site reads it).

Search: option 2, an own index in `packages/editor` (`library-search.ts`, pure). It indexes name, category, pack and
`keywords`; a query of several words matches entries that satisfy every word. The cylinder's keywords include `database`;
the synthetic 10k-entry set of the bench gives each entry a few keywords. MiniSearch stays an option if fuzzy matching is
asked for; the index interface (`build(entries)`, `search(query): entry[]`) does not change.

### Consequences

- Good: sections diff and undo like any record and carry ids; site nav (R7) needs no new data.
- Good: no new dependency; search is a few microseconds per keystroke at 10k entries (budget 100 ms, bench enforced).
- Bad: a schema minor bump touches every consumer's fixtures once (the documented migration path), and old readers see an
  unknown record type (they preserve it, FR-DOC-005).
- Bad: no fuzzy matching or typo tolerance in v1.

### Confirmation

- `packages/schema`: T0 "FR-SCR-004: a document without sections migrates and round-trips" over the 1.0 fixture (including one
  with a dangling `sectionId`); a 1.1 document whose `sectionId` names no section fails validation.
- `packages/editor/bench/library-search-10k.bench.ts` under `LIBRARY_SEARCH_10K_MAX_MS`: "database" finds the cylinder.
- The completion gate of M8 checks this ADR is accepted and names site navigation.

## More Information

02-document-model §3 (the screen record), 11-shapes-and-library (FR-LIB-001), 21-import-export-publish (FR-SITE-001),
ADR-0016 (ShapeDef, `keywords`, `category`).
