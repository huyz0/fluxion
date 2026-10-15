// The `layout.arrange` command (FR-LAY-005, FR-LAY-001, 05-layout-and-routing.md §1): lay out a screen, a selection or a container with a registered
// algorithm and write the boxes back as ONE transaction (one undo step). Routes stay derived: only the `transform` of elements changes. The command
// lives here, beside the algorithms, so the editor, the CLI and MCP register the same one; it reads records structurally (this package has no
// schema dependency) and registers into a host's `commands` registry.
import { type AnyCommand, defineCommand, type Registry, type Store, type Tx, type TxFailure } from '@fluxion/core';
import { z } from 'zod';
import { err, type LayoutError, ok, type Result } from './errors.js';
import { layoutNested, type NestedRunner } from './nested.js';
import type { Boxes } from './passes.js';
import { layoutSync } from './pipeline.js';
import { buildSnapshot, type SnapshotRecord } from './snapshot.js';
import type { LayoutAlgorithm, LayoutInput, LayoutNode } from './types.js';
import type { AbortSignalWithEvents, LayoutHost } from './worker/host.js';

/** A record id as the store takes it (the schema's branded string; this package reads ids as plain strings). */
type StoreId = Parameters<Tx['patch']>[0];

/**
 * The id of the arrange command.
 *
 * @public
 */
export const ARRANGE_COMMAND_ID = 'layout.arrange';

/**
 * Finds a layout algorithm by its registered name.
 *
 * @public
 */
export type AlgorithmByName = (name: string) => LayoutAlgorithm<never> | undefined;

const scopeSchema = z.union([z.literal('screen'), z.literal('selection'), z.object({ containerId: z.string().min(1) })]);
const argsSchema = z.object({
  screenId: z.string().min(1),
  scope: scopeSchema.default('screen'),
  selection: z.array(z.string().min(1)).optional(),
  algorithm: z.string().min(1).default('layered'),
  options: z.unknown().optional(),
  seed: z.number().finite().optional(),
});
type Args = z.infer<typeof argsSchema>;

type Rec = SnapshotRecord & {
  readonly transform?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly layout?: unknown;
};

