// The lazy half of `streamFluxScript` (FR-AI-010, ADR-0032): the only editor module that imports `@fluxion/dsl`, loaded by a dynamic import so
// the editor's initial chunk never holds the compiler. Do not import this file statically from anywhere but its own tests.
import type { Store } from '@fluxion/core';
import { createStreamCompiler, type DslDiagnostic, type StreamUpdate } from '@fluxion/dsl';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { DEFAULT_CAMERA } from '../session.js';
import type { StreamFluxOptions, StreamFluxResult } from '../stream-flux-types.js';

/** The undo merge key of one stream: every screen's transaction joins one undo step. */
const MERGE_KEY = 'ai.stream-flux';

/** The record types a replacing stream keeps: they are not the content of a screen. */
const KEPT_WHEN_REPLACING: ReadonlySet<string> = new Set(['document', 'theme', 'asset', 'variable', 'plugin-ref']);

/** The store's document without the content a replacing stream is about to write (screens, elements and everything pointing at them). */
function withoutContent(doc: DocumentFile): DocumentFile {
  const records = Object.fromEntries(Object.entries(doc.records).filter(([, r]) => KEPT_WHEN_REPLACING.has(r.type)));
  return { ...doc, records };
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Write the stream's own work since `run.prev` through the `document.applyRecords` command: the records that differ between the previous running doc and
 * `doc` are put, the ones `doc` lacks are deleted (when still in the store). What the user changed meanwhile, and the stream did not, is left alone. A
 * replacing stream also deletes the old content, once, in its first write. One run, so one canvas update.
 */
function applyDoc(options: StreamFluxOptions, doc: DocumentFile, run: Run): string | undefined {
  const { store, execute } = options;
  const prev = run.prev.records;
  const puts = Object.values(doc.records).filter((record) => !same(prev[record.id], record));
  const gone = Object.keys(prev).filter((id) => !(id in doc.records));
  // ids are stable hashes (ADR-0031): content streamed again has the ids of what it replaces, and a put must not be undone by a delete of the same id
  const put = new Set(puts.map((r) => r.id as string));
  const deletes = [...new Set([...gone, ...run.stale])].filter((id) => !put.has(id) && store.has(id as RecordId));
  const result = execute('document.applyRecords', { puts, deletes }, { mergeKey: MERGE_KEY });
  if (!result.ok) return result.error.message;
  run.prev = doc;
  run.stale = [];
  return undefined;
}

/** The diagnostics a stream shows so far: screens' own are provisional until a recompile replaces the lot. */
function shown(shownSoFar: readonly DslDiagnostic[], update: StreamUpdate): readonly DslDiagnostic[] {
  if (update.recompiled && update.tail) return update.tail.diagnostics;
  return [...shownSoFar, ...(update.header?.diagnostics ?? []), ...update.screens.flatMap((s) => s.diagnostics), ...(update.tail?.diagnostics ?? [])];
}

/** The documents an update asks to show, in order: one per compiled screen, then the tail's (deferred keys, or the recompile). */
function docsOf(update: StreamUpdate): { doc: DocumentFile; screen: boolean }[] {
  const out = update.screens.flatMap((s) => (s.compiled && s.doc ? [{ doc: s.doc, screen: true }] : []));
  return update.tail?.doc ? [...out, { doc: update.tail.doc, screen: false }] : out;
}

type Run = { prev: DocumentFile; stale: readonly string[]; count: number; focused: boolean; diagnostics: readonly DslDiagnostic[]; recompiled: boolean };

/** Show the first screen that arrives (once): the canvas follows the stream's beginning, not its end. */
function focusFirst(options: StreamFluxOptions, before: ReadonlySet<RecordId>, run: Run): void {
  const { session, store } = options;
  if (run.focused || !session) return;
  const fresh = store.members('byType', 'screen').find((id) => !before.has(id));
  if (fresh === undefined) return;
  run.focused = true;
  session.screen.set(fresh);
  session.selection.set([]);
  session.camera.set(DEFAULT_CAMERA);
}

/** Apply one update's documents to the store; the failure message of a refused one. */
function applyUpdate(options: StreamFluxOptions, update: StreamUpdate, run: Run): string | undefined {
  for (const { doc, screen } of docsOf(update)) {
    const before = new Set(options.store.members('byType', 'screen'));
    const refused = applyDoc(options, doc, run);
    if (refused !== undefined) return refused;
    if (screen) run.count++;
    focusFirst(options, before, run);
  }
  return undefined;
}

/** Read `source` chunk by chunk, whichever kind it is (a ReadableStream is read with its reader: Safari has no async iterator on it). */
async function* chunksOf(source: AsyncIterable<string> | ReadableStream<string>): AsyncGenerator<string> {
  if (!('getReader' in source)) {
    yield* source;
    return;
  }
  const reader = source.getReader();
  try {
    for (let r = await reader.read(); !r.done; r = await reader.read()) yield r.value;
  } finally {
    reader.releaseLock();
  }
}

/** Run the stream. See `streamFluxScript`. */
export async function runFluxStream(source: AsyncIterable<string> | ReadableStream<string>, options: StreamFluxOptions): Promise<StreamFluxResult> {
  const { store, registries, signal, onDiagnostics } = options;
  const snapshot = store.toDocument();
  const base = options.replace === true ? withoutContent(snapshot) : snapshot;
  const compiler = createStreamCompiler({ registries, base, ...(options.salt !== undefined ? { salt: options.salt } : {}) });
  const run: Run = {
    prev: base,
    // a replacing stream deletes what the document held, in its first write
    stale: options.replace === true ? Object.keys(snapshot.records).filter((id) => !(id in base.records)) : [],
    count: 0,
    focused: false,
    diagnostics: [],
    recompiled: false,
  };
  const finish = (status: StreamFluxResult['status'], problem?: string): StreamFluxResult => ({
    status,
    screens: run.count,
    diagnostics: run.diagnostics,
    recompiled: run.recompiled,
    ...(problem !== undefined ? { problem } : {}),
  });
  const take = (update: StreamUpdate): string | undefined => {
    run.diagnostics = shown(run.diagnostics, update);
    if (update.recompiled) run.recompiled = true;
    const refused = applyUpdate(options, update, run);
    onDiagnostics?.(run.diagnostics);
    return refused;
  };
  // a stream is its own undo step: not merged into the edit before it, nor into a stream after it
  store.history.seal();
  try {
    for await (const chunk of chunksOf(source)) {
      if (signal?.aborted) return finish('aborted');
      const refused = take(compiler.push(chunk));
      if (refused !== undefined) return finish('refused', refused);
    }
    if (signal?.aborted) return finish('aborted');
    const refused = take(compiler.end());
    return refused === undefined ? finish('done') : finish('refused', refused);
  } finally {
    store.history.seal();
  }
}
