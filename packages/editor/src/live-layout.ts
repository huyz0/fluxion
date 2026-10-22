// Live layout frames (FR-LAY-010, ADR-0046): a group or frame whose `layout.live` is true is laid out again by the editor after an edit that adds, removes
// or resizes one of its children. The re-layout is a commit of its own with `amend: true`, so it joins the edit's undo entry (one Ctrl+Z takes back both),
// and it runs in a microtask after the edit's commit, never inside the store's listener loop, so every subscriber receives the edit's diff first.
// Undo, redo, remote and the reactor's own commits are ignored. Pure over a store and an executor: no DOM, no React.
import type { Diff, Store, TxMeta } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import type { ArrangePort } from './layout-arrange.js';
import type { Execute } from './pointer.js';

/** The store as the reactor reads it. */
type LiveStore = Pick<Store, 'subscribe' | 'get' | 'members'>;

/**
 * How a frame is laid out again. It returns at once for a layout that is computed in place (the commit is then an amend) or a promise for one that
 * resolves later; `apply` writes the result, with `amend` true only while nothing else has been committed since the layout began.
 *
 * @public
 */
export type LiveLayoutRun = (frame: LiveFrame) => LivePlan | Promise<LivePlan>;

/**
 * A computed re-layout waiting to be written.
 *
 * @public
 */
export type LivePlan = {
  /** Write the layout; `amend` joins the open undo entry, else the commit is an entry of its own. */
  readonly apply: (amend: boolean) => void;
};

/**
 * A live frame: its id and the screen it is on.
 *
 * @public
 */
export type LiveFrame = {
  /** The group or frame. */
  readonly containerId: RecordId;
  /** The screen the frame is on. */
  readonly screenId: RecordId;
  /** The children the commits since the last layout added, removed or resized: the rest keep their places (FR-LAY-006). */
  readonly changed: readonly RecordId[];
};

/**
 * What the reactor needs.
 *
 * @public
 */
export type LiveLayoutDeps = {
  /** The document: read, and notified of every commit. */
  readonly store: Pick<Store, 'subscribe' | 'get' | 'members'>;
  /** Re-lay a frame out; the default runs `layout.arrange` on the frame's own children with `execute`. */
  readonly run?: LiveLayoutRun;
  /** Runs a command, for the default `run`. */
  readonly execute?: Execute;
  /** Lays a frame out in a layout worker (the studio's); the default `run` sends it the frames that are large or whose layout only runs there. */
  readonly arrange?: ArrangePort;
  /** Defers a task to after the commit that asked for it (default: `queueMicrotask`). */
  readonly schedule?: (task: () => void) => void;
};

type Rec = {
  readonly id: RecordId;
  readonly type?: string;
  readonly kind?: string;
  readonly screenId?: RecordId;
  readonly parentId?: RecordId;
  readonly transform?: { readonly w?: number; readonly h?: number };
  readonly layout?: { readonly live?: unknown; readonly type?: unknown };
};

/** The kinds of element that hold others and may carry a layout of their own. */
const CONTAINER_KINDS: ReadonlySet<string> = new Set(['group', 'frame']);

const sizeOf = (r: Rec): string => `${r.transform?.w}x${r.transform?.h}`;

/** The containers a commit touches, each with the children that were added, removed, resized or moved to or from it. */
function touchedParents(diff: Diff): Map<RecordId, Set<RecordId>> {
  const parents = new Map<RecordId, Set<RecordId>>();
  const add = (parent: RecordId | undefined, child: RecordId): void => {
    if (parent === undefined) return;
    const children = parents.get(parent);
    if (children) children.add(child);
    else parents.set(parent, new Set([child]));
  };
  for (const { before, after } of diff.puts.values()) {
    const [was, now] = [before as Rec | undefined, after as unknown as Rec];
    if (now.type !== 'element') continue;
    if (was === undefined || sizeOf(was) !== sizeOf(now) || was.parentId !== now.parentId) add(now.parentId, now.id);
    if (was !== undefined && was.parentId !== now.parentId) add(was.parentId, now.id);
  }
  for (const gone of diff.deletes.values())
    if ((gone as unknown as Rec).type === 'element') add((gone as unknown as Rec).parentId, (gone as unknown as Rec).id);
  return parents;
}

