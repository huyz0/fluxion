// FR-LIB-005 FR-LIB-006 FR-LIB-009 NFR-LIC-003: the studio's Iconify and draw.io importer (M18.210) turns one picked file into a
// checked pack whose source a save keeps; the file is bounded before it is read, draw.io rights and the licence policy are checked
// before any witness starts, refused entries are listed, and the pack registers like an SVG pack. The witness is an injected port,
// not evidence of paint (e2e/library.import-iconify-drawio.spec.ts drives the browser witness).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ArtworkFontBinding, createRegistry, type ShapeDef } from '@fluxion/core';
import { INPUT_LIMITS, type SvgPaintWitness, sha256Hex } from '@fluxion/format';
import { type Diagnostic, err, ok } from '@fluxion/schema';
import { describe, expect, it, vi } from 'vitest';
import { type CollectionLibraryOptions, convertCollectionLibrary } from './import-collection.js';
import type { SvgLibraryItem } from './import-svg-input.js';
import { registerSvgLibrary } from './register-svg.js';

const CORPUS = join(import.meta.dirname, '../../../../specs/import/corpus');
const item = (path: string, name = path.split('/').at(-1) ?? path): SvgLibraryItem & { reads: () => number } => {
  const bytes = new Uint8Array(readFileSync(join(CORPUS, path)));
  let reads = 0;
  return {
    name,
    size: bytes.length,
    bytes: async () => {
      reads++;
      return bytes;
    },
    reads: () => reads,
  };
};

/** A start port counting sessions; `fail` makes the first start refuse. */
function host(fail?: 'start') {
  let requests = 0;
  const witness: SvgPaintWitness = async (r) => {
    requests++;
    return { identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) };
  };
  const startWitness = vi.fn(async () =>
    fail === 'start'
      ? err([{ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path: '', message: 'unsupported SVG paint witness context' } as Diagnostic])
      : ok({ witness, dispose: async () => ok(undefined) }),
  );
  return { startWitness, requests: () => requests };
}

const own = { kind: 'original', license: 'MIT', attribution: 'Fluxion fixtures', author: 'Fluxion' } as const;
const declared = (rights: NonNullable<CollectionLibraryOptions['declared']>['rights'] = own) => ({
  namespace: 'mixed',
  version: '1.0.0',
  name: 'Mixed',
  rights,
});
const optionsOf = (h: ReturnType<typeof host>, extra: Partial<CollectionLibraryOptions> = {}): CollectionLibraryOptions => ({
  startWitness: h.startWitness,
  now: () => 0,
  ...extra,
});

describe('convertCollectionLibrary: Iconify', () => {
  it('FR-LIB-005 NFR-LIC-003: the pinned Lucide collection becomes one pack of every icon and alias, credited from its own declared licence', async () => {
    const h = host();
    const result = await convertCollectionLibrary({ kind: 'iconify', item: item('iconify/lucide.json') }, optionsOf(h));
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const { pack, omitted } = result.value;
    expect(omitted).toEqual([]);
    expect(pack.source.definitions).toHaveLength(2198);
    expect(pack.index).toMatchObject({ id: 'lucide', name: 'Lucide', license: 'ISC', attribution: 'Lucide by Lucide Contributors' });
    expect(pack.index.version).toMatch(/^0\.0\.0\+sha256\.[0-9a-f]{16}$/);
    // 2198 requests through rotating sessions of at most 128
    expect(h.requests()).toBe(2198);
    expect(h.startWitness.mock.calls.length).toBeGreaterThanOrEqual(Math.ceil(2198 / 128));
  }, 60_000);

  it('FR-LIB-005 NFR-LIC-003: a collection that declares no licence is refused, and so is one the content policy does not permit', async () => {
    const none = await convertCollectionLibrary({ kind: 'iconify', item: item('iconify/original-aliases.json') }, optionsOf(host()));
    expect(none.ok).toBe(false);
    expect(!none.ok && none.error.map((p) => p.message)).toEqual([expect.stringMatching(/declares no license; it cannot be saved portably/)]);
    const text = JSON.stringify({
      ...JSON.parse(readFileSync(join(CORPUS, 'iconify/original-aliases.json'), 'utf8')),
      info: { name: 'Closed', license: { spdx: 'LicenseRef-Closed' } },
    });
    const bytes = new TextEncoder().encode(text);
    const closed = await convertCollectionLibrary(
      { kind: 'iconify', item: { name: 'closed.json', size: bytes.length, bytes: async () => bytes } },
      optionsOf(host()),
    );
    expect(closed.ok).toBe(false);
  });
});

