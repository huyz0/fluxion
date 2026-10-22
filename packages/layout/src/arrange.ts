// The `layout.arrange` command (FR-LAY-005, FR-LAY-001, 05-layout-and-routing.md §1): lay out a screen, a selection or a container with a registered
// algorithm and write the boxes back as ONE transaction (one undo step). Routes stay derived: only the `transform` of elements changes. The command
// lives here, beside the algorithms, so the editor, the CLI and MCP register the same one; it reads records structurally (this package has no
// schema dependency) and registers into a host's `commands` registry.
import { type AnyCommand, defineCommand, type Registry, type Store, type Tx, type TxFailure } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { z } from 'zod';
import { err, type LayoutError, ok, type Result } from './errors.js';
import { layoutNested, type NestedRunner } from './nested.js';
import type { Boxes } from './passes.js';
import { layoutSync } from './pipeline.js';
import { buildSnapshot, type SnapshotRecord } from './snapshot.js';
import type { LayoutAlgorithm, LayoutInput, LayoutNode } from './types.js';

/** A record id as the store takes it (the schema's branded string; this package reads ids as plain strings). */
export type StoreId = Parameters<Tx['patch']>[0];

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

/** The arguments of `layout.arrange` once parsed (defaults applied). */
export type Args = {
  readonly screenId: string;
  readonly scope: 'screen' | 'selection' | { readonly containerId: string };
  readonly selection?: string[] | undefined;
  readonly algorithm: string;
  readonly options?: unknown;
  readonly seed?: number | undefined;
  /** Incremental mode (FR-LAY-006): the children added, removed or resized by the edit this layout follows; every other box is kept where it is as far as the layout can. */
  readonly changed?: string[] | undefined;
  /** The async arranger's writes join the last undo entry (they follow an edit); `layout.arrange` takes its options from its caller and ignores it. */
  readonly amend?: boolean | undefined;
};

const scopeSchema = z.union([z.literal('screen'), z.literal('selection'), z.object({ containerId: z.string().min(1) })]);
const argsSchema: z.ZodType<Args> = z.object({
  screenId: z.string().min(1),
  scope: scopeSchema.default('screen'),
  selection: z.array(z.string().min(1)).optional(),
  algorithm: z.string().min(1).default('layered'),
  options: z.unknown().optional(),
  seed: z.number().finite().optional(),
  changed: z.array(z.string().min(1)).optional(),
  amend: z.boolean().optional(),
});

export type Rec = SnapshotRecord & {
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
export type Reader = Pick<Store, 'members' | 'get' | 'subscribe'>;
/** A refusal as a command result. */
type Refusal = { ok: false; error: TxFailure };
/** The records of one screen and the layout input read from them (for the scope of the request). */
export type Prepared = {
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

/** The area of a screen: its size (1920 x 1080 when it has none), or the viewport of an infinite screen. */
function screenFrame(screen: unknown): Box {
  const s = (screen ?? {}) as { kind?: unknown; size?: { w?: unknown; h?: unknown }; viewport?: Box };
  if (s.kind === 'infinite' && s.viewport) return { x: s.viewport.x, y: s.viewport.y, w: s.viewport.w, h: s.viewport.h };
  const [w, h] = [s.size?.w, s.size?.h];
  return { x: 0, y: 0, w: typeof w === 'number' && w > 0 ? w : 1920, h: typeof h === 'number' && h > 0 ? h : 1080 };
}

/** The bounds of `boxes`, grown to reach the screen's far edges (so a layout wraps at the screen, not at the selection). */
function selectionFrame(boxes: readonly Box[], screen: Box): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w), screen.x + screen.w);
  const bottom = Math.max(...boxes.map((b) => b.y + b.h), screen.y + screen.h);
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * The layout input for the scope, in the screen's own area. A selection is laid out among the rest of the screen, which stays where it is (it is
 * pinned), starting where the selection is. A container's children use the container's box.
 */
function inputFor(records: readonly Rec[], args: Args, screen: Box): LayoutInput {
  const scope = args.scope;
  if (scope !== 'selection') return buildSnapshot(records, { screenId: args.screenId, scope, ...(scope === 'screen' ? { frame: screen } : {}) });
  const whole = buildSnapshot(records, { screenId: args.screenId, scope: 'screen', frame: screen });
  const free = withDescendants(whole.nodes, new Set(args.selection ?? []));
  const freeBoxes = whole.nodes.filter((n) => free.has(n.id)).map((n) => n.box);
  const frame = freeBoxes.length > 0 ? selectionFrame(freeBoxes, screen) : screen;
  return { ...whole, frame, scope, nodes: whole.nodes.map((n) => (free.has(n.id) ? n : { ...n, pinned: true })) };
}

/** The `{ type, options }` layout spec a container record carries, if it has a usable one. */
function specOf(record: Rec | undefined): { type: string; options: unknown } | undefined {
  const spec = record?.layout as { type?: unknown; options?: unknown } | undefined;
  return typeof spec?.type === 'string' ? { type: spec.type, options: spec.options } : undefined;
}

/** The layout spec that applies at a level: that of the container (the top level of a container scope is that container's own children), if any. */
export function specAt(args: Args, container: string | undefined, byId: ReadonlyMap<string, Rec>): { type: string; options: unknown } | undefined {
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
export function prepare(store: Reader, args: Args): { ok: true; value: Prepared } | Refusal {
  const records = recordsOf(store, args.screenId);
  const byId = new Map(records.map((r) => [r.id, r] as const));
  if (!records.some((r) => r.type === 'element')) return refuse(`no elements on screen "${args.screenId}"`, ['screenId']);
  if (typeof args.scope === 'object' && byId.get(args.scope.containerId)?.type !== 'element')
    return refuse(`"${args.scope.containerId}" is not an element of the screen`, ['scope', 'containerId']);
  const input = inputFor(records, args, screenFrame(store.get(args.screenId as StoreId)));
  return { ok: true, value: { byId, input: args.changed === undefined ? input : incremental(input, args.changed) } };
}

/** `input` as an incremental run: every node's current box is `previous`, so only the `changed` nodes are free to move (ADR-0046). */
function incremental(input: LayoutInput, changed: readonly string[]): LayoutInput {
  return { ...input, previous: Object.fromEntries(input.nodes.map((n) => [n.id, n.box])), changed };
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

export const invalid = <T>(message: string): Result<T> => err<LayoutError>({ code: 'LAYOUT_INPUT_INVALID', message });

/** The request's arguments, or the reason they are refused. */
export function parseArgs(rawArgs: unknown): Result<Args> {
  const parsed = argsSchema.safeParse(rawArgs);
  return parsed.success ? ok(parsed.data) : invalid(`${ARRANGE_COMMAND_ID}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
}
