# 02 — Document Model

> Read when: touching `@fluxion/schema`, adding a record type or field, writing a migration,
> or generating documents (AI/DSL). Contract rules: `docs/standards/contracts.md`.

## 1. Principles

1. **Normalized records** in a flat `Map<RecordId, Record>` — no deep nesting, no positional
   arrays for order. Every relation is by ID. (CRDT-ready, NFR-MNT-006.)
2. **Order by fractional index** strings (`index: "a0V"`) for screens, z-order, steps.
3. **Intent over geometry where possible**: connectors store *bindings* (element + anchor
   intent), not endpoint coordinates; styles store *token references*, not resolved colors.
4. **Schema = Zod 4** in `@fluxion/schema`. Record types are written by hand with TSDoc and
   proven equal to their schemas at compile time by `checkedSchema` (ADR-0140); JSON Schema for
   AI/MCP is generated from the same source (FR-AI-001).
5. **Open for extension**: plugin kinds carry `kind: "<pluginId>:<name>"` and a `props` object
   validated by the plugin's schema when present, preserved verbatim when not (FR-DOC-005).
6. **Parsing validates only**: no defaults are filled in, so a valid document parses to itself
   (ADR-0142). Defaults are documented on the fields and applied by readers (`screenSize`,
   `screenKind`, `transformRotation`, then the theme/render layers).

## 2. Record catalogue

```ts
type RecordId = string & { __brand: 'RecordId' };   // nanoid(16), URL-safe
type Index = string & { __brand: 'FractionalIndex' };
type TokenRef = `{${string}}`;                       // e.g. "{color.primary}"
type StyleValue<T> = T | TokenRef | { token: TokenRef; transform: ColorTransform };

interface BaseRecord {
  id: RecordId;
  type: RecordType;                 // discriminator
  meta?: Record<string, unknown>;   // free-form, preserved
}

type RecordType =
  | 'document' | 'screen' | 'element' | 'binding' | 'asset' | 'theme'
  | 'timeline' | 'step' | 'interaction' | 'variable' | 'plugin-ref' | 'comment';
```

The schema version is not a record field: `schemaVersion` (`MAJOR.MINOR`) sits on the file
(`DocumentFile`, §7) beside `records`.

Key fields list what the schemas check (`?` = optional); every record also has `id`, `type`
and `meta?`, and keeps unknown fields verbatim (FR-DOC-005). Fields named under "Planned" are
not in schema `1.0`; until added (minor version) they are preserved but not checked.
`tests/harness/docs-consistency.test.mjs` compares these tables with the built schema.

| Record | Key fields | Notes |
|---|---|---|
| `document` (singleton) | `title?`, `lang?`, `themeId?`, `settings?` (`responsive`, `reducedMotion`, `lineJumps`), `authors?`, `created?`, `modified?` | One per file |
| `screen` | `index`, `name?`, `kind?` (`fixed` default, or `infinite` + `viewport`), `size? {w,h}` (default 1920×1080 via `screenSize`), `viewport?`, `background?`, `masterId?`, `parentElementId?` (sub-screen), `sectionId?`, `notes?` (rich text), `hidden?` | FR-SCR-*. Planned: `transition`, `states`, `breakpoints`, `layout` (screen-level layout intent, e.g. layered LR — FR-LAY-005) |
| `element` | `screenId`, `parentId?` (group/frame/container), `index` (z), `kind`, `name?`, `style?`, `semantic?`, `locks?`, `matchKey?` (magic move), `placement?` (`'auto'` or `'pinned'`: auto = layout may move it; a human drag or explicit coordinates pin it — FR-DSL-005, FR-LAY-006), `hidden?` | Discriminated by `kind`; fields common to every core kind. Boxed kinds (all but connector) add transform {x,y,w,h,rot?,flipX?,flipY?} and text? (element kinds table). Planned: `layout` (container layout spec), `overrides` (per state/breakpoint) |
| `binding` | `connectorId`, `end: 'source'\|'target'`, `elementId`, `anchor: AnchorRef` | Separate record → moving/deleting shapes updates bindings cleanly (tldraw pattern) |
| `asset` | `hash` (sha256), `mime`, `size`, `name`, `w?`, `h?`, `source?` (URL if external) | Bytes live in the container, not in the record |
| `theme` | `name`, `tokens` (DTCG token tree), `defaults?` (per kind/variant styles) | Themes may also come from packs |
| `timeline` | `screenId`, `name` (`main` = build sequence), `index`, `loop?` | FR-TML |
| `step` | `timelineId`, `index`, `trigger`, `animations: Animation[]`, `label?` | Animation shapes in `07-animation-and-interaction.md` |
| `interaction` | `ownerId` (element/screen/document), `trigger`, `condition?`, `actions[]` | FR-INT |
| `variable` | `name`, `valueType`, `default?` | FR-DOC-008 |
| `plugin-ref` | `pluginId`, `version`, `integrity?`, `trust` | Lockfile of used plugins |
| `comment` | `targetId`, `author`, `body`, `resolved?`, `created?` | FR-EDT-020 |