describe('convertCollectionLibrary: draw.io', () => {
  it('FR-LIB-006 NFR-LIC-003: a library becomes one pack under the declared identity and credit, its refused entries listed by title', async () => {
    const h = host();
    const result = await convertCollectionLibrary({ kind: 'drawio', item: item('drawio/original-mixed.xml') }, optionsOf(h, { declared: declared() }));
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const { pack, omitted } = result.value;
    expect(pack.index).toMatchObject({ id: 'mixed', version: '1.0.0', name: 'Mixed', license: 'MIT', attribution: 'Fluxion fixtures' });
    expect(pack.index.credits).toEqual([
      expect.objectContaining({ license: 'MIT', source: { kind: 'original', author: 'Fluxion', statement: 'Original work of Fluxion.' } }),
    ]);
    expect(pack.source.definitions.length).toBeGreaterThan(0);
    expect(pack.source.definitions.every((d) => d.id.startsWith('mixed:'))).toBe(true);
    for (const o of omitted) expect(o.path).not.toBe('');
  });

  it('FR-LIB-006 NFR-LIC-003: no declaration, an incomplete one or an unpermitted licence is refused before any witness starts', async () => {
    const cases: [Partial<CollectionLibraryOptions>, RegExp][] = [
      [{}, /declare the namespace, version, name and rights/],
      [{ declared: declared({ ...own, author: ' ' }) }, /give the author's name/],
      [{ declared: declared({ ...own, license: ' ' }) }, /there is no default/],
      [{ declared: declared({ ...own, license: 'LicenseRef-Closed' }) }, /does not permit LicenseRef-Closed/],
      [{ declared: declared({ kind: 'upstream', license: 'MIT', attribution: 'x', reference: 'https://example.invalid', sha256: 'abc' }) }, /SHA-256/],
    ];
    for (const [extra, message] of cases) {
      const h = host();
      const result = await convertCollectionLibrary({ kind: 'drawio', item: item('drawio/original-mixed.xml') }, optionsOf(h, extra));
      expect(!result.ok && result.error.map((p) => p.message)).toEqual([expect.stringMatching(message)]);
      expect(h.startWitness).not.toHaveBeenCalled();
    }
  });
});

describe('convertCollectionLibrary: bounds and witness', () => {
  it('NFR-SEC-001: an over-cap file is refused from its listed size before it is read, and a file that is not UTF-8 is refused', async () => {
    const big = { ...item('iconify/original-aliases.json'), size: INPUT_LIMITS.maxEntryBytes + 1 };
    const h = host();
    const result = await convertCollectionLibrary({ kind: 'iconify', item: big }, optionsOf(h));
    expect(!result.ok && result.error).toEqual([{ path: 'original-aliases.json', message: 'entry exceeds 128 MiB' }]);
    expect(big.reads()).toBe(0);
    expect(h.startWitness).not.toHaveBeenCalled();
    const bad = new Uint8Array([0xff, 0xfe, 0x00]);
    const binary = await convertCollectionLibrary({ kind: 'iconify', item: { name: 'x.json', size: 3, bytes: async () => bad } }, optionsOf(host()));
    expect(!binary.ok && binary.error).toEqual([{ path: 'x.json', message: 'not UTF-8 text' }]);
  });

  it('FR-LIB-005: a witness that cannot start is the refusal', async () => {
    const result = await convertCollectionLibrary({ kind: 'iconify', item: item('iconify/lucide.json') }, optionsOf(host('start')));
    expect(!result.ok && result.error.map((p) => p.message)).toEqual(['unsupported SVG paint witness context']);
  });
});

describe('registering a collection pack', () => {
  it('FR-LIB-006 FR-LIB-009: a draw.io pack registers atomically under its namespace; a held namespace registers nothing', async () => {
    const converted = await convertCollectionLibrary({ kind: 'drawio', item: item('drawio/original-mixed.xml') }, optionsOf(host(), { declared: declared() }));
    if (!converted.ok) throw new Error(JSON.stringify(converted.error));
    const registries = {
      shapeDefs: createRegistry<string, ShapeDef>('shapeDefs'),
      artworkFonts: createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts'),
    };
    const ports = { sha256: async (b: Uint8Array) => sha256Hex(b), fonts: {} as FontFaceSet };
    const count = converted.value.pack.source.definitions.length;
    const library = await registerSvgLibrary(registries, converted.value.pack, ports);
    if (!library.ok) throw new Error(JSON.stringify(library.error));
    expect(registries.shapeDefs.list()).toHaveLength(count);
    expect((await registerSvgLibrary(registries, converted.value.pack, ports)).ok).toBe(false);
    expect(registries.shapeDefs.list()).toHaveLength(count);
    library.value.dispose();
    expect(registries.shapeDefs.list()).toHaveLength(0);
  });
});
