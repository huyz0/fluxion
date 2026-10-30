// Subset-on-save (FR-AST-003, ADR-0051, M18.40): a candidate copy of the document whose eligible font assets point at
// used-glyph WOFF2 subsets, the subset bytes, and one report line per font. The live document and its original font
// bytes are never changed; a font that is not subset keeps its record and bytes exactly. The host writes the
// candidate, reopens it to validate every replacement, and falls back to the whole-font save otherwise.
import type { AnyRecord, AssetRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { FONT_SUBSET_POLICY, type FontKeptReason } from './font-subset.js';
import { type EmbeddedFont, type FontSubsetDeps, planFontSubsets } from './font-subset-plan.js';

/** What subsetting did with one font asset. @public */
export type FontSubsetLine = {
  /** The asset record's id. */
  readonly asset: RecordId;
  /** The asset's file name. */
  readonly name: string;
  /** Size of the original bytes. */
  readonly before: number;
  /** Size of what the save writes (the original's when kept). */
  readonly after: number;
} & (
  | {
      /** Replaced by a validated subset. */
      readonly status: 'subset';
    }
  | {
      /** Kept whole. */
      readonly status: 'kept';
      /** Why. */
      readonly reason: FontKeptReason;
      /** Actionable explanation. */
      readonly message: string;
    }
);

/** The bytes of one subset font. @public */
export type SubsetAsset = {
  /** The WOFF2 bytes. */
  readonly bytes: Uint8Array;
  /** Always WOFF2. */
  readonly mime: 'font/woff2';
};

/** Characters a subset font no longer covers. @public */
export type SubsetFontGap = {
  /** The font asset record's id. */
  readonly asset: RecordId;
  /** The missing Unicode scalars, in inventory order. */
  readonly missing: readonly number[];
};

/** The candidate a subset save writes. @public */
export type SubsetSave = {
  /** The document with each subset font's asset record replaced; every other record is the same object. */
  readonly document: DocumentFile;
  /** Subset bytes by their SHA-256, to add to the save's asset store. */
  readonly assets: ReadonlyMap<string, SubsetAsset>;
  /** One line per font asset, in record order. */
  readonly report: readonly FontSubsetLine[];
};

/**
 * The record's `font.subset` metadata: where the bytes came from and what they still cover. `source` is the original
 * font's SHA-256 (kept through re-subsetting), `unicodes` the inventory as a CSS unicode-range.
 * @public
 */
export type FontSubsetIdentity = {
  /** SHA-256 of the whole font this subset was cut from. */
  readonly source: string;
  /** Size of that whole font. */
  readonly sourceSize: number;
  /** The adapter policy that cut it. */
  readonly policy: string;
  /** Layout fingerprint of the subset. */
  readonly fingerprint: string;
  /** The Unicode inventory it was cut to, as `U+20-7E,U+E9`. */
  readonly unicodes: string;
};

const isFont = (r: AnyRecord): r is AssetRecord =>
  r.type === 'asset' && String((r as { mime?: unknown }).mime).startsWith('font/') && typeof (r as { font?: unknown }).font === 'object';
const hex = (n: number): string => n.toString(16).toUpperCase();

/** Sorted scalars as a CSS unicode-range: runs collapse to `U+A-B`. @public */
export function unicodeRangeOf(codepoints: readonly number[]): string {
  const sorted = [...new Set(codepoints)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && (sorted[j + 1] as number) === (sorted[j] as number) + 1) j++;
    const [from, to] = [sorted[i] as number, sorted[j] as number];
    parts.push(from === to ? `U+${hex(from)}` : `U+${hex(from)}-${hex(to)}`);
    i = j + 1;
  }
  return parts.join(',');
}

/** The scalars a `U+A-B,U+C` range covers, as [from, to] pairs; anything unparseable yields no pair. @public */
export function unicodeRangePairs(range: string): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (const part of range.split(',')) {
    const m = /^\s*U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?\s*$/i.exec(part);
    if (m) out.push([Number.parseInt(m[1] as string, 16), Number.parseInt((m[2] ?? m[1]) as string, 16)]);
  }
  return out;
}

/** The longest `font.subset.unicodes` read (ADR-0201, M18.203): a range of every scalar as single code points fits in about 15 MB, but no cut this program writes needs more than a few hundred kB; a longer field is unreadable. */
const SUBSET_RANGE_MAX_CHARS = 2_000_000;
/** The scalars of Unicode: a range covering more is not a font's coverage. */
const MAX_SCALARS = 0x110000;