/** How deep a record sits: the number of containers above it. */
function depthOf(store: LiveStore, id: RecordId): number {
  let depth = 0;
  for (let at = (store.get(id) as Rec | undefined)?.parentId; at !== undefined && depth < 1000; at = (store.get(at) as Rec | undefined)?.parentId) depth += 1;
  return depth;
}

/** The live frame `id`, if it is one, with the children that changed. */
function frameOf(store: LiveStore, id: RecordId, changed: ReadonlySet<RecordId> = new Set()): LiveFrame | undefined {
  const r = store.get(id) as Rec | undefined;
  return r?.type === 'element' && CONTAINER_KINDS.has(r.kind ?? '') && r.layout?.live === true && r.screenId !== undefined
    ? { containerId: id, screenId: r.screenId, changed: [...changed] }
    : undefined;
}

/** The live frames a commit touches and what changed in each; each is counted in `epochs`, so a layout still pending for it is stale. */
function touchFrames(store: LiveStore, diff: Diff, epochs: Map<RecordId, number>): Map<RecordId, Set<RecordId>> {
  const frames = new Map([...touchedParents(diff)].filter(([parent]) => frameOf(store, parent) !== undefined));
  for (const frame of frames.keys()) epochs.set(frame, (epochs.get(frame) ?? 0) + 1);
  return frames;
}

/** Whether a commit may wake the reactor: not undo, redo, remote, an amend or the reactor's own write. */
const reacts = (meta: TxMeta, writing: boolean): boolean => !writing && meta.amend !== true && !['undo', 'redo', 'remote'].includes(meta.origin);

/** A force layout of more children than this runs in the layout worker, as does every `layouts-elk:*` layout (ADR-0046). */
const WORKER_ABOVE = 200;

/** Whether the frame's own layout is laid out in the worker: an ELK layout, or a force layout of many children. */
function inWorker(store: LiveStore, frame: LiveFrame): boolean {
  const type = (store.get(frame.containerId) as Rec | undefined)?.layout?.type;
  if (typeof type !== 'string') return false;
  return type.startsWith('layouts-elk:') || (type === 'force' && store.members('byParent', frame.containerId).length > WORKER_ABOVE);
}

/** The arguments of the arrange of a live frame: its children, and which of them changed (so the others keep their places). */
const arrangeArgs = (frame: LiveFrame): { screenId: RecordId; scope: { containerId: RecordId }; changed: readonly RecordId[] } => ({
  screenId: frame.screenId,
  scope: { containerId: frame.containerId },
  changed: frame.changed,
});

/** The default re-layout on the page's thread: the `layout.arrange` command on the frame's children, which uses the frame's own layout spec. */
function arrangeRun(execute: Execute | undefined): LiveLayoutRun {
  return (frame) => ({
    apply: (amend) => void execute?.('layout.arrange', arrangeArgs(frame), { origin: 'system', ...(amend ? { amend: true } : {}) }),
  });
}

/** The reactor's state the worker path reads: the frames' epochs, the count of commits that opened an undo entry, and whether it stopped. */
type ReactorState = { readonly epochs: ReadonlyMap<RecordId, number>; readonly foreign: () => number; readonly stopped: () => boolean };

/**
 * The worker path (FR-LAY-007): frames go to `arrange` one at a time, so the reactor's own jobs never supersede each other. Each joins the edit's
 * undo entry only if no entry was opened since the edit; a job that is dropped (the document changed while it ran, or a newer arrange of the screen
 * took its place) is sent once more as an entry of its own, unless its frame was dirtied again (a newer layout is on its way).
 */
