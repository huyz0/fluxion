// The async arranger (FR-LAY-007, FR-LAY-005, ADR-0033 amendment): lay a screen out off the caller's thread and write the boxes back, in slices if the host
// asks, as one undo step. The snapshot and the writes are `layout.arrange`'s own (arrange.ts); the layout itself runs in a worker through the layout host.

import {
  type AlgorithmByName,
  APPLY_BOXES_COMMAND_ID,
  ARRANGE_COMMAND_ID,
  type Args,
  invalid,
  type Prepared,
  parseArgs,
  prepare,
  type Reader,
  type Rec,
  type StoreId,
  specAt,
} from './arrange.js';
import { err, type LayoutError, ok, type Result } from './errors.js';
import type { Boxes } from './passes.js';
import type { AbortSignalWithEvents, LayoutHost } from './worker/host.js';

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
  /** Runs a command of the host by id (`layout.applyBoxes`, `layout.arrange`); `options.mergeKey` joins consecutive writes into one undo step. */
  readonly execute: (id: string, args: unknown, options?: ArrangeWriteOptions) => ArrangeCommandResult;
  /** Runs a flat layout in a worker. */
  readonly host: LayoutHost;
  /** Finds an algorithm by name. */
  readonly lookup: AlgorithmByName;
  /** How many elements one write moves (default: all at once). With `pause`, a larger result is written in slices of this size, so no write holds the thread long. */
  readonly slice?: number;
  /** Gives the thread back between slices (a timer or a frame); this package has no timers of its own. */
  readonly pause?: () => Promise<void>;
};

/**
 * Options of a write the arranger asks the host's `execute` for.
 *
 * @public
 */
export type ArrangeWriteOptions = {
  /** Consecutive writes with the same key form one undo step. */
  readonly mergeKey?: string;
};

/**
 * The outcome of an async arrange: how many elements moved, or why not.
 *
 * @public
 */
export type AsyncArrangeResult = Result<ArrangeMoved>;

/** The `{ moved }` a command result carries, or 0. */
function movedOf(r: { readonly ok: boolean; readonly value?: unknown }): number {
  const moved = (r.value as { moved?: unknown } | undefined)?.moved;
  return typeof moved === 'number' ? moved : 0;
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
  // a commit while the worker runs (a person's edit, an undo) makes the snapshot stale: the result is dropped, nothing is written
  let changed = false;
  const stop = deps.store.subscribe(() => {
    changed = true;
  });
  const laid = await deps.host
    .run({ scope: args.screenId, revision, algorithm: chosen.value.name, options: chosen.value.options, input: prepared.input, seed: args.seed ?? 0 }, signal)
    .finally(stop);
  if (!laid.ok) return laid;
  if (changed) return invalid('the document changed while the screen was being arranged; nothing was written');
  return writeInSlices(deps, {
    screenId: args.screenId,
    boxes: laid.value.boxes,
    before: prepared.byId,
    key: `${ARRANGE_COMMAND_ID}:${args.screenId}:${revision}`,
  });
}

/** A write of boxes in slices: the screen, the boxes, the records as they were read, and the merge key of the undo step. */
type SlicedWrite = {
  readonly screenId: string;
  readonly boxes: Boxes;
  readonly before: ReadonlyMap<string, Rec>;
  readonly key: string;
};

/**
 * Write `job.boxes` with `layout.applyBoxes`: at once, or (with `slice` and `pause`) in slices with the thread given back between them, all of one
 * undo step through the merge key. A slice whose elements were changed meanwhile (by a person) ends the write: what was moved stays, as one undo step.
 */
async function writeInSlices(deps: AsyncArrangeDeps, job: SlicedWrite): Promise<AsyncArrangeResult> {
  const entries = Object.entries(job.boxes);
  const size = deps.pause !== undefined && deps.slice !== undefined && deps.slice > 0 ? Math.floor(deps.slice) : entries.length;
  if (size >= entries.length)
    return movedResult(deps.execute(APPLY_BOXES_COMMAND_ID, { screenId: job.screenId, boxes: job.boxes }), 'the layout could not be applied');
  let moved = 0;
  for (let at = 0; at < entries.length; at += size) {
    const part = entries.slice(at, at + size);
    if (at > 0) {
      await deps.pause?.();
      if (part.some(([id]) => JSON.stringify(deps.store.get(id as StoreId)?.transform) !== JSON.stringify(job.before.get(id)?.transform)))
        return invalid(`the screen changed while it was being arranged; ${moved} of ${entries.length} elements were moved`);
    }
    const done = deps.execute(APPLY_BOXES_COMMAND_ID, { screenId: job.screenId, boxes: Object.fromEntries(part) }, { mergeKey: job.key });
    const result = movedResult(done, 'the layout could not be applied');
    if (!result.ok) return result;
    moved += result.value.moved;
  }
  return ok({ moved });
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
    // the caller's notice is drawn before the snapshot is read, so the two are not one long task
    if (deps.pause !== undefined) await deps.pause();
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
