# 03 — Core Engine (`@fluxion/core`, `@fluxion/geometry`)

> Read when: touching the store, commands, undo, registries, geometry, hit-testing, or adding
> any mutation path (editor tool, AI patch, DSL compile, plugin command).

## 1. Store

```ts
interface Store {
  get(id: RecordId): AnyRecord | undefined;
  has(id: RecordId): boolean;
  ids(): RecordId[];
  readonly size: number;
  members(index: IndexName, key: string): RecordId[];   // byScreen, byParent, byType, bindingsByElement
  record$(id: RecordId): ReadSignal<AnyRecord | undefined>;
  query<T>(fn: (view: ReadView) => T): ReadSignal<T>;   // memoized; re-runs only when what it read changes
  transact<R>(label: string, fn: (tx: Tx) => R, options?: TxOptions): Result<R, TxFailure>;   // the only write path
  subscribe(listener: (diff: Diff, meta: TxMeta) => void): () => void;
  readonly history: History;
  readonly readOnly: boolean;
  fork(): Store;
  diffFrom(parent: Store): Diff | undefined;
  toDocument(): DocumentFile;
}

interface Tx {
  get(id: RecordId): AnyRecord | undefined;   // the transaction's working state
  put(record: AnyRecord): void;
  patch(id: RecordId, fields: Readonly<Record<string, unknown>>): void;
  delete(id: RecordId): void;
}

type Diff = {
  readonly puts: ReadonlyMap<RecordId, PutChange>;   // { before?, after }
  readonly deletes: ReadonlyMap<RecordId, AnyRecord>;
};
```

- `createCore` wires a store for a `DocumentFile`: the core registries with the built-in hooks
  (`CORE_HOOKS`) and commands (`CORE_COMMANDS`) registered, the store created with those hooks, and
  `execute` for commands. `createStore` alone builds a bare store. `StoreOptions`: `validate`
  (default on; only production builds may switch it off), `hooks` (the `integrityHooks` registry),
  `policy` (`'read-write'` or `'read-only'`).
- Records are immutable (frozen) values; `patch` produces a new object.
- One signal per record (`record$`) and the `IndexName` indexes, kept from each diff; indexes are
  built on first use.
- `transact` runs its function on a working copy, runs the integrity hooks to a fixed point,
  validates the net diff (structural checks on the changed records, the referential check over
  the whole post-state: ADR-0014 amendment M3.23), then commits, or fails (`TX_INVALID`,
  `TX_HOOK_DEPTH`, `TX_READ_ONLY`) with diagnostics and leaves the store unchanged. A nested
  `transact` is a savepoint. An `undo` or `redo` origin is refused (`TX_INVALID`,
  `FLX_ORIGIN_RESERVED`): only the history module replays with them.
- Each committed transaction emits one `Diff` with its `TxMeta` to subscribers, after the history
  has recorded it: undo, autosave, dirty tracking, a future CRDT bridge and the MCP live link all
  read this one stream.
- Forks: `fork()` is O(1) and copy-on-write, and a fork is read-write even when its parent is
  read-only. `diffFrom(parent)` gives the fork's net change against its fork-time snapshot, and
  `applyFork(parent, fork)` writes that change into the parent as one user transaction.
- Semantics (net diffs, rollback as a `Result`, hook order, merging, forks, policy): ADR-0014.

## 2. Commands

```ts
type CommandDef<A> = {
  readonly id: string;                  // 'element.update', 'screen.reorder'
  readonly title: MessageDescriptor;    // i18n
  readonly args: ArgsSchema<A>;         // a Zod schema fits; parsed before run, exported to AI and MCP
  when?(ctx: CommandContext): boolean;
  run(ctx: CommandContext, args: A): Result<unknown, TxFailure>;   // writes through ctx.store.transact
};
```

- `defineCommand` types a definition, and definitions live in the `commands` registry.
  `executeCommand` looks the id up and refuses, with a diagnostic and the store untouched, an
  unknown id (`COMMAND_UNKNOWN`), an `undo` or `redo` origin (`COMMAND_ARGS` at
  `/options/origin`), a read-only store (`TX_READ_ONLY`), `when` returning false
  (`COMMAND_DISABLED`) and arguments the schema rejects (`COMMAND_ARGS`); then it runs the command.
  A built-in given an id that is missing or of the wrong type also returns `COMMAND_ARGS` (a bad
  argument, not an invalid document).
