import { allowsShapePackContentLicense } from '@fluxion/core';
import type { QualifiedName, Result } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { importIconifyCollection } from './iconify-import.js';
import { iconifyShapePack, importedShapePack } from './imported-pack.js';
import { loadFlux, writePortableFlux } from './index.js';
import { sha256Hex } from './sha256.js';
import { importSvgShape, type SvgPaintWitness } from './svg-import.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const FILES = import.meta.glob('../../../specs/import/corpus/iconify/lucide.json', { query: '?raw', import: 'default', eager: true });
// Every 16th pinned Lucide icon plus the two the document uses, with their aliases. Packing all 2198 exceeded the timeout
// on loaded CI runners (M18.117); the editor's FR-LIB-005 test imports the complete collection, but no test packs all of it
function lucideSample(text: string): string {
  const collection = JSON.parse(text) as { icons: Record<string, unknown>; aliases: Record<string, { parent: string }> };
  const kept = Object.keys(collection.icons).filter((name, i) => i % 16 === 0 || name === 'album' || name === 'arrow-up');
  const icons = Object.fromEntries(kept.map((name) => [name, collection.icons[name]]));
  const aliases = Object.fromEntries(Object.entries(collection.aliases).filter(([, alias]) => Object.hasOwn(icons, alias.parent)));
  return JSON.stringify({ ...collection, icons, aliases });
}
const lucide = lucideSample(Object.values(FILES)[0] ?? 'null');

// Pure orchestration port, not evidence of actual host paint; M18.15/E2E owns that qualification.
const witness: SvgPaintWitness = async (r) => ({ identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) });
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
const licensePolicy = allowsShapePackContentLicense;
function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function document(ids: readonly QualifiedName[]) {
  const b = documentBuilder({ seed: 18101 });
  const screen = b.screen();
  for (const defId of ids) b.rect(screen, { defId });
  return b.build();
}
const save = (ids: readonly QualifiedName[], sources: Parameters<typeof writePortableFlux>[0]['shapePacks']['sources']) =>
  writePortableFlux({ document: document(ids), hasher, appVersion: '0.0.0', shapePacks: { sources, builtinIds: new Set(), licensePolicy } });

