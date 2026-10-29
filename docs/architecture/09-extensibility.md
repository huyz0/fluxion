# 09 — Extensibility (`@fluxion/sdk`, plugins, packs)

> Read when: adding a contribution point, writing or loading a plugin/pack, changing the public
> SDK, the React component element contract, `.fluxpack`, plugin embedding, or the plugin trust
> model. Requirements: `19-extensibility.md` (FR-EXT, FR-CMP, FR-PKG), FR-SHP-013, FR-ANC-008,
> NFR-SEC-003, NFR-REL-004, NFR-MNT-007. Research: `research/01` §3.5, `research/04` §A.4, §D.5.
> Decision: ADR-0007.

## 1. Model

Everything extensible is a **registry entry** (03 §4). A plugin is a manifest plus up to three ESM
entry points that register entries through `@fluxion/sdk`. First-party packs use exactly the same
API (the dogfooding rule, FR-EXT-001), and lint forbids `switch (kind)` outside registries.

```
fluxion-plugin.json ──(static index at install: library, catalog, activation)──► host
player.js  ──activate(PlayerContext)──►  player registries  (bundled into saved files when used)
editor.js  ──activate(EditorContext)──►  editor registries  (studio only, never embedded)
worker.js  ──(optional) layout/import work off the main thread
```

## 2. Manifest (`fluxion-plugin.json`, FR-EXT-002)

```ts
interface PluginManifest {
  id: string;                     // reverse-DNS, globally unique: "com.acme.charts"
  namespace: string;              // short prefix used in documents: "acme-charts" → "acme-charts:gauge"
  version: string;                // exact semver
  name: string; description: string; license: string; publisher?: string;
  engines: { fluxion: string; sdk: string };     // semver ranges
  entry: { player?: string; editor?: string; worker?: string };
  contributes: Contributions;     // static declaration — code is not loaded to list these
  activationEvents?: ActivationEvent[];          // default: derived from contributes
  permissions?: { network?: string[]; clipboard?: boolean; storage?: 'document' | 'user' };
  settings?: JsonSchema;          // FR-EXT-007: generates a settings UI
  ai?: { summary: string };       // one line for the AI catalog (06 §6)
  attribution?: string;           // required for icon/brand packs (NFR-LIC-003)
}
type ActivationEvent =
  | `onKind:${string}` | `onShapeDef:${string}` | `onComponent:${string}` | `onRouter:${string}`
  | `onLayout:${string}` | `onEffect:${string}` | `onCommand:${string}` | `onImport:${string}`
  | `onExport:${string}` | `onDslMacro:${string}` | 'onStartup';
```

Namespaces `basic`, `flowchart`, `core`, `fluxion` and every first-party pack name are reserved.
A manifest is validated by its Zod schema in `@fluxion/sdk/manifest`. `fluxion plugin validate`
runs the same schema.

## 3. Contribution points

| Surface | Point | Declarative (no code) | Registry |
|---|---|---|---|
| player | `elementKinds` | — | `core.elementKinds` + `render.elementViews` |
| player | `shapeDefs` | ✅ JSON `ShapeDef` (03 §5) | `core.shapeDefs` |
| player | `markers` | ✅ SVG path + refs | `core.markers` |
| player | `routers` | — | `core.routers` |
| player | `layouts` | — (usually `worker`) | `core.layouts` |
| editor | `templates` (ADR-0047) | — | `core.templates` |
| player | `effects`, `transitions` | ✅ presets over built-in primitives; code for new primitives | `core.effects`, `core.transitions` |
| player | `themes`, `fonts` | ✅ DTCG tokens, WOFF2 assets | `core.themes`, `core.fonts` |
| player | `components` | — | `render.components` |
| editor | `tools`, `panels`, `inspectors` | — | `editor.*` |
| editor | `commands` | — | `core.commands` (AI-visible via catalog) |
| editor | `importers`, `exporters` | — | `core.importers`, `core.exporters` |
| editor | `dslMacros`, `lintRules` | ✅ macro templates in FluxScript | `core.dslMacros`, `core.lintRules` |

