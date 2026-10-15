/**
 * `@fluxion/layout/worker` — the layout host (main thread) and the worker-side handler; worker glue lives here and nowhere else in the package.
 *
 * @packageDocumentation
 */
export { type AbortSignalWithEvents, createLayoutHost, type HostJob, type LayoutHost, type WorkerLike } from './host.js';
export type { LayoutCancelMessage, LayoutJobMessage, LayoutReplyMessage } from './protocol.js';
export { type AlgorithmLookup, runLayoutJob, serveLayoutWorker, type WorkerScopeLike } from './serve.js';
