import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { buildLibraryIndex } from '@fluxion/editor';
import { sha256Hex, writePortableFlux } from '@fluxion/format';
import type { QualifiedName, Result } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { openDocument } from './bootstrap.js';
import { openFileBytes } from './file-session.js';
import { shapeSaveOptions } from './file-shapes.js';
import { documentCatalog, loadPackCatalog, usedDefIds } from './pack-catalog.js';

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
});
