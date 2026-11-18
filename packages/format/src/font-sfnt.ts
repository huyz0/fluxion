// The SFNT of a font file for readers other than the subsetter (ADR-0056 item 5): an SVG export's outliner reads faces through the
// pinned WOFF2 codec, so no font's own Brotli path ever runs. Pure: the host lends the codec instance.
import { Refusal, sfntOf, type Woff2CodecExports } from './font-subset.js';

/**
 * The SFNT (TrueType or OpenType tables) of font file `bytes`: a WOFF2 decoded by the pinned codec within the upload limit, a TTF or
 * OTF as is; undefined for a collection, WOFF 1.0, another container or data that does not decode.
 *
 * @public
 */
export function fontSfnt(codec: Woff2CodecExports, bytes: Uint8Array): Uint8Array | undefined {
  try {
    return sfntOf(codec, bytes);
  } catch (e) {
    if (e instanceof Refusal) return undefined;
    throw e;
  }
}
