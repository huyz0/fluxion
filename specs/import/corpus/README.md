# Frozen import corpus — M18.45

These are inputs, not successful-conversion claims. Freeze them before implementing the
converters (ADR-0049). Never replace a failing fixture with an easier one or remove failed
entries from a denominator. The test seals the complete manifest, checks every input and
notice checksum, and verifies upstream Git blob identities. Any intentional corpus revision
requires a reviewed rationale and must preserve the old measurement evidence.

## Inventory

- **50 SVGs:** 32 distinct upstream Lucide illustrations, unchanged; 18 original Fluxion
  format-stress illustrations. Filled/stroked geometry, relative paths, compound holes,
  transforms, local references, gradients, clipping, masks, markers, text and color mapping
  are represented. Original fixtures are purpose-built geometry, not copies of vendor art.
- **draw.io:** the complete upstream `templates.xml` library has 12 compressed model entries.
  The original stencil library has 12 entries; the original mixed library has 10 entries
  (four uncompressed models, four raw-DEFLATE/URI/base64 models, two embedded SVG images).
  Each library's denominator is its entire entry count. The future >=90% metric applies
  separately to each library, including every unsupported/failed entry.
- **Iconify:** the complete pinned Lucide collection has 1,978 icons and 220 aliases. Its
  preserved `info.total` is 1,903; actual entries, not that advertised count, define inventory.
  Separate original fixtures exercise default dimensions, nested aliases, rotations,
  reflections, hidden entries, categories, character mappings and a deliberate alias cycle.
- Malicious XML/SVG/archive cases remain in `specs/security/corpus` and future converter tests;
  they are not silently counted as successful artwork or used to replace these 50 inputs.

## Provenance and licenses

`manifest.json` pins repositories, immutable commit IDs, upstream paths/blob IDs, notices,
SHA-256 checksums and expected counts. Complete notices live in `licenses/`.

Lucide's ISC notice includes the MIT notice for Feather-derived icons; both are preserved.
The draw.io template file is from the separately Apache-2.0-licensed `jgraph/drawio-libs`
repository. No stencil artwork from the current `jgraph/drawio` repository is copied: that
repository's README adds an asset usage restriction. Original Fluxion fixtures use the
repository MIT license and carry an explicit original-author statement in the manifest.

During selection, Noto and Material Design Light candidates were set aside because their
current README/collection metadata and upstream license notices disagreed. No converter
measurements existed during selection. The selected collection and upstream SVG bytes are
unmodified; sanitization and conversion happen only in later implementation tasks.

Raw SVG and Iconify JSON inputs are excluded from application-source linting/formatting:
adding accessibility titles or reformatting would alter frozen bytes and the inputs being tested. Corpus tests validate their
checksums and provenance; rendered application UI remains subject to accessibility rules.
