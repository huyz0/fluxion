// FR-LIB-004 NFR-SEC-001 NFR-LIC-003: the studio SVG library importer (M18.175) converts the 50-SVG corpus under its declared
// credits into one checked pack and registers nothing; bounds are met from listed sizes before any byte is read; every refusal
// names its member path; rights and the license policy are checked before any witness starts. The witness here is an injected
// port, not evidence of paint (M18.17's e2e drives the browser witness).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ArtworkFontBinding, createRegistry, type ShapeDef } from '@fluxion/core';
import { INPUT_LIMITS, parseImportCredits, type SvgPaintWitness, sha256Hex, writeZip } from '@fluxion/format';
import { type Diagnostic, err, ok } from '@fluxion/schema';
import { describe, expect, it, vi } from 'vitest';
import { convertSvgLibrary, type SvgLibraryOptions, type SvgLibraryRights } from './import-svg.js';
import type { SvgLibraryItem } from './import-svg-input.js';
import { registerSvgLibrary } from './register-svg.js';

const ROOT = join(import.meta.dirname, '../../../..');
const CORPUS = join(ROOT, 'specs/import/corpus');
type Manifest = {
  sources: { id: string; license: string; attribution: string; notice: string; repository: string; commit: string; originalStatement?: string }[];
  svg: { path: string; source: string; sha256: string; upstreamPath?: string }[];
};
const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as Manifest;
const member = (path: string) => path.slice('svg/'.length);
const encode = (text: string) => new TextEncoder().encode(text);

/** The corpus's declared rights as the dialog's credits file: one upstream credit per Lucide member, one for Fluxion's, notices inline. */
function corpusRights(): SvgLibraryRights {
  const source = (id: string) => manifest.sources.find((s) => s.id === id) as Manifest['sources'][number];
  const notice = (s: Manifest['sources'][number]) => readFileSync(join(CORPUS, s.notice), 'utf8');
  const [lucide, original] = [source('lucide'), source('fluxion-original')];
  const credits = parseImportCredits({
    license: 'ISC AND MIT',
    attribution: 'Lucide Icons and Contributors; Fluxion contributors',
    credits: [
      ...manifest.svg
        .filter((e) => e.source === 'lucide')
        .map((e) => ({
          id: member(e.path).replace(/\.svg$/, ''),
          license: lucide.license,
          attribution: lucide.attribution,
          notice: notice(lucide),
          source: { kind: 'upstream', reference: `${lucide.repository}@${lucide.commit}:${e.upstreamPath}`, sha256: e.sha256 },
          members: [member(e.path)],
        })),
      {
        id: 'fluxion',
        license: original.license,
        attribution: original.attribution,
        notice: notice(original),
        source: { kind: 'original', author: 'Fluxion contributors', statement: original.originalStatement },
        members: manifest.svg.filter((e) => e.source === 'fluxion-original').map((e) => member(e.path)),
      },
    ],
  });
  if ('kind' in credits) throw new Error(credits.message);
  return { kind: 'credits', credits };
}

/** A picked item whose `bytes()` calls are counted. */
function item(name: string, bytes: Uint8Array, size = bytes.byteLength) {
  const read = vi.fn(async () => bytes);
  return { name, size, bytes: read } satisfies SvgLibraryItem;
}
const corpusItems = () =>
  readdirSync(join(CORPUS, 'svg'))
    .sort()
    .map((name) => item(name, new Uint8Array(readFileSync(join(CORPUS, 'svg', name)))));
const zipOf = (entries: { name: string; bytes: Uint8Array }[]) => {
  const zip = writeZip(entries);
  if (!zip.ok) throw new Error(zip.error.reason);
  return zip.value;
};

