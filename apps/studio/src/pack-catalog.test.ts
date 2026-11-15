import { allowsShapePackContentLicense, createCoreRegistries, encodeShapePack, type ShapeDef } from '@fluxion/core';
import { buildLibraryIndex } from '@fluxion/editor';
import { sha256Hex, writePortableFlux } from '@fluxion/format';
import { connectorDefOf } from '@fluxion/routing';
import type { QualifiedName, Result } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { openDocument } from './bootstrap.js';
import { openFileBytes } from './file-session.js';
import { shapeSaveOptions } from './file-shapes.js';
import { bundledPackCatalog, documentCatalog, loadPackCatalog, registerPackConnectors, usedDefIds } from './pack-catalog.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
function value<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
/** LIBRARY_SEARCH_10K_MAX_MS, read as text: tests do not import the gate's module. */
const SEARCH_MAX_MS = Number(
  /LIBRARY_SEARCH_10K_MAX_MS: \{ value: ([\d.]+)/.exec(
    import.meta.glob('../../../scripts/gates/thresholds.mjs', { query: '?raw', import: 'default', eager: true })[
      '../../../scripts/gates/thresholds.mjs'
    ] as string,
  )?.[1],
);
/** The first-party pack files, eagerly, wrapped as the catalog reads them, with every category read noted. */
const files = import.meta.glob('../node_modules/@fluxion/pack-*/pack/**/*.json', { query: '?raw', import: 'default', eager: true });
function packFiles(): {
  readonly indexes: Record<string, () => Promise<string>>;
  readonly categories: Record<string, () => Promise<string>>;
  readonly read: string[];
} {
  const read: string[] = [];
  const of = (match: (path: string) => boolean, note: boolean) =>
    Object.fromEntries(
      Object.entries(files)
        .filter(([path]) => match(path))
        .map(([path, text]) => [
          path,
          async () => {
            if (note) read.push(path);
            return text;
          },
        ]),
    );
  return { indexes: of((p) => p.endsWith('/pack/index.json'), false), categories: of((p) => p.includes('/pack/categories/'), true), read };
}

describe('the first-party packs in the studio library (M18.32)', () => {
  it('FR-LIB-007, FR-LIB-009: every pack index is verified and listed by its names without reading a category', async () => {
    const f = packFiles();
    const catalog = await loadPackCatalog(hasher, f.indexes, f.categories);
    expect(catalog.refused).toEqual([]);
    expect(catalog.loaders.map((l) => l.index.name).sort()).toEqual(
      [
        'Arrows',
        'Basic shapes',
        'BPMN-lite',
        'Callouts',
        'Cloud architecture',
        'Devices',
        'Flowchart',
        'Infographic',
        'Lucide icons',
        'Network',
        'People',
        'UML',
      ].sort(),
    );
    const doc = documentCatalog(catalog, createCoreRegistries().shapeDefs, new Set(), () => undefined);
    expect(doc.entries.length).toBe(catalog.loaders.reduce((n, l) => n + l.index.definitions.length, 0));
    expect(doc.entries.find((e) => e.id === 'devices:usb-drive')).toEqual(
      expect.objectContaining({ name: 'USB drive', pack: 'devices', packName: 'Devices', category: 'peripherals' }),
    );
    expect(f.read).toEqual([]);
  });

  it('FR-LIB-001, FR-LIB-007: searching the complete first-party index finds the cylinder and the database icons under LIBRARY_SEARCH_10K_MAX_MS', async () => {
    const f = packFiles();
    const doc = documentCatalog(await loadPackCatalog(hasher, f.indexes, f.categories), createCoreRegistries().shapeDefs, new Set(), () => undefined);
    const index = buildLibraryIndex(doc.entries);
    const start = performance.now();
    const found = index.search('database');
    expect(performance.now() - start).toBeLessThan(SEARCH_MAX_MS);
    expect(found.map((e) => e.id)).toEqual(expect.arrayContaining(['basic:cylinder', 'cloud:database', 'lucide:database']));
    // a pack's own name finds its entries
    expect(index.search('lucide icons').length).toBe(doc.entries.filter((e) => e.pack === 'lucide').length);
    expect(f.read).toEqual([]);
  });

  it('FR-LIB-009: ensure reads only the picked definition category, registers it once, and the save embeds only what was loaded', async () => {
    const f = packFiles();
    const catalog = await loadPackCatalog(hasher, f.indexes, f.categories);
    const defs = createCoreRegistries().shapeDefs;
    const doc = documentCatalog(catalog, defs, new Set(), () => undefined);
    expect(await doc.ensure('devices:laptop')).toBe(true);
    expect(f.read).toEqual(['../node_modules/@fluxion/pack-devices/pack/categories/computers.json']);
    expect(defs.get('devices:laptop')?.id).toBe('devices:laptop');
    expect(defs.source('devices:laptop')).toBe('devices');
    // a second pick reads nothing more
    expect(await doc.ensure('devices:laptop')).toBe(true);
    expect(f.read).toHaveLength(1);
    expect(doc.sources()).toEqual([expect.objectContaining({ kind: 'distribution', definitions: [expect.objectContaining({ id: 'devices:laptop' })] })]);
    // an id no pack has is refused
    expect(await doc.ensure('devices:nothing')).toBe(false);
    expect(await doc.ensure('elsewhere:thing')).toBe(false);
  });

  it('FR-LIB-009: a document opened with a pack used loads it, saves only that definition, and reopens it from the file', async () => {
    const f = packFiles();
    const catalog = await loadPackCatalog(hasher, f.indexes, f.categories);
    const b = documentBuilder();
    const screen = b.screen();
    for (const defId of ['devices:laptop', 'people:person', 'basic:rect'] as QualifiedName[]) b.rect(screen, { defId });
    const opened = value(openDocument(b.build()));
    const doc = documentCatalog(catalog, opened.core.registries.shapeDefs, new Set(), () => undefined);
    expect(await doc.resolve(usedDefIds(opened.core.store.toDocument().records))).toEqual([]);
    expect(opened.core.registries.shapeDefs.get('people:person')).toBeDefined();
    const written = value(
      await writePortableFlux({
        document: opened.core.store.toDocument(),
        hasher,
        appVersion: '0',
        shapePacks: shapeSaveOptions([], doc.sources(), new Set()),
      }),
    );
    const reopened = value(await openFileBytes('packs.flux', written.bytes, hasher));
    const saved = reopened.shapePacks ?? [];
    expect(saved.map((s) => [s.id, s.definitions.map((d) => d.id)]).sort()).toEqual([
      ['devices', ['devices:laptop']],
      ['people', ['people:person']],
    ]);
    // the reopened document's own geometry stands for those packs: the catalog leaves them out
    const again = documentCatalog(catalog, createCoreRegistries().shapeDefs, new Set(saved.map((s) => s.id)), () => undefined);
    expect(again.entries.some((e) => e.pack === 'devices' || e.pack === 'people')).toBe(false);
    expect(await again.ensure('devices:tablet')).toBe(false);
  });

  it('FR-LIB-009: a namespace an imported library already holds is not loaded into, so a save never embeds two sources of it', async () => {
    const f = packFiles();
    const catalog = await loadPackCatalog(hasher, f.indexes, f.categories);
    const defs = createCoreRegistries().shapeDefs;
    const problems: string[] = [];
    const doc = documentCatalog(catalog, defs, new Set(), (m) => problems.push(m));
    // the catalog's own loads into a namespace do not refuse each other
    expect(await doc.ensure('devices:laptop')).toBe(true);
    expect(await doc.ensure('devices:desktop')).toBe(true);
    // another document where an SVG library imported as `devices` (M18.17) registered first
    const imported = createCoreRegistries().shapeDefs;
    value(imported.register('devices:my-icon', { ...(defs.get('devices:laptop') as ShapeDef), id: 'devices:my-icon' }, 'devices'));
    const other = documentCatalog(catalog, imported, new Set(), (m) => problems.push(m));
    expect(await other.ensure('devices:laptop')).toBe(false);
    expect(imported.get('devices:laptop')).toBeUndefined();
    expect(other.sources()).toEqual([]);
    expect(problems).toEqual(['The shape devices:laptop could not be loaded: the namespace devices is held by another library']);
  });

  it('FR-LIB-009: a definition that fails its category check is reported and not registered', async () => {
    const f = packFiles();
    const tampered = Object.fromEntries(
      Object.entries(f.categories).map(([path, read]) => [
        path,
        path.endsWith('pack-devices/pack/categories/computers.json') ? async () => `${await read()} ` : read,
      ]),
    );
    const catalog = await loadPackCatalog(hasher, f.indexes, tampered);
    const defs = createCoreRegistries().shapeDefs;
    const problems: string[] = [];
    const doc = documentCatalog(catalog, defs, new Set(), (m) => problems.push(m));
    expect(await doc.ensure('devices:laptop')).toBe(false);
    expect(defs.get('devices:laptop')).toBeUndefined();
    expect(problems).toEqual([expect.stringContaining('devices:laptop could not be loaded')]);
    expect(doc.sources()).toEqual([]);
  });

  it("FR-LIB-009, FR-LIB-007: one pack index that fails to read refuses that pack alone, and another pack's shapes still resolve (M18.216)", async () => {
    const f = packFiles();
    const failing = Object.fromEntries(
      Object.entries(f.indexes).map(([path, read]) => [path, path.includes('/pack-devices/') ? () => Promise.reject(new Error('network error')) : read]),
    );
    const catalog = await loadPackCatalog(hasher, failing, f.categories);
    expect(catalog.refused).toEqual([expect.stringMatching(/pack-devices\/pack\/index\.json: network error$/)]);
    expect(catalog.loaders.some((l) => l.index.id === 'people')).toBe(true);
    expect(catalog.loaders.some((l) => l.index.id === 'devices')).toBe(false);
    const b = documentBuilder();
    const screen = b.screen();
    for (const defId of ['devices:laptop', 'people:person'] as QualifiedName[]) b.rect(screen, { defId });
    const opened = value(openDocument(b.build()));
    const doc = documentCatalog(catalog, opened.core.registries.shapeDefs, new Set(), () => undefined);
    // devices is not in the catalog, so only people's shape is wanted, and it resolves
    expect(await doc.resolve(usedDefIds(opened.core.store.toDocument().records))).toEqual([]);
    expect(opened.core.registries.shapeDefs.get('people:person')).toBeDefined();
  });

  it('FR-LIB-009: a category file that fails to read is reported, not thrown, and another pack still loads (M18.216)', async () => {
    const f = packFiles();
    const failing = Object.fromEntries(
      Object.entries(f.categories).map(([path, read]) => [
        path,
        path.endsWith('pack-devices/pack/categories/computers.json') ? () => Promise.reject(new Error('network error')) : read,
      ]),
    );
    const catalog = await loadPackCatalog(hasher, f.indexes, failing);
    const defs = createCoreRegistries().shapeDefs;
    const problems: string[] = [];
    const doc = documentCatalog(catalog, defs, new Set(), (m) => problems.push(m));
    expect(await doc.resolve(['devices:laptop', 'people:person'])).toEqual(['devices:laptop']);
    expect(problems).toEqual([expect.stringContaining('The shape devices:laptop could not be loaded: category could not be read')]);
    expect(defs.get('people:person')).toBeDefined();
  });

  it('FR-LIB-009: a bundled catalog read that rejects is not kept for the page, so the next use reads again (M18.216)', async () => {
    const rejected = bundledPackCatalog(hasher, () => Promise.reject(new Error('offline')));
    await expect(rejected).rejects.toThrow('offline');
    const f = packFiles();
    const again = await bundledPackCatalog(hasher, (h) => loadPackCatalog(h, f.indexes, f.categories));
    expect(again.loaders.length).toBeGreaterThan(0);
    // and a catalog that was read is kept
    expect(await bundledPackCatalog(hasher, () => Promise.reject(new Error('not read again')))).toBe(again);
  });
});

describe("the first-party packs' connector types in the studio (M18.251)", () => {
  const connectorFiles = (edit?: (text: string) => string) =>
    Object.fromEntries(
      Object.entries(files)
        .filter(([path]) => path.endsWith('/pack/connectors.json'))
        .map(([path, text]) => [path, async () => (edit ? edit(text as string) : (text as string))]),
    );
  const joined = () => {
    const b = documentBuilder({ seed: 251 });
    const s = b.screen();
    const [a, c] = [0, 1].map((i) => b.rect(s, { x: i * 200, y: 0, w: 80, h: 50 })) as [never, never];
    b.connect(a, c, { route: 'arrows:wavy' });
    return b.build();
  };

  it("FR-CON-010, FR-LIB-009: a pack's connectors.json is read with its index and its types registered in an open document's routers until disposed", async () => {
    const f = packFiles();
    const catalog = await loadPackCatalog(hasher, f.indexes, f.categories, connectorFiles());
    expect(catalog.refused).toEqual([]);
    expect(catalog.connectors.map((c) => [c.pack, c.definitions.map((d) => d.id)])).toEqual([
      ['arrows', ['arrows:cable', 'arrows:double', 'arrows:pipe', 'arrows:wavy', 'arrows:zigzag']],
    ]);
    const opened = value(openDocument(joined()));
    const problems: string[] = [];
    const registered = registerPackConnectors(catalog, opened.registries.routers, new Set(), (m) => problems.push(m));
    expect(connectorDefOf(opened.registries.routers, 'arrows:wavy')?.decoration).toEqual({ kind: 'wavy', amplitude: 3, wavelength: 12 });
    expect(problems).toEqual([]);
    registered.dispose();
    expect(opened.registries.routers.get('arrows:wavy')).toBeUndefined();
  });

  it("FR-CON-010: a refused connectors.json is listed under the refused packs and drops only its types, the pack's shapes still listed", async () => {
    const f = packFiles();
    const catalog = await loadPackCatalog(
      hasher,
      f.indexes,
      f.categories,
      connectorFiles((t) => t.replace('"orthogonal"', '"spiral"')),
    );
    expect(catalog.connectors).toEqual([]);
    expect(catalog.refused).toHaveLength(1);
    expect(catalog.refused[0]).toMatch(/pack-arrows\/pack\/connectors\.json: /);
    expect(catalog.loaders.map((l) => l.index.id)).toContain('arrows');
  });

  it('FR-CON-010, FR-LIB-009: a connectors.json that fails to read drops only its types, never the catalog (M18.251 r4 F1)', async () => {
    const f = packFiles();
    const files = Object.fromEntries(Object.keys(connectorFiles((t) => t)).map((path) => [path, () => Promise.reject(new Error('chunk failed'))]));
    const catalog = await loadPackCatalog(hasher, f.indexes, f.categories, files);
    expect(catalog.connectors).toEqual([]);
    expect(catalog.refused).toEqual([expect.stringMatching(/pack-arrows\/pack\/connectors\.json: chunk failed$/)]);
    expect(catalog.loaders.map((l) => l.index.id)).toContain('arrows');
  });

  it("FR-LIB-009: a namespace the opened file carries its own types for keeps the file's types (ADR-0183's rule)", async () => {
    const f = packFiles();
    const catalog = await loadPackCatalog(hasher, f.indexes, f.categories, connectorFiles());
    const saved = { id: 'arrows:wavy', router: 'orthogonal', decoration: { kind: 'wavy', amplitude: 6, wavelength: 20 } };
    const opened = value(
      openDocument(joined(), { connectors: [{ pack: 'arrows', input: { format: 'fluxion-connector-defs', formatVersion: '1.0', definitions: [saved] } }] }),
    );
    const registered = registerPackConnectors(catalog, opened.registries.routers, new Set(['arrows']), () => undefined);
    expect(connectorDefOf(opened.registries.routers, 'arrows:wavy')).toEqual(saved);
    expect(opened.registries.routers.get('arrows:pipe')).toBeUndefined();
    registered.dispose();
    expect(connectorDefOf(opened.registries.routers, 'arrows:wavy')).toEqual(saved);
  });

  it('FR-CON-010: a pack whose types another source holds is reported, nothing of it registered', async () => {
    const f = packFiles();
    const catalog = await loadPackCatalog(hasher, f.indexes, f.categories, connectorFiles());
    const opened = value(openDocument(joined()));
    const held = opened.registries.routers.register('arrows:wavy', opened.registries.routers.get('orthogonal') as never, 'other');
    expect(held.ok).toBe(true);
    const problems: string[] = [];
    registerPackConnectors(catalog, opened.registries.routers, new Set(), (m) => problems.push(m));
    expect(problems).toEqual([expect.stringMatching(/^The connector types of arrows could not be registered: /)]);
    expect(opened.registries.routers.get('arrows:pipe')).toBeUndefined();
  });
});

// FR-SHP-007: a first-party pack written at a later format version (1.3 for a definition with icon slots, M19.17) is read like a
// 1.0 one; a definition bound to artwork fonts is refused, the catalog neither registering nor saving font faces.
describe('later pack versions in the studio library (M19.36)', () => {
  const card = {
    id: 'slotted:card',
    outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
    iconSlots: [{ name: 'icon', x: 0.05, y: 0.1, w: 0.2, h: 0.8 }],
    defaultSize: { w: 120, h: 60 },
  } as ShapeDef;
  const credit = {
    id: 'fluxion',
    license: 'MIT',
    attribution: 'Fluxion contributors',
    notice: 'MIT License',
    source: { kind: 'original', author: 'Fluxion contributors', statement: 'Original artwork.' },
  } as const;
  /** A 1.3 pack holding `card`, as the catalog reads a first-party pack's files. */
  function slottedPack() {
    const pack = value(
      encodeShapePack(
        {
          id: 'slotted',
          version: '1.0.0',
          name: 'Slotted',
          license: 'MIT',
          attribution: 'Fluxion contributors',
          credits: [credit],
          definitions: [{ name: 'Card', def: card }],
        },
        allowsShapePackContentLicense,
      ),
    );
    const root = '../node_modules/@fluxion/pack-slotted/pack/';
    const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    const entries = [...pack.files].map(([path, bytes]) => [`${root}${path}`, async () => text(bytes)] as const);
    return {
      version: pack.index.formatVersion,
      indexes: Object.fromEntries(entries.filter(([path]) => path.endsWith('/index.json'))),
      categories: Object.fromEntries(entries.filter(([path]) => path.includes('/categories/'))),
    };
  }

  it('FR-SHP-007, FR-LIB-009: a 1.3 pack is listed, and its definition loads with its icon slots and is saved from its 1.3 index', async () => {
    const f = slottedPack();
    expect(f.version).toBe('1.3');
    const catalog = await loadPackCatalog(hasher, f.indexes, f.categories, {});
    expect(catalog.refused).toEqual([]);
    const defs = createCoreRegistries().shapeDefs;
    const doc = documentCatalog(catalog, defs, new Set(), () => undefined);
    expect(doc.entries.map((e) => e.id)).toEqual(['slotted:card']);
    expect(await doc.resolve(['slotted:card'])).toEqual([]);
    expect(defs.get('slotted:card')?.iconSlots).toEqual(card.iconSlots);
    expect(doc.sources().map((s) => (s.kind === 'distribution' ? s.index.formatVersion : s.kind))).toEqual(['1.3']);
  });

  it('FR-LIB-009: a definition bound to artwork fonts is reported and not registered, nothing of it fetched', async () => {
    const f = slottedPack();
    const [loader] = (await loadPackCatalog(hasher, f.indexes, f.categories, {})).loaders;
    if (loader === undefined) throw new Error('the pack was refused');
    // the index binds the card to a face, as a 1.1+ pack with artwork text does; an acquire would fetch its category and fonts
    const acquired: string[] = [];
    const fonted = {
      identity: loader.identity,
      index: { ...loader.index, definitionFonts: [{ definitionId: 'slotted:card', faceIds: ['inter-400'] }] },
      search: loader.search,
      acquire: async (id: string) => {
        acquired.push(id);
        return loader.acquire(id);
      },
    } as unknown as typeof loader;
    const defs = createCoreRegistries().shapeDefs;
    const problems: string[] = [];
    const doc = documentCatalog({ loaders: [fonted], connectors: [], refused: [] }, defs, new Set(), (m) => problems.push(m));
    expect(await doc.resolve(['slotted:card'])).toEqual(['slotted:card']);
    expect(problems).toEqual(['The shape slotted:card could not be loaded: its artwork fonts are not loaded from the bundled catalog']);
    expect(defs.get('slotted:card')).toBeUndefined();
    expect(await doc.installed('slotted:card')).toBeUndefined();
    expect(acquired).toEqual([]);
  });
});
