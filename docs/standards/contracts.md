# Contracts

> Read when: changing anything another party depends on — a public export of `@fluxion/*`,
> the document schema or file container, FluxScript grammar, `fluxion … --json` output, an MCP
> tool/resource schema, or the plugin manifest — or deprecating any of them.
> Family: Code · Related: [sdd.md](sdd.md), [testing.md](testing.md), [documentation.md](documentation.md)

A contract is a surface someone outside the changing package relies on without reading our
code: plugin authors, saved files from years ago, AI agents parsing JSON. Breaking one silently
is the most expensive mistake an agent can make here, so every contract has a machine-readable
snapshot that turns a change into a visible diff.

## 1. Contract surfaces

| Surface | Snapshot (source of truth for diffs) | Version carried by | Gate |
|---|---|---|---|
| Public SDK / package API | `packages/<pkg>/api/<pkg>.api.md` (API Extractor) | package semver (Changesets) | `api` CI job, `check-drift.mjs` |
| Document schema | `packages/schema/generated/document.schema.json` + fixtures `packages/format/fixtures/v<x.y.z>/` | `schemaVersion` (semver) in every document | `check-drift.mjs`, format round-trip in `precommit.mjs` |
| File container (`.flux`, `.flux.html`, `.flux.json`) | `packages/format/fixtures/containers/` | `schemaVersion` + container `formatVersion` | round-trip fixtures |
| FluxScript DSL | `packages/dsl/grammar/fluxscript.grammar.md` + `packages/dsl/fixtures/` (source → expected doc) | `fluxscript: <major.minor>` header | DSL fixture suite |
| CLI `--json` output | `packages/cli/schemas/<command>.output.json` | `"apiVersion"` field in every JSON reply | `cli` contract tests |
| MCP tools/resources | `packages/mcp/generated/tools.json` (names, input/output JSON Schemas) | server `version` + per-tool schema | `mcp` contract tests |
| Plugin manifest | `packages/sdk/generated/manifest.schema.json` | `engine` range in manifest | `check-drift.mjs` |

Anything not listed (internal modules, non-exported types, `@internal` TSDoc) is not a contract
and changes like any other code.

## 2. Universal rules

| # | Rule | Enforced by |
|---|---|---|
| 1 | Snapshots are **generated**, never hand-edited, and committed in the same commit as the change that alters them. | `check-drift.mjs` (regenerate + diff) |
| 2 | Additive change (new optional field, new export, new command, new tool) = **minor**. Removal, rename, type narrowing, new required input, changed meaning = **major**. Fix with no surface change = **patch**. | `api` job + Changesets check |
| 3 | A **major** change requires an ADR (`docs/architecture/decisions/ADR-NNNN-*.md`, MADR 4), a changeset of type `major`, and a migration path in the same commit. | `check-drift.mjs` (major without ADR ref fails) |
| 4 | Contract changes that were not in the milestone plan stop the drive loop for a human decision. | no gate — drive stop condition |
| 5 | Every public symbol has TSDoc with `@public`, `@beta`, `@internal`, or `@deprecated`. | API Extractor (`ae-missing-release-tag` as error) |
| 6 | Validation lives at the boundary: inputs crossing a contract are parsed with the Zod schema, never cast. | reviewer; Biome bans `as` on boundary modules |

## 3. Public SDK API

- `@fluxion/sdk` re-exports the stable plugin surface; packs import only from it (FR-EXT-001).
- `@beta` symbols may change in a minor with a changeset note; `@public` symbols follow rule 2.
- Pre-1.0 packages (`0.x`) still follow rule 2 shifted one place (breaking = minor bump) and
  still need an ADR for breaks to `sdk`, `schema`, or `format`.
- Review packets for commits touching `api/*.api.md` include the full report diff.

## 4. Document schema and file format

