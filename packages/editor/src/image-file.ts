// An image file becomes something the document can hold (FR-AST-001, FR-AST-002, ADR-0025): the bytes go through the import pipeline (sniffed, scaled
// to at most 2560 px, re-encoded as WebP where that is smaller, an SVG rebuilt from its allowlist), then become the item the paste placement takes.
// A refusal is a message the person can read, never an exception.

import type { ImageCodec } from '@fluxion/format';
import { importImage, MAX_IMPORT_BYTES, sha256Hex } from '@fluxion/format';
import { browserImageCodec } from './image-codec.js';
import type { SystemItem } from './system-paste.js';

/** The image item of `SystemItem`. */
export type ImageItem = Extract<SystemItem, { readonly type: 'image' }>;

/**
 * What reading an image file came to.
 *
 * @public
 */
export type ImageRead =
  | {
      /** The file is an image the document can hold. */
      readonly ok: true;
      /** Ready to place. */
      readonly item: ImageItem;
    }
  | {
      /** The file was refused. */
      readonly ok: false;
      /** Why, as one line for the person. */
      readonly message: string;
    };

/** `bytes` as a `data:` URL of media type `mime` (read by the browser, so a large image does not become a huge string of calls). */
function dataUrlOf(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes.slice().buffer], { type: mime }));
  });
}

/**
 * Read `file` through the import pipeline. The result's bytes are what the asset will hold: scaled and re-encoded as the pipeline decides.
 *
 * @public
 */
export async function readImageFile(file: File, codec: ImageCodec = browserImageCodec): Promise<ImageRead> {
  // refused before it is read: a file past the limit must not be copied into memory to be told so
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, message: `${file.name || 'The file'}: the file is larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB` };
  try {
    const imported = await importImage(new Uint8Array(await file.arrayBuffer()), codec);
    if (!imported.ok) return { ok: false, message: `${file.name || 'The file'}: ${imported.error.message}` };
    const { bytes, mime, width, height } = imported.value;
    return {
      ok: true,
      item: {
        type: 'image',
        mime,
        name: file.name || 'image',
        dataUrl: await dataUrlOf(bytes, mime),
        hash: sha256Hex(bytes),
        size: bytes.length,
        w: width,
        h: height,
      },
    };
  } catch (e) {
    return { ok: false, message: `${file.name || 'The file'} could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}
