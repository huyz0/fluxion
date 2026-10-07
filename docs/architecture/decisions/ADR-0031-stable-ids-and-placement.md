---
status: accepted
date: 2026-10-07
decision-makers: harness (M12.3; an additive schema minor under ADR-0003 and contracts.md, within FR-DSL-002/005; no requirement changes)
---

# ADR-0031 — Stable ids from slugs, layout specs on screens and containers, deferred FluxScript in the document: schema 1.3

## Context and Problem Statement

Compiling the same FluxScript twice must give byte-identical `.flux.json` (NFR-REL-005, FR-FIL-005). Recompiling one screen of an edited source must keep the
ids of the records that did not change, so that undo, selection, the source map and git diffs stay meaningful (FR-DSL-002, FR-EDT-022). Record ids today come
from the `Random` port (ADR-0012), so the compiler needs another source. The document can also not yet say how a screen or a container lays out its children
(FR-DSL-005), and it has no place for the FluxScript sections that ADR-0030 defers.

The tree at M12 already has `element.placement?: 'auto' | 'pinned'` and `element.semantic.slug` (unique per document, `FLX_SLUG_DUPLICATE`). It does not have
`screen.layout`, a container layout, or `document.source`. The only hash port is `Hasher.sha256(bytes): Promise<string>`, which is async, so a pure synchronous
compile cannot use it.

## Decision Drivers

- Determinism: the same source, catalog and salt give the same ids on every host, with no clock and no randomness (NFR-REL-005; pure core, non-negotiable 5).
- Stability: renaming a label or reordering nodes must not change an id. Only changing a slug may.
- Ids must be valid record ids (`[A-Za-z0-9_-]{1,64}`, ADR-0012).
- Additive contract change: older documents migrate, and older readers keep the fields as unknown data (02 §7).

## Considered Options

1. **Ids as `slug` itself.** Readable, but slugs are only unique per document, screen ids share the same spelling, and a document merged from two sources
   collides.
2. **`base62(hash128(docSalt + ':' + key))` through a synchronous port** (06-ai-authoring.md §3). The id is opaque, has 128 bits, and is stable for as long as
   the key is.
3. **Random ids, kept in a slug-to-id side table in the document.** Stable once written, but the first compile depends on the `Random` seed, two hosts compiling
   the same file disagree, and the table is one more contract.

For the hash in option 2:

- **(a) SHA-256 truncated to 128 bits.** The repository already has a pure, tested SHA-256 (`packages/format/src/sha256.ts`) with FIPS test vectors. It is
  slower than a non-cryptographic hash, but a compile hashes at most a few thousand short keys.
- **(b) MurmurHash3 x64-128 or xxHash128.** Faster, but it is new code with 64-bit arithmetic in 32-bit JavaScript, and nothing in the repository checks it.

## Decision Outcome

Chosen option **2 with hash (a)**.

### Ids

- `SyncHash128` is a port in `@fluxion/core`: `hash128(text: string): Uint8Array` returns 16 bytes, computed over the UTF-8 bytes of `text`. The default
  implementation is the first 16 bytes of SHA-256. The pure SHA-256 moves from `format` to `core`, and `format` re-exports it, so its public API is unchanged.
- `stableId(salt, key) = base62(hash128(salt + ':' + key))`. The bytes are read as one big-endian 128-bit number and written in base 62 (`0-9A-Za-z`),
  zero-padded to **22 characters**. These are valid record ids.
- **Salt.** One salt per document, kept in `document.source.salt` and reused by every later compile into that document: a screen recompile into a base
  document reads the base's salt, never its id, so records that did not change keep their ids. A first compile takes the salt from `CompileOptions.salt`.
  Without one the salt is the empty string, so a whole-file compile is a function of the source alone (the determinism tests and the CLI default). Hosts
  that create a new document from FluxScript (the studio, `fluxion compile --new`) pass a fresh random salt from their `Random` port, so two unrelated decks
  do not share ids. Ids are unique within a document (FR-DOC-002); documents compiled with the same salt can share ids, and bringing records from one
  document into another re-ids them, as paste and import already do (ADR-0020).
- **Keys.** The document is `document`. The theme is `theme:<name>`. A screen is `screen:<id>`. A node or group is `node:<slug>`. An edge is
  `edge:<screen>:<from>:<op>:<to>`, plus `:<n>` for the n-th repeat of the same edge on the same screen (n ≥ 2).
- Records created by hand in the editor keep random ids (ADR-0012). Decompiling writes their `semantic.slug` (generated from the label when missing, 02 §3).
  A later compile then derives a new id from that slug, and the source view maps the old id to the new one in one undo step (ADR-0032).

### Schema 1.3 (additive minor)

- **`LayoutSpec = { type: string; options?: { [key: string]: Json } }`.** `type` is a `layouts` registry name: a built-in such as `stack`, or a qualified
  `pack:name`. The options belong to that layout and are validated by it, not by the record schema.
- **`screen.layout?: LayoutSpec`.** The screen is the root container.
- **`layout?: LayoutSpec` on `group` and `frame` elements.** Their members are laid out inside them.
- **`element.placement`** already exists. Layout moves only `auto` elements, and a human drag sets `pinned` (06 §3).
- **`document.source?: { flux: 1; salt: string; deferred: { [pointer: string]: string } }`.** `salt` is the id salt above. `deferred` holds the YAML text of each section ADR-0030 defers, keyed by a pointer into
  the FluxScript (`/vars`, `/screens/arch/steps`, `/screens/arch/nodes/sla`). Screens are addressed by id, not by index. The decompiler writes these sections
  back in place, and a later compiler compiles them. It is not the whole source: the `.flux` container's optional `source/document.flux.yaml` (08) remains
  the place for the original file.
- **Migration 1.2 to 1.3** adds nothing, because every new field is optional. As with earlier migrations, a 1.2 document carrying a non-conforming value
  under one of these names is normalised by dropping that value, with a warning. A fixture covers it.

### Consequences

- Good, because ids are a pure function of the source, so compiled output diffs cleanly and a recompile keeps selection and undo.
- Good, because the hash is code the repository already tests.
- Good, because deferred sections survive editing and round trips, so later milestones only add compilation.
- Bad, because ids are 22 characters, not the 16 of generated ids. Both fit ADR-0012's accepted form.
- Bad, because renaming a slug changes the id, so the source view has to map it (ADR-0032).

### Confirmation

- `m12-complete`'s ADR leg checks that this ADR names hash128, base62, placement, `screen.layout`, 1.3 and the migration.
- M12.5: schema 1.3 migration and round-trip tests with fixtures.
- M12.6: known vectors for the hash and base62, and no id collision over a 10k-slug corpus.
- M12.14 and M12.17: a source compiled twice is byte-identical.

## More Information

ADR-0003 (file format), ADR-0012 (ids), ADR-0030 (grammar). Architecture: 02-document-model.md, 06-ai-authoring.md §3, 08-file-format.md.
