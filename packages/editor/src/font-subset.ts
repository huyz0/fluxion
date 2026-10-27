// Used-glyph subsetting of a document's embedded fonts (FR-AST-003, ADR-0051, M18.39): the glyph inventory of
// everything the document can render, pinned engine instantiation (fresh per font, as a disposable worker would
// be) and a cached per-asset plan. Saving with it is M18.40; the live document's font bytes are never replaced here.
import { artworkFontLicenses } from '@fluxion/core';
import {
  type FontEngines,
  type FontSubsetInput,
  type FontSubsetOutcome,
  fontSubsetCacheKey,
  type HarfBuzzSubsetExports,
  subsetFont,
  type Woff2CodecExports,
} from '@fluxion/format';
import type { AssetRecord, DocumentFile, RecordId } from '@fluxion/schema';

/** SHA-256 of the pinned engine modules (packages/editor/assets/font-engine/manifest.json); other bytes are refused. @public */
export const FONT_ENGINE_HASHES = {
  /** `harfbuzz-subset.wasm`. */
  harfbuzz: '62415fe6bad92ef16f3e5d2dbed6c66a4adec7f5a59c6d27084811c92cce1ba5',
  /** `woff2-codec.wasm`. */
  codec: '3829e158c6a14f186b7514dd6bcdf195c5dfd0f9c57e7082e9850e642067cb6f',
} as const;

/** The document's text inventory, or why its fonts must stay whole. @public */
export type GlyphInventory =
  | {
      /** Every Unicode scalar the document can render with a document font, sorted and unique. */
      readonly status: 'complete';
      /** The scalars, ascending. */
      readonly codepoints: readonly number[];
    }
  | {
      /** Some rendered text is not known in advance (a custom renderer, an unbounded generated value). */
      readonly status: 'unbounded';
      /** What makes it unbounded. */
      readonly reason: string;
    };

type Json = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const field = (o: Json, key: string): unknown => o[key];
const MAX_DEPTH = 64;
const DIGITS = '0123456789';
/** Element kinds whose text is all in their records; anything else may draw text this walk cannot see. */
const KNOWN_KINDS = new Set(['shape', 'connector', 'group', 'frame', 'text', 'image']);

/**
 * List markers the browser draws in the element's font: disc, circle and square bullets by nesting depth, and
 * ordered numbers (any digits, a sign for a negative start, the period and the space after it).
 */
const LIST_MARKERS: { readonly [type: string]: string } = { bulletList: '\u2022\u25e6\u25aa ', orderedList: `${DIGITS}-. ` };

type Walk = { readonly chars: Set<number>; readonly fields: Set<string>; unbounded?: string };
/** A lone surrogate is drawn as U+FFFD, so that is what it adds. */
const addScalars = (walk: Walk, text: string): void => {
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    walk.chars.add(cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp);
  }
};
/**
 * The text's scalars and those of its composed and decomposed forms: shapers compose a base and mark into a
 * precomposed glyph the font has (and decompose one it lacks), so both forms must survive. The string is not changed.
 */
const addText = (walk: Walk, text: string): void => {
  addScalars(walk, text);
  addScalars(walk, text.normalize('NFC'));
  addScalars(walk, text.normalize('NFD'));
};

/** One rich-text node's own contribution: a text node's string, or a field node's name. */
function visit(walk: Walk, node: Json): void {
  const type = field(node, 'type');
  const marker = typeof type === 'string' && Object.hasOwn(LIST_MARKERS, type) ? LIST_MARKERS[type] : undefined;
  if (marker !== undefined) addText(walk, marker);
  const text = field(node, 'text');
  const attrs = field(node, 'attrs');
  if (type === 'text' && typeof text === 'string') addText(walk, text);
  if (type === 'field' && isObject(attrs)) walk.fields.add(String(field(attrs, 'name')));
}

/** Rich-text text nodes and fields at any depth of one record (labels, notes and nested content included). */
function collect(walk: Walk, value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) {
    walk.unbounded ??= 'record nesting exceeds the inventory walk';
    return;
  }
  const children = Array.isArray(value) ? value : isObject(value) ? Object.values(value) : [];
  if (isObject(value)) visit(walk, value);
  for (const child of children) collect(walk, child, depth + 1);
}

const ofType = (records: readonly Json[], type: string): readonly Json[] => records.filter((r) => field(r, 'type') === type);
const named = (records: readonly Json[], type: string, key: string): string[] => ofType(records, type).map((r) => String(field(r, key) ?? ''));
/** Generated fields with a complete, finite set of values; `date` and unknown fields have none. */
const FIELD_VALUES: { readonly [name: string]: (records: readonly Json[]) => readonly string[] } = {
  page: () => [DIGITS],
  pageCount: () => [DIGITS],
  screenName: (records) => named(records, 'screen', 'name'),
  title: (records) => named(records, 'document', 'title'),
};