Rules: player contributions never import editor code (bundle check, FR-EXT-003). Declarative
contributions need no code, so they are safe in every trust tier. Every contribution carries a
one-line `describe` for the AI catalog.

## 4. Activation and lazy loading (FR-EXT-004)

- At install the host indexes `contributes` (ids, names, thumbnails, AI summaries), so the library,
  catalog and FluxScript completion work **without loading plugin code**.
- An entry is `import()`ed on its first activation event: a document containing
  `acme-charts:gauge`, a command invoked, an importer matched by extension. Shape-def geometry
  from large packs loads per category (FR-LIB-009).
- `activate()` returns `Disposable`s. Disable/uninstall/hot-reload disposes them, and the registry
  `changes$` signal re-renders dependents.
- Unused plugins cost 0 bytes of executed code, which a network/log E2E test asserts.

## 5. `@fluxion/sdk` API surface and stability (FR-EXT-005)

```ts
// @fluxion/sdk/player
export function definePlugin(p: { activate(ctx: PlayerContext): void | Disposable[] }): PluginModule;
export interface PlayerContext {
  register: {
    elementKind<P>(def: ElementKindDef<P>): Disposable;  shapeDef(def: ShapeDef): Disposable;
    marker(def: MarkerDef): Disposable;                  router(def: RouterDef): Disposable;
    layout(def: LayoutAlgorithmDef): Disposable;         effect(def: EffectDef): Disposable;
    transition(def: TransitionDef): Disposable;          theme(def: ThemeDef): Disposable;
    font(def: FontDef): Disposable;                      component<P>(def: ComponentDef<P>): Disposable;
  };
  z: typeof import('zod');          // shared Zod instance: plugin schemas join the document schema
  geometry: GeometryApi; tokens: TokenApi; settings: SettingsApi; log: Logger;
  permissions: GrantedPermissions;
}
// @fluxion/sdk/editor
export interface EditorContext extends PlayerContext {
  register: PlayerContext['register'] & {
    tool(def: ToolDef): Disposable; panel(def: PanelDef): Disposable; inspector(def: InspectorDef): Disposable;
    command<A>(def: CommandDef<A>): Disposable; importer(def: ImporterDef): Disposable;
    exporter(def: ExporterDef): Disposable; dslMacro(def: DslMacroDef): Disposable; lintRule(def: LintRule): Disposable;
  };
  ui: EditorUiApi;                  // toasts, dialogs, selection read, run command
}
// @fluxion/sdk/testing — renderComponent(), contractTest(def), fakeContext(), fixtures
```

Stability: API Extractor reports (`packages/*/api/*.api.md`, `check-api.mjs`) are checked in CI. Release tags
are `@public` (semver-guaranteed), `@beta`, `@alpha` and `@internal` (not exported). A breaking
change to `@public` needs a major changeset plus an ADR (NFR-MNT-007). The host accepts plugins
whose `engines.sdk` range includes its SDK version and refuses others with a diagnostic.

## 6. React component element contract (FR-CMP-001..007)