/** A refusal as the command result the store and callers understand. */
function refuse(message: string, at: ReadonlyArray<string | number>): Refusal {
  const path = `/args${at.map((p) => `/${String(p).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('')}`;
  return {
    ok: false,
    error: {
      code: 'COMMAND_ARGS',
      message: `${ARRANGE_COMMAND_ID}: ${message}`,
      diagnostics: [{ code: 'FLX_COMMAND_ARGS', severity: 'error', path, message }],
    } as TxFailure,
  };
}

/**
 * What the arrange code reads of a store.
 *
 * @public
 */
export type Reader = Pick<Store, 'members' | 'get'>;
/** A refusal as a command result. */
type Refusal = { ok: false; error: TxFailure };
/** The records of one screen and the layout input read from them (for the scope of the request). */
type Prepared = {
  /** The elements of the screen and every binding. */
  readonly byId: ReadonlyMap<string, Rec>;
  /** What the layout covers. */
  readonly input: LayoutInput;
};

/** A failure inside the runner, carried out of `layoutNested` to become a command result. */
class ArrangeFailure extends Error {}

/** The elements of the screen and every binding, as the snapshot builder reads them. */
function recordsOf(store: Reader, screenId: string): Rec[] {
  const ids = [...store.members('byScreen', screenId), ...store.members('byType', 'binding')];
  return ids.map((id) => store.get(id)).filter((r): r is NonNullable<typeof r> => r !== undefined) as unknown as Rec[];
}

/** The ids of `roots` and everything below them. */
function withDescendants(nodes: readonly LayoutNode[], roots: ReadonlySet<string>): Set<string> {
  const found = new Set(roots);
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of nodes) {
      if (!found.has(n.id) && n.parentId !== undefined && found.has(n.parentId)) {
        found.add(n.id);
        grew = true;
      }
    }
  }
  return found;
}

/** The layout input for the scope. A selection is laid out among the rest of the screen, which stays where it is (it is pinned). */
function inputFor(records: readonly Rec[], args: Args): LayoutInput {
  const scope = args.scope;
  if (scope !== 'selection') return buildSnapshot(records, { screenId: args.screenId, scope });
  const whole = buildSnapshot(records, { screenId: args.screenId, scope: 'screen' });
  const free = withDescendants(whole.nodes, new Set(args.selection ?? []));
  return { ...whole, scope, nodes: whole.nodes.map((n) => (free.has(n.id) ? n : { ...n, pinned: true })) };
}

/** The `{ type, options }` layout spec a container record carries, if it has a usable one. */
function specOf(record: Rec | undefined): { type: string; options: unknown } | undefined {
  const spec = record?.layout as { type?: unknown; options?: unknown } | undefined;
  return typeof spec?.type === 'string' ? { type: spec.type, options: spec.options } : undefined;
}

/** The layout spec that applies at a level: that of the container (the top level of a container scope is that container's own children), if any. */
function specAt(args: Args, container: string | undefined, byId: ReadonlyMap<string, Rec>): { type: string; options: unknown } | undefined {
  const owner = container ?? (typeof args.scope === 'object' ? args.scope.containerId : undefined);
  return owner === undefined ? undefined : specOf(byId.get(owner));
}

/** The algorithm and options for a level: those of its layout spec when that algorithm is registered, else the request's. */
function chosenFor(
  lookup: AlgorithmByName,
  args: Args,
  spec: { type: string; options: unknown } | undefined,
): { algorithm: LayoutAlgorithm<never>; options: unknown } {
  const own = spec ? lookup(spec.type) : undefined;
  if (spec && own) return { algorithm: own, options: spec.options };
  const algorithm = lookup(args.algorithm);
  if (!algorithm) throw new ArrangeFailure(`no layout algorithm named "${args.algorithm}"`);
  return { algorithm, options: args.options };
}

/** The runner for one arrange: a container's own layout spec if its algorithm is registered, else the request's. */
function runnerFor(lookup: AlgorithmByName, args: Args, byId: ReadonlyMap<string, Rec>): NestedRunner {
  return (container, input) => {
    const { algorithm, options } = chosenFor(lookup, args, specAt(args, container, byId));
    const result = layoutSync({ input, algorithm, options, seed: args.seed ?? 0 });
    if (!result.ok) throw new ArrangeFailure(result.error.message);
    return result.value.boxes as Boxes;
  };
}

/** The elements whose box differs from the layout's, with the new transform. */
function changes(byId: ReadonlyMap<string, Rec>, boxes: Boxes): Array<[string, NonNullable<Rec['transform']>]> {
  const out: Array<[string, NonNullable<Rec['transform']>]> = [];
  for (const [id, b] of Object.entries(boxes)) {
    const t = byId.get(id)?.transform;
    if (t && (t.x !== b.x || t.y !== b.y || t.w !== b.w || t.h !== b.h)) out.push([id, { ...t, x: b.x, y: b.y, w: b.w, h: b.h }]);
  }
  return out;
}

/** The records of the request's screen and the layout input for its scope, or why the request is refused. */
function prepare(store: Reader, args: Args): { ok: true; value: Prepared } | Refusal {
  const records = recordsOf(store, args.screenId);
  const byId = new Map(records.map((r) => [r.id, r] as const));
  if (!records.some((r) => r.type === 'element')) return refuse(`no elements on screen "${args.screenId}"`, ['screenId']);
  if (typeof args.scope === 'object' && byId.get(args.scope.containerId)?.type !== 'element')
    return refuse(`"${args.scope.containerId}" is not an element of the screen`, ['scope', 'containerId']);
  return { ok: true, value: { byId, input: inputFor(records, args) } };
}

/** The transaction body that writes the new `transform` of every element whose box differs; it returns `{ moved }`. */
function moveBoxes(byId: ReadonlyMap<string, Rec>, boxes: Boxes): (tx: Tx) => { moved: number } {
  const moves = changes(byId, boxes);
  return (tx) => {
    for (const [id, transform] of moves) tx.patch(id as StoreId, { transform });
    return { moved: moves.length };
  };
}

/**
 * The arrange command for the algorithms `lookup` finds: arguments `screenId`, `scope` (`screen`, `selection` with `selection` ids, or
 * `{ containerId }`), `algorithm` (default `layered`), `options`, `seed`. It writes the new `transform` of every element that moved in one
 * transaction and returns `{ moved }`.
 *
 * @public
 */
export function arrangeCommand(lookup: AlgorithmByName): AnyCommand {
  return defineCommand({
    id: ARRANGE_COMMAND_ID,
    title: { id: 'command.layout.arrange', defaultMessage: 'Arrange' },
    args: argsSchema,
    run: (ctx, args) => {
      const prepared = prepare(ctx.store, args);
      if (!prepared.ok) return prepared;
      const { byId, input } = prepared.value;
      let boxes: Boxes;
      try {
        boxes = layoutNested(input, runnerFor(lookup, args, byId));
      } catch (e) {
        if (e instanceof ArrangeFailure) return refuse(e.message, ['algorithm']);
        throw e;
      }
      return ctx.store.transact(ARRANGE_COMMAND_ID, moveBoxes(byId, boxes), ctx.options);
    },
  });
}

/**
 * Register the arrange command in a host's `commands` registry, finding algorithms in its `layouts` registry, as source `core`.
 *
 * @public
 */
export function registerArrangeCommand(
  commands: Registry<string, AnyCommand>,
  layouts: Registry<string, unknown>,
): ReturnType<Registry<string, AnyCommand>['register']> {
  const lookup: AlgorithmByName = (name) => layouts.get(name) as LayoutAlgorithm<never> | undefined;
  const arranged = commands.register(ARRANGE_COMMAND_ID, arrangeCommand(lookup), 'core');
  return arranged.ok ? commands.register(APPLY_BOXES_COMMAND_ID, applyBoxesCommand(), 'core') : arranged;
}

const boxSchema = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite().min(0), h: z.number().finite().min(0) });
const applySchema = z.object({ screenId: z.string().min(1), boxes: z.record(z.string(), boxSchema) });

/**
 * The id of the command that writes given boxes.
 *
 * @public
 */
export const APPLY_BOXES_COMMAND_ID = 'layout.applyBoxes';

/** The command `layout.applyBoxes`: write boxes computed elsewhere (a worker) as the `transform` of elements of a screen, as one transaction. */
function applyBoxesCommand(): AnyCommand {
  return defineCommand({
    id: APPLY_BOXES_COMMAND_ID,
    title: { id: 'command.layout.applyBoxes', defaultMessage: 'Apply a layout' },
    args: applySchema,
    run: (ctx, args) => {
      const byId = new Map(recordsOf(ctx.store, args.screenId).map((r) => [r.id, r] as const));
      for (const id of Object.keys(args.boxes)) {
        if (byId.get(id)?.type !== 'element') return refuse(`"${id}" is not an element of the screen`, ['boxes', id]);
      }
      return ctx.store.transact(APPLY_BOXES_COMMAND_ID, moveBoxes(byId, args.boxes), ctx.options);
    },
  });
}

/**
 * What the host's command runner gives back: whether the command ran, its value and why not.
 *
 * @public
 */
export type ArrangeCommandResult = {
  /** True when the command ran. */
  readonly ok: boolean;
  /** What a successful command returned (`{ moved }` for the arrange commands). */
  readonly value?: unknown;
  /** Why it did not run. */
  readonly error?: ArrangeCommandError;
};

/**
 * Why a command did not run.
 *
 * @public
 */
export type ArrangeCommandError = {
  /** A sentence naming the cause. */
  readonly message?: string;
};

/**
 * How many elements an arrange moved.
 *
 * @public
 */
export type ArrangeMoved = {
  /** The number of elements whose box changed. */
  readonly moved: number;
};

/**
 * Where an arrange runs: the host's store (read), the command runner, a layout host (workers) and the algorithms by name.
 *
 * @public
 */
export type AsyncArrangeDeps = {
  /** The document to read. */
  readonly store: Reader;
  /** Runs a command of the host by id (`layout.applyBoxes`, `layout.arrange`). */
  readonly execute: (id: string, args: unknown) => ArrangeCommandResult;
  /** Runs a flat layout in a worker. */
  readonly host: LayoutHost;
  /** Finds an algorithm by name. */
  readonly lookup: AlgorithmByName;
};

/**
 * The outcome of an async arrange: how many elements moved, or why not.
 *
 * @public
 */
export type AsyncArrangeResult = Result<ArrangeMoved>;

const invalid = <T>(message: string): Result<T> => err<LayoutError>({ code: 'LAYOUT_INPUT_INVALID', message });

/** The `{ moved }` a command result carries, or 0. */
function movedOf(r: { readonly ok: boolean; readonly value?: unknown }): number {
  const moved = (r.value as { moved?: unknown } | undefined)?.moved;
  return typeof moved === 'number' ? moved : 0;
}

/** The request's arguments, or the reason they are refused. */
function parseArgs(rawArgs: unknown): Result<Args> {
  const parsed = argsSchema.safeParse(rawArgs);
  return parsed.success ? ok(parsed.data) : invalid(`${ARRANGE_COMMAND_ID}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
}

