---
status: accepted
date: 2026-10-27
decision-makers: packs stream (M18.108; cp11 F4; amends ADR-0194 and the M18.101 `importedShapePack` API, subject to independent review)
---

# ADR-0196 — One shape pack encoder for first-party and imported packs

## Context and Problem Statement

Two encoders wrote declarative 1.0 packs. The SDK's `buildShapePackFiles` (ADR-0194) wrote JSON in
insertion order, used each category text as its slug and validated nothing; the format package's
`importedShapePack` (M18.101) wrote sorted-key JSON, slugged and numbered categories, hashed through
an async host port and validated every file. The same pack could give different bytes and
different hashes depending on which path built it, and a first-party pack was only validated when
its test loaded the files back (cp11 F4).

## Decision Drivers

- The same pack must give the same bytes, whoever builds it (FR-LIB-007, FR-LIB-009).
- A pack must not be written unless the host loader would accept it under the content policy
  (NFR-LIC-003).
- Core stays pure (non-negotiable 5): no host port is needed for SHA-256, which core already has.

## Considered Options

1. **Keep both, add a cross-check test.** Two implementations still drift. Rejected.
2. **Make the SDK call the format encoder.** Puts the SDK on `@fluxion/format` and keeps the async
   port for a pure hash. Rejected.
3. **One pure encoder in core, used by both.** Chosen.

## Decision Outcome

`@fluxion/core` exports `encodeShapePack(draft, licensePolicy)`, `canonicalJson` and the
`ShapePackDraft` / `EncodedShapePack` types:

- canonical JSON (keys sorted at every depth, two-space, trailing newline, `-0` as `0`);
- category slugs from any category text, numbered and never merged; no category is `uncategorized`;
- the index keeps draft order, and each category file keeps that order among its definitions;
- SHA-256 of each category file with core's synchronous hash;
- the index and every category validated by the pack parsers under the caller's policy; an empty
  pack, an id outside the namespace, an invalid definition or unpermitted rights is refused whole.

Callers:

- `buildShapePackFiles(pack, licensePolicy?)` (`@fluxion/sdk`) returns
  `Result<files, Diagnostic[]>`, defaulting to the repository content policy; `DeclarativeShapePack`
  is `ShapePackDraft`. `checkShapePack` reports encoder diagnostics under `loading` and nothing else;
  `shapePackExpectation` throws on them, so a write run never writes a partial pack.
- `importedShapePack` and `iconifyShapePack` (`@fluxion/format`) are synchronous and take no
  `hasher`; encoder paths are reported in the caller's terms (`/entries/<i>/definition`). The
  font-bearing refusal stays in format until pack 1.1 (M18.81).
- The format package's `canonicalJson` re-exports core's.

Where provenance and licence come from: Iconify collections derive name, author, SPDX licence and
an upstream source reference from collection metadata (`iconifyShapePack`). Single SVG and draw.io
library imports carry no reliable rights metadata, so the caller states them from the user's
declaration (their own drawing as an `original` source, or a named upstream with its SPDX licence)
through `importedShapePack`'s options. Declared rights are not ownership checks; the content policy
still refuses licences the repository does not permit.

### Consequences

- Good: one place defines pack bytes; first-party packs are validated when built; the
  `pack/` files of every first-party pack were regenerated once with sorted keys, which is
  allowed because no pack is released yet (version 0.0.0, ADR-0194 pre-release rule).
- Bad: `importedShapePack`/`iconifyShapePack` change from async with a `hasher` option to
  synchronous; in-repo callers are tests only, and the packages are pre-1.0.
- Neutral: pack format 1.0 itself is unchanged; existing packs still load.
