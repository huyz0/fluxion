# 02 — Document Model

> Read when: touching `@fluxion/schema`, adding a record type or field, writing a migration,
> or generating documents (AI/DSL). Contract rules: `docs/standards/contracts.md`.

## 1. Principles

1. **Normalized records** in a flat `Map<RecordId, Record>` — no deep nesting, no positional
   arrays for order. Every relation is by ID. (CRDT-ready, NFR-MNT-006.)
2. **Order by fractional index** strings (`index: "a0V"`) for screens, z-order, steps.
3. **Intent over geometry where possible**: connectors store *bindings* (element + anchor
   intent), not endpoint coordinates; styles store *token references*, not resolved colors.
4. **Schema = Zod 4** in `@fluxion/schema`; TS types are `z.infer`; JSON Schema for AI/MCP is
   generated from the same source (FR-AI-001).
5. **Open for extension**: plugin kinds carry `kind: "<pluginId>:<name>"` and a `props` object
   validated by the plugin's schema when present, preserved verbatim when not (FR-DOC-005).

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

| Record | Key fields | Notes |
|---|---|---|
| `document` (singleton) | `schemaVersion`, `title`, `lang`, `themeId`, `settings` (responsive mode, reduced-motion policy, line jumps…), `authors`, `created`, `modified` | One per file |
| `screen` | `index`, `name`, `size {w,h}` or `kind:'infinite'` + `viewport`, `background`, `masterId?`, `parentElementId?` (sub-screen), `sectionId?`, `notes` (rich text), `hidden`, `transition`, `states?`, `breakpoints?`, `layout?` (screen-level layout intent, e.g. layered LR — FR-LAY-005) | FR-SCR-* |
| `element` | `screenId`, `parentId?` (group/frame/container), `index` (z), `kind`, `transform {x,y,w,h,rot,flipX,flipY}`, `style`, `text?`, `semantic?`, `locks?`, `matchKey?` (magic move), `layout?` (container layout spec), `overrides?` (per state/breakpoint), `placement?` (`'auto'` or `'pinned'`) (auto = layout may move it; a human drag or explicit coordinates pin it — FR-DSL-005, FR-LAY-006) | Discriminated by `kind` |
| `binding` | `connectorId`, `end: 'source'\|'target'`, `elementId`, `anchor: AnchorRef` | Separate record → moving/deleting shapes updates bindings cleanly (tldraw pattern) |
| `asset` | `hash` (sha256), `mime`, `size`, `name`, `w?`, `h?`, `source?` (URL if external) | Bytes live in the container, not in the record |
| `theme` | DTCG token tree + `defaults` (per kind/variant styles) | Themes may also come from packs |
| `timeline` | `screenId`, `name` (`main` = build sequence), `index` | FR-TML |
| `step` | `timelineId`, `index`, `trigger`, `animations: Animation[]` | Animation shapes in `07-animation-and-interaction.md` |
| `interaction` | `ownerId` (element/screen/document), `trigger`, `condition?`, `actions[]` | FR-INT |
| `variable` | `name`, `valueType`, `default` | FR-DOC-008 |
| `plugin-ref` | `pluginId`, `version`, `integrity`, `trust` | Lockfile of used plugins |
| `comment` | `targetId`, `author`, `body`, `resolved` | FR-EDT-020 |

### Element kinds (core)

| `kind` | Extra fields |
|---|---|
| `shape` | `defId` (e.g. `basic:rect`), `params` (definition params), `anchors?` (instance-custom), `textRegions?` |
| `connector` | `route {type: 'straight'\|'curved'\|'orthogonal'\|'polyline'\|<plugin>, waypoints?, cornerRadius?}`, `markers {start,end,mid?}`, `labels[]`, `riders[]`, `effects[]`, `jumps?` — endpoints via `binding` records or `freeSource/freeTarget` points |
| `group` | none (children via `parentId`) |
| `frame` | `clip`, `layout?` (live container), `padding` |
| `text` | `text` (rich text doc), `autoSize` |
| `image` | `assetId`, `crop`, `fit`, `maskDefId?` |
| `component` | `componentId` (`<plugin>:<name>`), `props`, `snapshotAssetId?` (fallback) |
| `table` | `rows`, `cols`, `cells` (R3) |
| `<plugin>:<name>` | `props` — validated by plugin schema if loaded |

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
Resolution order: element literal → element token ref → theme `defaults[kind][variant]` →
theme `defaults[kind]` → theme globals.

## 3. IDs & human slugs

- Internal IDs: `nanoid(16)` (≈ 95 bits). Generated through the injected `Random` port so tests
  are deterministic.
- **Slugs** (`element.semantic.slug`, unique per document) are the handles used by FluxScript,
  AI patches and MCP tools (`api`, `pay-detail`). The compiler maps slug → ID; the decompiler
  emits slugs (generating them from labels when absent).

## 4. Versioning & migrations

- `document.schemaVersion` is semver `MAJOR.MINOR`. Minor = additive (optional fields/kinds);
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
