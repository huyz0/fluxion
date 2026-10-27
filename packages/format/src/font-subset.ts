// Used-glyph font subsetting over the pinned engines (ADR-0051, M18.39): HarfBuzz's subset C ABI and the standalone
// WOFF2 codec, both supplied by the host as instantiated exports. This module owns the ABI: every allocation is
// checked and freed, every size is bounded before allocation, and anything it cannot subset safely keeps the
// original bytes with a typed reason. Pure: no fetch, filesystem, clock, DOM, timers or module loading.
import { canonicalJson } from './canonical-json.js';
import type { ContentHasher } from './flux-write-types.js';
import { encodeUtf8 } from './utf8.js';

/** Linear memory as the adapter reads it. @public */
export type EngineMemory = {
  /** The current backing buffer; re-read after every call that may grow memory. */
  readonly buffer: ArrayBuffer;
};

/** The HarfBuzz subset-only module's exports this adapter calls (harfbuzzjs 1.6.4 `harfbuzz-subset.wasm`). @public */
export type HarfBuzzSubsetExports = {
  /** The module's linear memory. */
  readonly memory: EngineMemory;
  /** Allocate `size` bytes; 0 on failure. */
  malloc(size: number): number;
  /** Free an allocation of `malloc`. */
  free(pointer: number): void;
  /** Wrap bytes already in engine memory as a blob. */
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  /** Release a blob reference. */
  hb_blob_destroy(blob: number): void;
  /** Pointer to a blob's bytes. */
  hb_blob_get_data(blob: number, length: number): number;
  /** A blob's length in bytes. */
  hb_blob_get_length(blob: number): number;
  /** The face at `index` of a blob. */
  hb_face_create(blob: number, index: number): number;
  /** Release a face reference. */
  hb_face_destroy(face: number): void;
  /** The serialized bytes of a face. */
  hb_face_reference_blob(face: number): number;
  /** Add a value to a set. */
  hb_set_add(set: number, codepoint: number): void;
  /** Empty a set. */
  hb_set_clear(set: number): void;
  /** Complement a set; an emptied set becomes "everything". */
  hb_set_invert(set: number): void;
  /** A new subset input; 0 on failure. */
  hb_subset_input_create_or_fail(): number;
  /** Release a subset input. */
  hb_subset_input_destroy(input: number): void;
  /** One of the input's retain sets (`hb_subset_sets_t`). */
  hb_subset_input_set(input: number, which: number): number;
  /** The input's `hb_subset_flags_t`. */
  hb_subset_input_get_flags(input: number): number;
  /** Replace the input's `hb_subset_flags_t`. */
  hb_subset_input_set_flags(input: number, flags: number): void;
  /** The set of Unicode values to keep. */
  hb_subset_input_unicode_set(input: number): number;
  /** The subset face; 0 on failure. */
  hb_subset_or_fail(face: number, input: number): number;
};

/** The standalone WOFF2 codec's exports (`woff2-codec.wasm`, M18.48); every call zeroes its destination first. @public */
export type Woff2CodecExports = {
  /** The codec's linear memory. */
  readonly memory: EngineMemory;
  /** Allocate `size` bytes; 0 on failure. */
  codec_alloc(size: number): number;
  /** Free an allocation of `codec_alloc`. */
  codec_free(pointer: number): void;
  /** Upper bound of the WOFF2 encoding of an SFNT. */
  woff2_max_encoded(data: number, length: number): number;
  /** Encode an SFNT as WOFF2 into `out`; the size written, 0 on failure. */
  woff2_encode(data: number, length: number, out: number, capacity: number): number;
  /** The SFNT size a WOFF2 header declares; 0 when malformed. */
  woff2_final_size(data: number, length: number): number;
  /** Decode WOFF2 into `out`; the size written, 0 on failure. */
  woff2_decode(data: number, length: number, out: number, capacity: number): number;
};

