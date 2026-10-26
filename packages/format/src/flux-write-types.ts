import type { ShapePackLicensePolicy } from '@fluxion/core';
import type { DocumentFile } from '@fluxion/schema';
import type { ZipFailure } from './zip.js';

/**
 * Hashes bytes: the lower-case hex SHA-256. The same shape as `Hasher` of `@fluxion/core`, which hosts pass in.
 *
 * @public
 */
export type ContentHasher = {
  /** Lower-case hex SHA-256 of `bytes`. */
  sha256(bytes: Uint8Array): Promise<string>;
};

/**
 * One asset to write: its bytes and the media type its file extension comes from.
 *
 * @public
 */
export type FluxAsset = {
  /** The asset's bytes. */
  readonly bytes: Uint8Array;
  /** The media type (`image/webp`, `font/woff2`, ...): an unknown one is written as `.bin` unless `ext` is given. */
  readonly mime: string;
  /** The file extension to write it under, when it is not the one `mime` implies (a loaded file's own name is kept). */
  readonly ext?: string;
};

/**
 * What derived data a file bakes in (architecture/08 §8).
 *
 * @public
 */
export type FluxBakes = {
  /** Connector routes are cached in the document. */
  readonly routes: boolean;
  /** Static snapshots of plugin and component elements are included. */
  readonly snapshots: boolean;
};

/**
 * What to write.
 *
 * @public
 */
export type WriteFluxInput = {
  /** Required when validating known declarative shape locks; no default content permission. */
  readonly shapePackLicensePolicy?: ShapePackLicensePolicy;
  /** The document. */
  readonly document: DocumentFile;
  /** The assets to write, keyed by the SHA-256 their records carry; a key that is not the bytes' hash is refused. */
  readonly assets?: ReadonlyMap<string, FluxAsset>;
  /** The version of the program writing the file. */
  readonly appVersion: string;
  /** Who made the file, for example `fluxion-mcp 1.2 / <model>`. */
  readonly generator?: string;
  /** The FluxScript the document was compiled from, kept for regeneration. */
  readonly source?: string;
  /** The cover thumbnail, WebP, at most 640 px. */
  readonly preview?: Uint8Array;
  /**
   * Entries this writer does not know (a newer writer's, plugin bundles, snapshots), copied through unchanged and listed in the manifest;
   * the names must not be one this writer writes itself.
   */
  readonly extraEntries?: ReadonlyMap<string, Uint8Array>;
  /** Manifest fields this writer does not know, kept; a field it knows is ignored here (it writes those itself). */
  readonly manifestExtras?: { readonly [key: string]: unknown };
  /** The plugin lock of the manifest (default none); written as given. */
  readonly plugins?: readonly unknown[];
  /** What derived data the file bakes in (default none); written as given. */
  readonly bakes?: FluxBakes;
  /** Hashes entries for the manifest. */
  readonly hasher: ContentHasher;
};

/**
 * Why a document could not be written.
 *
 * @public
 */
export type FluxWriteFailure = ZipFailure;
