---
status: accepted
date: 2026-10-29
decision-makers: import stream (M18.171 plan for M18.16; ADR-0188/0189/0192 follow-up, subject to independent plan review)
---

# ADR-0206 — `fluxion pack-import`: a folder or ZIP of SVGs becomes one checked 1.0/1.1 pack directory, or nothing

## Context and Problem Statement

M18.79 gives a pure bounded batch report (`importSvgBatch`, ADR-0188), M18.80 a production Node
paint witness (`createNodeSvgPaintWitness`, ADR-0189), and M18.81 turns accepted definitions and
their exact fonts into a 1.0 or 1.1 pack (`importedShapePack`, ADR-0192). No host joins them:
FR-LIB-004 asks for a folder or ZIP of SVGs to become usable shapes (the 50-SVG fixture: 50
shapes, at least 4 anchors each), with traversal and decompression bombs failing within defined
limits. ADR-0188 left the CLI transaction, its `--json` reply and its rights flags undecided, and
the M18 completion leg still names an editor wrapper test that cp9 F3 ruled out.

## Decision Drivers

FR-LIB-004 (50 usable shapes, bounded rejection), FR-CLI-001/005 (one `--json` reply, exit codes),
NFR-SEC-001 (no traversal, bounded memory and time), NFR-LIC-003 and ADR-0050 (rights declared,
never inferred; content policy has no permissive default), ADR-0192 (only the pinned Inter profile).

## Considered Options

1. **A CLI command that writes a pack directory atomically.** Reads the input itself (folder walk
   or ZIP bytes), runs the batch with the shipped witness, encodes with `importedShapePack`, checks
   the written files with the sdk suite's loader, then renames into place. Chosen.
2. **Write a `.flux` with the shapes on a screen.** Mixes import with document authoring and
   cannot be installed as a library pack; rejected.
3. **Accept partial batches (write what converted, report the rest).** ADR-0188 says success needs
   `acceptedCount === inputCount`; a partial pack would silently drop sources. Rejected.

## Decision Outcome

Grammar: `fluxion pack-import <folder | file.zip> -o <out-dir> --namespace <ns> --version <semver>
--name <text> (--credits <file.json> | --license <spdx> --attribution <text> (--author <text> |
--upstream <reference> --upstream-sha256 <hex>) [--notice-file <path>]) [--browser
chromium|firefox|webkit] [--json]`.

- **Rights are declared, never inferred, per member.** Inputs often mix rights (the corpus holds
  ISC/MIT Lucide icons and MIT originals), so `--credits` names a JSON file: the pack's `license`
  (SPDX expression) and `attribution`, and `credits[]`, each `{ id, license, attribution, notice |
  noticeFile, source, members: [path] }` with `source` an ADR-0050 `ShapePackSource` as declared.
  Every member is in exactly one credit (a member in none or two is refused before any witness),
  and each credit is scoped by `definitionIds` to its members' definitions. The flag form is the
  one-credit shorthand covering every member: `--author` declares original work (`{kind:
  'original', author, statement}`), `--upstream` with `--upstream-sha256` a named upstream
  (`{kind:'upstream', reference, sha256}`); the notice is `--notice-file`'s text, else
  `<attribution>, licensed <license>.`. Hashes are declared, never computed from the input, so a
  folder and a ZIP of the same members give the same bytes. Every license is checked by
  `allowsShapePackContentLicense`. `importedShapePack` gains an optional scoped `credits` list for
  this and its result the canonical `files` map the CLI writes (both additive; the single-credit
  options stay, and the flag form's one credit is the pack's unscoped credit). An upstream member
  is credited on its own: one credit per member whose `reference` is
  `<repository>@<commit>:<upstreamPath>` and whose `sha256` is that member's declared hash, so a
  pin names exactly the bytes it covers (M18.171 r2 F1).