/** Every field's possible values; today's renderer also draws a field literally as {{name}}, so that is kept too. */
function fieldValues(walk: Walk, records: readonly Json[]): void {
  for (const name of walk.fields) {
    addText(walk, `{{${name}}}`);
    const values = Object.hasOwn(FIELD_VALUES, name) ? FIELD_VALUES[name] : undefined;
    if (values) for (const text of values(records)) addText(walk, text);
    else walk.unbounded ??= `the ${name} field has no finite set of values`;
  }
}

/**
 * Every Unicode scalar the document's screens can render with a document font: rich text in elements, connector
 * labels and notes, and the finite values of generated fields. The strings are read, never normalized. A custom
 * renderer (a component or unknown element kind) or an unbounded field makes the inventory `unbounded`.
 * @public
 */
export function glyphInventory(doc: DocumentFile): GlyphInventory {
  const records = Object.values(doc.records) as readonly Json[];
  const walk: Walk = { chars: new Set(), fields: new Set() };
  for (const record of records) {
    const type = field(record, 'type');
    if (type === 'element' && !KNOWN_KINDS.has(String(field(record, 'kind'))))
      return { status: 'unbounded', reason: `a ${String(field(record, 'kind'))} element may render text of its own` };
    if (type === 'element' || type === 'screen') collect(walk, record);
  }
  fieldValues(walk, records);
  if (walk.unbounded) return { status: 'unbounded', reason: walk.unbounded };
  return { status: 'complete', codepoints: [...walk.chars].sort((a, b) => a - b) };
}

/** The pinned modules' bytes, as the host loaded them (worker asset fetch, CLI file read). @public */
export type FontEngineModules = {
  /** Bytes of `harfbuzz-subset.wasm`. */
  readonly harfbuzz: Uint8Array;
  /** Bytes of `woff2-codec.wasm`. */
  readonly codec: Uint8Array;
};

/** Host hooks the engines import: none for HarfBuzz; memory-growth notice and exit for the codec. */
class EngineExit extends Error {}
const CODEC_IMPORTS = {
  env: { emscripten_notify_memory_growth: () => undefined },
  wasi_snapshot_preview1: {
    proc_exit: (code: number) => {
      throw new EngineExit(`font codec exited with ${code}`);
    },
  },
};

/**
 * Fresh engine instances from pinned module bytes; bytes whose hash is not pinned are refused, so a user font can
 * never be loaded as a module. Call once per font job and drop the result afterwards.
 * @public
 */
export async function instantiateFontEngines(modules: FontEngineModules, sha256: (bytes: Uint8Array) => Promise<string>): Promise<FontEngines> {
  const [hb, codec] = await Promise.all([sha256(modules.harfbuzz), sha256(modules.codec)]);
  if (hb !== FONT_ENGINE_HASHES.harfbuzz || codec !== FONT_ENGINE_HASHES.codec) throw new Error('font engine modules do not match the pinned hashes');
  const [harfbuzz, woff2] = await Promise.all([
    WebAssembly.instantiate(modules.harfbuzz.slice(), {}),
    WebAssembly.instantiate(modules.codec.slice(), CODEC_IMPORTS),
  ]);
  // both are WASI reactors: their constructors run once, before any other call
  const hbExports = harfbuzz.instance.exports as unknown as HarfBuzzSubsetExports & { _initialize(): void };
  const codecExports = woff2.instance.exports as unknown as Woff2CodecExports & { _initialize(): void };
  hbExports._initialize();
  codecExports._initialize();
  return { harfbuzz: hbExports, codec: codecExports, identity: { harfbuzz: hb, codec } };
}

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
  /** Fresh, pinned engines for one font job. */
  readonly engines: () => Promise<FontEngines>;
  /** Lower-case hex SHA-256. */
  readonly sha256: (bytes: Uint8Array) => Promise<string>;
  /** Outcomes by cache key, kept across saves by the host. */
  readonly cache?: Map<string, FontSubsetOutcome>;
};

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
    // only a catalog font with an allowed licence is a verified source; an upload's licence is its user's label
    verifiedSource: meta.source === 'google' && typeof meta.license === 'string' && artworkFontLicenses.includes(meta.license),
    ...(meta.metrics === undefined ? {} : { metrics: meta.metrics }),
  };
}

/** One font job on engines of its own; engines that fail to instantiate lose this font's subset only. */
async function subsetWithFreshEngines(input: FontSubsetInput, deps: FontSubsetDeps): Promise<FontSubsetOutcome> {
  const engines = await deps.engines().catch(() => undefined);
  const pinned = engines?.identity.harfbuzz === FONT_ENGINE_HASHES.harfbuzz && engines.identity.codec === FONT_ENGINE_HASHES.codec;
  if (!engines || !pinned) return { status: 'kept', reason: 'engine-failure', message: 'the pinned font engines could not be instantiated' };
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
