// Autosave for the document open in the editor (FR-FIL-007, NFR-REL-001): the lock is taken before the editor opens, so a second tab is built
// read-only, and the journal starts once the document exists.
import type { Store } from '@fluxion/core';
import type { AssetStore } from '@fluxion/editor';
import type { RecordId } from '@fluxion/schema';
import { useEffect, useState } from 'react';
import { type BrowserAutosave, browserAutosave } from './autosave/browser.js';
import { type AutosaveState, type DocumentAutosave, startDocumentAutosave } from './autosave/document-autosave.js';
import { currentFile, heldBytes } from './file-bar.js';
import type { OpenedEntry } from './opened-files.js';

/**
 * Whether this tab may edit the document.
 *
 * @public
 */
export type Guard =
  | {
      /** Waiting for the lock. */
      readonly phase: 'starting';
    }
  | {
      /** Another tab has the document. */
      readonly phase: 'read-only';
    }
  | {
      /** This tab holds the lock; `env` is the open storage. */
      readonly phase: 'editing';
      /** The browser's storage for autosave. */
      readonly env: BrowserAutosave;
    };

/**
 * The id the journal files a document under. A file is filed under its name and a hash of the bytes read, so two files called alike stay apart (the studio's `file-N` ids do not survive a reload, and a second tab
 * on the same file must meet the first tab's lock); a new or bundled document is a different document in each tab, so it is filed under the route's
 * id and this page's `instance`. Recovery lists what the journal holds, so the id need not be guessed again after a crash.
 *
 * @public
 */
export const journalId = (docId: string, entry: OpenedEntry | undefined, instance: string): string =>
  entry === undefined ? `${docId}~${instance}` : `file:${entry.identity}`;

/**
 * Take the lock for `id` while the page is open. With `enabled` false (present mode) nothing is taken and the phase is `editing` with no storage use.
 *
 * @public
 */
export function useGuard(id: string, enabled: boolean): Guard {
  const [guard, setGuard] = useState<Guard>({ phase: 'starting' });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let release: (() => void) | undefined;
    let env: BrowserAutosave | undefined;
    void browserAutosave().then(async (opened) => {
      env = opened;
      // a lock that cannot be asked for (a sandboxed frame) must not stop the editing: without it every tab may edit, as before
      const held = await opened.lock.acquire(`fluxion-doc:${id}`).catch(() => () => undefined);
      if (stopped) {
        held?.();
        opened.close();
        return;
      }
      release = held;
      setGuard(held === undefined ? { phase: 'read-only' } : { phase: 'editing', env: opened });
    });
    return () => {
      stopped = true;
      release?.();
      env?.close();
    };
  }, [id, enabled]);
  return guard;
}

/** How often, and how long apart, the bytes of a new asset are asked for. */
const ASSET_TRIES = 5;
const ASSET_RETRY_MS = 1000;

/** The asset records a diff creates or changes, with their hashes. */
function assetPuts(diff: { readonly puts: ReadonlyMap<string, { readonly after: unknown }> }): { id: RecordId; hash: string }[] {
  const out: { id: RecordId; hash: string }[] = [];
  for (const [id, change] of diff.puts) {
    const after = change.after as { type?: string; hash?: unknown };
    if (after.type === 'asset' && typeof after.hash === 'string') out.push({ id: id as RecordId, hash: after.hash });
  }
  return out;
}

/**
 * Keep the bytes of each asset the document gains, for a recovery to find. The editor may commit the asset record before it has the bytes, so a
 * missing one is asked for again a few times. Returns the way to stop.
 *
 * @public
 */
export function keepAssets(store: Store, assets: AssetStore, autosave: () => DocumentAutosave | undefined): () => void {
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const keep = (assetId: RecordId, hash: string, tries: number): void => {
    void heldBytes(assets, assetId)
      .then((held) => {
        if (held !== undefined) return autosave()?.keepAsset(hash, held.bytes);
        if (tries > 1 && !stopped) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            keep(assetId, hash, tries - 1);
          }, ASSET_RETRY_MS);
          timers.add(timer);
        }
        return undefined;
      })
      .catch(() => undefined);
  };
  const unsubscribe = store.subscribe((diff) => {
    for (const { id, hash } of assetPuts(diff)) keep(id, hash, ASSET_TRIES);
  });
  return () => {
    stopped = true;
    unsubscribe();
    for (const t of timers) clearTimeout(t);
  };
}

/** What {@link useProtection} needs. */
export type ProtectionInput = {
  /** The journal id. */
  readonly id: string;
  /** The document's store. */
  readonly store: Store;
  /** The editor's asset bytes. */
  readonly assets: AssetStore;
  /** The file it was opened from. */
  readonly entry: OpenedEntry | undefined;
  /** The title now. */
  readonly title: () => string;
  /** The guard this tab holds. */
  readonly guard: Guard;
};

/**
 * Journal the document while the guard says this tab is editing it. Returns the autosave (for Save to tell) and its state (for the status line).
 *
 * @public
 */
export function useProtection(input: ProtectionInput): { autosave: DocumentAutosave | undefined; state: AutosaveState | undefined } {
  const { id, store, assets, entry, title, guard } = input;
  const [started, setStarted] = useState<{ autosave: DocumentAutosave; state: AutosaveState } | undefined>();
  const env = guard.phase === 'editing' ? guard.env : undefined;
  useEffect(() => {
    if (env === undefined) return;
    let stopped = false;
    let current: DocumentAutosave | undefined;
    const stopAssets = keepAssets(store, assets, () => current);
    // the guard already holds the lock: this port hands out nothing more to release
    const held = { acquire: () => Promise.resolve(() => undefined) };
    void startDocumentAutosave({
      docId: id,
      store,
      title,
      journal: env.journal,
      durable: env.durable,
      ...(env.blobs === undefined ? {} : { blobs: env.blobs }),
      snapshots: env.snapshots,
      lock: held,
      persist: env.persist,
      timers: env.timers,
      iso: env.iso,
      flux: async () => {
        const made = await currentFile(entry, store, assets);
        if (!made.ok) throw new Error(made.error);
        return made.value.bytes;
      },
    }).then((result) => {
      if (result.kind !== 'editing') return;
      if (stopped) return result.autosave.stop();
      current = result.autosave;
      setStarted({ autosave: result.autosave, state: result.autosave.state() });
      result.autosave.onState((state) => setStarted({ autosave: result.autosave, state }));
    });
    const hide = (): void => {
      void current?.flush();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') hide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', hide);
    return () => {
      stopped = true;
      stopAssets();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', hide);
      current?.stop();
      setStarted(undefined);
    };
  }, [env, id, store, assets, entry, title]);
  return { autosave: started?.autosave, state: started?.state };
}
