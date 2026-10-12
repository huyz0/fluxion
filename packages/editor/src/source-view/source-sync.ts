// The debounce and the controller of the source view (FR-EDT-022, ADR-0032): the author's edits applied to the canvas after a pause (the apply itself, a
// three-way merge, is source-apply.ts), and canvas changes shown in the text only while the view is clean. Pure of CodeMirror and React so it is tested
// without a DOM. Lazy chunk: it imports `@fluxion/dsl`; nothing in the editor's initial chunk may import this file statically.
//
// Decision (M12.22): the view shows a whole file for ONE screen: `decompile(doc, { screens: [id] })`, i.e. the header (`flux`, `title`, `theme`,
// `uses`, up to and including the `screens:` line) and that screen's block. The header is read-only in the view (`headerLength` says where the
// editable part starts). Decision (M12.49): the whole text is compiled on its own with the document's salt, and only what changed since the last
// generated or applied text is merged into the document; every other screen and every record the block does not own is untouched.
import type { CoreRegistries, Store } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import type { Execute } from '../pointer.js';
import { applyMerged, type Base, baseOf, blocks, drifted, type Generated, generate, type SyncResult } from './source-apply.js';

export { applyMerged, applySource, type Base, baseOf, generate, type SyncResult, sourceOf } from './source-apply.js';

/** How long the text must rest before it is compiled. */
export const APPLY_DELAY_MS = 300;

/** How long the canvas must be quiet before the view looks at what changed (a drag changes the document every frame: one look, after it). */
export const RECONCILE_DELAY_MS = 50;

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

/** Where the editable part of a source starts: just after the `screens:` line (0 when there is none, so nothing is locked). */
export function headerLength(text: string): number {
  const match = /^screens:[^\n]*\n?/m.exec(text);
  return match === null ? 0 : match.index + match[0].length;
}

/** Options of {@link createSourceSync}. */
export type SourceSyncOptions = {
  /** The open document. */
  readonly store: Store;
  /** The command runner: the only write path. */
  readonly execute: Execute;
  /** The registries the compile looks shapes, layouts and themes up in. */
  readonly registries: CoreRegistries;
  /** Told after every try, with the text that was tried. */
  readonly onResult: (result: SyncResult, text: string) => void;
  /** The timer (the browser's by default). */
  readonly scheduler?: Scheduler;
  /** The quiet time before a compile (300 ms by default). */
  readonly delayMs?: number;
  /** The base the next apply merges against (the compile of the text as last generated or applied); without it the document is taken as the base. */
  readonly base?: () => Base | undefined;
  /** Told when an apply changed ids (a renamed slug, a record made by hand): the selection and the shown screen follow. */
  readonly onRemap?: (remap: ReadonlyMap<RecordId, RecordId>) => void;
};

/** The debounced text to canvas sync of one source view. */
export type SourceSync = {
  /** The text changed: compile it once the author has stopped typing for the delay. */
  readonly edit: (text: string) => void;
  /** Compile the last text now, if one is waiting. */
  readonly flush: () => void;
  /** Drop a waiting text. */
  readonly cancel: () => void;
  /** Whether a text waits for its pause (the view is dirty). */
  readonly pending: () => boolean;
  /** Whether an apply is running: the document changes it makes are the view's own. */
  readonly applying: () => boolean;
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
  let busy = false;
  const run = (): void => {
    if (waiting === undefined) return;
    const { text } = waiting;
    waiting = undefined;
    busy = true;
    let result: SyncResult;
    try {
      result = applyMerged(text, { store, execute, registries }, options.base?.());
    } finally {
      busy = false;
    }
    if (result.remap !== undefined && result.remap.size > 0) options.onRemap?.(result.remap);
    onResult(result, text);
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
    pending: () => waiting !== undefined,
    applying: () => busy,
  };
}

/** Where the cursor was, in terms that survive a regenerated text: the nearest node line above it (its slug key), the lines below that and the column. */
export type CursorAnchor = {
  /** The slug key of the node line at or above the cursor (`undefined` when none). */
  readonly key: string | undefined;
  /** Lines between that node line and the cursor's line. */
  readonly lines: number;
  /** The column in the cursor's line. */
  readonly column: number;
  /** The offset, the fallback when the slug is gone. */
  readonly pos: number;
};

