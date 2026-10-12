// The options and result of `streamFluxScript` (FR-AI-010); in a file of their own so the lazy chunk and the public wrapper share them without a cycle.
import type { CoreRegistries, Store } from '@fluxion/core';
import type { DslDiagnostic } from '@fluxion/dsl';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';

/**
 * How to stream a FluxScript source into the open document.
 *
 * @public
 */
export type StreamFluxOptions = {
  /** The open document's store, read here; every write goes through `execute`. */
  readonly store: Store;
  /** Runs commands against the store (the editor's `execute`): every screen is one `document.applyRecords` run. */
  readonly execute: Execute;
  /** The registries shapes, layouts and themes are looked up in (the open document's). */
  readonly registries: CoreRegistries;
  /** The editor session: the canvas shows the first screen that arrives. Omitted: the view is left alone. */
  readonly session?: Session;
  /**
   * Replace the screens (and everything on them) of the document with the stream's, from the first screen on; the document record, themes,
   * assets and variables stay. Default false: the stream's screens are upserted into the document, new ones after the last.
   */
  readonly replace?: boolean;
  /** The id salt of a document that has none yet (ADR-0031). */
  readonly salt?: string;
  /** Stops the stream between chunks; what already arrived stays. */
  readonly signal?: AbortSignal;
  /**
   * Called after every chunk with the diagnostics to show. They grow with the stream; when the stream reports `recompiled` the list is
   * replaced by the whole file's, because the earlier ones were provisional.
   */
  readonly onDiagnostics?: (diagnostics: readonly DslDiagnostic[]) => void;
};

/**
 * How a stream ended.
 *
 * @public
 */
export type StreamFluxResult = {
  /** `done` (the stream ended), `aborted` (the signal fired) or `refused` (the store refused a write: see `problem`). */
  readonly status: 'done' | 'aborted' | 'refused';
  /** Screens written to the store. */
  readonly screens: number;
  /** The diagnostics to show at the end (the whole file's after a recompile). */
  readonly diagnostics: readonly DslDiagnostic[];
  /** Whether the end of the stream recompiled the whole file (a `uses`, `theme`, `title` or `flux` key after the screens). */
  readonly recompiled: boolean;
  /** Why the store refused a write. */
  readonly problem?: string;
};
