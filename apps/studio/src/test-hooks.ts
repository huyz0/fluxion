// Test hooks (FR-AI-010): a spec drives a fake text stream into the open document. Installed only when the page opts in before it loads
// (`window.__FLUXION_TEST_HOOKS__ = true`, set by an init script), so a user's page has no handle on the document.
import type { Core, CoreRegistries } from '@fluxion/core';
import { type Session, type StreamFluxResult, streamFluxScript } from '@fluxion/editor';

/**
 * A fake stream a test holds open: `push` resolves once the studio has applied the chunk, `close` ends the stream.
 *
 * @internal
 */
export type FakeStream = {
  /** Hand over the next chunk; resolves when the studio is done with it (its completed screens are in the store). */
  push(chunk: string): Promise<void>;
  /** End the stream and wait for the studio to finish. */
  close(): Promise<StreamFluxResult>;
};

/**
 * What the studio puts on `window.__fluxion` in test mode.
 *
 * @internal
 */
export type StudioTestHooks = {
  /** Open a stream that replaces the document's screens with the streamed source's. */
  streamFlux(): FakeStream;
  /**
   * A canvas edit: pin the element that shows `label` at (`x`, `y`), through the same `element.update` command a gesture runs. (A drag moves an
   * auto-placed element's box but does not pin it, so the FluxScript has no `pin:` to show; this is the edit that does.) Throws when nothing shows `label`.
   */
  pinElement(label: string, x: number, y: number): void;
};

declare global {
  interface Window {
    __FLUXION_TEST_HOOKS__?: boolean;
    __fluxion?: StudioTestHooks;
  }
}

/** A stream the caller feeds chunk by chunk: the iterable the studio reads, and the handle the test holds. */
function fakeStream(start: (source: AsyncIterable<string>) => Promise<StreamFluxResult>): FakeStream {
  const queue: { chunk: string; applied: () => void }[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const signal = () => {
    wake?.();
    wake = undefined;
  };
  async function* source(): AsyncGenerator<string> {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) {
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      yield item.chunk;
      // the reader asks for more only after it has applied this chunk
      item.applied();
    }
  }
  const done = start(source());
  return {
    push: (chunk) =>
      new Promise<void>((applied) => {
        queue.push({ chunk, applied });
        signal();
      }),
    close: () => {
      closed = true;
      signal();
      return done;
    },
  };
}

/** Pin the element that shows `label` at (`x`, `y`), keeping its size. */
function pinElement(doc: { readonly store: Core['store']; readonly execute: Core['execute'] }, label: string, x: number, y: number): void {
  const id = doc.store.members('byType', 'element').find((i) => (doc.store.get(i) as { semantic?: { label?: unknown } }).semantic?.label === label);
  const box = id === undefined ? undefined : (doc.store.get(id) as { transform?: { w: number; h: number } }).transform;
  if (id === undefined || box === undefined) throw new Error(`no element shows "${label}"`);
  const done = doc.execute('element.update', { id, fields: { placement: 'pinned', transform: { x, y, w: box.w, h: box.h } } });
  if (!done.ok) throw new Error(done.error.message);
}

/**
 * Install the test hooks for the open document when the page opted in; returns the cleanup.
 *
 * @param doc - the open document's store, registries and editor session
 * @returns removes the hooks
 * @internal
 */
export function installTestHooks(doc: {
  readonly store: Core['store'];
  readonly execute: Core['execute'];
  readonly registries: CoreRegistries;
  readonly session: Session;
}): () => void {
  if (window.__FLUXION_TEST_HOOKS__ !== true) return () => undefined;
  const hooks: StudioTestHooks = {
    streamFlux: () => fakeStream((source) => streamFluxScript(source, { ...doc, replace: true })),
    pinElement: (label, x, y) => pinElement(doc, label, x, y),
  };
  window.__fluxion = hooks;
  return () => {
    if (window.__fluxion === hooks) delete window.__fluxion;
  };
}