const NODE_LINE = /^ +([A-Za-z0-9_-]+): \{/;

const lineIndexAt = (lines: readonly string[], pos: number): { index: number; column: number } => {
  let rest = pos;
  for (let i = 0; i < lines.length; i++) {
    const length = (lines[i] ?? '').length;
    if (rest <= length) return { index: i, column: rest };
    rest -= length + 1;
  }
  return { index: Math.max(0, lines.length - 1), column: 0 };
};

/** Note where `pos` is in `text`, to find it again in a regenerated text. */
export function cursorAnchor(text: string, pos: number): CursorAnchor {
  const lines = text.split('\n');
  const { index, column } = lineIndexAt(lines, pos);
  for (let i = index; i >= 0; i--) {
    const key = NODE_LINE.exec(lines[i] ?? '')?.[1];
    if (key !== undefined) return { key, lines: index - i, column, pos };
  }
  return { key: undefined, lines: 0, column, pos };
}

/** The offset in `next` that answers `anchor`: the same line below the same slug, else the old offset clamped; never inside the first `editFrom` characters. */
export function cursorIn(next: string, anchor: CursorAnchor, editFrom: number): number {
  const lines = next.split('\n');
  const at = anchor.key === undefined ? -1 : lines.findIndex((l) => NODE_LINE.exec(l)?.[1] === anchor.key);
  let pos = Math.min(anchor.pos, next.length);
  if (at >= 0) {
    const index = Math.min(at + anchor.lines, lines.length - 1);
    const start = lines.slice(0, index).reduce((sum, l) => sum + l.length + 1, 0);
    pos = start + Math.min(anchor.column, (lines[index] ?? '').length);
  }
  return Math.max(editFrom, pos);
}

/** What the controller needs of the view it drives. */
export type SourcePort = {
  /** The text the editor holds now. */
  readonly text: () => string;
  /** Replace the editable text by `text` in one change that is not the author's (it must not schedule an apply). */
  readonly replace: (text: string) => void;
  /** Show or hide the "Canvas changed — reload" banner. */
  readonly banner: (show: boolean) => void;
  /** Show what the last try came to (`undefined` clears it and the diagnostics). */
  readonly result: (result: SyncResult | undefined) => void;
};

/** Options of {@link createSourceController}. */
export type SourceControllerOptions = Omit<SourceSyncOptions, 'onResult'> & {
  /** The screen the view shows. */
  readonly screen: RecordId;
  /** The text the view was generated with. */
  readonly initial: string;
  /** The view. */
  readonly port: SourcePort;
};

/** The state of a {@link SourceController}. */
export type SourceState = {
  /** No waiting text, the editor text is the last generated or applied one, and no error is shown. */
  readonly clean: boolean;
  /** The banner is shown. */
  readonly canvasChanged: boolean;
};

/** The two-way sync of one source view: edits to the canvas (debounced) and canvas changes to the text (clean and blurred views only). */
export type SourceController = SourceSync & {
  /** The editor took the focus. */
  readonly focus: () => void;
  /**
   * The editor lost the focus: pending text is applied now, then the text is regenerated if the canvas changed and the view is clean.
   * With `toBanner` the focus went to the banner's own button: nothing is applied (the author is about to choose Reload), and the
   * flush happens when the focus leaves the whole view (a `blur()` without it).
   */
  readonly blur: (to?: { readonly toBanner?: boolean }) => void;
  /** The author asked to reload: the text is regenerated, whatever it held. */
  readonly reload: () => void;
  /** Stop listening to the store. */
  readonly dispose: () => void;
  /** The state, for the banner and the tests. */
  readonly state: () => SourceState;
};

/** The store's changes gathered into one `look` per quiet time, however many came in (a drag is one per frame); the view's own applies are not counted. */
function gatherChanges(store: Store, scheduler: Scheduler, own: () => boolean, look: () => void) {
  let handle: unknown;
  const cancel = (): void => {
    if (handle !== undefined) scheduler.clear(handle);
    handle = undefined;
  };
  const now = (): void => {
    cancel();
    look();
  };
  const unsubscribe = store.subscribe(() => {
    if (own()) return;
    // each change restarts the wait: a drag is looked at once, when it settles, not every 50 ms of it
    if (handle !== undefined) scheduler.clear(handle);
    handle = scheduler.set(now, RECONCILE_DELAY_MS);
  });
  return {
    /** Whether changes wait to be looked at. */
    waiting: () => handle !== undefined,
    now,
    cancel,
    dispose: () => {
      cancel();
      unsubscribe();
    },
  };
}

/**
 * Keep a source view and the canvas in step (ADR-0032, "Canvas to text"): a document change from anywhere but the view's own apply regenerates the
 * text only when the view is clean and not focused; otherwise it raises the banner and only `reload` replaces the text. Writes the editor, never the document.
 *
 * @param options - the document, the screen, the view and the timer
 * @returns the controller
 */
export function createSourceController(options: SourceControllerOptions): SourceController {
  const { store, registries, screen, port } = options;
  const scheduler = options.scheduler ?? BROWSER_SCHEDULER;
  let base = options.initial;
  let merging = baseOf(base, registries, generate(store, registries, screen), screen);
  let focused = false;
  let changed = false;
  let errors = 0;
  const banner = (show: boolean): void => {
    if (changed === show) return;
    changed = show;
    port.banner(show);
  };
  const sync = createSourceSync({
    ...options,
    base: () => merging,
    onResult: (result, text) => {
      errors = result.diagnostics.filter(blocks).length;
      if (result.status === 'applied' || result.status === 'unchanged') {
        base = text;
        merging = result.base ?? merging;
        // the text now says what it says, but the canvas may be ahead of it (a change the merge kept): then the view is behind
        banner(drifted(store, registries, screen, merging));
      }
      port.result(result);
    },
  });
  const clean = (): boolean => !sync.pending() && errors === 0 && port.text() === base;
  const put = (made: Generated): void => {
    base = made.text;
    merging = baseOf(made.text, registries, made, screen);
    errors = 0;
    port.replace(made.text);
    banner(false);
  };
  const reconcile = (): void => {
    // a banner that is up stays up while the view is focused or dirty: nothing could change, so nothing is generated
    if (changed && (focused || !clean())) return;
    if (store.get(screen) === undefined) return;
    const made = generate(store, registries, screen);
    if (made.text === port.text()) {
      base = made.text;
      banner(false);
    } else if (clean() && !focused) put(made);
    else banner(true);
  };
  const looker = gatherChanges(store, scheduler, () => sync.applying(), reconcile);
  return {
    ...sync,
    focus: () => {
      focused = true;
    },
    blur: (to) => {
      focused = false;
      if (to?.toBanner === true) return;
      sync.flush();
      if (changed || looker.waiting()) looker.now();
    },
    reload: () => {
      if (store.get(screen) === undefined) return;
      sync.cancel();
      looker.cancel();
      port.result(undefined);
      put(generate(store, registries, screen));
    },
    dispose: () => {
      looker.dispose();
    },
    state: () => ({ clean: clean(), canvasChanged: changed }),
  };
}
