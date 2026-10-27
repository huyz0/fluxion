# Architecture Decision Records

> Read when: making or questioning a decision that is expensive to reverse, or when a change
> touches anything listed under "ADR required when" below.

Format: [MADR 4](https://adr.github.io/madr/): YAML front matter (`status`, `date`,
`decision-makers`), then *Context and Problem Statement*, *Decision Drivers*, *Considered Options*,
*Decision Outcome* (with *Consequences* and *Confirmation*), *Pros and Cons of the Options*,
*More Information*. Copy the structure of any accepted ADR below as the template. The `adr` skill
(`.agents/skills/adr/`) walks through it.

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](ADR-0001-own-engine-dom-svg.md) | Build our own engine on React DOM + SVG | accepted | 2026-09-26 |
| [0002](ADR-0002-record-store-signals.md) | Normalized record store with signals and record-diff undo | accepted (editor UI state: superseded by 0028) | 2026-09-26 |
| [0003](ADR-0003-file-format.md) | `.flux` zip + `.flux.html` self-contained player + `.flux.json` | accepted | 2026-09-26 |
| [0004](ADR-0004-fluxscript-dsl.md) | FluxScript YAML-shaped DSL; AI never computes coordinates | accepted | 2026-09-26 |
| [0005](ADR-0005-layout-routing-stack.md) | Pluggable layout/routing pipeline; permissive defaults; ELK/libavoid optional | accepted (layout libraries: amended by 0045) | 2026-09-26 |
| [0006](ADR-0006-own-animation-model.md) | Own declarative animation model and scheduler | accepted | 2026-09-26 |
| [0007](ADR-0007-plugin-trust-model.md) | Plugin manifest, import-map shared deps, iframe sandbox for untrusted code | accepted | 2026-09-26 |
| [0008](ADR-0008-toolchain.md) | pnpm 11 / Turborepo / Vite 8 / tsdown / tsgo / Biome 2 / Vitest / Playwright / Storybook / Changesets | accepted | 2026-09-26 |
| [0009](ADR-0009-ai-harness.md) | AGENTS.md + portable skills + goal-driven milestone loop + hash-bound cross-vendor review | accepted | 2026-09-26 |
| [0010](ADR-0010-styling-isolation.md) | Tailwind/shadcn for editor chrome only; tokens + `fx-` content CSS for content (amended by 0015: CSS strings, `@layer fx.content`; by 0029: chrome Tailwind from M7, no preflight) | accepted | 2026-09-26 |
| [0011](ADR-0011-source-resolution-dual-compiler.md) | Workspace source resolution (`@fluxion/source` condition) and dual TypeScript compiler (TS 7 check, TS 6 for TypeDoc and dependency-cruiser) | accepted | 2026-09-26 |
| [0012](ADR-0012-ids-and-fractional-indices.md) | Record IDs and fractional-index keys are own code in `@fluxion/schema` | accepted | 2026-09-27 |
| [0013](ADR-0013-rich-text-subset.md) | Rich text is a ProseMirror-compatible JSON subset validated by Zod | accepted | 2026-09-27 |
| [0014](ADR-0014-command-and-transaction-semantics.md) | Command and transaction semantics of the record store (Result-returning transactions, fixed-point hooks, merge adjacency, inverse-diff undo, snapshot forks) | accepted (§Merging: amended by 0046) | 2026-09-28 |
| [0015](ADR-0015-static-render-path.md) | Static render path: `<ScreenView>` through `react-dom/server`, content CSS as an inlined string, styles resolved in `theme` | accepted | 2026-09-28 |
| [0016](ADR-0016-shape-outlines-and-expressions.md) | Shape outlines as path templates, and a safe expression language | accepted | 2026-09-29 |
| [0017](ADR-0017-hosts-bundle-first-party-packs.md) | Hosts bundle first-party packs as listed dependencies (packs at rank 5) | accepted | 2026-09-29 |
| [0018](ADR-0018-shape-text-fitting.md) | Shape text fitting: an optional `textFit` on shapes, pure layout in core | accepted | 2026-09-29 |
| [0019](ADR-0019-stroke-alignment-and-corner-radius.md) | Stroke alignment and corner radius on any outline | accepted | 2026-09-29 |
| [0020](ADR-0020-clipboard-format.md) | The clipboard format: one versioned Fluxion payload in every representation each path allows | accepted | 2026-10-01 |
| [0021](ADR-0021-screen-sections-and-library-search.md) | Screen sections are `section` records, and the library is searched by an own prefix and keyword index | accepted | 2026-10-02 |
| [0022](ADR-0022-font-sourcing-and-licensing.md) | Fonts are vendored OFL assets, the Google Fonts catalog is a snapshot fetched by the studio only, uploads are sniffed by magic bytes, subsetting waits past M10 (amendment M10.3) | accepted | 2026-10-03 |
| [0023](ADR-0023-i18n-pipeline.md) | The i18n pipeline: Lingui, with macros transformed and messages extracted by the native tools, never by Babel | accepted | 2026-10-03 |
| [0024](ADR-0024-autosave-storage.md) | Autosave storage: an IndexedDB journal, OPFS for bytes and snapshots, a Web Lock per document | accepted | 2026-10-04 |
| [0025](ADR-0025-image-import-and-sanitizer-reuse.md) | The sanitizer and image encoding for M10: ADR-0150's allowlist reused, WebP from the browser, no wasm in M10 | accepted | 2026-10-04 |
| [0028](ADR-0028-editor-interaction-architecture.md) | Editor interaction: statechart tools, a signal session store, a screen-space SVG overlay, a frame-batched pointer pipeline | accepted | 2026-09-30 |
| [0029](ADR-0029-editor-chrome-primitives.md) | Editor chrome: own splitters, a scoped `@layer fx.chrome` stylesheet, the panel layout in a settings port (amends 0010's timing) | accepted | 2026-09-30 |
| [0030](ADR-0030-fluxscript-grammar-v1.md) | FluxScript grammar v1: `flux: 1` is additive-only, R2 compiles a subset and keeps the deferred sections, the diagnostic codes | accepted | 2026-10-07 |
| [0031](ADR-0031-stable-ids-and-placement.md) | Stable ids `base62(hash128(salt:key))` through a sync port (SHA-256/128), layout specs on screens and containers, deferred FluxScript in `document.source`: schema 1.3 | accepted | 2026-10-07 |
| [0032](ADR-0032-source-view.md) | Source view: CodeMirror 6 in a lazy chunk, Lezer YAML with a FluxScript layer, a TextMate grammar, screen-scoped two-way sync | accepted | 2026-10-07 |
| [0033](ADR-0033-layout-engine-contract-v1.md) | Layout engine contract v1: synchronous algorithms, an asynchronous engine, the worker protocol, the fingerprint | accepted | 2026-10-13 |
| [0034](ADR-0034-overlap-removal-and-determinism.md) | Overlap removal by an own two-stage sweep, determinism rules, and the `@dagrejs/dagre` dependency | accepted | 2026-10-13 |
| [0035](ADR-0035-ai-patch-format-v1.md) | AI patch format v1: the nine ops, references, atomicity, staleness, the strict schema subset | accepted | 2026-10-16 |
| [0036](ADR-0036-cli-contract.md) | CLI contract v1: the operation layer, the full command set, exit-code meaning, the optional Chromium peer (extends ADR-0147) | accepted | 2026-10-16 |
| [0037](ADR-0037-fixed-tokenizer-for-budgets.md) | One pinned offline tokenizer (gpt-tokenizer, o200k_base) counts the AI token budgets; its margin is UNDERIVED until M15 | accepted | 2026-10-16 |
| [0038](ADR-0038-mcp-server-model.md) | MCP server model: document handles, file roots, transports, result shapes, image content | accepted | 2026-10-16 |
| [0039](ADR-0039-eval-harness.md) | Eval harness: case schema, recordings keyed by content, scorecard metrics, the alt-text metric | accepted | 2026-10-16 |
| [0040](ADR-0040-mermaid-markdown-import.md) | Mermaid and Markdown import: hand-written subset parsers and `mdast`, both emitting FluxScript | accepted | 2026-10-16 |
| [0041](ADR-0041-provider-adapters-key-storage.md) | Provider adapters and key storage: the `LlmClient` port, adapters in the studio, an IndexedDB key store | accepted | 2026-10-16 |
| [0045](ADR-0045-layout-suite-v2-libraries.md) | Layout suite v2: own pure algorithms, ELK only as a pack | accepted | 2026-10-21 |
| [0046](ADR-0046-live-layout-and-incremental-mode.md) | Live layout frames and incremental mode: a post-commit reactor that amends the edit it follows | accepted | 2026-10-21 |
| [0047](ADR-0047-smart-template-format.md) | Smart templates: a `TemplateDef` that builds shapes from an items list | accepted | 2026-10-21 |
| [0048](ADR-0048-shape-pack-format-v1.md) | Declarative shape packs: indexed categories and portable used definitions | accepted | 2026-10-25 |
| [0049](ADR-0049-shape-import-pipeline.md) | Shared sanitized paint and bounded SVG/Iconify/draw.io import | accepted (SVG routing clauses superseded by0187) | 2026-10-25 |
| [0050](ADR-0050-pack-license-attribution.md) | Preserve pack rights and used-definition credits offline | accepted | 2026-10-25 |
| [0051](ADR-0051-bounded-font-subsetting.md) | Bounded HarfBuzz/WOFF2 workers, deterministic subsets and lossless font fallback | accepted | 2026-10-25 |
| [0064](ADR-0064-rich-text-editor-library.md) | The rich-text editor library is ProseMirror, used directly and loaded with the editor only | accepted | 2026-10-01 |
| [0137](ADR-0137-subagent-review-no-dry-runs.md) | Isolated-subagent review by default; `/goal` dry runs not required (supersedes part of 0009) | accepted | 2026-09-26 |
| [0138](ADR-0138-pnpm-run-setup.md) | Invoke the repository setup script as `pnpm run setup` | accepted | 2026-09-26 |
| [0139](ADR-0139-storybook-portable-stories.md) | Story tests through portable stories until `@storybook/addon-vitest` supports Vitest 5 | accepted | 2026-09-27 |
| [0140](ADR-0140-record-types-checked-against-schemas.md) | Record types are written once as TSDoc'd types and checked against their Zod schemas | accepted | 2026-09-27 |
| [0141](ADR-0141-spatial-index-rbush-flatbush.md) | Spatial index: `rbush` and `flatbush` behind one `SpatialIndex` interface | accepted | 2026-09-27 |
| [0142](ADR-0142-parsing-never-fills-defaults.md) | Parsing a document never fills in defaults; readers apply documented defaults | accepted | 2026-09-27 |
| [0143](ADR-0143-ci-cold-setup-authority.md) | Inside CI the cold-setup job is the cold-setup authority; locally the recorded budget is | accepted | 2026-09-28 |
| [0144](ADR-0144-one-result-convention.md) | One Result shape across pure packages; each package owns its error-code union | accepted | 2026-09-28 |
| [0145](ADR-0145-budget-refresh-without-local-cold-setup.md) | A lockfile commit records a pending cold setup; CI's measurement replaces it after the push | accepted | 2026-09-28 |
| [0146](ADR-0146-mutation-testing-tzap.md) | Mutation testing with tzap instead of StrykerJS | accepted | 2026-09-28 |
| [0147](ADR-0147-cli-v0-contract.md) | CLI v0: command shape, exit codes and the `--json` envelope | accepted | 2026-09-29 |
| [0148](ADR-0148-text-measurement-from-recorded-metrics.md) | Text is measured from font metrics recorded from the engine that draws it | accepted | 2026-10-02 |
| [0149](ADR-0149-inspector-fields-from-schema-meta.md) | The inspector's fields come from the Zod schemas' `.meta` | accepted | 2026-10-02 |
| [0150](ADR-0150-sanitize-svg-allowlist.md) | `sanitizeSvg` rebuilds an SVG from an allowlist over a small tokenizer | accepted | 2026-10-02 |
| [0151](ADR-0151-group-model.md) | A group's members keep their screen coordinates and its box follows them | accepted | 2026-10-02 |
| [0152](ADR-0152-token-model-and-schema-1-2.md) | The token model: required roles checked at validation, derived tokens as DTCG aliases with a transform, an own OKLCH, schema 1.2 (metadata fields, a screen's theme reference) | accepted | 2026-10-03 |
| [0153](ADR-0153-own-zip-codec.md) | The zip container is read and written by our own codec in `@fluxion/format`, not by fflate | accepted | 2026-10-04 |
| [0154](ADR-0154-player-inline-host.md) | `@fluxion/player-inline`: the host that builds the one-file player | accepted | 2026-10-04 |
| [0155](ADR-0155-cli-convert.md) | `fluxion convert`: a `.flux` and a `.flux.html` are the same document | accepted | 2026-10-04 |
| [0156](ADR-0156-lighthouse-job-npx.md) | The Lighthouse CI job fetches `@lhci/cli` with npx, exactly pinned, until a lockfile change can be recorded | accepted | 2026-10-05 |
| [0157](ADR-0157-m10-decisions-gzip-budget-and-deferrals.md) | The `.flux.html` budget is gzip; the manifest's shape-def list and `sanitizeHtml` wait for their consumers | accepted | 2026-10-05 |
| [0158](ADR-0158-precommit-budget-360s.md) | The pre-commit budget is 360 s | superseded by 0163 | 2026-10-06 |
| [0159](ADR-0159-check-i18n-parses-with-oxc.md) | `check-i18n` parses JSX with `oxc-parser` | accepted | 2026-10-06 |
| [0160](ADR-0160-caniuse-lite-licence-exception.md) | `caniuse-lite` (CC-BY-4.0) is allowed as a transitive of `@lingui/core` | accepted | 2026-10-06 |
| [0161](ADR-0161-quick-budget-120s.md) | The quick-gate budget is 120 s | superseded by 0164 | 2026-10-06 |
| [0162](ADR-0162-convert-flux-json.md) | `fluxion convert` writes and reads `.flux.json`, with `--assets inline|external` | accepted | 2026-10-07 |
| [0163](ADR-0163-precommit-budget-480s.md) | The pre-commit budget is 480 s (supersedes 0158) | superseded by 0165 | 2026-10-07 |
| [0164](ADR-0164-quick-budget-180s.md) | The quick-gate budget is 180 s | superseded by 0190 (enforcement) | 2026-10-13 |
| [0165](ADR-0165-precommit-budget-600s.md) | The pre-commit budget is 600 s | superseded by 0166 | 2026-10-15 |
| [0166](ADR-0166-precommit-budget-900s.md) | The pre-commit budget is 900 s | accepted | 2026-10-15 |
| [0168](ADR-0168-route-tangents-and-jumps.md) | Curve tangents and the jump style on a connector's route (schema 1.5) | accepted | 2026-10-20 |
| [0169](ADR-0169-fluxscript-jumps.md) | FluxScript keys for line jumps (`lineJumps`, an edge's `jumps`) | accepted | 2026-10-20 |
| [0170](ADR-0170-perf-calibration-units.md) | Judge the layout regression budget in calibration units (same-job frozen workload) | accepted | 2026-10-23 |
| [0171](ADR-0171-circular-timing-advisory.md) | Only valid circular-500 timing overruns are advisory; all other budgets and correctness remain blocking | accepted | 2026-10-25 |
| [0172](ADR-0172-millisecond-baseline-readers.md) | Retain only consumed millisecond baselines; supplement ADR-0170 reader inventory | accepted | 2026-10-25 |
| [0173](ADR-0173-complete-mutation-source-partitions.md) | Complete mutation source partitions without reduced coverage or floors | superseded (sizing) | 2026-10-25 |
| [0174](ADR-0174-mutation-partition-sizing.md) | Smaller complete mutation partitions from terminal timing evidence | accepted (matrix cap amended by ADR-0198) | 2026-10-25 |
| [0175](ADR-0175-screen-duplicate-external-ends.md) | Caller-resolved free endpoints for screen duplication | accepted | 2026-10-25 |
| [0176](ADR-0176-proportionate-development-gates.md) | Proportionate development gates | accepted | 2026-10-25 |
| [0177](ADR-0177-shared-svg-policy.md) | Shared decoded SVG attribute policy | accepted | 2026-10-25 |
| [0178](ADR-0178-pack-validation-boundary.md) | Declarative pack validation and explicit license policy | accepted | 2026-10-25 |
| [0179](ADR-0179-tsrs-adoption.md) | Pinned tsrs alongside TypeScript 7 | accepted | 2026-10-26 |
| [0180](ADR-0180-bounded-shape-artwork.md) | Bounded artwork on shape definitions | accepted | 2026-10-26 |
| [0181](ADR-0181-lazy-shape-pack-loader.md) | Lazy shape-pack loading through explicit host ports | accepted | 2026-10-26 |
| [0182](ADR-0182-portable-shape-subsets.md) | Portable shape subsets and explicit content policy | accepted | 2026-10-26 |
| [0183](ADR-0183-used-shape-preparation.md) | Prepare deterministic used-shape entries from explicit sources | accepted | 2026-10-26 |
| [0184](ADR-0184-portable-shape-io.md) | Validate portable shape data and retain save diagnostics | accepted | 2026-10-26 |
| [0185](ADR-0185-portable-shape-hosts.md) | Restore portable shapes in document-scoped hosts | accepted | 2026-10-26 |
| [0186](ADR-0186-checked-svg-tree.md) | Reuse checked SVG data before serialization | accepted | 2026-10-26 |
| [0187](ADR-0187-svg-import-routing.md) | Preserve SVG paint with diagnosed viewport routing fallback | accepted | 2026-10-26 |
| [0188](ADR-0188-svg-batch-boundary.md) | Shared bounded SVG batch reports before host distribution | accepted | 2026-10-26 |
| [0189](ADR-0189-bounded-svg-witness.md) | Canonical requests and bounded shared SVG witnesses | accepted | 2026-10-26 |
| [0190](ADR-0190-quick-latency-advisory.md) | Quick latency advisory with unchanged verification | accepted | 2026-10-26 |
| [0191](ADR-0191-ci-provisioning-envelope.md) | Reserve verification separately from provisioning; retain interrupted streams without reruns | accepted (Windows bounds superseded by ADR-0197) | 2026-10-26 |
| [0192](ADR-0192-artwork-font-retention.md) | Exact licensed artwork fonts in portable shape packs | accepted | 2026-10-26 |
| [0193](ADR-0193-declarative-pack-suite.md) | A shared SDK suite builds, checks and draws declarative packs | accepted | 2026-10-27 |
| [0194](ADR-0194-pack-source-and-version-ledger.md) | Packs export their source; one SDK check covers files, versions and bounds | accepted | 2026-10-27 |
| [0195](ADR-0195-content-bound-review-evidence.md) | Reviews bind to rebase-stable content, and each commit carries its own evidence | accepted | 2026-10-27 |
| [0196](ADR-0196-one-shape-pack-encoder.md) | One shape pack encoder for first-party and imported packs | accepted | 2026-10-27 |
| [0197](ADR-0197-windows-verify-envelope.md) | Windows verification gets its own CI envelope (25 of 45 minutes) | accepted | 2026-10-27 |
| [0198](ADR-0198-chained-mutation-matrices.md) | Nightly mutation partitions run as chained matrices of at most 256 jobs | accepted | 2026-10-27 |
| [0026](ADR-0026-player-packaging.md) | Player packaging: the `<fluxion-player>` element, the React wrapper, the core and the lazy parts, no Zod in the player | accepted | 2026-10-04 |
| [0027](ADR-0027-observability-and-privacy.md) | Observability and privacy: the Logger, the debug overlay, the diagnostic report, no telemetry | accepted | 2026-10-04 |

## ADR required when

A change needs a new ADR, or a superseding one, in the **same commit** when it:

1. Changes a row of the decided stack in `docs/standards/tech-stack.md`, or adds a runtime
   dependency to `player` or anything it bundles.
2. Changes the file format: container layout, `formatVersion`, a **major** `schemaVersion`, or
   what is baked vs derived (08).
3. Makes a breaking change to a `@public` API of `@fluxion/sdk` or another published package
   (NFR-MNT-007).
4. Changes the layering or dependency rules in `01-overview.md` §2, or makes a pure package
   impure.
5. Changes the plugin trust model, sandbox, CSP or any security boundary (NFR-SEC-*).
6. Changes FluxScript grammar incompatibly, the AI patch format, CLI exit codes or `--json` shapes,
   or MCP tool contracts.
7. Adds a copyleft (EPL/LGPL/MPL-modified) component or changes licence policy (NFR-LIC-*).
8. Edits `docs/requirements/` acceptance criteria (the harness forbids this without an ADR).
9. Weakens a threshold in `scripts/gates/thresholds.mjs` (normally forbidden; an ADR is the only
   route).


## Lifecycle

`proposed` → `accepted` → (`deprecated` | `superseded by ADR-NNNN`). ADRs are never edited in
substance after acceptance. Write a new ADR that supersedes the old one, then update the old
one's status line and this index.

