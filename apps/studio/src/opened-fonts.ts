// The fonts a file brings (FR-THM-008, FR-FIL-006, M10.34): a font asset of a document the studio opens is loaded as a face from its own bytes, and
// once it has loaded its recorded metrics are registered, so the page draws and measures the text in it as the file's author saw it. A face that does
// not load is left out (the text falls back), and releasing takes the faces and the records out again when the document is closed.
import { readFontMetrics } from '@fluxion/core';
import { registerFontMetrics } from '@fluxion/editor';
import type { DocumentFile, RecordId } from '@fluxion/schema';

type FontAsset = {
  readonly id: RecordId;
  readonly font: {
    readonly family?: unknown;
    readonly weight?: unknown;
    readonly style?: unknown;
    readonly unicodeRange?: unknown;
    readonly metrics?: unknown;
  };
};

/** The font asset records of `document`. */
function fontAssets(document: DocumentFile): FontAsset[] {
  return Object.values(document.records).flatMap((r) => {
    const font = (r as { font?: FontAsset['font'] }).font;
    return r.type === 'asset' && font !== undefined ? [{ id: r.id, font }] : [];
  });
}

/**
 * Load the font assets of `document` (their bytes are the `data:` URLs in `urls`, by record id) into the page. Resolves when every face has loaded or
 * failed; the way to take exactly these faces and records out again comes back (a bundled face of the same family stays).
 *
 * @public
 */
export async function registerOpenedFonts(
  document: DocumentFile,
  urls: ReadonlyMap<RecordId, string>,
  fonts: FontFaceSet = globalThis.document.fonts,
): Promise<() => void> {
  const added: { readonly id: RecordId; readonly face: FontFace }[] = [];
  const loading: Promise<boolean>[] = [];
  for (const { id, font } of fontAssets(document)) {
    const url = urls.get(id);
    if (url === undefined || typeof font.family !== 'string' || typeof font.weight !== 'number') continue;
    try {
      const face = new FontFace(font.family, `url(${JSON.stringify(url)})`, {
        weight: String(font.weight),
        style: font.style === 'italic' ? 'italic' : 'normal',
        ...(typeof font.unicodeRange === 'string' && { unicodeRange: font.unicodeRange }),
      });
      fonts.add(face);
      added.push({ id, face });
      // a face whose bytes fail is taken out again: no dead entry stays in the set
      loading.push(
        face.load().then(
          () => true,
          () => {
            fonts.delete(face);
            return false;
          },
        ),
      );
    } catch {
      // a family the browser cannot take: the text falls back
    }
  }
  const results = await Promise.all(loading);
  const loaded = new Set(added.filter((_, i) => results[i]).map((a) => a.id));
  // only the metrics of faces that loaded: a table for a face the page does not draw would measure text in a font that is not on screen
  const tables = readFontMetrics({
    faces: fontAssets(document)
      .filter((a) => loaded.has(a.id))
      .map((a) => a.font.metrics),
  }).faces;
  const release = tables.length > 0 ? registerFontMetrics(tables) : undefined;
  return () => {
    release?.();
    for (const { face } of added) fonts.delete(face);
  };
}