| # | Rule | Enforced by |
|---|---|---|
| 7 | `schemaVersion` is semver. **patch**: docs/validation message fixes, no shape change. **minor**: new optional fields or record kinds; older readers preserve unknown fields (FR-DOC-005). **major**: anything an older reader would misread; ships with a converter (NFR-PORT-003). | format fixture suite |
| 8 | Every schema change lands in **one commit** with: the Zod schema, a migration in `packages/schema/src/migrations/<from>-to-<to>.ts` (for minor/major), a new fixture folder `fixtures/v<new>/`, round-trip tests, regenerated JSON Schema, an ADR, and updated `apps/docs` format reference. | `check-drift.mjs`, reviewer |
| 9 | Migrations are pure, ordered, idempotent functions; each is tested from **every** earlier released fixture to current (FR-DOC-003). | property + fixture tests |
| 10 | Released fixture folders are immutable. A bug in an old fixture is handled by a new migration, never by editing the fixture. | `check-tests-kept.mjs` (fixtures count as tests) |
| 11 | Round-trip invariant: `read(write(doc))` deep-equals `doc`, including unknown fields and plugin data. | T0 property test |
| 12 | Loading never throws: invalid input yields structured errors with JSON-pointer paths (FR-DOC-004, NFR-REL-002). | fuzz test |

## 5. FluxScript DSL

- The grammar document is normative; the parser is its implementation. Change both in one commit.
- New keywords/shorthands are **minor** only if no previously valid script changes meaning.
  Otherwise **major**: bump the `fluxscript:` header major, keep the old parser mode for one
  major, and ship `fluxion migrate --dsl`.
- Every grammar change adds fixtures (source → expected document) and error fixtures with
  suggested fixes (FR-DSL-006), and updates the AI authoring guide and `llms.txt` (FR-AI-011).
- Token-efficiency (NFR-AI-003) and eval scores (NFR-AI-001) are re-measured on grammar changes;
  a drop is a threshold change.

## 6. CLI `--json` and MCP

| # | Rule | Enforced by |
|---|---|---|
| 13 | Each `--json` reply is one JSON object with `apiVersion`, `ok`, and either `result` or `errors[]`; it validates against its committed output schema. Human text never goes to stdout in `--json` mode. | CLI contract tests |
| 14 | Exit codes are part of the contract: `0` ok, `1` validation/lint errors, `2` usage error, `3` internal error. | CLI contract tests |
| 15 | MCP tool names, input schemas, and output shapes are generated from the same Zod schemas as the CLI ops; a CLI op and its MCP tool never diverge. | `tools.json` drift check |
| 16 | Renaming an MCP tool or CLI command is major: keep the old name as an alias that emits a deprecation notice for one major. | reviewer |

## 7. Deprecation policy

| Step | What | When |
|---|---|---|
| 1. Mark | `@deprecated <replacement> — since x.y, removal in next major` in TSDoc; CLI/MCP emit a `deprecations[]` entry; DSL emits a lint warning | minor release |
| 2. Document | changeset + migration note in `apps/docs` "Upgrading" page | same commit |
| 3. Keep | deprecated surface works unchanged for ≥ 1 minor and until the next major | — |
| 4. Remove | major release with ADR, changeset, codemod or migration where feasible | next major |

Saved documents are never "deprecated away": every released `schemaVersion` stays loadable via
migrations forever (NFR-PORT-003).

## Examples

| Change | Class | Needs |
|---|---|---|
| Add optional `cornerRadius` to rect shape | schema minor | migration not needed (default), new fixture, round-trip, ADR, docs |
| Rename `Connector.via` → `waypoints` | schema major | migration, converter, fixtures, ADR, changeset major |
| Add `fluxion catalog --json` field `packs[]` | CLI minor | output schema update, changeset minor |
| Change `apply_patch` to require `docId` | MCP major | ADR, alias period, changeset major |
| Export new helper from `@fluxion/sdk` as `@beta` | API minor | TSDoc, API report, changeset |
