// Autosave for the document open in the editor (FR-FIL-007, NFR-REL-001): the lock is taken before the editor opens, so a second tab is built
// read-only, and the journal starts once the document exists.
import type { Store } from '@fluxion/core';
import type { AssetStore } from '@fluxion/editor';
import type { RecordId } from '@fluxion/schema';
import { useEffect, useState } from 'react';
import { type BrowserAutosave, browserAutosave } from './autosave/browser.js';
import { type AutosaveState, type DocumentAutosave, type Started, startDocumentAutosave } from './autosave/document-autosave.js';
import { currentFile } from './file-bar.js';
import type { OpenedEntry } from './opened-files.js';
import { journalId, keepAssets } from './protection-logic.js';

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

/** Start the autosave of a document whose lock this tab already holds. A recovered document carries on the journal it came from. */
async function begin(input: ProtectionInput, env: BrowserAutosave): Promise<Started> {
  const { id, store, assets, entry, title } = input;
  const stored = entry?.resume === undefined ? undefined : await env.journal.load(entry.resume).catch(() => undefined);
  return startDocumentAutosave({
    docId: id,
    store,
    title,
    journal: env.journal,
    durable: env.durable,
    ...(env.blobs === undefined ? {} : { blobs: env.blobs }),
    snapshots: env.snapshots,
    // the guard already holds the lock: this port hands out nothing more to release
    lock: { acquire: () => Promise.resolve(() => undefined) },
    persist: env.persist,
    timers: env.timers,
    iso: env.iso,
    flux: async () => {
      const made = await currentFile(entry, store, assets);
      if (!made.ok) throw new Error(made.error);
      return made.value.bytes;
    },
    ...(stored === undefined ? {} : { stored }),
  });
}

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
    void begin({ id, store, assets, entry, title, guard }, env).then((result) => {
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
