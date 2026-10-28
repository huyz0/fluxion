// The saved packs of an opened file in the studio (ADR-0192, M18.115): their geometry, and the exact artwork fonts their 1.1 subsets bind
// under private aliases, are registered before the document is shown, in the editor and in present mode alike. They stay for as long as the
// file is open (edits, undo and redo never touch them) and leave with it; a file whose bytes are missing is refused rather than drawn in
// another face.
import type { VersionedShapePackSubset } from '@fluxion/core';
import type { Result } from '@fluxion/schema';
import { useEffect, useState } from 'react';
import { type OpenDocument, registerOpenedShapePacks } from './bootstrap.js';
import { webHasher } from './file-session.js';

/** Where the saved packs of a document stand: being registered, registered, or refused (one line). */
export type SavedPacksState = { readonly phase: 'registering' } | { readonly phase: 'ready' } | { readonly phase: 'refused'; readonly message: string };

/** The disposer of a registration, or nothing to do. */
const disposeOf = (r: Result<{ dispose(): void }, string>) => (r.ok ? () => r.value.dispose() : () => undefined);
/** A registration's outcome as the page's state. */
const stateOf = (r: Result<unknown, string>): SavedPacksState => (r.ok ? { phase: 'ready' } : { phase: 'refused', message: r.error });

/**
 * Register `packs` (with the retained `fonts` they bind) into `opened` while it is open: ready at once when there are none, else once the
 * fonts have loaded and the geometry is registered. A new `opened`, or leaving, releases what was registered.
 *
 * @public
 */
export function useSavedShapePacks(
  opened: Result<OpenDocument, string>,
  packs: readonly VersionedShapePackSubset[],
  fonts: ReadonlyMap<string, Uint8Array>,
): SavedPacksState {
  const [state, setState] = useState<{ readonly for: OpenDocument; readonly value: SavedPacksState }>();
  useEffect(() => {
    if (!opened.ok || packs.length === 0) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const settle = (r: Result<{ dispose(): void }, string>) => {
      // a registration overtaken by leaving (or a development StrictMode's second run) keeps nothing
      if (controller.signal.aborted) return disposeOf(r)();
      release = disposeOf(r);
      setState({ for: opened.value, value: stateOf(r) });
    };
    void registerOpenedShapePacks(opened.value, packs, fonts, { sha256: (b) => webHasher.sha256(b), signal: controller.signal }).then(settle);
    return () => {
      controller.abort();
      release?.();
    };
  }, [opened, packs, fonts]);
  if (!opened.ok || packs.length === 0) return { phase: 'ready' };
  return state?.for === opened.value ? state.value : { phase: 'registering' };
}

/** The saved packs of a file, or none: kept as one value per file so the registration runs once per open. */
export const noSavedPacks: readonly VersionedShapePackSubset[] = [];
/** No retained artwork fonts. */
export const noArtworkFonts: ReadonlyMap<string, Uint8Array> = new Map();