/** A recorded range parsed once into sorted, merged, disjoint [from, to] runs, searched by bisection. */
type RangeIndex = { readonly from: Uint32Array; readonly to: Uint32Array };

/**
 * `range` as a {@link RangeIndex}, or undefined when it cannot be a recorded coverage: longer than
 * {@link SUBSET_RANGE_MAX_CHARS} or covering more than every Unicode scalar. Linear in its length plus a sort of its runs.
 */
function rangeIndex(range: string): RangeIndex | undefined {
  if (range.length > SUBSET_RANGE_MAX_CHARS) return undefined;
  const keys = runKeys(range).sort();
  const from = new Uint32Array(keys.length);
  const to = new Uint32Array(keys.length);
  let n = 0;
  for (const key of keys) {
    const a = Math.floor(key / RUN_KEY);
    const b = key - a * RUN_KEY;
    if (n > 0 && a <= (to[n - 1] as number) + 1) {
      if (b > (to[n - 1] as number)) to[n - 1] = b;
    } else {
      from[n] = a;
      to[n++] = b;
    }
  }
  let covered = 0;
  for (let i = 0; i < n; i++) covered += (to[i] as number) - (from[i] as number) + 1;
  return covered > MAX_SCALARS ? undefined : { from: from.subarray(0, n), to: to.subarray(0, n) };
}

/** A run's sort key: its start above its end, both below 2^24 (six hex digits), so a plain numeric sort orders runs by start. */
const RUN_KEY = 0x1000000;

/** The runs of `range` as {@link RUN_KEY} keys, read as {@link unicodeRangePairs} reads them, without a regular expression per part; a reversed run is dropped. */
function runKeys(range: string): Float64Array {
  let keys = new Float64Array(64);
  let n = 0;
  for (let i = 0; i <= range.length; ) {
    const comma = range.indexOf(',', i);
    const end = comma < 0 ? range.length : comma;
    const key = partKey(range, i, end);
    if (key >= 0) {
      if (n === keys.length) {
        const grown = new Float64Array(n * 2);
        grown.set(keys);
        keys = grown;
      }
      keys[n++] = key;
    }
    i = end + 1;
  }
  return keys.subarray(0, n);
}

const isSpace = (c: number): boolean => c === 0x20 || (c >= 0x09 && c <= 0x0d) || (c > 0x7f && /\s/.test(String.fromCharCode(c)));
const hexValue = (c: number): number => (c >= 0x30 && c <= 0x39 ? c - 0x30 : (c | 0x20) >= 0x61 && (c | 0x20) <= 0x66 ? (c | 0x20) - 0x57 : -1);

/** The end of the hex digits {@link hexRun} last read; module state, so a part allocates nothing. */
let hexEnd = 0;

/** The value of one to six hex digits of `range` from `k` up to `end`, or -1; {@link hexEnd} is where they stop. */
function hexRun(range: string, k: number, end: number): number {
  let value = 0;
  let digits = 0;
  for (let d = k < end ? hexValue(range.charCodeAt(k)) : -1; d >= 0 && digits < 7; d = ++k < end ? hexValue(range.charCodeAt(k)) : -1) {
    value = value * 16 + d;
    digits++;
  }
  hexEnd = k;
  return digits >= 1 && digits <= 6 ? value : -1;
}

/** The key of `U+A` or `U+A-B` (one to six hex digits each, spaces around) in `range` from `start` to `end`, or -1. */
function partKey(range: string, start: number, end: number): number {
  let i = start;
  let j = end;
  while (i < j && isSpace(range.charCodeAt(i))) i++;
  while (j > i && isSpace(range.charCodeAt(j - 1))) j--;
  if (j - i < 3 || (range.charCodeAt(i) | 0x20) !== 0x75 || range.charCodeAt(i + 1) !== 0x2b) return -1;
  const a = hexRun(range, i + 2, j);
  if (a < 0) return -1;
  if (hexEnd === j) return a * RUN_KEY + a;
  if (range.charCodeAt(hexEnd) !== 0x2d) return -1;
  const b = hexRun(range, hexEnd + 1, j);
  return b < 0 || hexEnd !== j || a > b ? -1 : a * RUN_KEY + b;
}

/** Whether `index` covers `cp`: the last run starting at or below it, found by bisection, reaches it. */
function covers(index: RangeIndex, cp: number): boolean {
  let lo = 0;
  let hi = index.from.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if ((index.from[mid] as number) <= cp) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 && cp <= (index.to[hi] as number);
}