```ts
interface ComponentDef<P> {
  id: string;                                   // "acme-charts:line"
  props: ZodType<P>; defaultProps: P;           // serializable by props only (FR-CMP-005)
  defaultSize: { w: number; h: number };
  usableAs: Array<'shape' | 'label' | 'rider' | 'popup'>;          // FR-CMP-003
  anchors?: AnchorDef[] | ((props: P, size: Size) => AnchorDef[]); // static or dynamic (FR-ANC-008)
  events?: Record<string, ZodType>;             // triggers it can emit (FR-INT)
  methods?: Record<string, ZodType>;            // actions it exposes
  animations?: string[];                        // named animations it supports (steps can target them)
  interactiveInEdit?: boolean;                  // FR-CMP-004
  view: ComponentType<ComponentProps<P>>;
  snapshot?(input: SnapshotInput<P>): Promise<{ svg: string } | { png: Uint8Array }>; // FR-CMP-006
  inspector?: () => Promise<ComponentType<InspectorProps<P>>>;     // editor entry only
}
interface ComponentProps<P> {
  props: P; size: Size; mode: 'edit' | 'present' | 'export';
  theme: ResolvedTokens;                        // read tokens; CSS vars also inherited
  time: { step: number; progress: number; playing: boolean }; // controlled by the host clock
  vars: Readonly<Record<string, VarValue>>;     // read only
  reducedMotion: boolean;
  emit(event: string, payload?: unknown): void;
  expose(methods: Record<string, (args: unknown) => void>): void;
  setAnchors(anchors: AnchorDef[]): void;       // dynamic anchors, re-routes attached connectors
}
```

- `useFluxion()` gives the same fields as a hook for deep trees.
- Components must render from `props + time`: remounting with the same inputs gives the same
  output (contract test). Internal animations must follow `time` so edit-mode scrubbing is
  faithful (research 03 §9.3).
- In edit mode the host captures pointer events unless the element is entered or
  `interactiveInEdit` is set.
- Each instance is wrapped in an **error boundary**. A throw renders a placeholder (snapshot if
  available) with the error, logs a diagnostic, and never breaks the screen (FR-CMP-007,
  NFR-REL-004).
- On save the host calls `snapshot()` (or rasterizes the view in the studio) and stores the result
  in `snapshots/` (08 §2). SVG snapshots go through the sanitizer.

## 7. Packaging: `.fluxpack` (FR-PKG-001) and embedding (FR-PKG-002)

```
acme-charts-1.4.2.fluxpack (zip)
├── mimetype                "application/vnd.fluxion.pack+zip" (first, stored)
├── fluxion-plugin.json
├── player.js  editor.js  worker.js     ESM, externals: react, react-dom, react/jsx-runtime, @fluxion/sdk/*
├── assets/…                            icons, fonts, thumbnails
├── integrity.json          { "<path>": "sha256-…" } for every file
├── LICENSE  README.md
└── signature.json          (R8, FR-PKG-005) publisher signature over integrity.json
```

`fluxion pack` builds it with the SDK's tsdown preset, rejects bundles that contain React
(FR-PKG-004), and enforces a size budget. Install verifies `integrity.json`.

On document save the host walks the records for used kinds, shape defs, components, markers,
effects, transitions, routers and live-container layouts. It then embeds:
- the **player** entry + manifest of each code plugin actually used, in
  `plugins/<id>@<ver>/player.js`;
- for declarative packs, **only the used definitions**, in `plugins/<id>@<ver>/defs.json`
  (NFR-SIZE-004).

Everything is deduplicated by hash and pinned in `manifest.plugins` (08 §2). Editor and worker
entries are never embedded.

### Shared dependencies (FR-PKG-004)

Plugins import bare specifiers `react`, `react-dom`, `react/jsx-runtime`, `@fluxion/sdk/player`.
The host resolves them to **its own instances** with an import map (one React, which hooks require):
- In the studio the map is static.
- In `.flux.html` the boot script creates shim modules re-exporting the player's instances and
  installs the map before the first plugin import.
- If an engine or CSP prevents installing the map, the loader rewrites the bare specifiers in the
  plugin text (es-module-lexer) to the same shim URLs. The research 04 §D.9 spike verifies this.

## 8. Trust tiers (FR-PKG-003, NFR-SEC-003)

