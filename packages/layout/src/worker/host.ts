// The host side (ADR-0033): runs layout jobs in a worker without blocking the caller, cancels them, and keeps only the newest revision of a scope.
// A worker busy in a synchronous layout cannot read a message, so cancelling ends the worker (`terminate`) and the next job starts a fresh one.
// The worker itself comes from the consumer (`spawn`), which knows how to create one in its environment (a browser Worker, `worker_threads`).
import { err, ok, type Result } from '../errors.js';
import type { LaidOut } from '../types.js';
import type { LayoutJobMessage, LayoutReplyMessage } from './protocol.js';

/**
 * The part of a `Worker` the host uses.
 *
 * @public
 */
export type WorkerLike = {
  /** Receives the worker's messages. */
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  /** Called when the worker fails (an uncaught error). */
  onerror: ((event: unknown) => void) | null;
  /** Called when a message from the worker cannot be read (optional: not every worker has it). */
  onmessageerror?: ((event: unknown) => void) | null;
  /** Sends a message to the worker. */
  postMessage(message: unknown): void;
  /** Ends the worker at once, whatever it is doing. */
  terminate(): void;
};

/**
 * The part of an `AbortSignal` the host uses.
 *
 * @public
 */
export type AbortSignalWithEvents = {
  /** True once aborted. */
  readonly aborted: boolean;
  /** Listen for the abort. */
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
  /** Stop listening. */
  removeEventListener(type: 'abort', listener: () => void): void;
};

/**
 * A job for the host: the worker message without the numbers the host assigns, and the scope it belongs to.
 *
 * @public
 */
export type HostJob = Omit<LayoutJobMessage, 'type' | 'id' | 'revision' | 'seed' | 'fontHash' | 'post'> & {
  /** What the job lays out (a screen id, a container id): a newer revision of a scope supersedes an older one still running. */
  readonly scope: string;
  /** The revision of that scope this job was asked at; a lower one than the newest seen is superseded at once. */
  readonly revision: number;
  /** The seed of the random stream (default 0). */
  readonly seed?: number;
  /** A hash of the fonts the sizes were measured with (default empty). */
  readonly fontHash?: string;
  /** The post-passes (default pins, overlap, snap). */
  readonly post?: LayoutJobMessage['post'];
};

/**
 * Runs layout jobs in workers.
 *
 * @public
 */
export type LayoutHost = {
  /**
   * Run `job`. Resolves with the layout result; rejects with an error named `AbortError` when `signal` aborts, or when a newer revision of the
   * same scope superseded this job (its worker is ended and its late reply is ignored).
   */
  run(job: HostJob, signal?: AbortSignalWithEvents): Promise<Result<LaidOut>>;
  /** End every worker and reject every job in flight with an `AbortError`. */
  dispose(): void;
};

type Outcome = { readonly result: Result<LaidOut> } | { readonly abort: string };

type Running = {
  readonly id: number;
  readonly revision: number;
  readonly worker: WorkerLike;
  readonly settle: (outcome: Outcome) => void;
};

/** What a host keeps between jobs: the running job of each scope, the newest revision seen of each, and the next job number. */
type State = { readonly spawn: () => WorkerLike; readonly running: Map<string, Running>; readonly newest: Map<string, number>; nextId: number };

/** An error named `AbortError`, as `fetch` and `AbortSignal` reject with. */
function abortError(reason: string): Error {
  const e = new Error(reason);
  e.name = 'AbortError';
  return e;
}

