---
status: accepted
date: 2026-10-27
decision-makers: harness (M18.32; FR-LIB-007, FR-LIB-009 within ADR-0017, ADR-0181 and ADR-0185, subject to independent review)
---

# ADR-0200 — The studio library offers every first-party pack, loaded lazily

Extends ADR-0017 (hosts bundle first-party packs as listed dependencies) to the eleven shape packs beyond `basic`.

## Context and Problem Statement

FR-LIB-007 ships twelve first-party shape packs and FR-LIB-009 requires that only index metadata
is loaded up front, geometry is fetched on use, and a saved file embeds only the definitions it
uses. The studio registered only `basic`. Registering every pack eagerly would put about 400
definitions' geometry, Lucide's artwork included, in the studio's first load. It would also
make every save depend on registry contents, which ADR-0185 forbids as a source of rights.

## Decision Drivers

- FR-LIB-009: metadata up front, geometry on use, only used definitions saved.
- ADR-0017: a host's packs are listed dependencies the layering gate can see.
- ADR-0181 and ADR-0185: one verified loader per pack; saves name explicit distribution sources;
  a namespace the opened file embeds stays the file's.

## Considered Options

1. **Register every pack at open.** Simple, but it loads all geometry and leaves FR-LIB-009 unmet. Rejected.
2. **Import each pack's JavaScript module lazily.** The modules hold every definition of the pack,
   so the first pick loads the whole pack, and the files' hashes are not checked. Rejected.
3. **Read each pack's checked-in `pack/` files through its SDK loader.** Chosen.

## Decision Outcome

The studio lists the eleven packs and `sdk` as dependencies; the overview's studio row names them.
At start it reads every `pack/index.json` through Vite's lazy glob over the listed dependencies,
`../node_modules/@fluxion/pack-*/pack/`, each index and category file its own chunk. It verifies
each index with `createShapePackLoader`, under the content-license policy and a 4 MiB cap per file.
For each open document, `documentCatalog` offers the editor every entry by the names its index
gives (`entriesOfIndex`), leaving out namespaces the opened file embeds. A pick, drop or replace,
or a definition the document already uses, loads that definition's category and registers the
definition in the document's own registry. The save receives what was loaded as `distribution`
sources. Knip cannot see a glob's use of a dependency, so `knip.json` names the eleven packs as
used by the studio.

### Consequences

Good: the library searches all packs from metadata alone, and a document fetches only the
categories it uses. A saved file is self-contained for what it draws. Bad: a picked entry inserts
after its category loads, a few milliseconds the first time. The studio build carries every pack's
files as separate chunks.

### Confirmation

`apps/studio/src/pack-catalog.test.ts` checks the following:
- all twelve indexes verify and are listed with no category read;
- a search of the full index finds the cylinder and the database icons under `LIBRARY_SEARCH_10K_MAX_MS`;
- a pick reads only its category;
- a save embeds only the loaded definitions, and the reopened file's namespaces stay its own;
- a tampered category is refused.

`e2e/library.panel.spec.ts` lists every pack by name, then picks an entry that is not yet loaded
and checks it is inserted and drawn. `check-layering` holds the studio row.
