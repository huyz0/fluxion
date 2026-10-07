# 06 — AI Authoring (`@fluxion/dsl`, `@fluxion/cli`, `@fluxion/mcp`)

> Read when: touching FluxScript grammar, the compiler/decompiler, diagnostics, AI patches, the AI
> catalog, lint rules, the generation pipeline, the CLI, the MCP server, provider adapters or the
> eval suite. Requirements: `20-ai-authoring.md` (FR-DSL/AI/CLI/MCP), NFR-AI-001..004.
> Research: `research/04` §B, §D.6–D.7. Decision: ADR-0004.

## 1. Principle

**The AI states intent; the engine computes geometry.** A model names elements, relations, layout
intent, theme variants and motion. `dsl` + `layout` + `routing` turn that into canonical records
deterministically. The canonical JSON (02) is never the primary AI surface: it costs 3× the tokens
or more (NFR-AI-003) and invites coordinate arithmetic that models do badly. There are three AI
surfaces over one engine: **FluxScript** for whole documents or screens, **AI patches** for
incremental edits, and **commands** (03 §2), which patches lower to.

## 2. FluxScript grammar (summary)

FluxScript is a YAML 1.2 document with a fixed top-level shape plus one micro-syntax, the edge
shorthand. It is parsed with `yaml` (`keepSourceTokens`, `LineCounter`) so every node keeps its
range. The full grammar is published as JSON Schema generated from the Zod source (FR-AI-001).

```
file        := header screens
header      := flux: 1 · title · theme? · uses? · vars? · settings?
screen      := id · (kind | title | layout | nodes | groups | edges | steps | interactions
               | notes | background | breakpoints | markdown | mermaid | raw)*
node        := <slug>: { shape | component | text | image, label?, tone?, style?, pin?, near?, … }
edge        := "<end> <op> <end>" [ ":" label | ":" { label?, style?, route?, flow?, riders? } ]
end         := slug ( "." anchor )?          anchor := n|e|s|w|<named anchor>
op          := "->" | "<-" | "<->" | "--" | "~>"   (~> = async: dashed, animated flow)
step        := { show|hide|highlight|animate|morph|camera: targets, effect?, with?|after?|on? }
interaction := { on: "<event> <target>", do: "<action> <arg>" | { action: args }, if? }
```

Rules: **slugs** (`[a-z][a-z0-9-]*`) are unique per document and become `element.semantic.slug`.
**Shape names** resolve through `uses:` packs (`rounded-rect` → `basic:rounded-rect` when unique,
else `FLX_DSL_AMBIGUOUS_SHAPE`). **Styles are token-named** (`tone: accent` → `style.variant`;
hex literals are linted). **Coordinates are optional** (FR-DSL-005): `pin:` pins, `near:` hints.
Every `screens[]` item compiles **on its own** (FR-AI-010); cross-screen ids only in `goto`/`popup`.

### 2.1 Full example (`examples/checkout.flux.yaml`)

```yaml
flux: 1
title: How our checkout works
theme: { preset: ocean, mode: auto, accent: "#7C5CFF" }  # seeds only; palette is generated
uses: [basic, flowchart, icons-lucide, effects-core]
screens:
  - id: intro
    kind: title                            # archetype template (dslMacros registry)
    title: How checkout works
    subtitle: From cart to confirmation in 400 ms
  - id: arch
    title: Architecture
    layout: { type: layered, direction: right, spacing: comfortable }
    nodes:
      web:   { shape: rounded-rect, label: Web, icon: lucide:globe }
      api:   { shape: rounded-rect, label: API Gateway, tone: accent }
      pay:   { shape: rounded-rect, label: Payments, badge: PCI }
      db:    { shape: flowchart:database, label: Orders DB, alt: Orders database }
      queue: { shape: flowchart:queue, label: Events, pin: { x: 1500, y: 820 } }
      sla:   { component: basic:stat, props: { value: 400ms, label: p95 latency } }
    groups:
      backend: { label: Backend, contains: [api, pay, db], style: dashed }
    edges:
      - web -> api: HTTPS
      - api -> pay: charge()
      - api -> db
      - pay ~> queue: { label: event, flow: dots }
    steps:
      - show: [web, api]
      - { show: [pay, db], effect: fade }
      - { highlight: api, with: previous }
      - { animate: "pay ~> queue", effect: flow, riders: { shape: effects-core:dot, count: 5 } }
    interactions:
      - { on: click pay, do: popup pay-detail }
      - { on: click db, do: { goto: data-model, transition: zoom } }
  - id: pay-detail
    kind: popup
    markdown: |
      **Payments** retries 3× with backoff; one idempotency key per order.
  - id: data-model
    title: Data model
    mermaid: |
      erDiagram
        ORDER ||--o{ LINE_ITEM : contains
        ORDER }o--|| CUSTOMER : "placed by"
```

