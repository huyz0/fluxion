// The browser's image codec for the import pipeline (FR-AST-002, ADR-0025): a raster is decoded with `createImageBitmap`, drawn at the size
// asked for on a canvas, and encoded as WebP by the canvas. There is no wasm codec in M10: a browser that cannot encode WebP (Safari's canvas
// answers PNG) gives undefined, and the pipeline keeps the original or refuses an image over the limit.
import { type ImageCodec, scaleToFit } from '@fluxion/format';

/** The WebP quality of a re-encode: visually close to the original at a fraction of the bytes. */
const WEBP_QUALITY = 0.85;

/** The canvas the browser offers: off-screen where it exists, else a detached element. */
type Surface = {
  readonly context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  readonly encode: () => Promise<Blob | null>;
};

function surface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    return { context: canvas.getContext('2d'), encode: () => canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY }) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { context: canvas.getContext('2d'), encode: () => new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY)) };
}

/**
 * The image codec of a browser page: decodes with `createImageBitmap`, scales on a canvas, encodes WebP with the canvas. Every failure (an
 * image the browser cannot decode, a browser that cannot encode WebP) is `undefined`, never a throw.
 *
 * @public
 */
export const browserImageCodec: ImageCodec = {
  async toWebp(bytes, mime, maxSide) {
    try {
      const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer], { type: mime }));
      try {
        // the bitmap's own size: `createImageBitmap` has applied the EXIF orientation, so it is the picture as it is shown
        const fitted = scaleToFit(bitmap.width, bitmap.height, maxSide);
        const width = fitted?.width ?? bitmap.width;
        const height = fitted?.height ?? bitmap.height;
        const target = surface(width, height);
        if (target.context === null) return undefined;
        target.context.drawImage(bitmap, 0, 0, width, height);
        const blob = await target.encode();
        // a browser without a WebP encoder answers with PNG: that is not what was asked for
        if (blob === null || blob.type !== 'image/webp') return undefined;
        return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, scaled: fitted !== undefined };
      } finally {
        bitmap.close();
      }
    } catch {
      return undefined;
    }
  },
};
