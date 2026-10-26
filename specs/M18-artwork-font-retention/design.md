# Design

[ADR-0192](../../docs/architecture/decisions/ADR-0192-artwork-font-retention.md) defines the version, ownership, rights and compatibility decisions. Resource identity and supported-profile declarations belong in a shared pure lower-layer module; binary acquisition/validation and FontFace effects remain host responsibilities. Core must not import format/render or browser APIs to validate metadata.

Pack 1.1 binds exact resources to source face descriptors, definitions and scoped rights. The version-aware reader validates every reference and canonical subset/lock identity. SDK acquisition verifies actual bytes before returning owned copies. Persistence selects only used definitions, keeps all applicable notices even when bytes deduplicate, and carries generic binary assets without ordinary-family font descriptors. Hosts apply private exact-face aliases only to renderer-facing text; canonical source art remains unchanged.

The old 1.0 parser contracts stay strict. Any widened existing public return type is an explicit pre-1.0 compatibility change with migration notes, minor changeset and generated API report. Test original old-reader rejection of known 1.1 locks before relying on unchanged document/container versions. Do not simulate old-reader behavior using the new parser.

Use normalized text closure already established by SVG import/witness validation; do not introduce a second family-guessing algorithm. Share the supported profile's exact identity between metadata, acquisition and witness checks without reversing package dependencies. The new writer preflight is explicitly limited to font-retaining portable preparation and includes all final entries against effective destination loader limits.

Real acceptance uses different font bytes under the same source family, offline archive/inline reopen, missing/corrupt font refusal, many aliases across packs, scoped credit pruning, ownership/cancellation and browser/CLI parity. Pure parser tests alone cannot qualify the feature.