## 3. Compile pipeline

```ts
interface CompileOptions {
  catalog: Catalog;                 // built from registries (§6)
  measurer: TextMeasurer;           // port (03 §7) — fontkit in Node, canvas in browser
  hasher: SyncHash128;              // stable IDs: id = base62(hash(docSalt + ':' + slug))
  mode: 'strict' | 'lenient';       // lenient = apply auto-fixes, downgrade to warnings
  base?: DocSnapshot;               // upsert a screen into an existing document
  stages?: { layout?: boolean; lint?: boolean };
}
interface CompileResult {
  doc?: DocSnapshot;                // absent only when a fatal parse error blocks everything
  diagnostics: Diagnostic[];        // 02 §5 shape, `source` filled
  sourceMap: Map<RecordId, SourceRange>; // editor Source view (FR-EDT-022), diagnostics
  stats: { screens: number; records: number; msPerStage: Record<string, number> };
}
```

| # | Stage | What happens | Typical diagnostics |
|---|---|---|---|
| 1 | parse | `yaml` → CST with ranges; edge shorthand parsed by a hand-written tokenizer | `FLX_DSL_SYNTAX`, `FLX_DSL_EDGE_SYNTAX` |
| 2 | resolve | slug table; shapes/components/tokens/layouts looked up in the catalog; did-you-mean by edit distance over catalog + slugs (FR-DSL-006) | `FLX_DSL_UNKNOWN_SHAPE`, `FLX_REF_MISSING`, `FLX_DSL_DUP_SLUG` |
| 3 | expand | archetypes (`kind: title`), `dslMacros`, `mermaid:`/`markdown:` importers, groups → `group`/`frame` records | `FLX_DSL_MACRO_ARGS` |
| 4 | style | `tone`/`variant` → `style.variant`; defaults from `theme.defaults[kind][variant]` are **referenced, not copied** (02 §2 resolution order) | `FLX_TOKEN_UNKNOWN` |
| 5 | layout | measure text → node sizes; run `@fluxion/layout` (pure, same code in Node and worker) per screen/container; pins honoured; positions written to `transform` | `FLX_LAYOUT_OVERFLOW` |
| 6 | validate | Zod structural → referential → bindings/anchors | `FLX_SCHEMA_*`, `FLX_ANCHOR_UNKNOWN` |
| 7 | lint | §7 rules; produce a quality score | `FLX_LINT_*` |

**R2 (ADR-0030):** the stages are parse → resolve → expand → style → **place** → validate. Place keeps pins and puts unpinned
elements through the screen's `layout` from the registry, else the built-in `stack`, at shape default sizes; measured text and
`layered` come in M13, lint in M14. ADR-0030 freezes the `flux: 1` grammar, lists what R2 compiles and what it keeps in
`document.source` with `FLX_DSL_NOT_YET`, and lists the diagnostic codes.

Stages are pure functions `(input, ctx) → { output, diagnostics }` and deterministic
(NFR-REL-005): same source + catalog + fonts → byte-identical `.flux.json`. Routes are not stored
(02 §6); `render`/exporters compute them.

**Schema additions this needs (additive minor, tracked in 02):** `screen.layout?` (screen as root
container, same spec as `frame.layout`) and `element.placement?: 'auto' | 'pinned'`. Layout only
moves `auto` elements. A human drag flips the element to `pinned`.

### 3.1 Decompiler (FR-DSL-008)

`decompile(doc, { screens? }) → string` emits canonical FluxScript: slugs (generated from labels
when missing, 02 §3), short shape names, edge shorthand, steps, interactions; `pin:` only for
`placement: 'pinned'`; anything inexpressible goes into a `raw:` block. Contract:
`compile(decompile(doc))` ≡ `doc` (property test). `get_screen` returns this form to models.

## 4. Diagnostics for humans and models

The `Diagnostic` type from 02 §5 is the only error shape. For models (FR-AI-004) the formatter
**ranks** (errors first, then by source position), **dedupes** (one diagnostic per root cause)
and **caps** the list (default 20, followed by "+N more"), one line each:

```
L23:9  error   FLX_REF_MISSING       edge target 'dbb' not found — hint: did you mean 'db'?
L31:5  warning FLX_LINT_TEXT_OVERFLOW label of 'pay' overflows by 34px — hint: shorten or use size: l
```

`--json` / MCP output carries the full `Diagnostic[]`. Codes are stable, defined in
`packages/dsl/src/diagnostics/codes.ts`, and the docs page is generated from it.

## 5. AI patch format (FR-AI-003)

