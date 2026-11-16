// FR-LIB-009, FR-SHP-007: the definitions a document's icon slots name are loaded from the first-party packs like a shape's own
// (M19.38), so an opened slot draws its pack icon and the save embeds it.
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
const files = import.meta.glob('../node_modules/@fluxion/pack-*/pack/**/*.json', { query: '?raw', import: 'default', eager: true });
/** The first-party pack files as the catalog reads them. */
function packFiles() {
  const of = (match: (path: string) => boolean) =>
    Object.fromEntries(
      Object.entries(files)
        .filter(([path]) => match(path))
        .map(([path, text]) => [path, async () => text]),
    );
  return { indexes: of((p) => p.endsWith('/pack/index.json')), categories: of((p) => p.includes('/pack/categories/')) };
}

describe('icon slots and the first-party packs in the studio (M19.38)', () => {
  it('FR-LIB-009: a document opened with an icon slot naming a pack definition loads it and the save embeds it (M19.38)', async () => {
    const f = packFiles();
    const catalog = await loadPackCatalog(hasher, f.indexes, f.categories);
    const b = documentBuilder();
    const screen = b.screen();
    const card = b.rect(screen, { defId: 'basic:rect' as QualifiedName });
    const file = b.build();
    const records = { ...file.records, [card]: { ...(file.records[card] as object), icons: { icon: { defId: 'devices:laptop' } } } };
    // the slot's definition is used as the shape's own is; an image fill names no definition
    expect(usedDefIds(records as never).sort()).toEqual(['basic:rect', 'devices:laptop']);
    const withImage = { [card]: { ...(records[card] as object), icons: { icon: { defId: 'devices:laptop' }, logo: { assetId: 'a1' } } } };
    expect(usedDefIds(withImage as never).sort()).toEqual(['basic:rect', 'devices:laptop']);
    const opened = value(openDocument({ ...file, records } as never));
    const doc = documentCatalog(catalog, opened.core.registries.shapeDefs, new Set(), () => undefined);
    expect(await doc.resolve(usedDefIds(opened.core.store.toDocument().records))).toEqual([]);
    expect(opened.core.registries.shapeDefs.get('devices:laptop')).toBeDefined();
    // the save embeds the slot's definition: reopened, the file carries it
    const written = value(
      await writePortableFlux({
        document: opened.core.store.toDocument(),
        hasher,
        appVersion: '0',
        shapePacks: shapeSaveOptions([], doc.sources(), new Set()),
      }),
    );
    const reopened = value(await openFileBytes('slots.flux', written.bytes, hasher));
    expect((reopened.shapePacks ?? []).map((s) => [s.id, s.definitions.map((d) => d.id)])).toEqual([['devices', ['devices:laptop']]]);
  });
});
