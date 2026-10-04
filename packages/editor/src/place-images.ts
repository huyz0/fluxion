// Putting image files in the document (FR-AST-001, FR-EDT-007): a drop, the picker's file button. Each file is read through the import pipeline
// (image-file.ts) and placed like a pasted image, one undo step each, a little apart so several do not stack; the last one is selected. A file that
// is refused is told to `notify` (all the refusals of one drop in one message), and the rest still go in.
import type { Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { readImageFile } from './image-file.js';
import { pasteSystemItem, type SystemPasteDeps } from './system-paste.js';

/** How far apart several dropped files are placed, page px. */
const STAGGER = 24;

/** Whether `file` claims to be an image the import takes (the pipeline sniffs the bytes: this only decides whether a drop is ours). */
export const isImageFile = (file: File): boolean => file.type.startsWith('image/');

/**
 * Place `files` at `centre` (the first) and a step further for each next one. Resolves to the id of the last element placed, if any.
 *
 * @public
 */
export async function placeImageFiles(
  deps: SystemPasteDeps,
  files: readonly File[],
  centre: Vec2,
  notify: (message: string) => void,
): Promise<RecordId | undefined> {
  let last: RecordId | undefined;
  const refused: string[] = [];
  for (const [i, file] of files.entries()) {
    const read = await readImageFile(file);
    if (!read.ok) {
      refused.push(read.message);
      continue;
    }
    last = pasteSystemItem(deps, read.item, { x: centre.x + i * STAGGER, y: centre.y + i * STAGGER }) ?? last;
  }
  if (refused.length > 0) notify(refused.join(' '));
  return last;
}
