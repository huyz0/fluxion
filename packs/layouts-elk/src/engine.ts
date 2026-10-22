// ELK run synchronously (ADR-0045). elkjs's own API answers through a promise because it posts to a worker; the layout registry's algorithms are
// synchronous, so the pack calls ELK's dispatcher directly and reads its answer in the same call. Loaded in a web worker, elkjs's worker build
// installs its dispatcher as `self.onmessage` instead of exporting it: the loader takes the dispatcher from there and gives the scope its handler back.

/**
 * An ELK graph node or the root, as elkjs reads and writes it.
 *
 * @public
 */
export type ElkNode = {
  /** The node's id (the record id; `root` for the graph). */
  readonly id: string;
  /** Width, px. */
  width?: number;
  /** Height, px. */
  height?: number;
  /** Left edge in its parent, px; written by ELK. */
  x?: number;
  /** Top edge in its parent, px; written by ELK. */
  y?: number;
  /** ELK options by their full id, such as `elk.algorithm`. */
  readonly layoutOptions?: { readonly [key: string]: string };
  /** The nodes inside. */
  readonly children?: ElkNode[];
  /** The edges between the nodes inside. */
  readonly edges?: readonly ElkEdge[];
};

/**
 * An ELK edge.
 *
 * @public
 */
export type ElkEdge = {
  /** The connector's id. */
  readonly id: string;
  /** The node it starts at. */
  readonly sources: readonly string[];
  /** The node it ends at. */
  readonly targets: readonly string[];
};

/**
 * Lays out `graph` in place and returns it; throws what ELK threw.
 *
 * @public
 */
export type ElkEngine = (graph: ElkNode) => ElkNode;

type Message = { readonly id?: unknown; readonly data?: unknown; readonly error?: unknown };
type Dispatch = (event: { readonly data: unknown }) => void;

/** elkjs's worker module where it can export: its `Worker` (a fake worker that holds the dispatcher). */
type FakeWorkerModule = {
  readonly Worker?: new () => { dispatcher: { saveDispatch: Dispatch }; onmessage?: ((event: { data: Message }) => void) | undefined };
};

/** The worker scope elkjs takes over inside a web worker. */
export type ScopeLike = { onmessage: unknown; postMessage: (message: never) => void };

/** The ELK algorithms the pack uses; elkjs knows an algorithm only once it is registered (its own API registers them when it starts). */
const ALGORITHMS = ['layered', 'stress', 'rectpacking'];

/** How a call reads the dispatcher's answer: `hook(answer)` routes answers to `answer` and gives back the function that undoes it. */
type Hook = (answer: (m: Message) => void) => () => void;

/** One synchronous command to a dispatcher; its answer, or what ELK threw. */
function command(dispatch: Dispatch, data: object, hook: Hook): unknown {
  let got: Message | undefined;
  const release = hook((m) => {
    got = m;
  });
  try {
    dispatch({ data: { id: 0, ...data } });
  } finally {
    release();
  }
  if (got === undefined) throw new Error('ELK gave no answer');
  if (got.error !== undefined) throw got.error instanceof Error ? got.error : new Error(String((got.error as { message?: unknown })?.message ?? got.error));
  return got.data;
}

/** The engine over a dispatcher, its algorithms registered first. */
function engineOver(dispatch: Dispatch, hook: Hook): ElkEngine {
  command(dispatch, { cmd: 'register', algorithms: ALGORITHMS }, hook);
  return (graph) => command(dispatch, { cmd: 'layout', graph }, hook) as ElkNode;
}

/** The engine over elkjs's exported fake worker. */
export function engineOfModule(mod: FakeWorkerModule): ElkEngine | undefined {
  if (typeof mod.Worker !== 'function') return undefined;
  const worker = new mod.Worker();
  return engineOver(worker.dispatcher.saveDispatch, (answer) => {
    worker.onmessage = (event) => answer(event.data);
    return () => {
      worker.onmessage = undefined;
    };
  });
}

/** The engine over the dispatcher elkjs installed as `scope.onmessage`, answering through `scope.postMessage` (swapped only for the call). */
export function engineOfScope(scope: ScopeLike, dispatch: Dispatch): ElkEngine {
  return engineOver(dispatch, (answer) => {
    const post = scope.postMessage;
    scope.postMessage = answer as ScopeLike['postMessage'];
    return () => {
      scope.postMessage = post;
    };
  });
}

/** The worker scope of this realm when it is a web worker's (no document), else undefined. */
function workerScope(): ScopeLike | undefined {
  const g = globalThis as { document?: unknown; self?: ScopeLike };
  return g.document === undefined && g.self !== undefined && 'onmessage' in g.self ? g.self : undefined;
}

/** Load elkjs (its own chunk, fetched only now) and give its synchronous engine. */
export function loadElkEngine(): Promise<ElkEngine> {
  // once per realm: in a worker elkjs hands its dispatcher over only when its module is first evaluated, so a second load must reuse the first
  loading ??= load().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

let loading: Promise<ElkEngine> | undefined;

async function load(): Promise<ElkEngine> {
  const scope = workerScope();
  const before = scope?.onmessage;
  const mod = (await import('elkjs/lib/elk-worker.min.js')) as FakeWorkerModule & { readonly default?: FakeWorkerModule };
  return engineOfLoad(mod, scope, before);
}

/**
 * The engine of a loaded elkjs: its exported fake worker, else the dispatcher it installed on `scope` (which had `before` as its handler).
 *
 * @public
 */
export function engineOfLoad(mod: FakeWorkerModule & { readonly default?: FakeWorkerModule }, scope: ScopeLike | undefined, before: unknown): ElkEngine {
  const exported = engineOfModule(mod) ?? (mod.default ? engineOfModule(mod.default) : undefined);
  if (exported) return exported;
  if (scope === undefined || typeof scope.onmessage !== 'function' || scope.onmessage === before) throw new Error('elkjs did not load');
  const dispatch = scope.onmessage as Dispatch;
  scope.onmessage = before;
  return engineOfScope(scope, dispatch);
}
