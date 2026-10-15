# @fluxion/dsl

FluxScript: the YAML text form of a Fluxion document. Compiler, decompiler, streaming compiler and diagnostics.
Mermaid and Markdown importers are not here yet (M15).

| Layer | Pure | Status |
|---|---|---|
| L2 | yes | M12 — `flux: 1` compile, decompile, streaming, diagnostics, TextMate grammar |

Pure: no DOM, timers, clock, randomness, network or `node:*`. The same text, options and registries give the same document,
byte for byte once serialized (`serializeDocument` of `@fluxion/schema`).

```ts
import { compile, decompile, formatDiagnostics } from '@fluxion/dsl';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { basicPack } from '@fluxion/pack-basic';
import { createCoreRegistries } from '@fluxion/sdk';

const registries = createCoreRegistries();
basicPack.register(registries); // the packs your text names in `uses:`
registerBuiltInLayouts(registries.layouts);

const { doc, diagnostics } = compile(text, { registries }); // text is a *.flux.yaml
for (const line of formatDiagnostics(diagnostics)) console.error(line);
const flux = doc ? decompile(doc, { registries }).text : '';
```

## Public API

| Export | Purpose |
|---|---|
| `compile(text, { registries, base?, salt?, mode?, hasher? })` | FluxScript to `{ doc?, diagnostics, sourceMap, stats }`. With `base`, the text's screens are upserted into that document and its salt is kept. `mode: 'lenient'` removes a field the schema refuses and warns. |
| `decompile(doc, { registries, screens? })`, `decompileScreen` | Document to canonical FluxScript, `{ text, kept, slugs }`. `compile(decompile(doc))` equals `doc`. |
| `createStreamSplitter()`, `createStreamCompiler(options)` | Cut an AI text stream into the header and one block per screen, and compile each into a running document. After `end()` it equals the compile of the whole text. |
| `formatDiagnostics(diagnostics, { cap? })` | One line each: `L7:12  error   FLX_DSL_UNKNOWN_KEY  … — hint: did you mean "shape"?`; ranked, deduplicated, capped (default 20). |
| `DSL_CODES` | Every FluxScript diagnostic code with its severity and description. Codes are stable. |
| `fluxScriptKeys()` | The `flux: 1` key table (compiled and deferred keys per level), for completion and grammars. |

`parseFlux`, `readFlux`, `resolveFlux`, `expandFlux`, `placeFlux`, `validateFlux`, `upsertScreens`, the YAML tree and AST types, the edge
tokenizer and the suggest helpers are exported today but are internal: the public API will shrink to the table above before the first
publish (M26 row 16a). Do not build on them.

## Behaviour to know

- Sections `flux: 1` names but R2 does not compile (`vars`, `settings`, `kind`, `steps`, `interactions`, `markdown`, `mermaid`, `raw`,
  `component`, `icon`, `flow`, …) are kept in `document.source` and reported as the warning `FLX_DSL_NOT_YET`. A screen or group with no `layout` is
  laid out by `layered` (`stack` on a host that registers neither); `layered` named on a host that does not register it falls back with the same warning.
- Ids are hashes of the document's salt and a key derived from the source (ADR-0031): recompiling keeps ids, and a screen block that
  did not change keeps its records.
- Diagnostics are the document's `Diagnostic` plus a `source` range. Codes: [FluxScript diagnostics](../../apps/docs/src/content/docs/reference/fluxscript-diagnostics.md).

## Editors

`grammar/fluxscript.tmLanguage.json` is a TextMate grammar that extends `source.yaml`. In VS Code, point a local extension's
`contributes.grammars` at it (`scopeName: source.fluxscript`) and associate `*.flux.yaml` with the language. The studio's Source tab
uses a CodeMirror layer instead.

## Docs

- Guide: [Writing FluxScript](../../apps/docs/src/content/docs/guides/writing-fluxscript.md)
- Grammar and codes: ADR-0030; ids and salt: ADR-0031; Source view: ADR-0032
- Architecture: [06-ai-authoring.md](../../docs/architecture/06-ai-authoring.md), [01-overview.md](../../docs/architecture/01-overview.md)
