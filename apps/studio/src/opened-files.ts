// The files opened in this tab (M10.17): a file the person opens gets a document id (`file-1`, `file-2`) the route can name, and the document,
// its assets and what the studio must remember about it wait here until the editor page takes them. They live as long as the tab.
import type { RecordId } from '@fluxion/schema';
import type { OpenedFile } from './file-session.js';

/**
 * A file waiting to be edited: what was read, the `data:` URL of each of its assets for the editor to draw, and the handle to save through.
 *
 * @public
 */
export type OpenedEntry = {
  /** Tells this file from another of the same name: the name and the start of the hash of the bytes read (autosave files the document under it). */
  readonly identity: string;
  /** Present for a recovered document: the journal id it carries on, so a second crash before the first save loses nothing. */
  readonly resume?: string;
  /** What the file is and what must come back on a save. */
  readonly file: OpenedFile;
  /** The bytes of each asset record as a `data:` URL, by record id. */
  readonly urls: ReadonlyMap<RecordId, string>;
  /** A handle to save through, where the browser gave one. */
  readonly handle?: unknown;
};

const entries = new Map<string, OpenedEntry>();
let counter = 0;

/**
 * Remember `entry` and give it the document id the route will name.
 *
 * @public
 */
export function registerOpened(entry: OpenedEntry): string {
  counter += 1;
  const docId = `file-${counter}`;
  entries.set(docId, entry);
  return docId;
}

/**
 * The file registered as `docId`, if there is one.
 *
 * @public
 */
export const openedEntry = (docId: string): OpenedEntry | undefined => entries.get(docId);

/** `bytes` as a `data:` URL (read by the browser, so a large file does not become a huge string of calls). */
export function dataUrlOf(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes.slice().buffer], { type: mime }));
  });
}

/** The data URL of each asset record of `file` whose bytes the file held. */
export async function assetUrls(file: OpenedFile): Promise<Map<RecordId, string>> {
  const urls = new Map<RecordId, string>();
  const records = Object.values(file.document.records) as { id: RecordId; type: string; hash?: string }[];
  for (const record of records) {
    const asset = record.type === 'asset' && record.hash !== undefined ? file.assets.get(record.hash) : undefined;
    if (asset !== undefined) urls.set(record.id, await dataUrlOf(asset.bytes, asset.mime));
  }
  return urls;
}