| Tier | Who | Runs where | Capabilities |
|---|---|---|---|
| **first-party** | packs built from this repo, integrity in the host's built-in list | main realm | full SDK |
| **declarative** | any pack with no code entry | no code runs; data sanitized | n/a |
| **user-trusted** | the user chose "Trust" for `id@version+integrity` (stored locally, per publisher later) | main realm, in page | full SDK; `connect-src` widened only to declared hosts |
| **untrusted** (default for code embedded in an opened file) | unknown code | **sandboxed iframe** `sandbox="allow-scripts"` (opaque origin), `srcdoc` with strict CSP (`default-src 'none'`, `connect-src 'none'` unless granted) | components only, over RPC |

Sandbox RPC runs over a `MessageChannel`, and each message is validated with a Zod schema:

```ts
type HostMsg =
  | { t: 'init'; plugin: PluginLock; sdk: string; tokens: ResolvedTokens }
  | { t: 'render'; el: string; component: string; props: unknown; size: Size; mode: Mode; time: TimeState }
  | { t: 'call'; el: string; method: string; args: unknown } | { t: 'snapshot'; el: string };
type SandboxMsg =
  | { t: 'ready'; registered: string[] } | { t: 'emit'; el: string; event: string; payload: unknown }
  | { t: 'anchors'; el: string; anchors: AnchorDef[] } | { t: 'snapshot'; el: string; svg: string }
  | { t: 'error'; el?: string; message: string };
```

- The host positions one pooled iframe per visible instance over the element box and syncs the
  camera transform. Offscreen instances show their snapshot.
- Synchronous player contributions (routers, effect samplers) cannot run in a sandbox. Their
  elements use the baked route cache and snapshots and render static, with a "Trust to animate"
  affordance.
- On open, the user is prompted per plugin: *Run sandboxed* (default) / *Trust* / *Keep static*.
- A security E2E test proves that the sandbox cannot read parent DOM, storage or cookies.

## 9. Missing-plugin fallback (FR-EXT-008)