- `CommandContext` carries the `store` and optional `options` (`CommandTxOptions`: `mergeKey`,
  `origin` other than `undo`/`redo`, `metaBefore`, `metaAfter`) for the command's transaction.
- `CORE_COMMANDS` (registered by `registerCoreCommands`): element.create, element.update,
  element.delete, screen.create, screen.delete, screen.reorder, binding.set, document.update.
- **All** mutations from UI, keyboard, command palette, AI patches, MCP and plugins go through
  commands: one audit path, one undo semantics, one AI surface. The architecture test allows
  `transact` only in a command's `run`, the history module and the fork module.

## 3. Undo / redo

- `History` (the store's `history`): `undo()`, `redo()`, `canUndo()`, `canRedo()`, `undoDepth`,
  `redoDepth`, `seal()` and `batch(label, fn)`.
- An entry is the net diff of a `'user'` or `'system'` transaction plus the caller's `metaBefore`
  and `metaAfter` (selection, view); `'undo'`, `'redo'` and `'remote'` commits are not recorded
  and close the open entry. Undo applies the inverse diff through `transact` with origin `'undo'`, and redo
  re-applies it with `'redo'`. Neither runs hooks, and neither is recorded again.
- Gestures (drag, resize) pass a `mergeKey`: consecutive transactions with the same key and origin
  merge into one entry, as long as nothing else committed in between and `seal()` was not called.
  `batch` runs several commands as one entry.
- Property tests (NFR-REL-003): random command sequences, then undo all, deep-equal the initial
  document. Benches (NFR-PERF-006, `pnpm bench`) time undo, redo and transact of every built-in
  command on 5 000 records.

## 4. Registries (the extension backbone)

```ts
interface Registry<K extends string, V> {
  readonly name: string;
  // a key held by another source is refused: err(FLX_REGISTRY_DUPLICATE), the first entry stays
  register(key: K, value: V, source: PluginId): Result<Disposable, Diagnostic>;
  get(key: K): V | undefined;
  source(key: K): PluginId | undefined;
  list(): ReadonlyArray<readonly [K, V]>;       // sorted by key
  readonly changes$: ReadSignal<number>;
}
```

`createRegistry` makes one registry, and `createCoreRegistries` makes the core set
(`CORE_REGISTRY_NAMES`): `elementKinds`, `shapeDefs`, `markers`, `routers`, `layouts`, `effects`,
`transitions`, `themes`, `fonts`, `commands`, `integrityHooks`, `importers`, `exporters`,
`dslMacros` and `lintRules`. Render-level registries (element views, components) live in
@fluxion/render, and editor-level ones (tools, panels, inspectors) live in @fluxion/editor. First-party
packs register the built-ins through the same API (FR-EXT-001). The check-kind-switch gate
forbids switching on a kind outside registries.
Integrity hooks (`IntegrityHook`, ADR-0014) run inside each transaction, sorted by key, until a
pass changes nothing. The built-ins (`CORE_HOOKS`, registered by `registerCoreHooks`) cascade
screen and subtree deletes and keep connector ends either bound or free.

## 5. Shape definitions

```ts
interface ShapeDef {
  id: string;                               // 'basic:star'
  params?: Record<string, ParamSpec>;       // number | int | enum | points, with ranges and defaults
  outline: OutlineSpec;                     // { path } | { polygon: { n, x, y } } | { points, closed?, smooth? }
  anchors?: AnchorDef[];                    // default: n,e,s,w,center
  textRegions?: TextRegionDef[];            // default: inset box
  handles?: HandleDef[];                    // param-bound drag handles
  defaultSize: { w: number; h: number };
  defaultStyle?: Partial<Style>;
  decorations?: { path: string }[];         // stroke-only templates (e.g., cylinder top ellipse)
  keywords?: string[]; category?: string; license?: string;
}
```
ADR-0016 decides the outline representation, the expression language and where `ShapeDef` lives (core).
Outlines are written in the shape's own box (`0…w`, `0…h`), not a unit box.
`outline` evaluates to one normalized subpath (absolute cubic beziers), closed or open → used for
render, hit-testing, perimeter projection, morphing, boolean ops, export. Path templates use the
safe expression language of ADR-0016 (numbers, `w`, `h`, params, arithmetic, comparisons, a fixed
function set; enum params are their value's index), evaluated with a step budget and reused later
for bindings (no `eval`).

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
separate **session store** (core signals, ADR-0028) keyed by document ID, never serialized into the file.