/** The recorded coverage of a font asset: absent for a whole font, `unreadable` for a field {@link rangeIndex} refuses. */
function recordedCoverage(record: AnyRecord): RangeIndex | 'unreadable' | undefined {
  const unicodes = (record as unknown as { font?: FontField }).font?.subset?.unicodes;
  if (typeof unicodes !== 'string') return undefined;
  return rangeIndex(unicodes) ?? 'unreadable';
}

const replaceExt = (name: string): string => `${name.replace(/\.[^./]+$/, '')}.woff2`;
type FontField = { readonly subset?: Partial<FontSubsetIdentity> } & Record<string, unknown>;

/** The asset record of a subset: new hash, size, media type and name; the face, licence and metrics stay. */
function subsetRecord(asset: AssetRecord, out: { sha256: string; size: number; fingerprint: string }, unicodes: string): AssetRecord {
  const font = (asset as unknown as { font: FontField }).font;
  const subset: FontSubsetIdentity = {
    source: font.subset?.source ?? asset.hash,
    sourceSize: font.subset?.sourceSize ?? asset.size,
    policy: FONT_SUBSET_POLICY,
    fingerprint: out.fingerprint,
    unicodes,
  };
  return { ...asset, hash: out.sha256, size: out.size, mime: 'font/woff2', name: replaceExt(asset.name), font: { ...font, subset } } as AssetRecord;
}

/**
 * What a cut of `asset` to `codepoints` can draw: all of them for a whole font, and for a font that is already a
 * subset only those its recorded range covers (a re-cut cannot add glyphs the earlier cut discarded).
 */
function coveredBy(asset: AssetRecord, codepoints: readonly number[]): readonly number[] {
  const coverage = recordedCoverage(asset);
  // an unreadable range is no recorded range: whole-font semantics, and subsetFontGaps reports the whole text as a gap
  if (coverage === undefined || coverage === 'unreadable') return codepoints;
  return codepoints.filter((cp) => covers(coverage, cp));
}

/**
 * The candidate document and bytes of a subset-on-save. `bytesOf` gives a font asset's original bytes by hash; a
 * font without bytes is left to the save's usual missing-asset handling and gets no line.
 * @public
 */
export async function subsetFontsForSave(document: DocumentFile, bytesOf: (hash: string) => Uint8Array | undefined, deps: FontSubsetDeps): Promise<SubsetSave> {
  const fonts: EmbeddedFont[] = [];
  for (const record of Object.values(document.records)) {
    const bytes = isFont(record) ? bytesOf(record.hash) : undefined;
    if (bytes && isFont(record)) fonts.push({ asset: record, bytes });
  }
  const plan = await planFontSubsets(document, fonts, deps);
  const codepoints = plan.inventory.status === 'complete' ? plan.inventory.codepoints : [];
  const records: Record<string, AnyRecord> = { ...document.records };
  const assets = new Map<string, SubsetAsset>();
  const report: FontSubsetLine[] = [];
  for (const { asset, bytes } of fonts) {
    const outcome = plan.fonts.get(asset.id);
    const base = { asset: asset.id, name: asset.name, before: bytes.length };
    if (outcome?.status === 'subset') {
      const cut = { sha256: outcome.sha256, size: outcome.woff2.length, fingerprint: outcome.fingerprint };
      records[asset.id] = subsetRecord(asset, cut, unicodeRangeOf(coveredBy(asset, codepoints)));
      assets.set(outcome.sha256, { bytes: outcome.woff2, mime: 'font/woff2' });
      report.push({ ...base, after: outcome.woff2.length, status: 'subset' });
    } else if (outcome) report.push({ ...base, after: bytes.length, status: 'kept', reason: outcome.reason, message: outcome.message });
  }
  return { document: { ...document, records }, assets, report };
}

/**
 * Characters the document's text uses that a subset font no longer covers (text edited after a subset-only file was
 * reopened). Each needs the original font: re-saving cannot recover discarded glyphs. Empty when nothing is missing.
 * Bounded by the inventory's size times the log of the recorded runs; a recorded range longer than
 * 2 000 000 characters or covering more than every scalar reports the whole inventory (M18.203).
 * @public
 */
export function subsetFontGaps(document: DocumentFile, inventory: readonly number[]): readonly SubsetFontGap[] {
  const out: SubsetFontGap[] = [];
  for (const record of Object.values(document.records)) {
    const coverage = isFont(record) ? recordedCoverage(record) : undefined;
    if (coverage === undefined) continue;
    // a range too long or too wide to be a cut's coverage vouches for nothing the text uses
    const missing = coverage === 'unreadable' ? [...inventory] : inventory.filter((cp) => !covers(coverage, cp));
    if (missing.length > 0) out.push({ asset: record.id, missing });
  }
  return out;
}
