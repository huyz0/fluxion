// Finding what a crash left behind (FR-FIL-007, NFR-REL-001, ADR-0024): the documents whose journal holds changes the file does not, that no open tab
// is editing, rebuilt up to the last entry that replays, with a summary for the prompt and the asset bytes their records name.
import { type DocumentFile, SCHEMA_VERSION } from '@fluxion/schema';
import { getAssetBytes } from './asset-bytes.js';
import { type Recovery, recover } from './autosave.js';
import type { BlobStore } from './blobs.js';
import type { LockPort } from './document-autosave.js';
import type { AutosaveStore } from './store.js';

/**
 * One document that can be recovered.
 *
 * @public
 */
export type Recoverable = {
  /** The id the journal files it under (the lock's name is made from it too). */
  readonly id: string;
  /** What the journal rebuilds. */
  readonly recovery: Recovery;
};

/**
 * What the prompt shows of one recoverable document.
 *
 * @public
 */
export type RecoveryPreview = {
  /** The document's title. */
  readonly title: string;
  /** When autosave last wrote, ISO 8601. */
  readonly updated: string;
  /** How many screens it has. */
  readonly screens: number;
  /** How many records it has. */
  readonly records: number;
  /** How many changes since the file was saved are in it. */
  readonly changes: number;
  /** A sentence about what could not be recovered, when something could not. */
  readonly warning?: string;
};

/**
 * The summary of `item` for the prompt.
 *
 * @public
 */
export function previewOf(item: Recoverable): RecoveryPreview {
  const { recovery } = item;
  const all = Object.values(recovery.records) as { type?: string }[];
  return {
    title: recovery.title,
    updated: recovery.updated,
    screens: all.filter((r) => r.type === 'screen').length,
    records: all.length,
    changes: recovery.applied,
    ...(recovery.dropped === undefined
      ? {}
      : {
          warning: `${recovery.dropped.entries} later ${recovery.dropped.entries === 1 ? 'change' : 'changes'} could not be read (${recovery.dropped.reason}); the document is recovered up to the change before.`,
        }),
  };
}

/**
 * The documents with unsaved work in `journal` that no open tab holds: a document whose lock is taken is being edited right now. Never rejects; a
 * journal that cannot be read recovers nothing.
 *
 * @public
 */
export async function findRecoverable(journal: AutosaveStore, lock: LockPort): Promise<readonly Recoverable[]> {
  try {
    const found: Recoverable[] = [];
    for (const meta of await journal.unsaved()) {
      const release = await lock.acquire(`fluxion-doc:${meta.docId}`).catch(() => undefined);
      if (release === undefined) continue;
      release();
      const stored = await journal.load(meta.docId);
      const recovery = stored === undefined ? undefined : recover(stored);
      if (recovery?.unsaved === true) found.push({ id: meta.docId, recovery });
    }
    return found;
  } catch {
    return [];
  }
}

/**
 * The document file a recovery rebuilds. The records are the journal's; the envelope is this version's, since the journal keeps only records.
 *
 * @public
 */
export const documentOf = (item: Recoverable): DocumentFile => ({ schemaVersion: SCHEMA_VERSION, records: item.recovery.records });

/**
 * The bytes of the assets `item`'s records name that autosave kept, by hash, with the mime type the record gives. An asset whose bytes were not kept
 * is left out (the record stays; its image shows as missing).
 *
 * @public
 */
export async function recoveredAssets(item: Recoverable, blobs: BlobStore | undefined): Promise<Map<string, { bytes: Uint8Array; mime: string }>> {
  const out = new Map<string, { bytes: Uint8Array; mime: string }>();
  if (blobs === undefined) return out;
  for (const r of Object.values(item.recovery.records) as { type?: string; hash?: unknown; mime?: unknown }[]) {
    if (r.type !== 'asset' || typeof r.hash !== 'string' || out.has(r.hash)) continue;
    const bytes = await getAssetBytes(blobs, r.hash).catch(() => undefined);
    if (bytes !== undefined) out.set(r.hash, { bytes, mime: typeof r.mime === 'string' ? r.mime : 'application/octet-stream' });
  }
  return out;
}
