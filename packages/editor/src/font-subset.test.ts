import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  FONT_ENGINE_HASHES,
  type FontEngines,
  type FontSubsetDeps,
  type FontSubsetInput,
  fontSubsetCacheKey,
  glyphInventory,
  instantiateFontEngines,
  planFontSubsets,
  subsetFont,
  type WasmInstantiate,
} from '@fluxion/format';
import type { AssetRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';

// fixtures/fonts/fira-sans-400.ttf: Fira Sans Regular 4.203 from google/fonts, OFL-1.1 with no Reserved Font Name
// (provenance in fixtures/fonts/fira-sans-400.provenance.json), 456996 bytes and 137772 bytes as full WOFF2.
const FIRA = new Uint8Array(readFileSync(new URL('../../../fixtures/fonts/fira-sans-400.ttf', import.meta.url)));
const OFL = readFileSync(new URL('../../../fixtures/fonts/LICENSE-FiraSans-OFL.txt', import.meta.url), 'utf8');
const ASSETS = new URL('../../format/assets/font-engine/', import.meta.url);
const MODULES = {
  harfbuzz: new Uint8Array(readFileSync(new URL('harfbuzz-subset.wasm', ASSETS))),
  codec: new Uint8Array(readFileSync(new URL('woff2-codec.wasm', ASSETS))),
};
const MAX_BYTES = Number(
  /FONT_SUBSET_LATIN_MAX_BYTES: \{ value: ([0-9_]+)/
    .exec(Object.values(import.meta.glob('../../../scripts/gates/thresholds.mjs', { query: '?raw', import: 'default', eager: true }))[0] ?? '')?.[1]
    ?.replace(/_/g, ''),
);

const hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sha256 = async (bytes: Uint8Array): Promise<string> => hex(bytes);
const hasher = { sha256 };
const instantiate: WasmInstantiate = async (bytes, imports) => (await WebAssembly.instantiate(bytes as BufferSource, imports as WebAssembly.Imports)).instance;
const engines = (): Promise<FontEngines> => instantiateFontEngines(MODULES, { sha256, instantiate });
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** The Google Fonts `latin` slice's unicode-range. */
const LATIN = [
  ...range(0x20, 0x7e),
  ...range(0xa0, 0xff),
  0x131,
  0x152,
  0x153,
  0x2bb,
  0x2bc,
  0x2c6,
  0x2da,
  0x2dc,
  0x304,
  0x308,
  0x329,
  ...range(0x2000, 0x206f),
  0x20ac,
  0x2122,
  0x2191,
  0x2193,
  0x2212,
  0x2215,
  0xfeff,
  0xfffd,
];
const input = (codepoints: readonly number[], extra: Partial<FontSubsetInput> = {}): FontSubsetInput => ({
  bytes: FIRA,
  sourceSha256: hex(FIRA),
  weight: 400,
  style: 'normal',
  codepoints,
  rights: 'OFL-1.1',
  verifiedSource: true,
  ...extra,
});

// --- a minimal SFNT reader, independent of the adapter: tables, cmap (formats 4 and 12), hmtx, maxp, name ---
type Sfnt = { bytes: Uint8Array; view: DataView; tables: Map<string, number> };
function sfnt(bytes: Uint8Array): Sfnt {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) tables.set(String.fromCharCode(...bytes.subarray(12 + i * 16, 16 + i * 16)), view.getUint32(12 + i * 16 + 8));
  return { bytes, view, tables };
}
function format12(view: DataView, at: number, out: Map<number, number>): void {
  for (let g = 0; g < view.getUint32(at + 12); g++) {
    const [start, end, gid] = [0, 4, 8].map((o) => view.getUint32(at + 16 + g * 12 + o)) as [number, number, number];
    for (let cp = start; cp <= end; cp++) out.set(cp, gid + cp - start);
  }
}
function segment4(view: DataView, at: number, s: number, out: Map<number, number>): void {
  const segs = view.getUint16(at + 6) / 2;
  const end = view.getUint16(at + 14 + s * 2);
  const start = view.getUint16(at + 16 + segs * 2 + s * 2);
  const delta = view.getInt16(at + 16 + segs * 4 + s * 2);
  const rangeAt = at + 16 + segs * 6 + s * 2;
  const offset = view.getUint16(rangeAt);
  for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
    const raw = offset === 0 ? cp : view.getUint16(rangeAt + offset + (cp - start) * 2);
    const gid = raw === 0 ? 0 : (raw + delta) & 0xffff;
    if (gid !== 0 && !out.has(cp)) out.set(cp, gid);
  }
}
function cmap(font: Sfnt): Map<number, number> {
  const { view } = font;
  const base = font.tables.get('cmap') as number;
  const out = new Map<number, number>();
  for (let i = 0; i < view.getUint16(base + 2); i++) {
    const at = base + view.getUint32(base + 4 + i * 8 + 4);
    if (view.getUint16(at) === 12) format12(view, at, out);
    if (view.getUint16(at) === 4) for (let s = 0; s < view.getUint16(at + 6) / 2; s++) segment4(view, at, s, out);
  }
  return out;
}
const numGlyphs = (font: Sfnt): number => font.view.getUint16((font.tables.get('maxp') as number) + 4);
function advance(font: Sfnt, gid: number): number {
  const metrics = font.view.getUint16((font.tables.get('hhea') as number) + 34);
  return font.view.getUint16((font.tables.get('hmtx') as number) + Math.min(gid, metrics - 1) * 4);
}
function names(font: Sfnt): string[] {
  const { view, bytes } = font;
  const base = font.tables.get('name') as number;
  const strings = base + view.getUint16(base + 4);
  return Array.from({ length: view.getUint16(base + 2) }, (_, i) => {
    const at = base + 6 + i * 12;
    const ids = [0, 2, 4, 6].map((o) => view.getUint16(at + o)).join('.');
    const start = strings + view.getUint16(at + 10);
    return `${ids}:${hex(bytes.subarray(start, start + view.getUint16(at + 8)))}`;
  }).sort();
}
/** WOFF2 decoded by a separate codec instance, so the check does not share state with the adapter's run. */
async function decode(woff2: Uint8Array): Promise<Sfnt> {
  const { codec } = await engines();
  const at = codec.codec_alloc(woff2.length);
  new Uint8Array(codec.memory.buffer, at, woff2.length).set(woff2);
  const size = codec.woff2_final_size(at, woff2.length) >>> 0;
  const out = codec.codec_alloc(size);
  const written = codec.woff2_decode(at, woff2.length, out, size) >>> 0;
  expect(written).toBeGreaterThan(0);
  return sfnt(new Uint8Array(codec.memory.buffer, out, written).slice());
}
const subset = async (codepoints: readonly number[], extra: Partial<FontSubsetInput> = {}) => {
  const outcome = await subsetFont(input(codepoints, extra), await engines(), hasher);
  if (outcome.status !== 'subset') throw new Error(`kept: ${outcome.reason} ${outcome.message}`);
  return outcome;
};