function workerPath(arrange: ArrangePort, state: ReactorState): (frame: LiveFrame) => void {
  let queue: Promise<unknown> = Promise.resolve();
  const send = (frame: LiveFrame, epoch: number | undefined, began: number | undefined): void => {
    const current = () => !state.stopped() && state.epochs.get(frame.containerId) === epoch;
    queue = queue.then(async () => {
      if (!current()) return;
      const amend = began === state.foreign() ? ({ amend: true } as const) : {};
      const done = await arrange({ ...arrangeArgs(frame), ...amend }).catch(() => ({ ok: false }));
      if (!done.ok && began !== undefined && current()) send(frame, epoch, undefined);
    });
  };
  return (frame) => send(frame, state.epochs.get(frame.containerId), state.foreign());
}

/** The re-layout `deps` ask for: their own `run`, else `layout.arrange` through `execute` (frames for the worker go to `arrange`). */
function runOf(deps: LiveLayoutDeps): LiveLayoutRun {
  if (deps.run === undefined && deps.execute === undefined && deps.arrange === undefined)
    throw new Error('startLiveLayout needs a run, an execute or an arrange');
  return deps.run ?? arrangeRun(deps.execute);
}

/**
 * Start the reactor. It returns the function that stops it.
 *
 * @public
 */
export function startLiveLayout(deps: LiveLayoutDeps): () => void {
  const { store } = deps;
  const run = runOf(deps);
  const schedule = deps.schedule ?? ((task: () => void) => queueMicrotask(task));
  // the live frames to lay out again, with the children that changed since their last layout
  const dirty = new Map<RecordId, Set<RecordId>>();
  // the number of commits that opened an undo entry and are not the reactor's own: a re-layout that resolves later amends only if none came in between
  // (an amend joins the last entry, so the edit's entry is still the one to join)
  let foreign = 0;
  // how often each frame was dirtied: a re-layout that resolves after its frame was dirtied again is stale
  const epochs = new Map<RecordId, number>();
  let scheduled = false;
  let stopped = false;
  // true while the reactor's own plan is written: that commit, amended or not, must not wake the reactor
  let writing = false;
  const worker =
    deps.run === undefined && deps.arrange !== undefined ? workerPath(deps.arrange, { epochs, foreign: () => foreign, stopped: () => stopped }) : undefined;
  const write = (plan: LivePlan, amend: boolean): void => {
    writing = true;
    try {
      plan.apply(amend);
    } finally {
      writing = false;
    }
  };

  /** Re-lay one frame out; a layout that resolves later amends only when nothing else was committed meanwhile, else it is its own entry, or dropped if the frame was dirtied again. */
  const lay = (frame: LiveFrame): void => {
    if (worker !== undefined && inWorker(store, frame)) {
      worker(frame);
      return;
    }
    const began = foreign;
    const epoch = epochs.get(frame.containerId);
    const planned = run(frame);
    if (!(planned instanceof Promise)) {
      write(planned, true);
      return;
    }
    void planned.then((plan) => {
      if (stopped || epochs.get(frame.containerId) !== epoch) return;
      write(plan, foreign === began);
    });
  };

  const flush = (): void => {
    scheduled = false;
    if (stopped) return;
    const frames = [...dirty].map(([id, changed]) => frameOf(store, id, changed)).filter((f): f is LiveFrame => f !== undefined);
    dirty.clear();
    // innermost first, so a container sees its children already laid out
    frames.sort((a, b) => depthOf(store, b.containerId) - depthOf(store, a.containerId));
    for (const frame of frames) lay(frame);
  };

  const stop = store.subscribe((diff: Diff, meta: TxMeta) => {
    if (writing) return;
    if (meta.amend !== true) foreign += 1;
    // an undo, redo or remote commit does not re-lay out, but it does make a layout still pending for its frames stale
    const touched = touchFrames(store, diff, epochs);
    if (!reacts(meta, writing)) return;
    for (const [frame, changed] of touched) dirty.set(frame, new Set([...(dirty.get(frame) ?? []), ...changed]));
    if (dirty.size > 0 && !scheduled) {
      scheduled = true;
      schedule(flush);
    }
  });
  return () => {
    stopped = true;
    stop();
  };
}