### Element kinds (core)

| `kind` | Extra fields | Planned |
|---|---|---|
| `shape` | `transform`, `text?`, `defId` (e.g. `basic:rect`), `params?` (definition params), `anchors?` (instance-custom) | `textRegions` |
| `connector` | `route {type: 'straight'\|'curved'\|'orthogonal'\|'polyline'\|<plugin>, waypoints?, cornerRadius?}`, `markers? {start?,end?,mid?}`, `labels?[]`, `freeSource?`, `freeTarget?` (points for an end without a `binding` record); no transform | `riders`, `effects`, `jumps` |
| `group` | `transform`, `text?` (children via `parentId`) | |
| `frame` | `transform`, `text?`, `clip?`, `padding?` | `layout` (live container) |
| `text` | `transform`, `text` (rich text doc, required), `autoSize?` | |
| `image` | `transform`, `text?`, `assetId`, `crop?`, `fit?`, `maskDefId?` | |
| `component` | `transform`, `text?`, `componentId` (`<plugin>:<name>`), `props`, `snapshotAssetId?` (fallback) | |
| `<plugin>:<name>` | `props?` — validated by plugin schema if loaded | |

`table` (`rows`, `cols`, `cells`) is planned for R3; until then it is an unknown kind, kept with
only its envelope checked.

### Anchors

```ts
type AnchorRef =
  | { kind: 'auto' }                               // engine picks (FR-ANC-004)
  | { kind: 'floating' }                           // nearest perimeter point toward other end
  | { kind: 'named'; name: string }                // from def or instance anchors
  | { kind: 'side'; side: 'n'|'e'|'s'|'w'; t?: number }  // t omitted → distributed/optimized
  | { kind: 'point'; x: number; y: number };       // fractional 0..1 in element box

interface AnchorDef { name: string; x: number; y: number; dir?: Vec2; role?: 'in'|'out'|'any'; max?: number; }
```

Resolved anchor positions are **derived** (never stored) — computed by `routing` from the
element's outline + transform.

### Rich text

A compact ProseMirror-compatible JSON (`{type:'doc', content:[…]}`) subset: paragraphs,
headings, lists, marks (bold/italic/underline/strike/code/link/color/highlight/font/size),
fields (`{{page}}`). Sanitized on load (NFR-SEC-001).

### Style

```ts
interface Style {
  fill?: Paint; stroke?: Stroke; opacity?: StyleValue<number>;
  radius?: StyleValue<number>; shadow?: Shadow[]; effects?: Effect[]; // glow, blur
  font?: FontStyle; variant?: string;               // theme variant name, e.g. 'emphasis'
}
```
Resolution order, per field: element literal → element token ref → theme
`defaults[kind].variants[variant]` → theme `defaults[kind]` → theme globals (`defaults['*']`) →
built-in fallbacks (`@fluxion/theme` `resolveStyle`, ADR-0015). An unknown token reference
(FLX_TOKEN_UNKNOWN) or a value that is not valid for its field (a non-colour, a keyword outside its
set) is skipped and the next layer is used, so no resolved value carries other CSS.

