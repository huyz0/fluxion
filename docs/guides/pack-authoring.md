# Authoring shape packs

> Read when: writing or changing a first-party shape pack, importing a library into a pack, or changing what a saved file keeps of a pack.

A shape pack is data, never code: a licensed `index.json`, hashed category files of core `ShapeDef`s, optional fonts
and an optional `connectors.json`. The format and its rules are in [09 — Extensibility](../architecture/09-extensibility.md)
(sections "First-party declarative pack suite" onward) and [08 — File format](../architecture/08-file-format.md); this
guide is the order to do things in. Executable plugins are M27 and are not covered here.

## 1. Versioning (ADR-0048, ADR-0194, ADR-0210)

- **Format version.** `formatVersion` is chosen by the encoder, never by hand. 1.0 is geometry and credits. 1.1 adds
  exact artwork fonts (`fontResources`, `fontFaces`, `definitionFonts`, `fontCredits`, ADR-0192). 1.2 is 1.1 plus a display
  `name` on a category whose source text is not its slug's own title form (ADR-0210). A pack without fonts or names keeps
  its 1.0 bytes; a writer never downgrades. Readers accept 1.0, 1.1 and 1.2; 1.0 and 1.1 refuse the later fields.
- **Pack version.** A first-party pack's `version` is its package version (`VERSION` in `src/index.ts`). The ledger
  `pack-versions.json` maps each released version to its category hashes; changing geometry at a recorded version fails
  the pack test until the package version is bumped (`pnpm changeset`, then `pnpm run version-packages`, which runs
  `scripts/packs/sync-versions.mjs` to rewrite every pack's `VERSION` and files). `0.0.0` is never recorded.
- **Definition ids** are `<pack id>:<name>` and stay stable across versions: a saved file names them, and a rename is a
  new definition.

## 2. Writing a first-party pack

1. Add the workspace to `tools/gen/workspaces.json` (`layer: "Pack"`, `dependsOn: ["sdk"]`), then run
   `node tools/gen/package.mjs packs/<id>`, which creates the missing manifest, tsconfig and source files. The package
   imports only `@fluxion/sdk`.
2. In `src/index.ts` export `<id>Source: DeclarativeShapePack` (id, version, name, license, attribution, credits, and the
   definitions named through `namedShapeDefs(shapes, NAMES)`) and `<id>Pack = definePack(...)` for hosts that register in
   code. Every shape needs a `describe` line (the AI catalog refuses an undescribed entry, `FLX_REGISTRY_UNDESCRIBED`).
3. `src/pack.test.ts` calls `testShapePack(<id>Source, globs)` from `@fluxion/sdk/testing` with the five
   `import.meta.glob` results, as `packs/flowchart/src/pack.test.ts` does (ADR-0199). It only compares.
4. Write the distribution and goldens with `VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run packs/<id> -u`, inspect the
   goldens, then run once more without the variable. `buildShapePackFiles` encodes through core's one encoder
   (ADR-0196), so the files are what an imported pack of the same content would be.
5. `checkShapePack` (inside the test) fails on changed, missing or extra files, loader diagnostics, vendor brand names,
   geometry leaving its box at any param bound or at 16 units, and the version ledger. Fix the source, not the files.

## 3. Licenses and credits (ADR-0050)

- Content licenses are checked against `SHAPE_CONTENT_LICENSES` (core); `check-licenses --packs` refuses a first-party
  index, credit or definition whose license is missing or not on that list, or whose attribution or notice is missing.
  A content license never authorizes a code dependency, and the package itself stays MIT.
- Every definition is covered by a credit: `original` (an author and a statement) or `upstream` (a reference and the
  upstream bytes' SHA-256, which `packs/icons-lucide/src/provenance.test.ts` shows how to check). Rights are declared,
  never inferred from a file (ADR-0206).
- A saved file keeps the global credits and the scoped credits of the definitions it uses, with their notices; the
  studio's Credits dialog and the player's chrome show them offline (M18.143).

## 4. Imports (ADR-0049, ADR-0186–0189, ADR-0206)

- **SVG folder or ZIP to a pack directory:** `fluxion pack-import <folder | file.zip> -o <out-dir> --namespace <ns>
  --version <semver> --name <text> --credits <file.json>` (or the one-credit flags `--license`, `--attribution` and
  `--author` or `--upstream` with `--upstream-sha256`). Members are bounded, named by their paths, painted by the Node paint witness (ADR-0189) and
  converted all or nothing (ADR-0188); the output is checked by the artwork loader and written atomically. Text in the
  artwork is bound to the exact Inter face, which makes the pack 1.1.
- **In the studio:** the library panel's **Import SVG…**, **Import Iconify…** and **Import draw.io…** convert in the
  browser under the same rules (`convertSvgLibrary`, `convertCollectionLibrary`; witness, rights before any witness,
  refusals listed by member) and register one new namespace. Iconify uses the collection's own SPDX license and refuses a
  collection without one; draw.io and SVG use the rights the user declares. The imported pack's source is kept, so a
  save embeds the used definitions (FR-LIB-009).
- draw.io XML is read by a strict bounded reader with no entities or scripts; external images become placeholders and
  unsupported entries are refused but stay in the import's denominator (ADR-0049).

## 5. Used-definition persistence (ADR-0048, ADR-0182–0185)

- A save embeds only the definitions the document uses (group children included) as a saved subset under a data-only
  lock, with their credits and, for 1.1 and 1.2, their exact font bytes as `assets/<sha256>.woff2`. The file reopens
  drawn and credited without the pack; a missing or changed font refuses the file rather than substituting a face.
- A namespace the opened file embeds stays the file's: an installed pack of the same id never replaces it.
- Pack connector types (`connectors.json`, ADR-0048 amendments M18.38, M18.111, M18.112) are saved the same way, one
  `connectors/<pack>.json` entry with the used types, and registered again on open. Gap: the studio and CLI do not yet
  load a pack directory's own `connectors.json` (row M18.233); no first-party pack ships one today.

## 6. Fonts (ADR-0051, ADR-0192, ADR-0201)

- Artwork text needs the exact face it was witnessed with; registration uses the private family
  `fx-artwork-<sha256>`, so it never shadows the document's own fonts.
- Subsetting on save is optional (the studio's assistant settings option "Subset embedded fonts to the text they draw
  when saving", off by default; CLI `convert --subset-fonts`): HarfBuzz subset
  WASM and the WOFF2 codec, pinned by hash, keep every glyph the document's text can draw; a font whose license reserves
  its name, a variable font, an unverified upload or a subset that is not smaller is kept whole, with the reason.

## 7. AI catalog (ADR-0211, ADR-0212)

`buildCatalog` lists the host's `core` registrants entry by entry and every other pack as one summary line naming the
`pack` to ask for; `buildCatalog(registries, { detail: 'full', pack })` lists one pack. Gap: `fluxion catalog --pack`
and MCP `list_catalog({ pack })` (ADR-0212, row M18.218) are not on main yet; today the CLI and MCP bundle only
`basic`, so their catalogs carry no summary lines.

## Checklist before a commit

- `pnpm exec vitest run packs/<id>` passes without the write variable.
- `node scripts/gates/check-licenses.mjs --packs` passes.
- A changeset names the pack when its geometry or credits change.