/** The outcome of a command run on the caller as an async arrange result. */
function movedResult(done: ArrangeCommandResult, failure: string): AsyncArrangeResult {
  return done.ok ? ok({ moved: movedOf(done) }) : invalid(done.error?.message ?? failure);
}

/** Lay a flat plan out in a worker and write the boxes, unless the screen changed meanwhile. */
async function arrangeFlat(
  deps: AsyncArrangeDeps,
  job: { args: Args; prepared: Prepared; revision: number },
  signal?: AbortSignalWithEvents,
): Promise<AsyncArrangeResult> {
  const { args, prepared, revision } = job;
  const chosen = chosenName(deps.lookup, args, prepared.byId);
  if (!chosen.ok) return chosen;
  const laid = await deps.host.run(
    { scope: args.screenId, revision, algorithm: chosen.value.name, options: chosen.value.options, input: prepared.input, seed: args.seed ?? 0 },
    signal,
  );
  if (!laid.ok) return laid;
  const after = prepare(deps.store, args);
  if (!after.ok || JSON.stringify(after.value.input) !== JSON.stringify(prepared.input))
    return invalid('the screen changed while it was being arranged; nothing was written');
  return movedResult(deps.execute(APPLY_BOXES_COMMAND_ID, { screenId: args.screenId, boxes: laid.value.boxes }), 'the layout could not be applied');
}