- **IDs and categories from paths.** ADR-0188 keeps the pure batch free of slug inference; this host
  derives the explicit `ids` map it passes. A member `a/b/My Icon.svg` gets id `<ns>:my-icon`: the
  basename without `.svg`, lowercased, each run of characters outside `[a-z0-9]` to one `-`, leading
  and trailing `-` trimmed. A member whose slug is empty or does not give a valid qualified id
  (core's `parseShapeDef` id rule), and two members with one id, are refused before any witness,
  each diagnostic naming the member path(s). Category text is the member's directory (`a/b`); the
  root is `uncategorized`.
- **Bounds.** ZIP: the file's size is checked (`stat`) before it is read, refusing more than 256 MiB;
  then it is listed once with `readZip` under `importSvgBatch`'s bounds (4096 entries, 128 MiB per
  entry, 256 MiB in total, strict names), and its members go to the batch as `{kind:'files'}`
  (M18.171 r2 F2); an absolute, backslash, empty, `.` or `..` member name is refused there, before
  any witness, and again by the batch's own preflight. Folder: the CLI walks with
  `lstat`, refuses any symlink, device or other non-regular entry, and stops reading before the
  same caps are passed; dot-files are members like any other. A decompression bomb fails on the
  declared and the inflated size caps without inflating past them.
- **Every member must convert.** A non-SVG member, a refused SVG or a witness failure fails the
  whole import (exit 1); each diagnostic names its source path. Nothing is written.
- **Witness sessions.** A Node session admits 128 requests and lives 120 s (ADR-0189), so the batch
  is witnessed by successive sessions, each replaced after 128 requests or 90 s and disposed with
  its disposal checked before the next starts. A session that cannot start or close fails the
  import with its own diagnostics (exit 2 for a missing browser peer, else 1); no member after it
  is counted as painted.
- **Fonts.** The witness and the importer get one face: `@fluxion/pack-fonts-core`'s Inter 400
  normal, the only supported artwork profile, with its own rights (OFL-1.1, its copyright and
  `OFL.txt`) and as the default face for text that names none. Text in another family is refused
  by the converter. A pack with text is a 1.1 that carries `fonts/<sha256>.woff2`.
- **Output.** `-o` must not exist. The pack (`index.json`, `categories/*.json`, `fonts/*.woff2`)
  is written to a sibling temporary directory, read back through `createArtworkShapePackLoader` (the
  version-aware artwork loader `checkShapePackFiles` uses, every definition acquired), then renamed to `-o`; any failure removes the temporary directory.
- **Reply.** `result`: `{ pack: { id, version, formatVersion, dir }, inputCount, svgCount,
  acceptedCount, definitions: [{ id, name, category, source, sourceSha256, anchors, fonts }],
  files: [path] }`, validated by `packages/cli/schemas/pack-import.output.json`. Exit 1 for input
  and rights refusals, 2 for usage and a missing browser peer (`FLX_CLI_PEER_MISSING`, as `render
  --format png`), 3 internal. No MCP tool: the command needs a local browser.

## Consequences

- Good: one honest transaction from files to an installable pack; same bytes for the same inputs
  and flags; the corpus test exercises the shipped witness and encoder together.
- Bad: one non-SVG file (a README) fails a folder import; users pass a folder of SVGs only. Only
  the Inter profile is usable until more profiles exist (M18.48/39/40).

## Confirmation

`packages/cli/src/e2e/cli.pack-import.test.ts` against the built bin and Chromium: the 50-SVG corpus
as a folder and as a ZIP gives 50 definitions with at least 4 anchors each and byte-identical
packs that check clean, under a `--credits` file built from `specs/import/corpus/manifest.json`
(Lucide members credited to their upstream, originals to Fluxion), each credit scoped to exactly its
members' definitions; traversal, symlink, bomb, oversized-archive, entry-count, id-collision,
empty-slug, uncredited-member, unpermitted-license, existing-output and partial-conversion inputs
exit 1 within 10 s and leave nothing; a text SVG
gives a 1.1 pack with its font. The output schema contract test validates every reply. The M18
completion leg "50 SVG batch imports, bounded ZIP and traversal rejection" runs this suite and
`packages/format/src/svg-batch.test.ts`, no editor wrapper (cp9 F3).

## Links

ADR-0036, ADR-0050, ADR-0147, ADR-0187, ADR-0188, ADR-0189, ADR-0192, ADR-0196.