/** Freshly instantiated engines for one font job, and the pinned hashes of the modules they came from. @public */
export type FontEngines = {
  /** The HarfBuzz subset module. */
  readonly harfbuzz: HarfBuzzSubsetExports;
  /** The WOFF2 codec module. */
  readonly codec: Woff2CodecExports;
  /** The modules' hashes; part of every cache key. */
  readonly identity: {
    /** SHA-256 of the HarfBuzz module. */
    readonly harfbuzz: string;
    /** SHA-256 of the codec module. */
    readonly codec: string;
  };
};

/** One embedded face and the text it must still render. @public */
export type FontSubsetInput = {
  /** Original WOFF2, TTF or OTF bytes; never modified. */
  readonly bytes: Uint8Array;
  /** SHA-256 of `bytes`, as the asset records it. */
  readonly sourceSha256: string;
  /** Face weight, as the asset records it. */
  readonly weight: number;
  /** Face style, as the asset records it. */
  readonly style: string;
  /** Unicode scalar values to keep; order and duplicates do not matter. */
  readonly codepoints: readonly number[];
  /** Recorded license and copyright text; a Reserved Font Name there or in the font keeps it whole. */
  readonly rights?: string;
  /**
   * The host verified where the font came from and its licence (a catalog font with a recorded allowed licence).
   * An unverified font, such as an upload labelled only by its user, is kept whole.
   */
  readonly verifiedSource?: boolean;
  /** Explicit, recorded permission to modify this font: it overrides an unverified source and a Reserved Font Name. */
  readonly modificationPermission?: boolean;
  /** Recorded metrics of the face, part of the layout fingerprint. */
  readonly metrics?: unknown;
};

/** Why a font keeps its original bytes. @public */
export type FontKeptReason =
  | 'reserved-font-name'
  | 'unverified-source'
  | 'variable-font'
  | 'font-collection'
  | 'unsupported-format'
  | 'malformed'
  | 'too-large'
  | 'not-smaller'
  | 'unbounded-text'
  | 'engine-failure';

/** A successful subset, or the original kept with a reason; a kept font is never reported as subset. @public */
export type FontSubsetOutcome =
  | {
      /** Subset and validated. */
      readonly status: 'subset';
      /** Validated WOFF2 bytes. */
      readonly woff2: Uint8Array;
      /** SHA-256 of `woff2`: the asset integrity hash. */
      readonly sha256: string;
      /** Identity of every input that determines the bytes. */
      readonly cacheKey: string;
      /** Layout identity: cache key, output hash and recorded metrics. */
      readonly fingerprint: string;
    }
  | {
      /** The original bytes stay. */
      readonly status: 'kept';
      /** Why. */
      readonly reason: FontKeptReason;
      /** Actionable explanation. */
      readonly message: string;
    };

/** Adapter policy version; changing what is retained changes it and so every cache key. @public */
export const FONT_SUBSET_POLICY = 'fluxion-font-subset/1 features=all scripts=all names=all+legacy hinting=kept';

/** The existing upload limit, applied to source, decoded SFNT, subset and encoded output alike. */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_CODEPOINTS = 0x110000;
const HB_MEMORY_MODE_READONLY = 1;
/** hb_subset_sets_t: name IDs, name languages, layout features and scripts are all retained (sets inverted to "everything"). */
const RETAIN_ALL_SETS = [4, 5, 6, 7];
/** HB_SUBSET_FLAGS_NAME_LEGACY: keep the non-Unicode (Macintosh) name records too, so every name record survives. */
const HB_SUBSET_FLAGS_NAME_LEGACY = 0x8;

type Kept = Extract<FontSubsetOutcome, { status: 'kept' }>;
const kept = (reason: FontKeptReason, message: string): Kept => ({ status: 'kept', reason, message });
class Refusal extends Error {
  readonly outcome: Kept;
  constructor(outcome: Kept) {
    super(outcome.message);
    this.outcome = outcome;
  }
}
const refuse = (reason: FontKeptReason, message: string): never => {
  throw new Refusal(kept(reason, message));
};
/** wasm32 `size_t` results reach JavaScript as signed numbers; read them unsigned. */
const unsigned = (n: number): number => n >>> 0;

