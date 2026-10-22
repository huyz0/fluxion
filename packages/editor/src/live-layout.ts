// Live layout frames (FR-LAY-010, ADR-0046): a group or frame whose `layout.live` is true is laid out again by the editor after an edit that adds, removes
// or resizes one of its children. The re-layout is a commit of its own with `amend: true`, so it joins the edit's undo entry (one Ctrl+Z takes back both),
// and it runs in a microtask after the edit's commit, never inside the store's listener loop, so every subscriber receives the edit's diff first.
// Undo, redo, remote and the reactor's own commits are ignored. Pure over a store and an executor: no DOM, no React.
import type { Diff, Store, TxMeta } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import type { Execute } from './pointer.js';

/** The store as the reactor reads it. */
type LiveStore = Pick<Store, 'subscribe' | 'get'>;

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
};

/**
 * What the reactor needs.
 *
 * @public
 */
export type LiveLayoutDeps = {
  /** The document: read, and notified of every commit. */
  readonly store: Pick<Store, 'subscribe' | 'get'>;
  /** Re-lay a frame out; the default runs `layout.arrange` on the frame's own children with `execute`. */
  readonly run?: LiveLayoutRun;
  /** Runs a command, for the default `run`. */
  readonly execute?: Execute;
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
  readonly layout?: { readonly live?: unknown };
};

/** The kinds of element that hold others and may carry a layout of their own. */
const CONTAINER_KINDS: ReadonlySet<string> = new Set(['group', 'frame']);

const sizeOf = (r: Rec): string => `${r.transform?.w}x${r.transform?.h}`;

/** The container ids a commit touches: the parent of every child added, removed, resized or moved to another parent. */
function touchedParents(diff: Diff): Set<RecordId> {
  const parents = new Set<RecordId>();
  const add = (parent: RecordId | undefined): void => void (parent !== undefined && parents.add(parent));
  for (const { before, after } of diff.puts.values()) {
    const [was, now] = [before as Rec | undefined, after as unknown as Rec];
    if (now.type !== 'element') continue;
    if (was === undefined || sizeOf(was) !== sizeOf(now) || was.parentId !== now.parentId) add(now.parentId);
    if (was !== undefined && was.parentId !== now.parentId) add(was.parentId);
  }
  for (const gone of diff.deletes.values()) if ((gone as unknown as Rec).type === 'element') add((gone as unknown as Rec).parentId);
  return parents;
}

/** How deep a record sits: the number of containers above it. */
function depthOf(store: LiveStore, id: RecordId): number {
  let depth = 0;
  for (let at = (store.get(id) as Rec | undefined)?.parentId; at !== undefined && depth < 1000; at = (store.get(at) as Rec | undefined)?.parentId) depth += 1;
  return depth;
}

/** The live frame `id`, if it is one. */
function frameOf(store: LiveStore, id: RecordId): LiveFrame | undefined {
  const r = store.get(id) as Rec | undefined;
  return r?.type === 'element' && CONTAINER_KINDS.has(r.kind ?? '') && r.layout?.live === true && r.screenId !== undefined
    ? { containerId: id, screenId: r.screenId }
    : undefined;
}

/** The live frames a commit touches; each is counted in `epochs`, so a layout still pending for it is stale. */
function touchFrames(store: LiveStore, diff: Diff, epochs: Map<RecordId, number>): RecordId[] {
  const frames = [...touchedParents(diff)].filter((parent) => frameOf(store, parent) !== undefined);
  for (const frame of frames) epochs.set(frame, (epochs.get(frame) ?? 0) + 1);
  return frames;
}

/** Whether a commit may wake the reactor: not undo, redo, remote, an amend or the reactor's own write. */
const reacts = (meta: TxMeta, writing: boolean): boolean => !writing && meta.amend !== true && !['undo', 'redo', 'remote'].includes(meta.origin);

/** The default re-layout: the `layout.arrange` command on the frame's children, which uses the frame's own layout spec. */
function arrangeRun(execute: Execute): LiveLayoutRun {
  return (frame) => ({
    apply: (amend) =>
      void execute(
        'layout.arrange',
        { screenId: frame.screenId, scope: { containerId: frame.containerId } },
        { origin: 'system', ...(amend ? { amend: true } : {}) },
      ),
  });
}

/**
 * Start the reactor. It returns the function that stops it.
 *
 * @public
 */
export function startLiveLayout(deps: LiveLayoutDeps): () => void {
  const { store } = deps;
  const run = deps.run ?? (deps.execute ? arrangeRun(deps.execute) : undefined);
  if (run === undefined) throw new Error('startLiveLayout needs a run or an execute');
  const schedule = deps.schedule ?? ((task: () => void) => queueMicrotask(task));
  const dirty = new Set<RecordId>();
  // the number of commits that are not the reactor's own: a re-layout that resolves later amends only if none came in between
  let foreign = 0;
  // how often each frame was dirtied: a re-layout that resolves after its frame was dirtied again is stale
  const epochs = new Map<RecordId, number>();
  let scheduled = false;
  let stopped = false;
  // true while the reactor's own plan is written: that commit, amended or not, must not wake the reactor
  let writing = false;
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
    const frames = [...dirty].map((id) => frameOf(store, id)).filter((f): f is LiveFrame => f !== undefined);
    dirty.clear();
    // innermost first, so a container sees its children already laid out
    frames.sort((a, b) => depthOf(store, b.containerId) - depthOf(store, a.containerId));
    for (const frame of frames) lay(frame);
  };

  const stop = store.subscribe((diff: Diff, meta: TxMeta) => {
    if (writing) return;
    foreign += 1;
    // an undo, redo or remote commit does not re-lay out, but it does make a layout still pending for its frames stale
    const touched = touchFrames(store, diff, epochs);
    if (!reacts(meta, writing)) return;
    for (const frame of touched) dirty.add(frame);
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
