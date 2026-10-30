/**
 * `@fluxion/format` — .flux zip, .flux.html and .flux.json read/write, content-addressed asset store, sanitizers, lockfile.
 *
 * @packageDocumentation
 */

export { type AssetStore, createMemoryAssetStore, referencedAssetHashes, type SelectedAssets, selectAssets, usedAssetIds } from './asset-store.js';
export { type OpenedDocument, openDocumentText, type Salvage } from './document-open.js';
export {
  type EmbedFailure,
  type EmbedFailureCode,
  type EmbedInput,
  type EmbedResult,
  embedExternalAssets,
  UNPINNED_HASH,
} from './embed-external.js';
export type { FormatError, FormatErrorCode, LoadNote, LoadNoteCode } from './errors.js';
export { FLUX_HTML_BOOT, FLUX_HTML_MARKER_COMMENT, FLUX_HTML_MARKER_META, type WriteFluxHtmlInput, writeFluxHtml } from './flux-html.js';
export { readFluxHtml } from './flux-html-reader.js';
export {
  type FluxJsonFailure,
  type FluxJsonFile,
  type FluxJsonOutput,
  type ReadFluxJson,
  readFluxJson,
  type WriteFluxJsonInput,
  writeFluxJson,
} from './flux-json.js';
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
export {
  type DiffLike,
  type DiffPut,
  type EntryRead,
  type EntryRefused,
  encodeDiff,
  JOURNAL_MAX_BYTES,
  JOURNAL_MAX_ENTRIES,
  type JournalEntry,
  type JournalPut,
  needsCompaction,
  type Replayed,
  type ReplayPoint,
  type ReplayStop,
  readEntry,
  replay,
  serializeEntry,
} from './journal.js';
export { type LoadedFlux, type LoadedManifest, type LoadOptions, loadFlux } from './loader.js';
export { minifySvg } from './minify-svg.js';
export {
  type PortableFluxHtmlOutput,
  type PortableFluxOutput,
  type WritePortableFluxHtmlInput,
  type WritePortableFluxInput,
  writePortableFlux,
  writePortableFluxHtml,
} from './portable-writer.js';
export { safeLinkUrl } from './safe-url.js';
export { type AssetCheck, checkAsset, sanitizeAsset } from './sanitize-asset.js';
export { inspectSvg, inspectSvgTree, MAX_SVG_CHARS, type SvgInspection, type SvgTreeInspection, sanitizeSvg } from './sanitize-svg.js';
export { sha256Hex } from './sha256.js';
export {
  type PreparedShapePacks,
  type PrepareShapePacksOptions,
  prepareUsedShapePacks,
  type ShapePackDataLock,
  type ShapePackSourceData,
  shapePackSubsetOf,
} from './shape-pack-prepare.js';
export { usedFontFamilies } from './used-fonts.js';
export { readZip, writeZip, type ZipEntry, type ZipFailure, type ZipInput, type ZipLimits, type ZipMethod } from './zip.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

export {
  type DrawioEntryOutcome,
  type DrawioImportOptions,
  type DrawioImportReport,
  type DrawioProcessedReport,
  importDrawioLibrary,
} from './drawio-import.js';
export { FONT_ENGINE_HASHES, type FontEngineModules, type FontEnginePorts, instantiateFontEngines, type WasmInstantiate } from './font-engines.js';
export { type GlyphInventory, glyphInventory } from './font-inventory.js';
export {
  type EngineMemory,
  FONT_SUBSET_POLICY,
  type FontEngines,
  type FontKeptReason,
  type FontSubsetInput,
  type FontSubsetOutcome,
  fontSubsetCacheKey,
  type HarfBuzzSubsetExports,
  subsetFont,
  type Woff2CodecExports,
} from './font-subset.js';
export {
  FONT_SUBSET_JOB_TIMEOUT_MS,
  type FontJobScope,
  type FontJobWorker,
  type JobTimers,
  runFontSubsetJob,
  serveFontSubsetJob,
} from './font-subset-job.js';
export { type EmbeddedFont, type FontSubsetDeps, type FontSubsetPlan, planFontSubsets } from './font-subset-plan.js';
export {
  type FontSubsetIdentity,
  type FontSubsetLine,
  type SubsetAsset,
  type SubsetFontGap,
  type SubsetSave,
  subsetFontGaps,
  subsetFontsForSave,
  unicodeRangeOf,
  unicodeRangePairs,
} from './font-subset-save.js';
export {
  type IconifyIconOutcome,
  type IconifyImportOptions,
  type IconifyImportReport,
  type IconifyProcessedReport,
  type IconifyProvenance,
  importIconifyCollection,
} from './iconify-import.js';
export {
  type DeclaredImportCredit,
  type DeclaredImportCredits,
  type ImportCreditsProblem,
  type ImportRights,
  parseImportCredits,
  scopedCredits,
  withNotices,
} from './import-credits.js';
export {
  type ImportedPack,
  type ImportedPackEntry,
  type ImportedPackFont,
  type ImportedPackOptions,
  iconifyShapePack,
  importedShapePack,
} from './imported-pack.js';
export { importSvgBatch, type SvgBatchFile, type SvgBatchInput, type SvgBatchOptions, type SvgBatchOutcome, type SvgBatchReport } from './svg-batch.js';
export {
  importSvgShape,
  type SvgImportFont,
  type SvgImportOptions,
  type SvgImportResult,
  type SvgPaintReceipt,
  type SvgPaintRequest,
  type SvgPaintWitness,
} from './svg-import.js';
export { categoryOf, escapes, INPUT_LIMITS, memberIds, type SvgMemberProblem, slugOf, zipMembers } from './svg-pack-members.js';
export { createSvgPaintRequest, parseSvgPaintRequest } from './svg-paint-request.js';
export { SESSION_AGE_MS, SESSION_REQUESTS, type WitnessSessionPort, type WitnessSessions, witnessSessions } from './svg-witness-sessions.js';