/** A start port counting sessions and witnessed requests; `refuse(n)` makes the witness not see the nth request painted. */
function host(fail?: 'start') {
  const requests: string[] = [];
  let unpainted = -1;
  const witness: SvgPaintWitness = async (r) => {
    requests.push(r.identity);
    return { identity: r.identity, status: requests.length - 1 === unpainted ? 'no-witness' : 'painted', fontHashes: r.fonts.map((f) => f.sha256) };
  };
  const startWitness = vi.fn(async () =>
    fail === 'start'
      ? err([{ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path: '', message: 'unsupported SVG paint witness context' } as Diagnostic])
      : ok({ witness, dispose: async () => ok(undefined) }),
  );
  return { startWitness, requests, refuse: (nth: number) => (unpainted = nth) };
}
const INTER = (() => {
  const bytes = new Uint8Array(readFileSync(join(ROOT, 'packs/fonts-core/fonts/inter-latin-400-normal.woff2')));
  const face = { family: 'Inter', weight: 400, style: 'normal' as const, sha256: sha256Hex(bytes) };
  const notice = readFileSync(join(ROOT, 'packs/fonts-core/OFL.txt'), 'utf8');
  const source = { kind: 'upstream' as const, reference: '@fluxion/pack-fonts-core:fonts/inter-latin-400-normal.woff2', sha256: face.sha256 };
  return { bytes, face, notice, rights: { bytes, license: 'OFL-1.1', attribution: 'The Inter Project Authors', notice, source } };
})();

const optionsOf = (h: ReturnType<typeof host>, extra: Partial<SvgLibraryOptions> = {}): SvgLibraryOptions => ({
  namespace: 'corpus',
  version: '1.0.0',
  name: 'Corpus',
  rights: corpusRights(),
  startWitness: h.startWitness,
  now: () => 0,
  fonts: [{ face: INTER.face, rights: INTER.rights }],
  ...extra,
});
const own: SvgLibraryRights = { kind: 'original', license: 'MIT', attribution: 'Me', author: 'Me' };

