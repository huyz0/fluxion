// The `layout.arrange` command (FR-LAY-005, FR-LAY-001, 05-layout-and-routing.md §1): lay out a screen, a selection or a container with a registered
// algorithm and write the boxes back as ONE transaction (one undo step). Routes stay derived: only the `transform` of elements changes. The command
// lives here, beside the algorithms, so the editor, the CLI and MCP register the same one; it reads records structurally (this package has no
// schema dependency) and registers into a host's `commands` registry.
import { type AnyCommand, defineCommand, type Registry, type Store, type Tx, type TxFailure } from '@fluxion/core';
import { z } from 'zod';
import { layoutNested, type NestedRunner } from './nested.js';
import type { Boxes } from './passes.js';
import { layoutSync } from './pipeline.js';
import { buildSnapshot, type SnapshotRecord } from './snapshot.js';
import type { LayoutAlgorithm, LayoutInput, LayoutNode } from './types.js';

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
function refuse(message: string, at: ReadonlyArray<string | number>): { ok: false; error: TxFailure } {
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

/** A failure inside the runner, carried out of `layoutNested` to become a command result. */
class ArrangeFailure extends Error {}

/** The elements of the screen and every binding, as the snapshot builder reads them. */
function recordsOf(store: Store, screenId: string): Rec[] {
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
      const records = recordsOf(ctx.store, args.screenId);
      const byId = new Map(records.map((r) => [r.id, r] as const));
      if (!records.some((r) => r.type === 'element')) return refuse(`no elements on screen "${args.screenId}"`, ['screenId']);
      if (typeof args.scope === 'object' && !byId.has(args.scope.containerId))
        return refuse(`"${args.scope.containerId}" is not an element of the screen`, ['scope', 'containerId']);
      let boxes: Boxes;
      try {
        const input = inputFor(records, args);
        boxes = layoutNested(input, runnerFor(lookup, args, byId));
      } catch (e) {
        if (e instanceof ArrangeFailure) return refuse(e.message, ['algorithm']);
        throw e;
      }
      const moves = changes(byId, boxes);
      return ctx.store.transact(
        ARRANGE_COMMAND_ID,
        (tx) => {
          for (const [id, transform] of moves) tx.patch(id as StoreId, { transform });
          return { moved: moves.length };
        },
        ctx.options,
      );
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
  return commands.register(ARRANGE_COMMAND_ID, arrangeCommand(lookup), 'core');
}