describe('used-glyph font subsetting (FR-AST-003, ADR-0051)', () => {
  it('FR-AST-003: a Latin subset of a Google font weight is valid WOFF2 within the 60 kB budget', async () => {
    expect(MAX_BYTES).toBe(60_000);
    const out = await subset(LATIN);
    expect(out.woff2.length).toBeLessThanOrEqual(MAX_BYTES);
    expect(String.fromCharCode(...out.woff2.subarray(0, 4))).toBe('wOF2');
    expect(out.sha256).toBe(hex(out.woff2));
    const source = sfnt(FIRA);
    const result = await decode(out.woff2);
    const [sourceMap, resultMap] = [cmap(source), cmap(result)];
    for (const cp of LATIN.filter((c) => sourceMap.has(c))) {
      expect(resultMap.has(cp), `U+${cp.toString(16)}`).toBe(true);
      expect(advance(result, resultMap.get(cp) as number)).toBe(advance(source, sourceMap.get(cp) as number));
    }
    expect([...resultMap.keys()].every((cp) => LATIN.includes(cp))).toBe(true);
    expect(names(result)).toEqual(names(source));
    for (const table of ['GSUB', 'GPOS', 'GDEF', 'fpgm', 'prep', 'cvt ']) expect(result.tables.has(table), table).toBe(true);
  });

  it('FR-AST-003: keeps the layout closure, combining marks, and leaves out what the font lacks', async () => {
    const source = cmap(sfnt(FIRA));
    expect(source.has(0x4e00)).toBe(false);
    const ligatures = await decode((await subset([0x66, 0x69])).woff2);
    // f and i plus .notdef would be three glyphs; the fi/ffi ligatures and alternates of every feature come along
    expect(numGlyphs(ligatures)).toBeGreaterThan(3);
    const marks = await decode((await subset([0x65, 0x301, 0x4e00])).woff2);
    const map = cmap(marks);
    expect(map.has(0x301) && map.has(0x65)).toBe(true);
    expect(map.has(0x4e00)).toBe(false);
  });

  it('FR-AST-003: output, cache key and fingerprint are deterministic across fresh engines', async () => {
    const [a, b] = [await subset(LATIN), await subset([...LATIN].reverse().concat(LATIN))];
    expect(b.woff2).toEqual(a.woff2);
    expect([b.sha256, b.cacheKey, b.fingerprint]).toEqual([a.sha256, a.cacheKey, a.fingerprint]);
    const withMetrics = await subset(LATIN, { metrics: { ascent: 0.935 } });
    expect(withMetrics.cacheKey).toBe(a.cacheKey);
    expect(withMetrics.fingerprint).not.toBe(a.fingerprint);
  });

  it('FR-AST-003: the cache key changes with the source, face, inventory, rights and engines', async () => {
    const identity = { identity: FONT_ENGINE_HASHES };
    const key = (i: FontSubsetInput, id: { identity: FontEngines['identity'] } = identity) => fontSubsetCacheKey(i, id, hasher);
    const base = await key(input(LATIN));
    const variants = [
      await key(input(LATIN, { sourceSha256: '0'.repeat(64) })),
      await key(input(LATIN, { weight: 700 })),
      await key(input(LATIN, { style: 'italic' })),
      await key(input([...LATIN, 0x100])),
      await key(input(LATIN), { identity: { ...FONT_ENGINE_HASHES, harfbuzz: '1'.repeat(64) } }),
      await key(input(LATIN), { identity: { ...FONT_ENGINE_HASHES, codec: '2'.repeat(64) } }),
      await key(input(LATIN, { rights: 'OFL-1.1\nCopyright 2024' })),
      await key(input(LATIN, { modificationPermission: true })),
      await key(input(LATIN, { verifiedSource: false })),
    ];
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
    // the inventory is a set: order and duplicates do not change the key
    expect(await key(input([...LATIN, ...LATIN].reverse()))).toBe(base);
  });

  it('FR-AST-003: fonts that cannot be subset safely keep their original bytes with a reason', async () => {
    const reason = async (extra: Partial<FontSubsetInput>, codepoints = LATIN) => {
      const outcome = await subsetFont(input(codepoints, extra), await engines(), hasher);
      return outcome.status === 'kept' ? outcome.reason : 'subset';
    };
    const patched = (at: number, tag: string) => {
      const copy = FIRA.slice();
      copy.set(
        Array.from(tag, (c) => c.charCodeAt(0)),
        at,
      );
      return copy;
    };
    const dsig = [...sfnt(FIRA).tables.keys()].indexOf('DSIG');
    expect(await reason({ rights: "Copyright 2010 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'." })).toBe('reserved-font-name');
    expect(await reason({ rights: "Copyright 2011 Foo.\nReserved Font Name: 'Bar'" })).toBe('reserved-font-name');
    expect(await reason({ rights: 'Copyright 2010 Adobe, with Reserved Font Name Source.', modificationPermission: true })).toBe('subset');
    // an upload labelled only by its user is not a verified source; recorded permission to modify it is required
    expect(await reason({ verifiedSource: false })).toBe('unverified-source');
    expect(await reason({ verifiedSource: false, modificationPermission: true })).toBe('subset');
    // the OFL's own text defines the term without reserving a name
    expect(await reason({ rights: OFL })).toBe('subset');
    expect(await reason({ bytes: patched(12 + dsig * 16, 'fvar') })).toBe('variable-font');
    expect(await reason({ bytes: patched(0, 'ttcf') })).toBe('font-collection');
    expect(await reason({ bytes: patched(0, 'wOFF') })).toBe('unsupported-format');
    expect(await reason({ bytes: new TextEncoder().encode('<svg></svg>') })).toBe('unsupported-format');
    expect(await reason({ bytes: FIRA.slice(0, 100) })).toBe('malformed');
    expect(await reason({ bytes: patched(0, 'wOF2').slice(0, 48) })).toBe('malformed');
    expect(await reason({ bytes: new Uint8Array(5 * 1024 * 1024 + 1) })).toBe('too-large');
    const small = await subset([0x41]);
    expect(await reason({ bytes: small.woff2, sourceSha256: small.sha256 }, [0x41])).toBe('not-smaller');
    const broken = await engines();
    const trapping = {
      ...broken,
      harfbuzz: {
        ...broken.harfbuzz,
        hb_subset_or_fail: () => {
          throw new WebAssembly.RuntimeError('unreachable');
        },
      },
    };
    const outcome = await subsetFont(input(LATIN), trapping, hasher);
    expect(outcome).toMatchObject({ status: 'kept', reason: 'engine-failure' });
  });

  it('NFR-SEC-002 FR-AST-003: a WOFF2 under 5 MiB that declares a 6 MiB decoded font is too-large before the codec allocates it', async () => {
    const whole = (await subset(LATIN)).woff2;
    const DECLARED = 6 * 1024 * 1024;
    const lying = whole.slice();
    // WOFF2 header: totalSfntSize is the big-endian uint32 at offset 16, which woff2_final_size reports
    new DataView(lying.buffer).setUint32(16, DECLARED);
    const real = await engines();
    const allocated: number[] = [];
    const codec = {
      ...real.codec,
      codec_alloc: (n: number) => {
        allocated.push(n);
        return real.codec.codec_alloc(n);
      },
    };
    const outcome = await subsetFont(input(LATIN, { bytes: lying, sourceSha256: hex(lying) }), { ...real, codec }, hasher);
    expect(outcome).toMatchObject({ status: 'kept', reason: 'too-large' });
    expect(allocated.length).toBeGreaterThan(0);
    expect(Math.max(...allocated)).toBeLessThan(DECLARED);
    // the same bytes with their true size decode and subset: only the declared size is refused
    const honest = await subsetFont(input(range(0x41, 0x42), { bytes: whole, sourceSha256: hex(whole) }), await engines(), hasher);
    expect(honest.status).toBe('subset');
  });

  it('FR-AST-003: engine modules must be the pinned ones of the manifest', async () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', ASSETS), 'utf8')) as { assets: { file: string; sha256: string }[] };
    const pinned = Object.fromEntries(manifest.assets.map((a) => [a.file, a.sha256]));
    expect(FONT_ENGINE_HASHES).toEqual({ harfbuzz: pinned['harfbuzz-subset.wasm'], codec: pinned['woff2-codec.wasm'] });
    await expect(instantiateFontEngines({ ...MODULES, codec: MODULES.harfbuzz }, { sha256, instantiate })).rejects.toThrow(/pinned/);
  });
});

