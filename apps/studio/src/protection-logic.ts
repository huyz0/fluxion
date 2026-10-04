// The pure-ish parts of protecting a document (FR-FIL-007): where it is filed in the journal, and keeping the bytes of the assets it gains. Kept apart
// from the hooks so a node test can reach them without the editor's browser-only modules.
import type { Store } from '@fluxion/core';
import type { AssetStore } from '@fluxion/editor';
import type { RecordId } from '@fluxion/schema';
import type { DocumentAutosave } from './autosave/document-autosave.js';
import { heldBytes } from './held-bytes.js';
import type { OpenedEntry } from './opened-files.js';

/**
 * The id the journal files a document under. A file is filed under its name and a hash of the bytes read, so two files called alike stay apart, and a recovered document carries on the journal it was rebuilt from (the studio's `file-N` ids do not survive a reload, and a second tab
 * on the same file must meet the first tab's lock); a new or bundled document is a different document in each tab, so it is filed under the route's
 * id and this page's `instance`. Recovery lists what the journal holds, so the id need not be guessed again after a crash.
 *
 * @public
 */
export const journalId = (docId: string, entry: OpenedEntry | undefined, instance: string): string =>
  entry === undefined ? `${docId}~${instance}` : (entry.resume ?? `file:${entry.identity}`);

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
