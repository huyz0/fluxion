// Pasting what is not Fluxion's (FR-EDT-007, NFR-SEC-001, M7.23): an image becomes an asset and an image element, an SVG
// (through `sanitizeSvg`) the same, and plain text a `text` element, placed at the centre of the view. The reading of
// the clipboard is system-paste-dom.ts; this is what is written, as one undo step. Pure but for the commands it runs.
import type { Vec2 } from '@fluxion/geometry';
import type { AssetRecord, RecordId } from '@fluxion/schema';
import type { AssetStore } from './asset-store.js';
import type { PasteDeps } from './clipboard.js';
import { frontIndex } from './create-tool.js';

/**
 * Something pasted that is not Fluxion's, read and ready to place: an image (its bytes as a `data:` URL, with the hash
 * and size of the bytes and the pixel size when it decoded), or text.
 *
 * @public
 */
export type SystemItem =
  | {
      /** An image, or an SVG already sanitised. */
      readonly type: 'image';
      /** Its media type. */
      readonly mime: string;
      /** A file name for the asset. */
      readonly name: string;
      /** Its bytes as a `data:` URL. */
      readonly dataUrl: string;
      /** SHA-256 of the bytes, 64 lower-case hex digits. */
      readonly hash: string;
      /** The size of the bytes. */
      readonly size: number;
      /** Pixel width, when the image decoded. */
      readonly w: number | undefined;
      /** Pixel height, when the image decoded. */
      readonly h: number | undefined;
    }
  | {
      /** Plain text. */
      readonly type: 'text';
      /** The text. */
      readonly text: string;
    };

/** The longest side a pasted image is placed at, page px. */
const PASTE_IMAGE_MAX = 480;

/**
 * A size in page px.
 *
 * @public
 */
export type ImageSize = {
  /** Width. */
  readonly w: number;
  /** Height. */
  readonly h: number;
};

/**
 * The size a pasted image is placed at: its pixels, shrunk to fit 480 px on a side; a default when it has none.
 *
 * @public
 */
export function fitImage(w: number | undefined, h: number | undefined): ImageSize {
  if (w === undefined || h === undefined || w <= 0 || h <= 0) return { w: 240, h: 160 };
  const scale = Math.min(1, PASTE_IMAGE_MAX / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/** The width a pasted text is placed at, page px, and the height of a line of it. */
const PASTE_TEXT_WIDTH = 320;
const LINE = 28;

/** The rich text of `text`: a paragraph per line. */
function paragraphs(text: string): { readonly type: 'doc'; readonly content: readonly unknown[] } {
  return {
    type: 'doc',
    content: text.split(/\r\n|\r|\n/).map((line) => ({ type: 'paragraph', ...(line === '' ? {} : { content: [{ type: 'text', text: line }] }) })),
  };
}

/**
 * What a paste of `item` needs besides the clipboard's deps.
 *
 * @public
 */
export type SystemPasteDeps = PasteDeps & {
  /** Where the bytes of a pasted image are held. */
  readonly assets: AssetStore;
};

/**
 * Write `item` onto the deps' screen, centred at `centre`, as one undo step; the new element's id, or undefined when
 * nothing was written (no screen, or the document refused it).
 *
 * @public
 */
export function pasteSystemItem(deps: SystemPasteDeps, item: SystemItem, centre: Vec2): RecordId | undefined {
  const { view, execute, screen } = deps;
  const index = screen === undefined ? undefined : frontIndex(view, screen);
  if (screen === undefined || index === undefined) return undefined;
  const id = deps.newId();
  const mergeKey = `paste:${id}`;
  const base = { id, type: 'element', screenId: screen, index } as const;
  const place = (w: number, h: number) => ({ x: Math.round(centre.x - w / 2), y: Math.round(centre.y - h / 2), w, h });
  if (item.type === 'text') {
    const h = Math.max(40, item.text.split(/\r\n|\r|\n/).length * LINE + 16);
    const made = execute(
      'element.create',
      { element: { ...base, kind: 'text', transform: place(PASTE_TEXT_WIDTH, h), text: paragraphs(item.text) } },
      { mergeKey },
    );
    deps.seal();
    return made.ok ? id : undefined;
  }
  // the document's own asset with these bytes is used again; else the asset is made beside the element
  const held = view.members('byType', 'asset').find((a) => (view.get(a) as AssetRecord).hash === item.hash);
  const assetId = held ?? deps.newId();
  if (held === undefined) {
    const asset: AssetRecord = {
      id: assetId,
      type: 'asset',
      hash: item.hash,
      mime: item.mime,
      size: item.size,
      name: item.name,
      ...(item.w !== undefined && item.h !== undefined && { w: item.w, h: item.h }),
    };
    if (!execute('asset.create', { asset }, { mergeKey }).ok) {
      deps.seal();
      return undefined;
    }
    deps.assets.set(assetId, item.dataUrl);
  }
  const size = fitImage(item.w, item.h);
  const made = execute('element.create', { element: { ...base, kind: 'image', assetId, transform: place(size.w, size.h) } }, { mergeKey });
  deps.seal();
  return made.ok ? id : undefined;
}