/**
 * An arranger that lays a screen out off the caller's thread: it reads the snapshot on the caller, runs a flat layout (no nested containers) in
 * a worker through the host, and writes the boxes with `layout.applyBoxes` (one undo step). A plan with nested containers is laid out on the
 * caller, bottom-up, by `layout.arrange` itself. It resolves with an error and writes nothing when the request is refused, the layout fails, or
 * the screen was edited while the worker ran; a newer arrange of the same screen supersedes an older one (the older rejects with an
 * `AbortError`, from the host). The arguments are those of `layout.arrange`.
 *
 * @public
 */
export function createAsyncArranger(deps: AsyncArrangeDeps): (rawArgs: unknown, signal?: AbortSignalWithEvents) => Promise<AsyncArrangeResult> {
  let revision = 0;
  return async (rawArgs, signal) => {
    const args = parseArgs(rawArgs);
    if (!args.ok) return args;
    const prepared = prepare(deps.store, args.value);
    if (!prepared.ok) return invalid(prepared.error.message);
    if (prepared.value.input.nodes.some((n) => n.parentId !== undefined))
      return movedResult(deps.execute(ARRANGE_COMMAND_ID, rawArgs), 'the arrange was refused');
    revision += 1;
    return arrangeFlat(deps, { args: args.value, prepared: prepared.value, revision }, signal);
  };
}

/** The registered name and options the top level of a flat plan is laid out with. */
function chosenName(lookup: AlgorithmByName, args: Args, byId: ReadonlyMap<string, Rec>): Result<{ name: string; options: unknown }> {
  const spec = specAt(args, undefined, byId);
  if (spec && lookup(spec.type)) return ok({ name: spec.type, options: spec.options });
  if (!lookup(args.algorithm)) return invalid(`${ARRANGE_COMMAND_ID}: no layout algorithm named "${args.algorithm}"`);
  return ok({ name: args.algorithm, options: args.options });
}