// --- documents for the inventory and plan ---
const text = (...nodes: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: nodes }] });
const t = (s: string) => ({ type: 'text', text: s });
const f = (name: string) => ({ type: 'field', attrs: { name } });
const doc = (...records: ({ id: string } & Record<string, unknown>)[]): DocumentFile =>
  ({
    schemaVersion: '1.7',
    records: Object.fromEntries(
      [{ id: 'd', type: 'document', title: 'Ünïcode' }, { id: 's1', type: 'screen', name: 'Intro', index: 'a0' }, ...records].map((r) => [r.id, r]),
    ),
  }) as unknown as DocumentFile;
const chars = (inventory: ReturnType<typeof glyphInventory>): string =>
  inventory.status === 'complete' ? String.fromCodePoint(...inventory.codepoints) : `unbounded: ${inventory.reason}`;

describe('glyph inventory of a document (FR-AST-003)', () => {
  it('FR-AST-003: collects element text, connector labels, notes and finite field values', () => {
    const inventory = glyphInventory(
      doc(
        { id: 'e1', type: 'element', kind: 'shape', screenId: 's1', text: text(t('Ab'), f('page')) },
        { id: 'e2', type: 'element', kind: 'connector', screenId: 's1', labels: [{ text: text(t('é')), position: 0.5 }] },
        { id: 's2', type: 'screen', name: 'Zed', index: 'a1', notes: text(t('ñ'), f('screenName'), f('title')) },
      ),
    );
    const got = chars(inventory);
    for (const ch of ['A', 'b', 'é', 'ñ', ...'0123456789', ...'{}pagescreenNametitle', ...'IntroZed', ...'Ünïcode']) expect(got).toContain(ch);
    expect(got).not.toContain('X');
    expect(inventory.status === 'complete' && inventory.codepoints).toEqual(
      [...new Set([...got].map((c) => c.codePointAt(0)))].sort((a, b) => (a ?? 0) - (b ?? 0)),
    );
  });

  it('FR-AST-003: text no walk can bound makes the inventory unbounded', () => {
    expect(glyphInventory(doc({ id: 'e1', type: 'element', kind: 'shape', screenId: 's1', text: text(f('date')) })).status).toBe('unbounded');
    expect(glyphInventory(doc({ id: 'e1', type: 'element', kind: 'component', screenId: 's1' })).status).toBe('unbounded');
    expect(chars(glyphInventory(doc({ id: 'e1', type: 'element', kind: 'text', screenId: 's1', text: text(t('a\ud800')) })))).toContain('�');
  });

  it('FR-AST-003: adds list markers, composed and decomposed forms, and keeps supplementary characters as single scalars', () => {
    const list = (type: string) => ({
      type: 'doc',
      content: [{ type, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('Apple')] }] }] }],
    });
    const bullets = chars(glyphInventory(doc({ id: 'e1', type: 'element', kind: 'shape', screenId: 's1', text: list('bulletList') })));
    for (const ch of ['\u2022', '\u25e6', '\u25aa', ' ', 'A']) expect(bullets).toContain(ch);
    const numbers = chars(glyphInventory(doc({ id: 'e1', type: 'element', kind: 'shape', screenId: 's1', text: list('orderedList') })));
    for (const ch of [...'0123456789', '.', '-', ' ']) expect(numbers).toContain(ch);
    const emoji = glyphInventory(doc({ id: 'e1', type: 'element', kind: 'text', screenId: 's1', text: text(t('\u{1f600}\u{1d400}')) }));
    expect(emoji.status === 'complete' && emoji.codepoints.filter((cp) => cp > 0xffff)).toEqual([0x1d400, 0x1f600]);
    expect(emoji.status === 'complete' && emoji.codepoints.some((cp) => cp >= 0xd800 && cp <= 0xdfff)).toBe(false);
    // a base and mark the shaper may compose: both the precomposed and decomposed forms are kept
    expect([...chars(glyphInventory(doc({ id: 'e1', type: 'element', kind: 'text', screenId: 's1', text: text(t('e\u0301\u00c5')) })))]).toEqual(
      expect.arrayContaining(['e', '\u0301', '\u00e9', '\u00c5', 'A', '\u030a']),
    );
  });

  it('FR-AST-003: a plan subsets each font with fresh engines, caches, and keeps fonts whole for unbounded text', async () => {
    const asset = (id: string, bytes: Uint8Array, source = 'google'): AssetRecord =>
      ({
        id: id as RecordId,
        type: 'asset',
        hash: hex(bytes),
        mime: 'font/ttf',
        size: bytes.length,
        font: { family: 'Fira Sans', weight: 400, style: 'normal', source, license: 'OFL-1.1' },
      }) as unknown as AssetRecord;
    let created = 0;
    const cache = new Map();
    const counted = (): Promise<FontEngines> => {
      created += 1;
      return engines();
    };
    const deps: FontSubsetDeps = { engines: counted, sha256, cache };
    const fonts = [
      { asset: asset('f1', FIRA), bytes: FIRA },
      { asset: asset('f2', FIRA.slice(0, 64)), bytes: FIRA.slice(0, 64) },
      { asset: asset('f3', FIRA, 'upload'), bytes: FIRA },
    ];
    const latin = doc({ id: 'e1', type: 'element', kind: 'text', screenId: 's1', text: text(t('Hello, world')) });
    const first = await planFontSubsets(latin, fonts, deps);
    expect(created).toBe(3);
    expect(first.fonts.get('f3' as RecordId)).toMatchObject({ status: 'kept', reason: 'unverified-source' });
    expect(first.fonts.get('f1' as RecordId)).toMatchObject({ status: 'subset' });
    expect(first.fonts.get('f2' as RecordId)).toMatchObject({ status: 'kept', reason: 'malformed' });
    const again = await planFontSubsets(latin, fonts, deps);
    expect(created).toBe(3);
    expect(again.fonts.get('f1' as RecordId)).toBe(first.fonts.get('f1' as RecordId));
    // a failure is not cached: the same cache retries on the next plan
    const retry = new Map();
    const failing = await planFontSubsets(latin, fonts, { engines: () => Promise.reject(new Error('no wasm')), sha256, cache: retry });
    expect(failing.fonts.get('f1' as RecordId)).toMatchObject({ status: 'kept', reason: 'engine-failure' });
    expect(retry.size).toBe(0);
    const recovered = await planFontSubsets(latin, fonts, { engines, sha256, cache: retry });
    expect(recovered.fonts.get('f1' as RecordId)).toMatchObject({ status: 'subset' });
    const open = await planFontSubsets(doc({ id: 'e1', type: 'element', kind: 'component', screenId: 's1' }), fonts, deps);
    expect(open.fonts.get('f1' as RecordId)).toMatchObject({ status: 'kept', reason: 'unbounded-text' });
    expect(created).toBe(3);
  });
});