```ts
type Ref = string;          // slug ('api'), '#<RecordId>', or edge key ('api->db', 'pay~>queue')
interface AiPatch { flux: 1; baseRevision?: string /* stale → FLX_PATCH_STALE */; ops: PatchOp[] }
type PatchOp =
  | { op: 'add'; screen: Ref; slug: string; node: NodeSpec; parent?: Ref }   // NodeSpec = FluxScript node
  | { op: 'update'; target: Ref; set: Partial<NodeSpec> }
  | { op: 'remove'; target: Ref; cascade?: boolean }        // cascade removes attached connectors
  | { op: 'connect'; edge: string /* 'a.e -> b: label' */; spec?: EdgeSpec }
  | { op: 'disconnect'; target: Ref }
  | { op: 'setLayout'; scope: Ref /* screen or container */; layout: LayoutIntent; relayout?: boolean }
  | { op: 'restyle'; targets: Ref[] | { select: Selector }; style: StyleSpec }
  | { op: 'addStep'; screen: Ref; at?: number | 'end'; step: StepSpec }
  | { op: 'addInteraction'; owner: Ref; rule: InteractionSpec };
```

Payloads reuse FluxScript sub-schemas, so a model learns one vocabulary. **Atomic**: the patch
runs as one `ai.applyPatch` command in one `store.transact`. Every op is resolved and validated
before anything is written. Any error rejects the whole patch, with diagnostics pointing into it
(`/ops/3/target`). Success is one undo entry. Affected containers are re-laid out incrementally
unless `relayout: false`. The patch JSON Schema is generated from Zod in the provider-strict subset
(`additionalProperties: false`, flat unions).

## 6. AI catalog (FR-AI-002, NFR-AI-002)

`buildCatalog(registries, { packs?, detail })` walks `shapeDefs`, `elementKinds`, `components`,
`layouts`, `routers`, `markers`, `effects`, `transitions`, `themes`, `dslMacros` and token names.
Every registered item must carry an AI one-liner (`describe`) — the registry rejects items without
one in dev builds. `--format=llm` (default) prints one line per item
(`basic:diamond — decision; params: none; anchors: n,e,s,w`) for prompts and `list_catalog`;
`json` adds param schemas (editor completion, FR-DSL-009); `md` feeds the docs site. Budget: the core-pack catalog plus the cheat sheet must fit in **8 000 tokens** (NFR-AI-002),
checked by a token-count test with a fixed tokenizer in `pnpm verify`. Additional packs cost only
their summary lines; `--detail=<pack>` / `list_catalog({ pack })` expands one pack on demand.

## 7. Quality linter (FR-AI-005)

Rules are `LintRule { id, severity, weight, check(doc, ctx): Diagnostic[] }` entries in the
`lintRules` registry, pure over the laid-out document plus measured text. Core rules (`FLX_LINT_*`): `OVERLAP` (FR-LAY-004) · `OFFSCREEN` (outside safe area) ·
`TEXT_OVERFLOW` (measured) · `CONTRAST` (text 4.5:1, large text and meaningful strokes 3:1, WCAG
2.2, NFR-A11Y-005) · `DENSITY` (words/elements per screen) · `ORPHAN_CONNECTOR` ·
`STYLE_LITERAL` / `STYLE_INCONSISTENT` · `ALT_MISSING` / `READING_ORDER` (NFR-A11Y-006) ·
`SMALL_TEXT` (< 14 px at the portrait breakpoint) · `FLASH` (> 3/s, NFR-A11Y-003). Score = `100 − Σ weight·count` (floored per rule, clamped at 0). The eval target is an average
≥ 85 (NFR-AI-004).

## 8. Generation pipeline

```
prompt / outline / source text
  ▼ 1 Outline      strict JSON: screens[{id, kind, title, intent, bullets}]   (optional human checkpoint)
  ▼ 2 Screens      FluxScript per screen, streamed; parallel when the provider allows
  │                each completed `- id:` block → compile(screen, base = doc so far) → render
  ▼ 3 Validate     diagnostics formatted for LLM (§4)
  │   └─ errors ─► 4 Repair: send diagnostics + offending lines; model returns a screen or a patch
  │                (≤ 2 rounds, then compile in lenient mode with auto-fixes as warnings)
  ▼ 5 Layout       full layout + routing + text fit with embedded fonts
  ▼ 6 Lint         score; top findings optionally fed back as one "polish" round
  ▼ 7 Visual check (optional) render PNG per screen → vision critique → patch
  ▼ canonical records → editor (single undo entry "AI: generate deck")
```

The orchestrator (`packages/dsl/src/generate/`) takes an `LlmClient` port and holds no network
code. FR-AI-008 modes (restyle, animate, portrait variant, explain as steps) are prompt templates
with an expected output kind (patch or screen). A block splitter emits each screen as it completes.

## 9. CLI (`@fluxion/cli`)

All commands wrap `@fluxion/cli/ops`, the same functions the MCP server calls.

