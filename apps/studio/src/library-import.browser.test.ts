// FR-LIB-004 FR-LIB-009: the studio's SVG library importer (M18.17) converts through the shipped renderer's witness over this page with
// fonts-core's Inter, registers the final pack into the open document with its exact face, keeps its source for the save, and releases
// both on dispose. FR-LIB-005 FR-LIB-006 (M18.210): an Iconify collection and a draw.io library convert through the same witness and
// fonts and register the same way, their sources kept for the save.
import { artworkFontAlias } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import { describe, expect, it, vi } from 'vitest';
import { openDocument } from './bootstrap.js';
import { loadDocument } from './documents.js';
import { studioLibraryImports } from './library-import.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?url' | '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const badge =
  Object.values(import.meta.glob('../../../specs/import/corpus/svg/original-label-badge.svg', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const donut =
  Object.values(import.meta.glob('../../../specs/import/corpus/svg/original-donut.svg', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const aliases =
  Object.values(import.meta.glob('../../../specs/import/corpus/iconify/original-aliases.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const mixed =
  Object.values(import.meta.glob('../../../specs/import/corpus/drawio/original-mixed.xml', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const item = (name: string, text: string) => {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.byteLength, bytes: async () => bytes };
};
function opened() {
  const file = loadDocument('new', seededRandom(1));
  if (!file.ok) throw new Error(file.error);
  const doc = openDocument(file.value);
  if (!doc.ok) throw new Error(doc.error);
  return doc.value;
}
const request = {
  namespace: 'mine',
  version: '1.0.0',
  name: 'Mine',
  rights: { kind: 'original', license: 'MIT', attribution: 'Me', author: 'Me' },
} as const;

describe('studioLibraryImports (FR-LIB-004)', () => {
  it('FR-LIB-009: a text badge converts to a 1.1 pack in Inter, registers with its face, its source is kept, and dispose releases them', async () => {
    const doc = opened();
    const imports = studioLibraryImports(doc, { document, fetch: (...args) => fetch(...args), now: () => Date.now() });
    expect(imports.importer.colorTokens).toContain('{color.primary}');
    const converted = await imports.importer.convert({ kind: 'files', items: [item('label-badge.svg', badge), item('donut.svg', donut)] }, request);
    if (!converted.ok) throw new Error(JSON.stringify(converted.error));
    expect(converted.value.pack.index.formatVersion).toBe('1.1');
    const [sha256] = [...converted.value.pack.source.fonts.keys()];
    expect(converted.value.colors).toContain('#2878c8');
    // nothing is registered by converting
    expect(doc.core.registries.shapeDefs.get('mine:donut')).toBeUndefined();

    const changed = vi.fn();
    imports.subscribe(changed);
    const registered = await imports.importer.register(converted.value.pack);
    expect(registered.ok).toBe(true);
    expect(doc.core.registries.shapeDefs.get('mine:donut')).toBeDefined();
    expect(imports.sources()).toEqual([converted.value.pack.source]);
    expect(changed).toHaveBeenCalledTimes(1);
    const alias = artworkFontAlias(sha256 ?? '');
    expect([...document.fonts].filter((f) => f.family.replaceAll('"', '') === alias)).toHaveLength(1);

    // a held namespace is refused, keeping what is there
    expect((await imports.importer.register(converted.value.pack)).ok).toBe(false);
    expect(imports.sources()).toHaveLength(1);

    imports.dispose();
    expect(doc.core.registries.shapeDefs.get('mine:donut')).toBeUndefined();
    expect(imports.sources()).toEqual([]);
    // the face leaves the set once its load settles
    await vi.waitFor(() => expect([...document.fonts].filter((f) => f.family.replaceAll('"', '') === alias)).toHaveLength(0));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('FR-LIB-004: a mapped color is kept on the artwork as its token reference', async () => {
    const imports = studioLibraryImports(opened(), { document, fetch: (...args) => fetch(...args), now: () => Date.now() });
    const converted = await imports.importer.convert(
      { kind: 'files', items: [item('donut.svg', donut)] },
      { ...request, colors: { '#2878c8': '{color.primary}' as never } },
    );
    if (!converted.ok) throw new Error(JSON.stringify(converted.error));
    // the literal stays as written; the renderer draws it through the token
    expect(converted.value.pack.source.definitions[0]?.artwork?.colors).toEqual({ '#2878c8': '{color.primary}' });
  });
  it('FR-LIB-009: a pack whose registration ends after the document closed is released, and a later import still registers', async () => {
    const doc = opened();
    const imports = studioLibraryImports(doc, { document, fetch: (...args) => fetch(...args), now: () => Date.now() });
    const converted = await imports.importer.convert({ kind: 'files', items: [item('label-badge.svg', badge)] }, request);
    if (!converted.ok) throw new Error(JSON.stringify(converted.error));
    const alias = artworkFontAlias([...converted.value.pack.source.fonts.keys()][0] ?? '');
    const pending = imports.importer.register(converted.value.pack);
    imports.dispose();
    expect((await pending).ok).toBe(false);
    expect(doc.core.registries.shapeDefs.get('mine:label-badge')).toBeUndefined();
    expect(imports.sources()).toEqual([]);
    await vi.waitFor(() => expect([...document.fonts].filter((f) => f.family.replaceAll('"', '') === alias)).toHaveLength(0));
    // the importer is not spent: the next import registers
    expect((await imports.importer.register(converted.value.pack)).ok).toBe(true);
    expect(doc.core.registries.shapeDefs.get('mine:label-badge')).toBeDefined();
    imports.dispose();
  });

  it('FR-LIB-005 FR-LIB-009: an Iconify collection with its own licence converts, registers and keeps its source for the save', async () => {
    const doc = opened();
    const imports = studioLibraryImports(doc, { document, fetch: (...args) => fetch(...args), now: () => Date.now() });
    const licensed = JSON.stringify({ ...JSON.parse(aliases), info: { name: 'Corpus', author: { name: 'Fluxion' }, license: { spdx: 'MIT' } } });
    const converted = await imports.importer.convertCollection?.({ kind: 'iconify', item: item('corpus.json', licensed) }, undefined);
    if (!converted?.ok) throw new Error(JSON.stringify(converted?.error));
    expect(converted.value.pack.index).toMatchObject({ id: 'fluxion-corpus', name: 'Corpus', license: 'MIT' });
    expect(converted.value.pack.source.definitions.map((d) => d.id)).toContain('fluxion-corpus:mirrored');
    expect((await imports.importer.register(converted.value.pack)).ok).toBe(true);
    expect(doc.core.registries.shapeDefs.get('fluxion-corpus:mirrored')).toBeDefined();
    expect(imports.sources()).toEqual([converted.value.pack.source]);
    imports.dispose();
  });

  it('FR-LIB-006 FR-LIB-009: a draw.io library converts under its declared credit, registers and keeps its source for the save', async () => {
    const doc = opened();
    const imports = studioLibraryImports(doc, { document, fetch: (...args) => fetch(...args), now: () => Date.now() });
    const converted = await imports.importer.convertCollection?.({ kind: 'drawio', item: item('mixed.xml', mixed) }, { ...request, namespace: 'mixed' });
    if (!converted?.ok) throw new Error(JSON.stringify(converted?.error));
    expect(converted.value.pack.index).toMatchObject({ id: 'mixed', license: 'MIT', attribution: 'Me' });
    const ids = converted.value.pack.source.definitions.map((d) => d.id);
    expect(ids.length).toBeGreaterThan(0);
    expect((await imports.importer.register(converted.value.pack)).ok).toBe(true);
    expect(ids.every((id) => doc.core.registries.shapeDefs.get(id) !== undefined)).toBe(true);
    expect(imports.sources()).toEqual([converted.value.pack.source]);
    imports.dispose();
    expect(ids.some((id) => doc.core.registries.shapeDefs.get(id) !== undefined)).toBe(false);
  });
});
