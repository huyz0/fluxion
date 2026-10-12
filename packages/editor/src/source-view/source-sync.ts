// The text half of the source view (FR-EDT-022, ADR-0032): the screen's FluxScript shown, and the author's edits applied to the canvas.
// Pure of CodeMirror and React so it is tested without a DOM. Lazy chunk: it imports `@fluxion/dsl`; nothing in the editor's initial chunk may
// import this file statically.
//
// Decision (M12.22): the view shows a whole file for ONE screen: `decompile(doc, { screens: [id] })`, i.e. the header (`flux`, `title`, `theme`,
// `uses`, up to and including the `screens:` line) and that screen's block. The header is read-only in the view (`headerLength` says where the
// editable part starts); the whole text is compiled into the open document as `compile(text, { base })`, so the screen's block replaces the
// records it owns (the upsert rules of M12.18) and every other screen is untouched.
import type { CoreRegistries, Store } from '@fluxion/core';
import { compile, type DslDiagnostic, decompile } from '@fluxion/dsl';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import type { Execute } from '../pointer.js';

/** The undo merge key of one apply. */
const MERGE_KEY = 'source-view.apply';

/** How long the text must rest before it is compiled. */
export const APPLY_DELAY_MS = 300;

/** A timer the caller injects (the tests drive it by hand). */
export type Scheduler = {
  /** Run `run` after `ms`; returns a handle for `clear`. */
  readonly set: (run: () => void, ms: number) => unknown;
  /** Cancel a pending run. */
  readonly clear: (handle: unknown) => void;
};

/** The browser's timers. */
export const BROWSER_SCHEDULER: Scheduler = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** What one try at applying the text came to. */
export type SyncResult = {
  /** `applied` (the canvas changed, one undo step), `unchanged` (the text compiles to what the document holds), `invalid` (errors: nothing applied) or `refused` (the store refused the write). */
  readonly status: 'applied' | 'unchanged' | 'invalid' | 'refused';
  /** Every diagnostic of the compile, warnings included. */
  readonly diagnostics: readonly DslDiagnostic[];
  /** Why the store refused the write. */
  readonly problem?: string;
};

/** The FluxScript of one screen: the header and its block. */
export function sourceOf(store: Store, registries: CoreRegistries, screen: RecordId): string {
  return decompile(store.toDocument(), { registries, screens: [screen] }).text;
}

/** Where the editable part of a source starts: just after the `screens:` line (0 when there is none, so nothing is locked). */
export function headerLength(text: string): number {
  const match = /^screens:[^\n]*\n?/m.exec(text);
  return match === null ? 0 : match.index + match[0].length;
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Whether a diagnostic stops the apply: warnings (the deferred sections the compiler keeps but does not compile) do not. */
export const blocks = (d: DslDiagnostic): boolean => d.severity === 'error';

/** Compile `text` into the open document and write what changed as one command and one undo step. */
export function applySource(text: string, store: Store, execute: Execute, registries: CoreRegistries): SyncResult {
  const base = store.toDocument();
  const result = compile(text, { registries, base });
  const diagnostics = result.diagnostics;
  if (result.doc === undefined || diagnostics.some(blocks)) return { status: 'invalid', diagnostics };
  const next = result.doc.records as Record<string, AnyRecord>;
  const puts = Object.values(next).filter((r) => !same(base.records[r.id], r));
  const put = new Set(puts.map((r) => r.id as string));
  const deletes = Object.keys(base.records).filter((id) => !(id in next) && !put.has(id));
  if (puts.length === 0 && deletes.length === 0) return { status: 'unchanged', diagnostics };
  // each apply is its own undo step: not merged into the edit before it, nor into the next apply
  store.history.seal();
  const written = execute('document.applyRecords', { puts, deletes }, { mergeKey: MERGE_KEY });
  store.history.seal();
  return written.ok ? { status: 'applied', diagnostics } : { status: 'refused', diagnostics, problem: written.error.message };
}

/** Options of {@link createSourceSync}. */
export type SourceSyncOptions = {
  /** The open document. */
  readonly store: Store;
  /** The command runner: the only write path. */
  readonly execute: Execute;
  /** The registries the compile looks shapes, layouts and themes up in. */
  readonly registries: CoreRegistries;
  /** Told after every try. */
  readonly onResult: (result: SyncResult) => void;
  /** The timer (the browser's by default). */
  readonly scheduler?: Scheduler;
  /** The quiet time before a compile (300 ms by default). */
  readonly delayMs?: number;
};

/** The debounced text to canvas sync of one source view. */
export type SourceSync = {
  /** The text changed: compile it once the author has stopped typing for the delay. */
  readonly edit: (text: string) => void;
  /** Compile the last text now, if one is waiting. */
  readonly flush: () => void;
  /** Drop a waiting text. */
  readonly cancel: () => void;
};

/**
 * Debounce the author's edits and apply the last one.
 *
 * @param options - the document, the timer and who to tell
 * @returns the sync
 */
export function createSourceSync(options: SourceSyncOptions): SourceSync {
  const { store, execute, registries, onResult } = options;
  const scheduler = options.scheduler ?? BROWSER_SCHEDULER;
  const delay = options.delayMs ?? APPLY_DELAY_MS;
  let waiting: { text: string; handle: unknown } | undefined;
  const run = (): void => {
    if (waiting === undefined) return;
    const { text } = waiting;
    waiting = undefined;
    onResult(applySource(text, store, execute, registries));
  };
  const cancel = (): void => {
    if (waiting !== undefined) scheduler.clear(waiting.handle);
    waiting = undefined;
  };
  return {
    edit: (text) => {
      cancel();
      waiting = { text, handle: scheduler.set(run, delay) };
    },
    flush: () => {
      if (waiting !== undefined) scheduler.clear(waiting.handle);
      run();
    },
    cancel,
  };
}
