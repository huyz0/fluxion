/**
 * `@fluxion/format` — .flux zip, .flux.html and .flux.json read/write, content-addressed asset store, sanitizers, lockfile.
 *
 * @packageDocumentation
 */

export { type AssetStore, createMemoryAssetStore, referencedAssetHashes, type SelectedAssets, selectAssets } from './asset-store.js';
export type { Salvage } from './document-open.js';
export type { FormatError, FormatErrorCode, LoadNote, LoadNoteCode } from './errors.js';
export { FLUX_HTML_BOOT, FLUX_HTML_MARKER_COMMENT, FLUX_HTML_MARKER_META, type WriteFluxHtmlInput, writeFluxHtml } from './flux-html.js';
export { readFluxHtml } from './flux-html-reader.js';
export {
  type ContentHasher,
  FLUX_FORMAT_VERSION,
  FLUX_MIMETYPE,
  type FluxAsset,
  type FluxBakes,
  type FluxWriteFailure,
  type WriteFluxInput,
  writeFlux,
} from './flux-writer.js';
export {
  type EncodedImage,
  type ImageCodec,
  type ImageImportCode,
  type ImageImportFailure,
  type ImportedImage,
  importImage,
  MAX_IMAGE_SIDE,
  MAX_IMPORT_BYTES,
  type PixelSize,
  scaleToFit,
} from './image-import.js';
export { type ImageInfo, type ImageMime, sniffImage } from './image-sniff.js';
export { type LoadedFlux, type LoadedManifest, type LoadOptions, loadFlux } from './loader.js';
export { minifySvg } from './minify-svg.js';
export { safeLinkUrl } from './safe-url.js';
export { type AssetCheck, checkAsset, sanitizeAsset } from './sanitize-asset.js';
export { inspectSvg, MAX_SVG_CHARS, type SvgInspection, sanitizeSvg } from './sanitize-svg.js';
export { sha256Hex } from './sha256.js';
export { readZip, writeZip, type ZipEntry, type ZipFailure, type ZipInput, type ZipLimits, type ZipMethod } from './zip.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