describe('convertSvgLibrary', () => {
  it('FR-LIB-004 NFR-LIC-003: the 50-SVG corpus as files or a ZIP gives one pack of 50 definitions with 33 scoped credits, the same bytes', async () => {
    const h = host();
    const files = await convertSvgLibrary({ kind: 'files', items: corpusItems() }, optionsOf(h));
    const entries = corpusItems().map((i) => ({ name: i.name, bytes: new Uint8Array(readFileSync(join(CORPUS, 'svg', i.name))) }));
    const zipBytes = zipOf([...entries].reverse());
    const zipped = await convertSvgLibrary({ kind: 'zip', items: [item('corpus.zip', zipBytes)] }, optionsOf(host()));
    if (!files.ok || !zipped.ok) throw new Error(JSON.stringify(files.ok ? zipped : files));
    const { pack } = files.value;
    expect(pack.source.definitions).toHaveLength(50);
    for (const def of pack.source.definitions) expect(def.anchors?.length).toBeGreaterThanOrEqual(4);
    expect(pack.index.credits).toHaveLength(33);
    // the corpus's text badge draws in the given Inter face, so the pack is 1.1 and carries its bytes
    expect(pack.index.formatVersion).toBe('1.1');
    expect([...pack.source.fonts.keys()]).toEqual([INTER.face.sha256]);
    expect([...zipped.value.pack.files]).toEqual([...pack.files]);
    // every member through one session (50 < 128)
    expect(h.startWitness).toHaveBeenCalledTimes(1);
    expect(h.requests).toHaveLength(50);
  });

  it('NFR-SEC-001: the entry-count, per-entry and total caps of picked files are met from their sizes before any bytes are read', async () => {
    const svg = encode('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    const cases: [SvgLibraryItem[], string][] = [
      [Array.from({ length: INPUT_LIMITS.maxEntries + 1 }, (_, i) => item(`m${i}.svg`, svg)), `more than ${INPUT_LIMITS.maxEntries} entries`],
      [[item('a.svg', svg), item('big.svg', svg, INPUT_LIMITS.maxEntryBytes + 1)], 'entry exceeds 128 MiB'],
      [[item('a.svg', svg, INPUT_LIMITS.maxEntryBytes), item('b.svg', svg, INPUT_LIMITS.maxEntryBytes), item('c.svg', svg, 1)], 'inputs exceed 256 MiB'],
    ];
    for (const [items, message] of cases) {
      const h = host();
      const result = await convertSvgLibrary({ kind: 'files', items }, optionsOf(h, { rights: own }));
      expect(result.ok ? [] : result.error.map((p) => p.message)).toEqual([message]);
      expect(items.every((i) => vi.mocked(i.bytes).mock.calls.length === 0)).toBe(true);
      expect(h.startWitness).not.toHaveBeenCalled();
    }
  });

  it("NFR-SEC-001: a ZIP's own size is checked before it is read; its entry count is refused from the central directory", async () => {
    const big = item('big.zip', new Uint8Array(), INPUT_LIMITS.maxTotalBytes + 1);
    expect(await convertSvgLibrary({ kind: 'zip', items: [big] }, optionsOf(host(), { rights: own }))).toEqual(
      err([{ path: '', message: 'ZIP file exceeds 256 MiB' }]),
    );
    expect(big.bytes).not.toHaveBeenCalled();
    const many = zipOf(Array.from({ length: INPUT_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `m${i}.svg`, bytes: encode('<svg/>') })));
    const refused = await convertSvgLibrary({ kind: 'zip', items: [item('many.zip', many)] }, optionsOf(host(), { rights: own }));
    expect(refused.ok ? '' : refused.error[0]?.message).toMatch(/^ZIP refused: /);
    // an entry whose central directory declares more than 128 MiB is refused from the listing, before it is inflated
    const declared = zipOf([{ name: 'a.svg', bytes: encode('<svg/>') }]);
    const view = new DataView(declared.buffer, declared.byteOffset, declared.byteLength);
    const central = declared.findLastIndex((_, i) => i + 4 <= declared.length && view.getUint32(i, true) === 0x02014b50);
    view.setUint32(central + 24, INPUT_LIMITS.maxEntryBytes + 1, true);
    const oversized = await convertSvgLibrary({ kind: 'zip', items: [item('big-entry.zip', declared)] }, optionsOf(host(), { rights: own }));
    expect(oversized.ok ? '' : oversized.error[0]?.message).toMatch(/^ZIP refused: /);
    const changed = item('c.zip', many, many.byteLength + 1);
    expect(await convertSvgLibrary({ kind: 'zip', items: [changed] }, optionsOf(host(), { rights: own }))).toEqual(
      err([{ path: '', message: 'ZIP file changed while it was read' }]),
    );
  });

  it('NFR-SEC-001: a multi-entry ZIP is refused for a declared size before its corrupt first entry is inflated (M18.202)', async () => {
    const svg = encode(`<svg viewBox="0 0 10 10">${'<rect width="10" height="10"/>'.repeat(20)}</svg>`);
    const shaped = (last: number, middle = svg.length) => {
      const zip = zipOf([
        { name: 'a.svg', bytes: svg },
        { name: 'b.svg', bytes: svg },
        { name: 'c.svg', bytes: svg },
      ]);
      const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      // the first entry's deflate body becomes an invalid block, and the central directory declares the other sizes
      const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
      zip.fill(0xff, start, start + 4);
      let at = view.getUint32(zip.length - 22 + 16, true);
      for (const size of [svg.length, middle, last]) {
        view.setUint32(at + 24, size, true);
        at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
      }
      return item('shaped.zip', zip);
    };
    const message = async (zip: ReturnType<typeof item>) => {
      const r = await convertSvgLibrary({ kind: 'zip', items: [zip] }, optionsOf(host(), { rights: own }));
      return r.ok ? '' : r.error[0]?.message;
    };
    expect(await message(shaped(INPUT_LIMITS.maxEntryBytes + 1))).toMatch(/^ZIP refused: c\.svg: \d+ bytes inflated \(more than/);
    expect(await message(shaped(INPUT_LIMITS.maxEntryBytes, INPUT_LIMITS.maxEntryBytes))).toMatch(/^ZIP refused: the entries inflate to more than/);
  });

  it('NFR-SEC-001: a non-SVG, an escaping, an empty or a colliding name is refused, naming the path, before any witness starts', async () => {
    const svg = encode('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    const h = host();
    const names = await convertSvgLibrary(
      { kind: 'files', items: [item('notes.txt', svg), item('!!!.svg', svg), item('a-b.svg', svg), item('A B.svg', svg)] },
      optionsOf(h, { rights: own }),
    );
    expect(names.ok ? [] : names.error).toEqual([
      { path: '!!!.svg', message: 'its name gives no valid definition id ("corpus:")' },
      { path: 'a-b.svg', message: 'gives the id corpus:a-b, as A B.svg does' },
      { path: 'notes.txt', message: 'is not an SVG; every member of a pack-import must be one' },
    ]);
    const escaping = await convertSvgLibrary(
      { kind: 'files', items: [item('../up.svg', svg), item('ok.svg', svg), item('a\\b.svg', svg)] },
      optionsOf(h, { rights: own }),
    );
    expect(escaping.ok ? [] : escaping.error.map((p) => p.path)).toEqual(['../up.svg', 'a\\b.svg']);
    expect(h.startWitness).not.toHaveBeenCalled();
  });

  it('FR-LIB-004: one member the witness does not see painted refuses the whole batch, naming it', async () => {
    const h = host();
    h.refuse(7);
    const items = corpusItems();
    const result = await convertSvgLibrary({ kind: 'files', items }, optionsOf(h));
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : [...new Set(result.error.map((p) => p.path))]).toEqual([items[7]?.name]);
  });

  it('NFR-LIC-003: an uncredited member, an unpermitted license, a missing license and a notice file are refused before any witness starts', async () => {
    const svg = encode('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    const items = () => [item('a.svg', svg), item('b.svg', svg)];
    const declared = (credits: unknown): SvgLibraryRights => {
      const parsed = parseImportCredits(credits);
      if ('kind' in parsed) throw new Error(parsed.message);
      return { kind: 'credits', credits: parsed };
    };
    const credit = { id: 'mine', license: 'MIT', attribution: 'Me', notice: 'Me, MIT.', source: { kind: 'original', author: 'Me', statement: 'Mine.' } };
    const cases: [SvgLibraryRights, string][] = [
      [{ ...own, license: 'LicenseRef-Proprietary' }, 'the content license policy does not permit LicenseRef-Proprietary'],
      [{ ...own, license: ' ' }, 'give the license of the SVGs; there is no default'],
      [
        { kind: 'upstream', license: 'MIT', attribution: 'Them', reference: 'https://example.org/x', sha256: 'abc' },
        "give the source's SHA-256 as 64 lowercase hex",
      ],
      [
        declared({ license: 'MIT', attribution: 'Me', credits: [{ ...credit, notice: undefined, noticeFile: 'LICENSE', members: ['a.svg', 'b.svg'] }] }),
        'credit mine names the notice file LICENSE; give its notice inline',
      ],
    ];
    for (const [rights, message] of cases) {
      const h = host();
      expect(await convertSvgLibrary({ kind: 'files', items: items() }, optionsOf(h, { rights }))).toEqual(err([{ path: '', message }]));
      expect(h.startWitness).not.toHaveBeenCalled();
    }
    // coverage gaps are named by member path, each its own refusal
    const h = host();
    const gaps = declared({ license: 'MIT', attribution: 'Me', credits: [{ ...credit, members: ['a.svg', 'gone.svg'] }] });
    expect(await convertSvgLibrary({ kind: 'files', items: [...items(), item('c.svg', svg)] }, optionsOf(h, { rights: gaps }))).toEqual(
      err([
        { path: 'b.svg', message: 'no credit names it' },
        { path: 'c.svg', message: 'no credit names it' },
        { path: 'gone.svg', message: 'credit mine names it, but the input does not hold it' },
      ]),
    );
    expect(h.startWitness).not.toHaveBeenCalled();
  });

  it('FR-LIB-004: a witness that cannot start is the refusal, and nothing is converted', async () => {
    const h = host('start');
    const result = await convertSvgLibrary({ kind: 'files', items: corpusItems().slice(0, 2) }, optionsOf(h, { rights: own }));
    expect(result).toEqual(err([{ path: '', message: 'unsupported SVG paint witness context' }]));
  });

  it('FR-LIB-004: the batch colors are offered exactly as written; a mapped color converts to its token reference', async () => {
    const svg = encode('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#F00" style="stroke: blue ;"/><path d="M0 0L10 10" stroke="none"/></svg>');
    const first = await convertSvgLibrary({ kind: 'files', items: [item('a.svg', svg)] }, optionsOf(host(), { rights: own }));
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    expect([first.value.colors, first.value.colorsOmitted]).toEqual([['#F00', 'blue'], 0]);
    const colors = { '#F00': '{color.accent}' } as const;
    const mapped = await convertSvgLibrary(
      { kind: 'files', items: [item('a.svg', svg)] },
      optionsOf(host(), { rights: own, colors, tokenRefs: new Set(['{color.accent}']) }),
    );
    expect(mapped.ok && mapped.value.pack.source.definitions[0]?.artwork?.colors).toEqual(colors);
    const unknown = await convertSvgLibrary({ kind: 'files', items: [item('a.svg', svg)] }, optionsOf(host(), { rights: own, colors, tokenRefs: new Set() }));
    expect(unknown.ok).toBe(false);
  });

  it('FR-AST-003 NFR-LIC-003: text makes a 1.1 pack carrying the given Inter face with its own declared OFL-1.1 rights', async () => {
    const { face, notice, bytes } = INTER;
    const svg = encode('<svg viewBox="0 0 40 20"><text x="2" y="14">API</text></svg>');
    const result = await convertSvgLibrary({ kind: 'files', items: [item('label.svg', svg)] }, optionsOf(host(), { rights: own }));
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const { index } = result.value.pack;
    expect(index.formatVersion).toBe('1.1');
    expect(index.formatVersion === '1.1' && index.fontCredits).toEqual([expect.objectContaining({ license: 'OFL-1.1', notice })]);
    expect(result.value.pack.source.fonts.get(face.sha256)).toEqual(bytes);
  });
});

describe('registerSvgLibrary', () => {
  it('FR-LIB-004: the final pack registers atomically under its namespace; a held namespace registers nothing', async () => {
    // the Lucide members draw no text, so no face is loaded (a 1.1 pack's faces need the browser: M18.17's e2e)
    const items = corpusItems().filter((i) => i.name.startsWith('lucide-'));
    const converted = await convertSvgLibrary({ kind: 'files', items }, optionsOf(host(), { rights: own }));
    if (!converted.ok) throw new Error(JSON.stringify(converted.error));
    const registries = {
      shapeDefs: createRegistry<string, ShapeDef>('shapeDefs'),
      artworkFonts: createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts'),
    };
    // no face is created, so the set is never touched
    const ports = { sha256: async (b: Uint8Array) => sha256Hex(b), fonts: {} as FontFaceSet };
    const library = await registerSvgLibrary(registries, converted.value.pack, ports);
    if (!library.ok) throw new Error(JSON.stringify(library.error));
    expect(library.value.entries).toHaveLength(items.length);
    expect(registries.shapeDefs.list().filter(([id]) => id.startsWith('corpus:'))).toHaveLength(items.length);
    const again = await registerSvgLibrary(registries, converted.value.pack, ports);
    expect(again.ok).toBe(false);
    expect(registries.shapeDefs.list()).toHaveLength(items.length);
    library.value.dispose();
    expect(registries.shapeDefs.list()).toHaveLength(0);
  });
});