const tagAt = (bytes: Uint8Array, at: number): string => String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
const u16 = (view: DataView, at: number): number => view.getUint16(at);
const u32 = (view: DataView, at: number): number => view.getUint32(at);

/** The table directory of an SFNT, every range inside the bytes; undefined when malformed. */
function tablesOf(sfnt: Uint8Array): Map<string, { offset: number; length: number }> | undefined {
  if (sfnt.length < 12) return undefined;
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const count = u16(view, 4);
  if (count === 0 || count > 256 || 12 + count * 16 > sfnt.length) return undefined;
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const offset = u32(view, at + 8);
    const length = u32(view, at + 12);
    if (offset + length > sfnt.length) return undefined;
    tables.set(tagAt(sfnt, at), { offset, length });
  }
  return tables;
}

/** One name record's string: UTF-16BE for Unicode and Windows platforms, bytes as Latin-1 otherwise. */
function recordText(raw: Uint8Array, platform: number): string {
  if (platform !== 0 && platform !== 3) return String.fromCharCode(...raw);
  let s = '';
  for (let k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode((raw[k] ?? 0) * 256 + (raw[k + 1] ?? 0));
  return s;
}

/** Text of the `name` table's records, every range bounded by the table itself. */
function nameText(sfnt: Uint8Array, table: { offset: number; length: number } | undefined): string {
  if (!table || table.length < 6) return '';
  const view = new DataView(sfnt.buffer, sfnt.byteOffset + table.offset, table.length);
  const count = u16(view, 2);
  const strings = u16(view, 4);
  const parts: string[] = [];
  for (let i = 0; i < count && 6 + i * 12 + 12 <= table.length; i++) {
    const at = 6 + i * 12;
    const length = u16(view, at + 8);
    const start = strings + u16(view, at + 10);
    if (start + length <= table.length) parts.push(recordText(sfnt.subarray(table.offset + start, table.offset + start + length), u16(view, at)));
  }
  return parts.join('\n');
}

/**
 * A Reserved Font Name declaration: "..., with Reserved Font Name 'Source'.", "Reserved Font Names: Foo, Bar" or
 * "Reserved Font Name "Foo"" after a comma or at a line start. The OFL body's definitions ('"Reserved Font Name"
 * refers to', 'may use the Reserved Font Name(s)') and the template's "<Reserved Font Name>" do not reserve a name.
 */
const RESERVED_NAME = /(?:(?:with|,|^)\s*(?:the\s+)?reserved\s+font\s+names?\s*:?|reserved\s+font\s+names?\s*:)\s*(?!<)["'\u2018\u201c]?[\p{L}\p{N}]/imu;

/** Refuse what this adapter does not subset: collections, WOFF1, unknown formats, variable fonts, malformed tables, RFN. */
function checkSfnt(sfnt: Uint8Array, input: FontSubsetInput): void {
  const tables = tablesOf(sfnt) ?? refuse('malformed', 'the font table directory is malformed');
  if (tables.has('fvar')) refuse('variable-font', 'variable fonts are kept whole (instancing is not supported)');
  if (!tables.has('cmap')) refuse('malformed', 'the font has no cmap table');
  if (input.modificationPermission) return;
  if (!input.verifiedSource) refuse('unverified-source', 'the font source and licence are not verified; record permission to modify it to subset it');
  if (RESERVED_NAME.test(nameText(sfnt, tables.get('name'))) || RESERVED_NAME.test(input.rights ?? ''))
    refuse('reserved-font-name', 'the font declares a Reserved Font Name; a subset is a modified version, so it is kept whole');
}

/** Copy `bytes` into engine memory through `alloc`; refuses a failed allocation. */
function copyIn(memory: EngineMemory, alloc: (n: number) => number, bytes: Uint8Array): number {
  const at = alloc(bytes.length);
  if (!at) refuse('engine-failure', 'the engine could not allocate its input');
  new Uint8Array(memory.buffer, at, bytes.length).set(bytes);
  return at;
}

/** WOFF2 to SFNT with the declared size bounded before allocation and the result bounded by the destination. */
function decodeWoff2(codec: Woff2CodecExports, woff2: Uint8Array): Uint8Array {
  const input = copyIn(codec.memory, (n) => codec.codec_alloc(n), woff2);
  try {
    const declared = unsigned(codec.woff2_final_size(input, woff2.length));
    if (declared === 0) refuse('malformed', 'the WOFF2 header is malformed');
    if (declared > MAX_BYTES) refuse('too-large', 'the decoded font would exceed 5 MiB');
    const out = codec.codec_alloc(declared);
    if (!out) refuse('engine-failure', 'the codec could not allocate the decoded font');
    try {
      const size = unsigned(codec.woff2_decode(input, woff2.length, out, declared));
      if (size === 0) refuse('malformed', 'the WOFF2 data does not decode');
      return new Uint8Array(codec.memory.buffer, out, size).slice();
    } finally {
      codec.codec_free(out);
    }
  } finally {
    codec.codec_free(input);
  }
}

/** SFNT to WOFF2 into a bounded, zeroed destination. */
function encodeWoff2(codec: Woff2CodecExports, sfnt: Uint8Array): Uint8Array {
  const input = copyIn(codec.memory, (n) => codec.codec_alloc(n), sfnt);
  try {
    const capacity = Math.min(unsigned(codec.woff2_max_encoded(input, sfnt.length)), MAX_BYTES);
    const out = capacity ? codec.codec_alloc(capacity) : 0;
    if (!out) refuse('engine-failure', 'the codec could not allocate the encoded font');
    try {
      const size = unsigned(codec.woff2_encode(input, sfnt.length, out, capacity));
      if (size === 0) refuse('engine-failure', 'WOFF2 encoding failed');
      return new Uint8Array(codec.memory.buffer, out, size).slice();
    } finally {
      codec.codec_free(out);
    }
  } finally {
    codec.codec_free(input);
  }
}

/** HarfBuzz subset with default shaping and composite closure, keeping every feature, script, name and hinting. */
function subsetSfnt(hb: HarfBuzzSubsetExports, sfnt: Uint8Array, codepoints: readonly number[]): Uint8Array {
  const data = copyIn(hb.memory, (n) => hb.malloc(n), sfnt);
  const blob = hb.hb_blob_create(data, sfnt.length, HB_MEMORY_MODE_READONLY, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  const input = hb.hb_subset_input_create_or_fail();
  try {
    if (!input) refuse('engine-failure', 'HarfBuzz could not create a subset input');
    for (const which of RETAIN_ALL_SETS) {
      const set = hb.hb_subset_input_set(input, which);
      hb.hb_set_clear(set);
      hb.hb_set_invert(set);
    }
    hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input) | HB_SUBSET_FLAGS_NAME_LEGACY);
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const cp of codepoints) hb.hb_set_add(unicodes, cp);
    const result = hb.hb_subset_or_fail(face, input);
    if (!result) refuse('malformed', 'HarfBuzz could not subset the font');
    const out = hb.hb_face_reference_blob(result);
    try {
      const length = unsigned(hb.hb_blob_get_length(out));
      if (length === 0 || length > MAX_BYTES) refuse('engine-failure', 'the subset is empty or exceeds 5 MiB');
      return new Uint8Array(hb.memory.buffer, unsigned(hb.hb_blob_get_data(out, 0)), length).slice();
    } finally {
      hb.hb_blob_destroy(out);
      hb.hb_face_destroy(result);
    }
  } finally {
    if (input) hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.hb_blob_destroy(blob);
    hb.free(data);
  }
}

