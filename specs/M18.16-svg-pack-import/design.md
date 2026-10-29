# Design

Contract: [ADR-0206](../../docs/architecture/decisions/ADR-0206-svg-pack-import-command.md).

`packages/cli/src/pack-import.ts` (command), `pack-import-rights.ts` (flags or `--credits` file → pack
license, scoped credits, member coverage), `pack-import-input.ts` (bounded folder walk → `SvgBatchInput`;
a ZIP's size checked before it is read), `pack-import-write.ts` (temporary sibling, read-back check, rename). Flow:
parse flags (usage errors first, exit 2) → rights → read input → ids/categories from paths (empty or
invalid slugs and collisions refused, naming paths) → every member credited exactly once →
`createNodeSvgPaintWitness({ theme: LIGHT_THEME, fonts: [Inter] })` → `importSvgBatch` → all accepted or
exit 1 → `importedShapePack` (entries keep their category text; scoped credits; fonts: Inter with
fonts-core rights) →
write → `checkShapePackFiles` → rename → reply. The witness session is disposed in `finally`.

Alternatives rejected: a `.flux` output (not installable); partial packs (ADR-0188); following
symlinks inside the root (traversal by indirection); inferring rights from SVG metadata (ADR-0050).

Contracts touched: CLI `--json` (new command, `pack-import.output.json`, CLI minor), format importer
(face keying; optional scoped `credits`, additive, format minor). Risks: the 120 s witness lifecycle bounds one batch; the 50-input
corpus already qualified under it (M18.80). WebKit/Firefox witness runs remain M18.80's.

Tests first: usage, input bounds and writer atomicity as unit tests with injected fs/witness ports;
then the e2e corpus/bounds suite against the built bin; then the schema contract test.
