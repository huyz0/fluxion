// The routing chunk's worker (M16.28, ADR-0044 amendment): the player draws the cheap routes at once and the global pass's routes once
// the chunk has routed them, off the main thread (performance.md rule 9: the pass takes hundreds of ms on a busy screen). A `.flux.html`
// carries the chunk as an inert `<script type="text/plain" data-fluxion-chunk="routing">` block, run as a worker from a Blob URL (the
// file's CSP allows `blob:` scripts, which also covers workers, 08 §3); the element script runs `fluxion-routing.js` from beside itself.
// A missing or failing chunk leaves the cheap routes drawn.
import type { GlobalRoute, GlobalRouteInput } from '@fluxion/routing';

/**
 * The global pass in a worker: `route` routes one screen's input, undefined when the worker cannot (it failed to start or was disposed).
 *
 * @public
 */
export type RoutingWorker = {
  readonly route: (input: GlobalRouteInput) => Promise<readonly GlobalRoute[] | undefined>;
  readonly dispose: () => void;
};

/** The selector of the chunk's data block in a `.flux.html`. */
const ROUTING_CHUNK_SELECTOR = 'script[type="text/plain"][data-fluxion-chunk="routing"]';

type Answer = { readonly id: number; readonly routes?: readonly GlobalRoute[] };

/** A worker port over the classic worker script at `url`; `release` runs when it is disposed. Undefined when no worker can be made. */
function workerAt(url: string, release: () => void = () => undefined): RoutingWorker | undefined {
  let worker: Worker;
  try {
    worker = new Worker(url);
  } catch {
    release();
    return undefined;
  }
  const waiting = new Map<number, (routes: readonly GlobalRoute[] | undefined) => void>();
  let next = 0;
  let dead = false;
  const fail = () => {
    dead = true;
    for (const resolve of waiting.values()) resolve(undefined);
    waiting.clear();
  };
  worker.addEventListener('message', (e: MessageEvent<Answer>) => {
    const resolve = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    resolve?.(e.data.routes);
  });
  worker.addEventListener('error', fail);
  worker.addEventListener('messageerror', fail);
  return {
    route: (input) => {
      if (dead) return Promise.resolve(undefined);
      const id = ++next;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        worker.postMessage({ id, input });
      });
    },
    dispose: () => {
      worker.terminate();
      fail();
      release();
    },
  };
}

/**
 * The routing worker of the chunk a `.flux.html` embeds in `doc`, run from a Blob URL; none when the file carries no chunk.
 *
 * @public
 */
export function embeddedRoutingWorker(doc: Document): RoutingWorker | undefined {
  const text = doc.querySelector(ROUTING_CHUNK_SELECTOR)?.textContent ?? '';
  if (text.trim() === '') return undefined;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  return workerAt(url, () => URL.revokeObjectURL(url));
}

/**
 * The routing worker of `fluxion-routing.js` beside the element script at `scriptSrc`, read and run from a Blob URL (a worker script must
 * be same-origin with the page, the element script need not be); none when the script's address is unknown or the chunk cannot be read.
 *
 * @public
 */
export async function siblingRoutingWorker(scriptSrc: string | undefined): Promise<RoutingWorker | undefined> {
  if (scriptSrc === undefined || scriptSrc === '') return undefined;
  try {
    const response = await fetch(new URL('fluxion-routing.js', scriptSrc).href);
    if (!response.ok) return undefined;
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
    return workerAt(url, () => URL.revokeObjectURL(url));
  } catch {
    return undefined;
  }
}
