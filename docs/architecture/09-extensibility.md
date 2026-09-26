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

Stability: API Extractor reports (`packages/sdk/etc/*.api.md`) are checked in CI. Release tags
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
