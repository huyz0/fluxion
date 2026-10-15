// The worker side (ADR-0033): a handler that answers a layout job with `layoutSync`, and the glue that connects it to a worker scope. The scope
// is a structural type (`postMessage`, `onmessage`), so this file needs no DOM or Node types and is tested with a fake scope. The module a worker
// actually loads is the consumer's: it registers the algorithms it wants and calls `serveLayoutWorker(self, ...)`.
import type { LayoutError } from '../errors.js';
import { layoutSync } from '../pipeline.js';
import type { LayoutAlgorithm } from '../types.js';
import type { LayoutJobMessage, LayoutReplyMessage } from './protocol.js';

/**
 * Finds an algorithm by its registered name.
 *
 * @public
 */
export type AlgorithmLookup = (name: string) => LayoutAlgorithm<never> | undefined;

/**
 * The part of a worker's global scope the layout worker uses.
 *
 * @public
 */
export type WorkerScopeLike = {
  /** Receives a message sent by the host. */
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  /** Sends a message to the host. */
  postMessage(message: unknown): void;
};

const isJob = (v: unknown): v is LayoutJobMessage =>
  typeof v === 'object' && v !== null && (v as { type?: unknown }).type === 'layout' && typeof (v as { id?: unknown }).id === 'number';

/**
 * Answer one job: the unknown-algorithm error, or the result of `layoutSync` as a reply message.
 *
 * @public
 */
export function runLayoutJob(job: LayoutJobMessage, lookup: AlgorithmLookup): LayoutReplyMessage {
  const algorithm = lookup(job.algorithm);
  if (!algorithm) {
    const error: LayoutError = { code: 'LAYOUT_ALGORITHM_UNKNOWN', message: `no layout algorithm named "${job.algorithm}"` };
    return { type: 'error', id: job.id, error };
  }
  const result = layoutSync({
    input: job.input,
    algorithm,
    options: job.options,
    seed: job.seed,
    fontHash: job.fontHash,
    post: job.post,
    ...(job.overlap ? { overlap: job.overlap } : {}),
  });
  return result.ok ? { type: 'done', id: job.id, output: result.value } : { type: 'error', id: job.id, error: result.error };
}

/**
 * Connect a worker scope to the layout handler: each job message is answered with a `done` or `error` message; anything else (a `cancel`, a
 * message of another protocol) is ignored.
 *
 * @public
 */
export function serveLayoutWorker(scope: WorkerScopeLike, lookup: AlgorithmLookup): void {
  scope.onmessage = (event) => {
    if (isJob(event.data)) scope.postMessage(runLayoutJob(event.data, lookup));
  };
}