When a plugin is missing, refused, fails integrity or is out of range, its elements render their
**snapshot** (or a labelled placeholder box with the element's `semantic` label). Connectors stay
bound through the element box, and the records are preserved byte-for-byte on save (FR-DOC-005).
The inspector offers a raw JSON props editor and "Find plugin". Diagnostics use the
`FLX_PLUGIN_MISSING` / `_BLOCKED` / `_INTEGRITY` codes.

## 10. Plugin developer workflow (FR-EXT-006, FR-CLI-003)

| Step | Command | Result |
|---|---|---|
| scaffold | `fluxion plugin create <name> --template shapes\|component\|layout\|theme\|importer` | package with manifest, entries, Vitest + `contractTest`, example FluxScript |
| develop | `fluxion plugin dev` | Vite dev server + WebSocket; studio opened with `?plugin-dev=<url>` loads it as user-trusted and hot-reloads by dispose → re-activate |
| check | `fluxion plugin validate` | manifest schema, no bundled React, player entry free of editor imports, size budget, AI summaries present |
| ship | `fluxion pack` | `.fluxpack` with integrity |

Target: from scaffold to running in the dev studio in under 1 minute.

## 11. First-party packs (`packs/*`)

| Pack | Contents | Inc |
|---|---|---|
| `basic` | rect, rounded-rect, ellipse, diamond, triangle, text/stat components, core markers | R1 |
| `themes-core` | ≥ 8 themes (FR-THM-003), font pairings | R1 |
| `flowchart` | process, decision, database, queue, document, terminator… | R3 |
| `arrows`, `callouts`, `infographic` | block arrows, callouts, SmartArt-like templates | R3 |
| `uml`, `bpmn-lite`, `network` | class/sequence-lite, BPMN core, network/cloud nodes | R3 |
| `icons-lucide` | Lucide via Iconify JSON (ISC) | R3 |
| `effects-core` | entrance/exit/emphasis presets, riders (dot, electron, packet), flows | R4 |
| `layouts-elk` (optional) | elkjs layered/stress/rectpacking in a worker; EPL-2.0, unmodified, lazy | R3 |
| `routing-libavoid` (optional) | libavoid-js wasm router; LGPL-2.1, separate chunk | R3 |

### M18 declarative shape-pack decision (implementation pending)

[ADR-0048](decisions/ADR-0048-shape-pack-format-v1.md) defines the data boundary beside
the existing SDK runtime `PackSpec`: a licensed `index.json`, hashed per-category
`ShapeDef` files, metadata-only search and atomic category registration. Saved files
carry only used definitions and attribution, pinned by a data-only manifest lock.
The loader must never execute that data; code-plugin activation remains M27.
M18.12–14 implement and test this decision before it is a supported authoring format.

[ADR-0050](decisions/ADR-0050-pack-license-attribution.md) supplements that pending format
with source credits and used-subset attribution. Content-asset permissions never authorize
code dependencies; current code/font policy stays unchanged. M18.12/14/33 implement
validation, portable credits and the license gate/player UI before these are supported.

## First-party declarative pack suite (ADR-0193, ADR-0194)

A shape pack exports its source as a `DeclarativeShapePack` (`<pack>Source`: version equal to
the package version, names, credits, named definitions); `buildShapePackFiles` from
`@fluxion/sdk` turns it into the canonical `index.json` and hashed category files through
core's `encodeShapePack`, the one encoder imported packs use too (ADR-0196), refusing a pack the
loader would not accept.
`@fluxion/sdk/testing` draws each definition's normalized SVG golden (`renderShapeGolden`)
and `checkShapePack` reports every problem of the checked-in `pack/`, `__golden__/` and
`pack-versions.json`: changed, missing or extra files, loader diagnostics, vendor brands,
geometry leaving the box at any number param's bounds, any corner of the params' range or enum
value, at the default size or resized to 16 units (outline, handles, text regions, anchors), and versions. The ledger maps each released version to its category
hashes; changing geometry at a recorded version fails until the package version is bumped,
and a version `CHANGELOG.md` names must keep its entry. `0.0.0` is never recorded. After
`changeset version`, `pnpm run version-packages` syncs each pack's `VERSION` and rebuilds its files.
Every first-party pack's `src/pack.test.ts` calls `testShapePack(source, globs)` with its
exported source and its `import.meta.glob` results (ADR-0199). Ordinary runs only compare (M18.100);
`VITE_FLUXION_WRITE_PACK=1 pnpm exec vitest run packs/<pack> -u` rewrites the files for review.

## Declarative shape-pack validation (ADR-0178)

`@fluxion/sdk` exports `parseShapePackIndex(input, licensePolicy)` and
`parseShapePackCategory(input, index, category, licensePolicy)`. Supply a content-policy
function that accepts only approved SPDX expressions; no default permission is inferred.
Both return Results with path-specific diagnostics, and a failed category returns no subset.
Successful definitions can be passed to the existing atomic `definePack` registration.

`fixtures/shape-pack/` is a valid version-1.0 wire example, including original source
statements and complete notices. Index definitions must be unique, namespace-bound and
covered by credits; category definitions must match the index exactly. Upstream source
records require a byte hash and reference. Original records require an author and explicit
statement. The validators preserve notices and do not fetch source references.

The structural JSON Schemas in `packages/core/generated/` support tooling, but do not
replace semantic/license validation. Regenerate with `node scripts/core/pack-schemas.mjs --write`
after building core; omit `--write` to check snapshots. Category byte-hash verification
and lazy loading remain M18.13, and imported paint-tree validation remains M18.47.

Optional `ShapeDef.artwork` carries inert imported paint independently of the routing outline
(ADR-0180). `SvgArtwork` and `SvgArtworkNode` describe the bounded tree; `parseSvgArtwork`
validates geometry, local reference graphs and resource limits before rendering. Shape and
pack parsers apply the same validation. The renderer scopes IDs per instance and preserves
literal colors unless an explicit theme-color mapping resolves. Legacy definitions retain
outline rendering. Portable storage retains used definitions and their source credits (M18.14).

### Lazy declarative loading

`createShapePackLoader(indexBytes, options)` (ADR-0181) validates original index bytes
without reading geometry. Supply an explicit content license policy, `Hasher`, a relative
path reader and a positive safe-integer `maxBytes` cap. Readers enforce that cap during I/O;
the adapter also checks size before copying, hashing and parsing. Ordinary failures return
`FLX_PACK_INVALID` diagnostics rather than partial definitions.

`ShapePackLoader.search(query)` searches frozen metadata only. `load(id)` reads and verifies
only the indexed category; concurrent IDs in that category share one pending operation.
Successful categories are cached within the immutable namespace/version/index-hash identity.
A failed load is retried only on a subsequent explicit call. The adapter never registers a
partial pack, chooses a network endpoint or loads executable code. `ShapePackLoaderOptions`
captures host capabilities at creation; used-definition embedding and offline resave are exercised by M18.14.

### Verified artwork font acquisition (ADR-0192)

`createArtworkShapePackLoader(indexBytes, options)` takes the same options and accepts 1.0
or 1.1 indexes; `createShapePackLoader` keeps 1.0-only behavior and refuses 1.1 rather than
drop font obligations. `search` does no category or font I/O. `acquire(id, { signal })`
captures its arguments before any await, reads the version-checked category (artwork text
closure included), then reads each bound resource at `fonts/<sha256>.woff2` with the declared
size as cap and requires the hash of the resource and its supported profile. It returns a
frozen `AcquiredArtworkDefinition`: the definition, `AcquiredArtworkFont` faces in binding
order with consumer-owned byte copies, and the font credits naming the definition. Concurrent
acquisitions share one verified read per resource; failures are evicted and retried on a later
call. Cancellation (`signal.aborted`, sampled around every host await) and every mismatch
return diagnostics and no value. `ARTWORK_ACQUISITION_LIMITS` bounds one acquisition to 8
faces, 5 MiB per font and 8 MiB in total. No registration or document effect happens here.

### Artwork font registration (ADR-0192, M18.97)

Exact artwork bytes are registered under the private family `artworkFontAlias(sha256)`
(`fx-artwork-<sha256>`), derived from the byte identity alone, never under the source family:
ordinary document text of the same family keeps its own face. Core is pure:
`artworkFontRequirements(subsets)` lists each bound identity once, and
`registerVersionedShapePackSubsets({ shapeDefs, artworkFonts }, subsets, policy, registered)`
registers 1.0 and 1.1 subsets atomically, refusing everything when a bound identity is not in
`registered`. Geometry stays canonical; per-definition `ArtworkFontBinding`s go to
`artworkFonts`. Render's `registerArtworkFonts` checks every font (present, exact size and
SHA-256) before creating any `FontFace`, requires each to load, copies bytes before its first
await, and leaves nothing on failure or cancellation; one face per identity per font set is
shared and leaves with its last owner. `registerSavedShapePacks` composes both. The
`fx-artwork-` prefix is reserved (`isArtworkFontAlias`): hosts never register a document or theme
font under it, so one file cannot shadow another file's artwork face on the same page.
`RenderRegistries.artworkFonts` reaches the shape view, which draws bound text through
`aliasSvgArtworkFonts` (alias named, the text's inline font declarations dropped) and draws a
placeholder, never a fallback face, for text without its binding. The one-file player opens
files this way before its first paint. Where no `FontFace` exists, `@fluxion/render/ssr`'s
`embedSavedShapePacks(shapeDefs, packs, ports)` checks the packs, verifies every bound font's
size and SHA-256 and registers geometry with a new `artworkFonts` registry; `renderDocumentToHtml`
takes the returned `fonts` as `artworkFonts` and writes one generated `@font-face` per identity
under its alias, bytes inline (M18.116). `fluxion render` opens a `.flux` this way under the shape
content policy; `--format png` photographs only after every alias face has loaded and otherwise
exits 1, as it does for missing bytes or a file that opens only in part; container notes are
warnings, and images are drawn from the archive's verified bytes. `convert` opens saved packs under the same policy and
refuses a `.flux.json` that would drop them.

Hosts check first (M18.115): `checkVersionedShapePackSubsets(registry, inputs, policy)` parses,
checks rights and finds namespaces free without effects, and `registerSavedShapePacks` runs it
before reading any font, so a refused pack never touches the page. Render's `loadFontFaces`, the
studio's opened-file fonts and the one-file player skip document fonts in the reserved namespace.
The studio opens a file's saved packs through `registerSavedShapePacks` (re-exported by the
player) before showing it in the editor or present mode: `OpenedFile.artworkFonts` holds the
loader-verified bytes by SHA-256, crash-recovery state carries them (they have no asset record),
and Save passes them with each embedded source. They leave with the file; edits, undo and redo
never touch them. Missing or changed bytes show the refusal instead of the document.

