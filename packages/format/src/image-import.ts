// Importing an image file (FR-AST-001, FR-AST-002, ADR-0025): what the first bytes say it is, an SVG rebuilt from the allowlist and minified,
// a raster larger than 2560 px on a side scaled down to fit, and a raster re-encoded as WebP when that is smaller. Decoding and encoding are
// the host's (a browser canvas; there is no wasm codec in M10), so they come in through `ImageCodec`; this package stays pure. An animated
// image is kept as it is: re-encoding would keep one frame.
import { err, ok, type Result } from '@fluxion/schema';
import { type ImageInfo, type ImageMime, sniffImage } from './image-sniff.js';
import { minifySvg } from './minify-svg.js';
import { inspectSvg } from './sanitize-svg.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

/**
 * The longest side, in pixels, an imported raster keeps; larger images are scaled down to it.
 *
 * @public
 */
export const MAX_IMAGE_SIDE: number = 2560;

/**
 * The most bytes of an image file an import reads.
 *
 * @public
 */
export const MAX_IMPORT_BYTES: number = 64 * 1024 * 1024;

/**
 * An image the codec encoded.
 *
 * @public
 */
export type EncodedImage = {
  /** The WebP bytes. */
  readonly bytes: Uint8Array;
  /** Their pixel width, as the picture is shown (orientation applied). */
  readonly width: number;
  /** Their pixel height, as the picture is shown (orientation applied). */
  readonly height: number;
  /** True when the codec scaled the picture down because its longer side was over the limit it was given. */
  readonly scaled: boolean;
};

/**
 * What the host's image codec does: decode a raster and encode it as WebP, scaled down to a limit when it is larger. The sizes are the
 * decoded picture's own (a header can be wrong, and an EXIF rotation swaps width and height), so the host works them out.
 *
 * @public
 */
export interface ImageCodec {
  /**
   * `bytes` (of media type `mime`) as WebP. When the picture's longer side is over `maxSide` it is scaled down, keeping its proportions, so that
   * the longer side is `maxSide`, and `scaled` is true; a smaller picture keeps its size. Undefined when the host cannot decode the bytes or
   * cannot encode WebP.
   */
  toWebp(bytes: Uint8Array, mime: ImageMime, maxSide: number): Promise<EncodedImage | undefined>;
}

/**
 * Why an image was not imported (add, never rename).
 *
 * @public
 */
export type ImageImportCode = 'IMAGE_NOT_AN_IMAGE' | 'IMAGE_TOO_LARGE' | 'IMAGE_SVG_REFUSED' | 'IMAGE_DECODE_FAILED';

/**
 * An image that could not be imported.
 *
 * @public
 */
export type ImageImportFailure = {
  /** Stable machine-readable code. */
  readonly code: ImageImportCode;
  /** One line for the person. */
  readonly message: string;
};

/**
 * An image ready to become an asset.
 *
 * @public
 */
export type ImportedImage = {
  /** The bytes to store. */
  readonly bytes: Uint8Array;
  /** Their media type: what the bytes are, which can differ from the file's (a JPEG that became WebP). */
  readonly mime: ImageMime;
  /** Pixel width; undefined for an SVG. */
  readonly width?: number;
  /** Pixel height; undefined for an SVG. */
  readonly height?: number;
  /** What was done: nothing, a downscale, a WebP re-encode, or an SVG rebuilt and minified. */
  readonly change: 'none' | 'downscaled' | 'webp' | 'svg';
};

/**
 * A picture size in pixels.
 *
 * @public
 */
export type PixelSize = {
  /** Width in pixels. */
  readonly width: number;
  /** Height in pixels. */
  readonly height: number;
};

/**
 * The size a picture of `width` x `height` is scaled to so that its longer side is `max` (proportions kept, each side at least 1), or
 * undefined when it already fits. For a host that implements `ImageCodec`.
 *
 * @public
 */
export function scaleToFit(width: number, height: number, max: number): PixelSize | undefined {
  const longest = Math.max(width, height);
  if (longest <= max) return undefined;
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** An SVG file: rebuilt from the allowlist, then minified. */
function importSvg(bytes: Uint8Array): Result<ImportedImage, ImageImportFailure> {
  const clean = inspectSvg(decodeUtf8(bytes));
  if (clean === undefined) return err({ code: 'IMAGE_SVG_REFUSED', message: 'the SVG is too large, is not SVG, or has nothing safe to show' });
  return ok({ bytes: encodeUtf8(minifySvg(clean.svg)), mime: 'image/svg+xml', change: 'svg' });
}

/** A raster: scaled and re-encoded through the codec as the rules say. */
async function importRaster(bytes: Uint8Array, info: ImageInfo, codec: ImageCodec, maxSide: number): Promise<Result<ImportedImage, ImageImportFailure>> {
  const sized = info.width === undefined || info.height === undefined ? {} : { width: info.width, height: info.height };
  const headerOver = info.width !== undefined && info.height !== undefined && Math.max(info.width, info.height) > maxSide;
  const encoded = await codec.toWebp(bytes, info.mime, maxSide);
  if (encoded === undefined) {
    // an image the header says is over the limit cannot be imported without scaling; any other is kept as it is
    return headerOver ? err(tooBig()) : ok({ bytes, mime: info.mime, ...sized, change: 'none' });
  }
  if (Math.max(encoded.width, encoded.height) > maxSide) return err(tooBig());
  // a picture the codec did not scale fits already: WebP only when it is smaller
  // (kept as it is, its size is the decoded picture's, which has the orientation applied)
  if (!encoded.scaled && encoded.bytes.length >= bytes.length)
    return ok({ bytes, mime: info.mime, width: encoded.width, height: encoded.height, change: 'none' });
  return ok({ bytes: encoded.bytes, mime: 'image/webp', width: encoded.width, height: encoded.height, change: encoded.scaled ? 'downscaled' : 'webp' });
}

const tooBig = (): ImageImportFailure => ({ code: 'IMAGE_DECODE_FAILED', message: 'the image is larger than the limit and could not be scaled down' });

/**
 * Import the image file `bytes`: the type is read from the bytes. An SVG is rebuilt and minified; an animated image is kept; any other
 * raster is scaled down to `maxSide` (default {@link MAX_IMAGE_SIDE}) when it is larger, and re-encoded as WebP when that is smaller
 * (always when it was scaled). Anything else, or more than {@link MAX_IMPORT_BYTES}, is a failure with a code.
 *
 * @public
 */
export async function importImage(bytes: Uint8Array, codec: ImageCodec, maxSide: number = MAX_IMAGE_SIDE): Promise<Result<ImportedImage, ImageImportFailure>> {
  if (bytes.length > MAX_IMPORT_BYTES) return err({ code: 'IMAGE_TOO_LARGE', message: `the file is larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB` });
  const info = sniffImage(bytes);
  if (info === undefined) return err({ code: 'IMAGE_NOT_AN_IMAGE', message: 'the file is not a PNG, JPEG, WebP, AVIF, GIF or SVG image' });
  if (info.mime === 'image/svg+xml') return importSvg(bytes);
  if (info.animated)
    return ok({
      bytes,
      mime: info.mime,
      ...(info.width === undefined || info.height === undefined ? {} : { width: info.width, height: info.height }),
      change: 'none',
    });
  return importRaster(bytes, info, codec, maxSide);
}