/** Sorted unique scalar values; refuses anything that is not one. */
function inventoryOf(codepoints: readonly number[]): number[] {
  const unique = [...new Set(codepoints)].sort((a, b) => a - b);
  if (unique.length > MAX_CODEPOINTS || unique.some((cp) => !Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)))
    refuse('malformed', 'the inventory contains a value that is not a Unicode scalar');
  return unique;
}

const hashOf = async (hasher: ContentHasher, value: unknown): Promise<string> => hasher.sha256(encodeUtf8(canonicalJson(value)));

/**
 * The cache key of a subset: source bytes, face, style, axes, the exact inventory, rights, verification and permission, both engine
 * hashes and the adapter policy. Display family names are deliberately not part of it.
 * @public
 */
export async function fontSubsetCacheKey(input: FontSubsetInput, engines: Pick<FontEngines, 'identity'>, hasher: ContentHasher): Promise<string> {
  return hashOf(hasher, {
    policy: FONT_SUBSET_POLICY,
    source: input.sourceSha256,
    faceIndex: 0,
    weight: input.weight,
    style: input.style,
    axes: [],
    codepoints: inventoryOf(input.codepoints),
    // the retention decision: recorded rights, source verification and permission decide subset or keep
    rights: input.rights ?? '',
    verifiedSource: input.verifiedSource === true,
    modificationPermission: input.modificationPermission === true,
    harfbuzz: engines.identity.harfbuzz,
    codec: engines.identity.codec,
  });
}

