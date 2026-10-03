// Loading fonts into the page (FR-THM-008, ADR-0022): a face's bytes become a `FontFace` of `document.fonts`, so the content layer
// draws with it, and the shared measurer measures again once it has loaded (its cache is emptied on `loadingdone`, text-measurer.ts).
// The registry of faces is pure (`@fluxion/theme`); loading needs the DOM, so it lives here.

/**
 * A face to load: a family, weight and style, and the URL of its bytes (a bundled file, a blob URL of an asset).
 *
 * @public
 */
export type LoadableFace = {
  /** The family name the content CSS uses. */
  readonly family: string;
  /** CSS weight. */
  readonly weight: number;
  /** CSS style. */
  readonly style: 'normal' | 'italic';
  /** Where the bytes are. */
  readonly url: string;
};

/**
 * Add `faces` to `fonts` (the page's `document.fonts` by default) and resolve when every one has loaded, or reject with the first
 * that failed. A face already in the set is added again as the browser allows (the same bytes draw the same).
 *
 * @public
 */
export async function loadFontFaces(faces: readonly LoadableFace[], fonts: FontFaceSet = document.fonts): Promise<void> {
  const loading = faces.map((face) => {
    const loaded = new FontFace(face.family, `url(${JSON.stringify(face.url)})`, { weight: String(face.weight), style: face.style });
    fonts.add(loaded);
    // a face whose bytes fail is taken out again: no dead entry stays in the set, and a retry adds one fresh
    return loaded.load().catch((error: unknown) => {
      fonts.delete(loaded);
      throw error;
    });
  });
  await Promise.all(loading);
}
