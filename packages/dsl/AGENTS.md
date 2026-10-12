# @fluxion/dsl — agent notes

FluxScript (`flux: 1`): parser, compiler, decompiler, streaming compiler, diagnostics. Mermaid/Markdown importers: M15, not here.
Grammar: ADR-0030. Ids and salt: ADR-0031. Source view: ADR-0032. Architecture: docs/architecture/06-ai-authoring.md §3.

## Rules

- Layer L2: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by `check-layering`.
- **Pure package**: no DOM, timers, `Date.now`, `Math.random`, network or `node:*`. Inject ports (`Clock`, `Random`, `TextMeasurer`, `FileIO`). `stats` holds counts only: no clock.
- Public API lives in `src/index.ts` (`@fluxion/source` condition; ADR-0011); every export needs TSDoc and a release tag. The stage functions and AST types are exported but internal-to-be (M26 row 16a): do not build on them.

## Pipeline (`src/compile.ts`)

parse → read → resolve → expand (the style stage is inside it) → place → validate. Later stages run whatever earlier ones reported; only unparseable text or a file that is not a `flux: 1` mapping stops with no `doc`.

| Dir | Stage |
|---|---|
| `parse/` | `yaml` tree with ranges (`parse.ts`), edge tokenizer (`edge.ts`) |
| `read/` | key table `KEYS` and `fluxScriptKeys()` (`fields.ts`), typed AST (`read.ts`, `ast.ts`); UNKNOWN_KEY, VERSION, BAD_SLUG, EDGE_SYNTAX |
| `resolve/` | slugs, shapes through `uses:`, did-you-mean (`suggest.ts`) |
| `expand/` | records, ids, groups, connectors and bindings; `style.ts` = tokens, tone |
| `place/` | pins kept, the rest through the screen `layout` (built-in `stack`) |
| `validate/` | `@fluxion/schema` validate, diagnostics pointed at source; lenient auto-fix |
| `stream/` | `split.ts`, `compile-stream.ts`, `upsert.ts` (screen-owned records replaced, others kept) |
| `decompile/` | document to FluxScript; what it cannot express is counted in `kept` |
| `diagnostics/` | `codes.ts` (`DSL_CODES`), `format.ts` |

## How to add

- **A key**: add it to `KEYS` in `read/fields.ts` (compiled or deferred), read it in `read.ts`, use it in `expand/`, emit it in `decompile/`; update ADR-0030's table (additive only, an amendment line), the TextMate grammar and the guide. `read/key-table.test.ts` checks the table's shape.
- **A code**: add it to `DslCode` and `DSL_CODES` in `diagnostics/codes.ts`, then `node scripts/docs/fluxscript-diagnostics.mjs` (the docs page is generated; `--check` fails on drift). Codes are never renamed.
- **A stage**: a pure function `(input, options) → { output, diagnostics }` in its own directory, wired in `compile.ts`; update ADR-0030 "Pipeline stages", 06 §3 and this table.
- A deferred section becomes compiled by moving its key from `deferred` to `compiled`, in a new ADR amendment, with the compile and the decompile in the same commit.

## Do not break

- **Byte-identical output**: same text, options and registries give the same `serializeDocument` bytes; no `Map`/`Set` iteration order, no object-key order that depends on input.
- **Stable ids**: `id = base62(hash128(salt + ':' + key))` (ADR-0031). Key formats (`screen:<id>`, `node:<slug>`, `edge:<screen>:<from>:<op>:<to>[:n]`, `<edge key>:source`/`:target`) are a contract; a base's kept salt wins.
- `compile(decompile(doc))` equals `doc` (round-trip property test); deferred sections survive a compile in `document.source`.
- `createStreamCompiler` after `end()` equals `compile` of the whole text.

## Tests and gates

- Co-locate `*.test.ts` next to the code; name tests with requirement IDs. T0 (node) only — no DOM in tests.
- `pnpm --filter @fluxion/dsl test:examples` runs `scripts/dsl/examples.test.ts`: every `examples/dsl/*.flux.yaml` (compile, determinism, round trip) and every `yaml flux` block of the guide `apps/docs/src/content/docs/guides/writing-fluxscript.md`. It lives outside the package because it needs packs (L-host).
- `node scripts/gates/m12-complete.mjs` is the milestone gate; `bench/compile-10.bench.ts` holds `DSL_COMPILE_10_MAX_MS`.
- Editor side (`packages/editor/src/source-view/`): the Lezer/CodeMirror layer (`fluxscript-tokens.ts`, `fluxscript-language.ts`), completion, merge and sync; it uses the dsl tokenizer so highlighting and compiler agree. The TextMate grammar is `grammar/fluxscript.tmLanguage.json`, checked against `examples/dsl`.