/** The SFNT inside `bytes`: WOFF2 decoded within bounds, TTF/OTF as is; other containers are refused. */
function sfntOf(codec: Woff2CodecExports, bytes: Uint8Array): Uint8Array {
  const magic = tagAt(bytes, 0);
  if (magic === 'wOF2') return decodeWoff2(codec, bytes);
  if (magic === 'ttcf') return refuse('font-collection', 'font collections are kept whole');
  if (magic === 'wOFF') return refuse('unsupported-format', 'WOFF 1.0 fonts are kept whole');
  if (magic === 'OTTO' || magic === 'true' || magic === '\u0000\u0001\u0000\u0000') return bytes;
  return refuse('unsupported-format', 'not a WOFF2, TrueType or OpenType font');
}

/**
 * Subset one face to `codepoints` (plus HarfBuzz's layout and composite closure) and encode it as WOFF2. The output
 * is decoded again before it counts; a result that is not smaller than the original keeps the original. Never
 * throws for font content: every refusal is a `kept` outcome with a reason.
 * @public
 */
export async function subsetFont(input: FontSubsetInput, engines: FontEngines, hasher: ContentHasher): Promise<FontSubsetOutcome> {
  try {
    if (input.bytes.length > MAX_BYTES) refuse('too-large', 'the font exceeds the 5 MiB upload limit');
    const cacheKey = await fontSubsetCacheKey(input, engines, hasher);
    const sfnt = sfntOf(engines.codec, input.bytes);
    checkSfnt(sfnt, input);
    const subset = subsetSfnt(engines.harfbuzz, sfnt, inventoryOf(input.codepoints));
    const woff2 = encodeWoff2(engines.codec, subset);
    decodeWoff2(engines.codec, woff2);
    if (woff2.length >= input.bytes.length) refuse('not-smaller', `the subset (${woff2.length} bytes) is not smaller than the original`);
    const sha256 = await hasher.sha256(woff2.slice());
    const fingerprint = await hashOf(hasher, { cacheKey, output: sha256, metrics: input.metrics ?? null });
    return { status: 'subset', woff2, sha256, cacheKey, fingerprint };
  } catch (e) {
    if (e instanceof Refusal) return e.outcome;
    // an engine trap (unreachable, out of memory) loses this font's subset only; the host discards the instance
    return kept('engine-failure', `the font engine failed: ${e instanceof Error ? e.name : 'error'}`);
  }
}
