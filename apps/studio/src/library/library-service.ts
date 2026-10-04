// The library as the studio uses it (FR-FIL-008): opened on first use, and a convenience that never gets in the way: a browser that refuses
// storage has no library, and a save that cannot be remembered is still a save.
import { idbLibrary, type LibraryEntry, type LibraryStore } from './store.js';
import { renderThumbnail, thumbnailPlan } from './thumbnail.js';

let opening: Promise<LibraryStore | undefined> | undefined;

/**
 * The library, or undefined where the browser has none.
 *
 * @public
 */
export function library(): Promise<LibraryStore | undefined> {
  opening ??= idbLibrary().then(
    (lib) => lib,
    () => undefined,
  );
  return opening;
}

/**
 * Remember a saved file: its bytes and a preview of its first screen, under its name. Never rejects.
 *
 * @public
 */
export async function rememberSaved(saved: { readonly name: string; readonly bytes: Uint8Array }, records: { readonly [id: string]: unknown }): Promise<void> {
  try {
    const lib = await library();
    if (lib === undefined) return;
    const plan = thumbnailPlan(records);
    const thumb = plan === undefined ? undefined : await renderThumbnail(plan);
    const entry: LibraryEntry = {
      id: saved.name,
      name: saved.name,
      saved: new Date().toISOString(),
      bytes: saved.bytes,
      ...(thumb === undefined ? {} : { thumb }),
    };
    await lib.put(entry);
  } catch {
    // the file is saved; the library is only a way back to it
  }
}