Imported artwork and the shared pack suite (M18.81): core's `encodeShapePack` takes a draft's
`fonts` (`ShapePackDraftFonts`: the 1.1 font metadata plus each resource's exact bytes by SHA-256)
and then encodes a 1.1 index and categories, checked by the 1.1 parsers, with each font, size and
hash verified, at `fonts/<sha256>.woff2`; a draft without `fonts` encodes byte-identically as
before. `importedShapePack` and `iconifyShapePack` take `fonts` (`ImportedPackFont`: bytes and the
font's declared license, attribution, notice and source) for the faces entries' text needs
(`SvgImportResult.fonts`): any font-bearing entry makes the pack a 1.1 with one resource per byte
identity, its faces, bindings and a font credit scoped to the definitions using it, and the
distribution source carries the bytes, so a portable save retains them and the file reopens
offline. A needed font that is not supplied, not a supported profile or under a font license the
policy refuses is refused; nothing is partial. The sdk suite builds text files with
`buildShapePackFiles`, expects a 1.1 pack's fonts as binary files (`ShapePackExpectation.fonts`,
`CheckedInShapePack.fonts`), records each font's hash in the version ledger and checks the files
through `createArtworkShapePackLoader`, acquiring every definition with its verified fonts;
`renderShapeGolden(def, fonts)` draws artwork text under the alias bindings.

### Saved shape subset validation (ADR-0182)

`ShapePackSubset` is the strict saved envelope: format, formatVersion, id, version, license,
attribution, definitions and credits. `parseShapePackSubset(input, licensePolicy)` validates
all geometry and source coverage without inventing distribution category metadata.
The explicit `allowsShapePackContentLicense` adapter follows the existing content allowlist
and AND/OR/WITH policy, with input/token/depth bounds; it does not establish ownership.
The generated structural schema alone does not establish semantic validity. This boundary
adds no registration or I/O. M18.74/75 prepare canonical locks and validate known data in
format readers/writers (ADR-0183/0184). M18.76 restores subsets before host rendering and preserves their provenance through Studio
saves (ADR-0185). Registration refuses existing namespaces transactionally, even with disjoint
IDs or matching source ownership. M18.14 verifies a real 5000-definition source shrinks to exactly three referenced shapes,
including a grouped child, with all applicable notices and identical offline rendering.
Credit-display UI remains M18.33.

SVG import reuses `inspectSvgTree` from format (ADR-0186): bounded, allowlisted decoded
data with removal diagnostics. This is not semantic artwork validation; M18.15 must
validate viewport, geometry and local references through core before registration.
`fluxion pack-import` (ADR-0206, M18.16) is the host that joins the batch (ADR-0188), the Node
paint witness (ADR-0189) and `importedShapePack` (ADR-0192): a folder or ZIP of SVGs, each member
credited to its declared rights by a scoped credit, becomes one checked 1.0/1.1 pack directory
written atomically, or nothing.