describe('imported collections as saveable credited packs (M18.101)', () => {
  it('FR-LIB-005 FR-LIB-009 NFR-LIC-003: a document using imported Lucide icons saves portably and reopens with geometry and credit', async () => {
    const report = await importIconifyCollection(lucide, { witness });
    const pack = value(iconifyShapePack(report, { licensePolicy }));
    // every accepted icon and alias is indexed, hidden ones (album) and aliases (inspect) included, with category files the index hashes exactly
    expect(pack.index.definitions).toHaveLength(136);
    expect(pack.index.definitions.map((d) => d.id)).toEqual(expect.arrayContaining(['lucide:album', 'lucide:inspect']));
    for (const [slug, entry] of Object.entries(pack.index.categories)) {
      expect(entry.path).toBe(`categories/${slug}.json`);
      expect(entry.sha256).toBe(sha256Hex(pack.categories.get(entry.path) ?? new Uint8Array()));
    }
    expect(pack.index.credits).toEqual([
      expect.objectContaining({
        license: 'ISC',
        attribution: 'Lucide by Lucide Contributors',
        source: expect.objectContaining({ kind: 'upstream', reference: 'iconify:lucide' }),
      }),
    ]);

    const used: QualifiedName[] = ['lucide:album', 'lucide:arrow-up'];
    expect((await save(used, [])).ok).toBe(false);
    const saved = value(await save(used, [pack.source]));
    const opened = value(await loadFlux(saved.bytes, { hasher, shapePackLicensePolicy: licensePolicy }));
    expect(opened.shapePacks.map((p) => p.definitions.map((d) => d.id))).toEqual([used]);
    expect(opened.shapePacks[0]?.credits).toEqual(pack.index.credits);
    expect(opened.shapePacks[0]?.version).toBe(pack.index.version);
  });

  it('FR-LIB-005 NFR-LIC-003: versions follow the source, and undeclared or unpermitted rights are refused', async () => {
    const collection = (extra: object) =>
      JSON.stringify({ prefix: 'tiny', icons: { dot: { body: '<circle cx="8" cy="8" r="4"/>' } }, info: { name: 'Tiny', author: { name: 'A' }, ...extra } });
    const packOf = async (text: string, version?: string) =>
      iconifyShapePack(await importIconifyCollection(text, { witness }), { licensePolicy, ...(version ? { version } : {}) });
    const a = value(await packOf(collection({ license: { spdx: 'MIT' } })));
    const again = value(await packOf(collection({ license: { spdx: 'MIT' } })));
    const changed = value(await packOf(collection({ license: { spdx: 'MIT' }, version: '2' })));
    expect(again.index).toEqual(a.index);
    expect(a.index.version).toMatch(/^0\.0\.0\+sha256\.[a-f0-9]{16}$/);
    expect(changed.index.version).not.toBe(a.index.version);
    expect(value(await packOf(collection({ license: { spdx: 'MIT' } }), '3.1.0')).index.version).toBe('3.1.0');
    expect((await packOf(collection({}))).ok).toBe(false);
    expect((await packOf(collection({ license: { spdx: 'LicenseRef-proprietary' } }))).ok).toBe(false);
    expect(iconifyShapePack({ status: 'failed', diagnostics: [] }, { licensePolicy }).ok).toBe(false);
  });

  it('FR-LIB-004 FR-LIB-009 NFR-LIC-003: a user-declared SVG import saves and reopens through the same pack path', async () => {
    // review r1 F3: a real single-SVG result, not an Iconify definition under another name
    const svg = value(await importSvgShape('<svg viewBox="0 0 10 10"><rect width="9" height="9" fill="#123456"/></svg>', { id: 'mine:box', witness }));
    const declared = {
      namespace: 'mine',
      version: '1.0.0',
      name: 'My shapes',
      license: 'CC0-1.0',
      attribution: 'Document author',
      notice: 'Drawn by the document author and dedicated to the public domain.',
      source: { kind: 'original' as const, author: 'Document author', statement: 'Original work of the document author.' },
      licensePolicy,
    };
    const entries = [{ definition: svg.definition, name: 'Box', fonts: svg.fonts }];
    const pack = value(importedShapePack({ ...declared, entries }));
    const opened = value(await loadFlux(value(await save(['mine:box'], [pack.source])).bytes, { hasher, shapePackLicensePolicy: licensePolicy }));
    expect(opened.shapePacks[0]?.definitions).toEqual([{ ...svg.definition, category: 'uncategorized' }]);
    expect(opened.shapePacks[0]?.credits.map((c) => c.source)).toEqual([declared.source]);
    const refused = (r: ReturnType<typeof importedShapePack>) => (r.ok ? [] : r.error.map((d) => d.path));
    expect(refused(importedShapePack({ ...declared, entries: [] }))).toEqual(['/entries']);
    expect(refused(importedShapePack({ ...declared, namespace: 'other', entries }))).toEqual(['/entries/0/definition/id']);
    // review r1 F2: index diagnostics name the caller's entry too
    expect(refused(importedShapePack({ ...declared, entries: [{ ...entries[0], name: '' }] as typeof entries }))).toEqual(['/entries/0/name']);
  });

  it('FR-LIB-005 NFR-LIC-003: categories keep distinct slugs, and font-bearing icons are refused rather than saved without faces', async () => {
    const icon = { body: '<path d="M2 2h12v12H2z"/>' };
    const categorized = JSON.stringify({
      prefix: 'cats',
      info: { name: 'Cats', license: { spdx: 'MIT' } },
      icons: { a: icon, b: icon, c: icon, d: icon, e: icon },
      categories: { 'Charts & Graphs': ['a'], 'Charts Graphs': ['b'], Флаги: ['c'], 矢印: ['d'] },
    });
    const pack = value(iconifyShapePack(await importIconifyCollection(categorized, { witness }), { licensePolicy }));
    const slugs = ['charts-graphs', 'charts-graphs-2', 'category', 'category-2', 'uncategorized'];
    expect(pack.index.definitions.map((d) => [d.id, d.category])).toEqual(['a', 'b', 'c', 'd', 'e'].map((n, i) => [`cats:${n}`, slugs[i]]));
    expect([...pack.categories.keys()].sort()).toEqual(slugs.map((s) => `categories/${s}.json`).sort());
    expect(pack.source.definitions.map((d) => d.category)).toEqual(slugs);

    // review r1 F1: pack 1.0 has no font resources, so text artwork would reopen without its exact face
    const font = { family: 'Roboto', weight: 400, style: 'normal' as const, sha256: 'a'.repeat(64) };
    const texty = JSON.stringify({
      prefix: 'texty',
      info: { license: { spdx: 'MIT' } },
      icons: { api: { body: '<text x="2" y="12" font-size="8">API</text>' } },
    });
    const report = await importIconifyCollection(texty, { witness, fonts: [font], defaultFont: font.sha256 });
    expect(report.status === 'processed' && report.acceptedCount).toBe(1);
    const refused = iconifyShapePack(report, { licensePolicy });
    expect(!refused.ok && refused.error[0]?.message).toMatch(/needs exact fonts/);
  });
});