/** The text of a failure: an Error, a browser ErrorEvent (a `message` field) or anything else. */
function failureText(event: unknown): string {
  const message = event instanceof Error ? event.message : (event as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? message : 'the layout worker failed';
}

const failed = (message: string): Outcome => ({ result: err({ code: 'LAYOUT_FAILED', message }) });

/** The outcome a worker message stands for, or undefined when it is not the reply to job `id` (another id, another shape, junk). */
function outcomeOf(data: unknown, id: number): Outcome | undefined {
  const reply = data as Partial<LayoutReplyMessage> | null;
  if (!reply || reply.id !== id) return undefined;
  if (reply.type === 'done' && reply.output) return { result: ok(reply.output) };
  if (reply.type === 'error' && reply.error) return { result: err(reply.error) };
  return undefined;
}

/** End the running job of `scope` if it is still `job`: settle it, drop its handlers, end its worker. */
function endJob(state: State, scope: string, job: Running, outcome: Outcome): void {
  if (state.running.get(scope) !== job) return;
  state.running.delete(scope);
  job.worker.onmessage = null;
  job.worker.onerror = null;
  if ('onmessageerror' in job.worker) job.worker.onmessageerror = null;
  // settle first: a promise must not hang because ending a dead worker throws
  job.settle(outcome);
  try {
    job.worker.terminate();
  } catch {
    // a worker that is already gone cannot be ended again; there is nothing to do
  }
}

/** The message that starts `job` as job number `id`. */
function messageFor(job: HostJob, id: number): LayoutJobMessage {
  const { scope: _scope, revision, seed, fontHash, post, ...rest } = job;
  return { ...rest, type: 'layout', id, revision, seed: seed ?? 0, fontHash: fontHash ?? '', post: post ?? ['pins', 'overlap', 'snap'] };
}

/** Start `job` on a new worker; `resolve` and `reject` settle the caller's promise. */
function startJob(
  state: State,
  job: HostJob,
  signal: AbortSignalWithEvents | undefined,
  settleWith: { resolve: (r: Result<LaidOut>) => void; reject: (e: Error) => void },
): void {
  let worker: WorkerLike;
  try {
    worker = state.spawn();
  } catch (e) {
    settleWith.resolve(err({ code: 'LAYOUT_FAILED', message: `no layout worker could be started: ${failureText(e)}` }));
    return;
  }
  const id = state.nextId;
  state.nextId += 1;
  const onAbort = (): void => endJob(state, job.scope, entry, { abort: 'the layout was aborted' });
  const settle = (outcome: Outcome): void => {
    signal?.removeEventListener('abort', onAbort);
    if ('abort' in outcome) settleWith.reject(abortError(outcome.abort));
    else settleWith.resolve(outcome.result);
  };
  const entry: Running = { id, revision: job.revision, worker, settle };
  state.running.set(job.scope, entry);
  signal?.addEventListener('abort', onAbort, { once: true });
  worker.onmessage = (event) => {
    // only the live job's own reply counts: a reply of an ended job, of another id or of another shape is ignored
    const outcome = state.running.get(job.scope) === entry ? outcomeOf(event.data, id) : undefined;
    if (outcome) endJob(state, job.scope, entry, outcome);
  };
  worker.onerror = (event) => endJob(state, job.scope, entry, failed(failureText(event)));
  worker.onmessageerror = () => endJob(state, job.scope, entry, failed('a message from the layout worker could not be read'));
  try {
    worker.postMessage(messageFor(job, id));
  } catch (e) {
    endJob(state, job.scope, entry, failed(`the layout job could not be sent: ${failureText(e)}`));
  }
}

/**
 * Create a host that starts workers with `spawn`.
 *
 * @public
 */
export function createLayoutHost(spawn: () => WorkerLike): LayoutHost {
  const state: State = { spawn, running: new Map(), newest: new Map(), nextId: 1 };
  return {
    run(job, signal) {
      const seen = state.newest.get(job.scope) ?? Number.NEGATIVE_INFINITY;
      if (signal?.aborted) return Promise.reject(abortError('the layout was aborted'));
      if (job.revision < seen) return Promise.reject(abortError(`superseded by revision ${seen}`));
      state.newest.set(job.scope, job.revision);
      const older = state.running.get(job.scope);
      if (older) endJob(state, job.scope, older, { abort: `superseded by revision ${job.revision}` });
      return new Promise<Result<LaidOut>>((resolve, reject) => startJob(state, job, signal, { resolve, reject }));
    },
    dispose() {
      for (const [scope, job] of [...state.running]) endJob(state, scope, job, { abort: 'the layout host was disposed' });
    },
  };
}
