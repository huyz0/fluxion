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
  const unicodes = (asset as unknown as { font: FontField }).font.subset?.unicodes;
  if (typeof unicodes !== 'string') return codepoints;
  const pairs = unicodeRangePairs(unicodes);
  return codepoints.filter((cp) => pairs.some(([from, to]) => cp >= from && cp <= to));
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
 * @public
 */
export function subsetFontGaps(document: DocumentFile, inventory: readonly number[]): readonly SubsetFontGap[] {
  const out: SubsetFontGap[] = [];
  for (const record of Object.values(document.records)) {
    const unicodes = isFont(record) ? (record as unknown as { font: FontField }).font.subset?.unicodes : undefined;
    if (typeof unicodes !== 'string') continue;
    const pairs = unicodeRangePairs(unicodes);
    const missing = inventory.filter((cp) => !pairs.some(([from, to]) => cp >= from && cp <= to));
    if (missing.length > 0) out.push({ asset: record.id, missing });
  }
  return out;
}
