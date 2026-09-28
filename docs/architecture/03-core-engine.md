# 03 — Core Engine (`@fluxion/core`, `@fluxion/geometry`)

> Read when: touching the store, commands, undo, registries, geometry, hit-testing, or adding
> any mutation path (editor tool, AI patch, DSL compile, plugin command).

## 1. Store

```ts
interface Store {
  get<T extends AnyRecord>(id: RecordId): T | undefined;
  query<T>(q: Query<T>): Signal<T[]>;           // reactive, memoized (alien-signals computed)
  record$(id: RecordId): Signal<AnyRecord | undefined>;
  transact<R>(label: string, fn: (tx: Tx) => R, opts?: TxOptions): Result<R, TxFailure>;  // only write path (ADR-0014)
  subscribe(listener: (diff: Diff, meta: TxMeta) => void): Unsubscribe;
}

interface Tx { put(r: AnyRecord): void; patch(id, partial): void; delete(id): void; }
interface Diff { puts: Map<RecordId, { before?: AnyRecord; after: AnyRecord }>; deletes: Map<RecordId, AnyRecord>; }
```

- Records are **immutable values**; `patch` produces a new object (structural sharing).
- One signal per record + indexes (by screen, by parent, by type, bindings by element) kept
  incrementally from diffs → queries are O(changed).
- `transact` validates changed records in dev/test (full Zod) and runs **integrity hooks**
  (registered per kind) inside the same transaction: e.g. deleting an element deletes its
  bindings or converts them to free endpoints; deleting a screen deletes its elements.
- Semantics (net diffs, rollback as a `Result`, hook order, merging, forks): ADR-0014.
- Every transaction emits one `Diff` → undo stack, autosave, dirty tracking, (future) CRDT
  bridge, MCP live link.

## 2. Commands

```ts
interface CommandDef<A> {
  id: string;                         // 'element.align', 'screen.duplicate', 'ai.applyPatch'
  title: MessageDescriptor;           // i18n
  args: ZodType<A>;                   // validated; also exported to AI catalog & MCP
  when?: (ctx: CommandContext) => boolean;
  run(ctx: CommandContext, args: A): void | CommandResult;   // uses ctx.store.transact
}
```
- **All** mutations from UI, keyboard, command palette, AI patches, MCP and plugins go
  through commands → one audit path, one undo semantics, one AI surface.
- Gestures (drag, resize) use **transaction merging**: `transact(label, fn, { mergeKey })`
  coalesces consecutive transactions with the same key into one undo entry.

## 3. Undo / redo

- History entries = inverse diffs (`before` snapshots) + selection & view state.
- Undo applies the inverse diff through `transact` with `origin: 'undo'` (not re-recorded).
- Property test (NFR-REL-003): random command sequences → undo all → deep-equal initial.

## 4. Registries (the extension backbone)

```ts
interface Registry<K extends string, V> {
  register(key: K, value: V, source: PluginId): Disposable;
  get(key: K): V | undefined;
  list(): ReadonlyArray<[K, V]>;
  changes$: Signal<number>;
}
```
Registries in core: `elementKinds`, `shapeDefs`, `markers`, `routers`, `layouts`, `effects`,
`transitions`, `themes`, `fonts`, `commands`, `integrityHooks`, `importers`, `exporters`,
`dslMacros`, `lintRules`. Render-level registries (`elementViews`, `components`) live in
`render`; editor-level (`tools`, `panels`, `inspectors`) in `editor`. Built-ins are registered
by first-party packs through the same API (FR-EXT-001; lint forbids `switch (kind)` over
extensible unions outside registries).

## 5. Shape definitions

```ts
interface ShapeDef {
  id: string;                               // 'basic:star'
  params?: Record<string, ParamSpec>;       // { points: {type:'int',min:3,max:24,default:5} }
  outline: OutlineSpec;                     // { svgPath: template } | { fn: 'basic.star' }
  anchors?: AnchorDef[];                    // default: n,e,s,w,center
  textRegions?: TextRegionDef[];            // default: inset box
  handles?: HandleDef[];                    // param-bound drag handles
  defaultSize: { w: number; h: number };
  defaultStyle?: Partial<Style>;
  decorations?: SvgFragmentSpec[];          // non-outline strokes/icons (e.g., cylinder top ellipse)
  keywords?: string[]; category?: string; license?: string;
}
```
`outline` evaluates to a normalized path (absolute cubic beziers) in unit box → used for
render, hit-testing, perimeter projection, morphing, boolean ops, export.
Path templates use a tiny safe expression language (`w`, `h`, params, arithmetic, `min/max`),
evaluated by the same interpreter as bindings (no `eval`).

## 6. Geometry (`@fluxion/geometry`)

- `Vec2`, `Mat2d`, `Box`, `Path` (cubic-normalized), `PathSampler` (arc-length LUT),
  intersections (segment/bezier), point-in-path, nearest-point-on-path, offset, bounds.
- Spatial index: `rbush` (dynamic, editor) and `flatbush` (static, player/export) behind a
  common `SpatialIndex` interface.
- All functions pure and property-tested (fast-check): e.g., `nearestPoint(p)` is on path and no
  sampled point is closer.

## 7. Ports (injected dependencies)

| Port | Purpose | Browser impl | Node impl | Test impl |
|---|---|---|---|---|
| `Clock` | now(), frame scheduling | `performance.now`, rAF | `performance.now`, setImmediate | `VirtualClock` |
| `Random` | IDs, seeded algorithms | `crypto.getRandomValues` / seeded PRNG | same | seeded PRNG |
| `TextMeasurer` | text box metrics | canvas measureText + font loading | fontkit | fixed-metrics fake |
| `FileIO` | read/write bytes | FS Access API / download / OPFS | `node:fs` | in-memory |
| `Hasher` | sha256 | SubtleCrypto | `node:crypto` | same |
| `Logger` | structured logs | console w/ namespaces | pino-like stdout | capture |

## 8. Selection & editor state (not in document)

Editor/session state (selection, camera, active tool, hover, preview clock) lives in a
separate **session store** (Zustand) keyed by document ID, never serialized into the file.
