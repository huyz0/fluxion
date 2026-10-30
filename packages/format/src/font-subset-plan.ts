// The per-font plan of a used-glyph subset (FR-AST-003, ADR-0051, M18.39): each embedded font's subset outcome for the
// document's inventory, one font job at a time with fresh engines (or a disposable worker), cached by cache key.
import { artworkFontLicenses } from '@fluxion/core';
import type { AssetRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { FONT_ENGINE_HASHES } from './font-engines.js';
import { type GlyphInventory, glyphInventory } from './font-inventory.js';
import { type FontEngines, type FontSubsetInput, type FontSubsetOutcome, fontSubsetCacheKey, subsetFont } from './font-subset.js';

type Json = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const field = (o: Json, key: string): unknown => o[key];

/** One embedded font asset and its bytes. @public */
export type EmbeddedFont = {
  /** The font's asset record (face, licence, metrics). */
  readonly asset: AssetRecord;
  /** The original bytes. */
  readonly bytes: Uint8Array;
};

/** What subsetting would do with each font asset of a document. @public */
export type FontSubsetPlan = {
  /** The inventory every face was subset to. */
  readonly inventory: GlyphInventory;
  /** One outcome per font asset, keyed by asset id. */
  readonly fonts: ReadonlyMap<RecordId, FontSubsetOutcome>;
};

/** Dependencies of planning: fresh engines per font, a hasher and an optional cache shared across saves. @public */
export type FontSubsetDeps = {
  /** Fresh, pinned engines for one font job, run on this thread. */
  readonly engines?: () => Promise<FontEngines>;
  /**
   * Runs one font job in isolation instead (a disposable worker with a watchdog, {@link runFontSubsetJob}); a job
   * that fails, traps or times out answers `engine-failure`.
   */
  readonly job?: (input: FontSubsetInput) => Promise<FontSubsetOutcome>;
  /** Lower-case hex SHA-256. */
  readonly sha256: (bytes: Uint8Array) => Promise<string>;
  /** Outcomes by cache key, kept across saves by the host. */
  readonly cache?: Map<string, FontSubsetOutcome>;
};

/** Font sources whose bytes and licence the studio's own catalog vouches for. */
const CATALOG_SOURCES = new Set(['bundled', 'google']);

type FontMeta = {
  readonly weight?: unknown;
  readonly style?: unknown;
  readonly source?: unknown;
  readonly license?: unknown;
  readonly copyright?: unknown;
  readonly metrics?: unknown;
};
function inputOf(font: EmbeddedFont, codepoints: readonly number[]): FontSubsetInput {
  const recorded = field(font.asset as Json, 'font');
  const meta = (isObject(recorded) ? recorded : {}) as FontMeta;
  const rights = [meta.license, meta.copyright].filter((s): s is string => typeof s === 'string').join('\n');
  return {
    bytes: font.bytes,
    sourceSha256: font.asset.hash,
    weight: typeof meta.weight === 'number' ? meta.weight : 400,
    style: typeof meta.style === 'string' ? meta.style : 'normal',
    codepoints,
    rights,
    // only a catalog font (bundled or Google) with an allowed licence is a verified source; an upload's licence is its user's label
    verifiedSource: CATALOG_SOURCES.has(String(meta.source)) && typeof meta.license === 'string' && artworkFontLicenses.includes(meta.license),
    ...(meta.metrics === undefined ? {} : { metrics: meta.metrics }),
  };
}

const engineFailure = (message: string): FontSubsetOutcome => ({ status: 'kept', reason: 'engine-failure', message });

/** One font job on engines of its own; engines that fail to instantiate lose this font's subset only. */
async function subsetWithFreshEngines(input: FontSubsetInput, deps: FontSubsetDeps): Promise<FontSubsetOutcome> {
  if (deps.job) return deps.job(input).catch(() => engineFailure('the font job failed'));
  const engines = await deps.engines?.().catch(() => undefined);
  const pinned = engines?.identity.harfbuzz === FONT_ENGINE_HASHES.harfbuzz && engines.identity.codec === FONT_ENGINE_HASHES.codec;
  if (!engines || !pinned) return engineFailure('the pinned font engines could not be instantiated');
  return subsetFont(input, engines, { sha256: deps.sha256 });
}

/**
 * Plan used-glyph subsets for a document's embedded fonts, one font at a time with fresh engines. An `unbounded`
 * inventory keeps every font whole. Results are cached by cache key, so an unchanged font and inventory is not
 * subset twice and any change of source, inventory, engines or policy misses the cache.
 * @public
 */
export async function planFontSubsets(doc: DocumentFile, fonts: readonly EmbeddedFont[], deps: FontSubsetDeps): Promise<FontSubsetPlan> {
  const inventory = glyphInventory(doc);
  const out = new Map<RecordId, FontSubsetOutcome>();
  for (const font of fonts) {
    if (inventory.status !== 'complete') {
      out.set(font.asset.id, { status: 'kept', reason: 'unbounded-text', message: `kept whole: ${inventory.reason}` });
      continue;
    }
    const input = inputOf(font, inventory.codepoints);
    // the key needs only the pinned identities, so a cache hit instantiates nothing
    const key = await fontSubsetCacheKey(input, { identity: FONT_ENGINE_HASHES }, { sha256: deps.sha256 }).catch(() => undefined);
    const cached = key === undefined ? undefined : deps.cache?.get(key);
    const outcome = cached ?? (await subsetWithFreshEngines(input, deps));
    // an engine failure is transient (memory, a trap, a failed load): it is never cached, so the next save retries
    if (key !== undefined && !cached && !(outcome.status === 'kept' && outcome.reason === 'engine-failure')) deps.cache?.set(key, outcome);
    out.set(font.asset.id, outcome);
  }
  return { inventory, fonts: out };
}
