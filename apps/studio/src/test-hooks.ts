// Test hooks (FR-AI-010): a spec drives a fake text stream into the open document. Installed only when the page opts in before it loads
// (`window.__FLUXION_TEST_HOOKS__ = true`, set by an init script), so a user's page has no handle on the document.
import type { Core, CoreRegistries, LogLevel } from '@fluxion/core';
import { type Session, type StreamFluxResult, streamFluxScript } from '@fluxion/editor';
import { idbKeyRecords } from './ai/key-records.js';
import { createKeyStore } from './ai/key-store.js';
import { studioRedactor } from './ai/redactor.js';
import { loggedProblems, studioLogger } from './dev-logger.js';
import { diagnosticReport } from './diagnostic-report.js';

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
  /** Every record of the open document, by id (a test reads what an apply of the Source view left). */
  records(): { readonly [id: string]: { readonly [field: string]: unknown } };
  /** Write records beside the source's (an element the grammar cannot say, a comment on one) as one undo step; the store's problem when it refuses, else `undefined`. */
  applyRecords(puts: readonly object[], deletes?: readonly string[]): string | undefined;
  /** Put a provider key in the key store, as the settings would (NFR-SEC-004): it is kept in IndexedDB and registered with the redactor. */
  holdKey(provider: string, value: string): Promise<void>;
  /** Write a line through the studio logger (the console and the diagnostic report's source). */
  log(level: LogLevel, message: string, fields?: { readonly [key: string]: unknown }): void;
  /** The diagnostic report the Copy button would put on the clipboard. */
  report(): string;
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
    records: () => doc.store.toDocument().records as unknown as ReturnType<StudioTestHooks['records']>,
    applyRecords: (puts, deletes = []) => {
      doc.store.history.seal();
      const result = doc.execute('document.applyRecords', { puts, deletes });
      doc.store.history.seal();
      return result.ok ? undefined : result.error.message;
    },
    holdKey: (provider, value) => createKeyStore({ records: idbKeyRecords(indexedDB), crypto, redactor: studioRedactor }).set(provider, value),
    log: (level, message, fields = {}) => studioLogger(window.location.search, console).child('studio').log(level, message, fields),
    report: () =>
      diagnosticReport({
        versions: { studio: 'test' },
        records: doc.store.toDocument().records,
        entries: loggedProblems(),
        userAgent: navigator.userAgent,
      }),
  };
  window.__fluxion = hooks;
  return () => {
    if (window.__fluxion === hooks) delete window.__fluxion;
  };
}