| Command | Purpose |
|---|---|
| `validate <file>` · `lint <file> [--min-score n]` | validation; quality rules and score |
| `compile <in.flux.yaml> -o <out>` · `decompile <file> [--screen id]` | FluxScript ⇄ document |
| `layout <file> [--screen id] [--algorithm a]` | re-run layout, write positions |
| `render <file> --format html\|png\|svg\|pdf [--screen id] [--step n]` | headless render (Playwright for raster/PDF) |
| `catalog [--format llm\|json\|md] [--pack p]` | AI catalog |
| `migrate <file>` · `convert <in> <out>` | upgrade schema; `.flux` ⇄ `.flux.html` ⇄ `.flux.json` |
| `patch <file> <patch.json>` | apply an AI patch atomically |
| `pack <plugin-dir>` · `site build <file…> -o dir` | `.fluxpack` (09); static site (10) |

`--json` prints exactly one `CliResult<T> { ok, command, version, diagnostics, data?, ms }` to
stdout; logs go to stderr. Exit codes (FR-CLI-005): **0** ok (warnings allowed), **1** validation/lint errors (or score below
`--min-score`), **2** usage error, **3** internal error (bug; stack trace on stderr).

## 10. MCP server (`@fluxion/mcp`)

stdio + streamable HTTP (`@modelcontextprotocol/sdk`); open documents are keyed by `docHandle`; files only under allowed roots.

| Tools (FR-MCP-001) | Notes |
|---|---|
| `create_document(fluxscript)` → `{docHandle, diagnostics}` | compile + layout + lint |
| `get_document_outline(docHandle)` | screens, titles, slugs, counts — never raw JSON by default |
| `get_screen(docHandle, screen, format: fluxscript\|json)` | decompiled FluxScript by default |
| `apply_patch(docHandle, patch)` | §5; returns diagnostics + new revision |
| `compile_dsl(fluxscript, {screen?})` · `validate` · `lint` · `layout` | dry-run compile; as CLI |
| `render_screen_png(docHandle, screen, step?)` | image content for vision self-check (FR-AI-006) |
| `list_catalog({pack?, kind?})` | §6, `llm` format |
| `save_file(docHandle, path, format)` | `.flux` / `.flux.html` / `.flux.json` |

Resources (FR-MCP-002): `fluxion://guide/authoring`, `fluxion://guide/cheatsheet`,
`fluxion://schema/document`, `fluxion://schema/patch`, `fluxion://catalog`,
`fluxion://examples/{name}`. Prompts: `generate_deck`, `diagram_from_description`, `animate_screen`.

**Live link (FR-MCP-003):** the studio opens a local WebSocket bridge after the user approves a
one-time pairing code. MCP tools then target the live document. Patches arrive as `ai.applyPatch`
commands, so they appear immediately and are undoable. The bridge binds to `127.0.0.1` only.

## 11. Provider adapters (studio, FR-AI-007)

Adapters implement `LlmClient { id; capabilities: { structuredOutput; vision };
stream(req, signal): AsyncIterable<LlmChunk> }` for Anthropic, OpenAI and OpenAI-compatible/local
endpoints. They live in `apps/studio/src/ai/`, not in libraries. Keys are stored in IndexedDB only
(optionally encrypted with a user passphrase) and are never written to documents, logs or
diagnostic reports (NFR-SEC-004, test scans saved files). The system prompt (cheat sheet + catalog)
is placed first so providers can cache it. Prompt templates are versioned files in
`packages/dsl/prompts/` and their version id is recorded in eval results.

## 12. Eval suite (FR-AI-009)

- Cases: `eval/cases/*.yaml` — `{ id, mode, prompt, inputs?, expect: { screens?, kinds?, mustContain?, minLint? } }`.
- `pnpm eval --recorded` (CI): replays `eval/recordings/<hash>.json`, where the hash covers case +
  prompt version + model. `pnpm eval --live` (nightly) calls providers and may refresh recordings.
- Scorecard (`eval/out/scorecard.{json,md}`): one-shot / post-repair validity (NFR-AI-001: ≥ 90 /
  ≥ 99 %), repair rounds, lint score (≥ 85), expectation pass rate, DSL-vs-JSON token ratio (≥ 3×,
  NFR-AI-003), tokens, latency. Thresholds live in `scripts/gates/thresholds.mjs`.

## 13. llms.txt and the authoring guide (FR-AI-011)

The docs site generates `llms.txt` (index) and `llms-full.txt` (FluxScript reference, catalog,
examples) from the same sources as the MCP resources: the grammar schema, `codes.ts`, the catalog
and `examples/*.flux.yaml`. Every example compiles in CI (FR-DSL-001). A drift check fails the
build when the guide mentions an id missing from the catalog.