## 3. IDs & human slugs

- Internal IDs: `nanoid(16)` (≈ 95 bits). Generated through the injected `Random` port so tests
  are deterministic.
- **Slugs** (`element.semantic.slug`, unique per document) are the handles used by FluxScript,
  AI patches and MCP tools (`api`, `pay-detail`). The compiler maps slug → ID; the decompiler
  emits slugs (generating them from labels when absent).

## 4. Versioning & migrations

- The file's `schemaVersion` (on `DocumentFile`, not the `document` record) is `MAJOR.MINOR`. Minor = additive (optional fields/kinds);
  major = breaking (requires converter + ADR).
- Migrations are an ordered list `{ from, to, up(doc) }` per version step, pure functions over
  the record map. Every released version keeps a fixture in `packages/schema/__fixtures__/v*/`
  and CI migrates each to current and validates (FR-DOC-003).
- After migration a **lenient repair** pass fixes recoverable issues (dangling bindings → free
  endpoints, missing index → appended, unknown token → fallback) and reports them as warnings.
- Per-plugin data versions: `plugin-ref.version` + plugin-provided migrations for its `props`.

## 5. Validation & errors

```ts
interface Diagnostic {
  code: string;            // 'FLX_REF_MISSING', 'FLX_TOKEN_UNKNOWN', …  (stable, documented)
  severity: 'error' | 'warning' | 'info';
  path: string;            // JSON pointer, e.g. /records/el_abc/style/fill
  message: string;         // one line, human & LLM readable
  hint?: string;           // concrete fix, e.g. "did you mean 'basic:rounded-rect'?"
  source?: { line: number; col: number };  // when from FluxScript
}
```
Layers: (1) structural (Zod), (2) referential (IDs, anchors, assets, tokens, plugin kinds),
(3) semantic lint (overlap, contrast, overflow — `FR-AI-005`, in `dsl`/`core` lint module).

## 6. Derived data (never persisted unless "baked")

| Derived | Computed by | Baked on save? |
|---|---|---|
| Resolved styles | `theme` + `core` selectors | No |
| Anchor positions, connector routes | `routing` | Optional route cache (for exporters/no-JS site) |
| Layout positions for live containers | `layout` | Yes (positions always stored; live containers re-run on change) |
| Animation state at step/time | `anim` | No |
| Text metrics | render/measure port | No |

## 7. Example (canonical JSON, abbreviated)

```json
{
  "schemaVersion": "1.0",
  "records": {
    "doc": { "id": "doc", "type": "document", "title": "Checkout", "themeId": "th1" },
    "s1":  { "id": "s1", "type": "screen", "index": "a0", "name": "Architecture", "size": { "w": 1920, "h": 1080 } },
    "e1":  { "id": "e1", "type": "element", "screenId": "s1", "index": "a0", "kind": "shape",
             "defId": "basic:rounded-rect", "transform": { "x": 200, "y": 400, "w": 240, "h": 120, "rot": 0 },
             "style": { "variant": "emphasis" }, "text": { "type": "doc", "content": [ … "API" … ] },
             "semantic": { "slug": "api" } },
    "c1":  { "id": "c1", "type": "element", "screenId": "s1", "index": "a2", "kind": "connector",
             "route": { "type": "orthogonal", "cornerRadius": 8 }, "markers": { "end": "arrow" },
             "riders": [ { "shape": "effects-core:dot", "count": 5, "speed": 40, "loop": true } ] },
    "b1":  { "id": "b1", "type": "binding", "connectorId": "c1", "end": "source", "elementId": "e1", "anchor": { "kind": "auto" } }
  }
}
```
