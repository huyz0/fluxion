import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRegistry, type ShapeDef } from '@fluxion/core';
import type { SvgPaintWitness } from '@fluxion/format';
import { expect, it } from 'vitest';
import { importIconifyLibrary } from './import-iconify.js';
import { buildLibraryIndex } from './library-search.js';

// Pure orchestration port, not evidence of actual host paint; M18.15/E2E owns that qualification.
const witness: SvgPaintWitness = async (r) => ({ identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) });
const corpus = (name: string) => readFileSync(join(import.meta.dirname, '../../../../specs/import/corpus/iconify', name), 'utf8');

it('FR-LIB-005: the complete pinned Lucide collection registers every icon and alias, searchable by name and keyword', async () => {
  const registry = createRegistry<string, ShapeDef>('shapeDefs');
  const text = corpus('lucide.json');
  const raw = JSON.parse(text) as { icons: Record<string, { hidden?: boolean }>; aliases: Record<string, { parent: string }> };
  const imported = await importIconifyLibrary(registry, text, { witness, source: 'import:lucide' });
  expect(imported.ok).toBe(true);
  if (!imported.ok) return;
  const { report, entries, hidden } = imported.value;
  // Actual entries define the inventory, not the advertised info.total of 1903.
  expect([report.iconCount, report.aliasCount, report.acceptedCount]).toEqual([1978, 220, 2198]);
  expect(registry.list()).toHaveLength(2198);
  const hiddenNames = Object.keys(raw.icons).filter((n) => raw.icons[n]?.hidden);
  expect(hidden.size).toBe(hiddenNames.length + Object.values(raw.aliases).filter((a) => raw.icons[a.parent]?.hidden).length);
  expect(entries).toHaveLength(2198 - hidden.size);
  expect(report.provenance).toMatchObject({ prefix: 'lucide', name: 'Lucide', author: 'Lucide Contributors', license: 'ISC' });
  for (const [, def] of registry.list()) expect(def.anchors?.length).toBeGreaterThanOrEqual(4);
  const index = buildLibraryIndex(entries);
  expect(
    index
      .search('house')
      .slice(0, 2)
      .map((e) => e.id),
  ).toEqual(['lucide:home', 'lucide:house']);
  expect(index.search('arrow down').length).toBeGreaterThan(10);
  // an alias is its own entry and finds its parent through keywords
  expect(index.search('alert circle').map((e) => e.id)).toEqual(expect.arrayContaining(['lucide:alert-circle', 'lucide:circle-alert']));
  for (const id of hidden) {
    expect(registry.get(id)).toBeDefined();
    expect(entries.some((e) => e.id === id)).toBe(false);
  }
}, 60_000);

it('FR-LIB-005: a held namespace or a failed registration leaves the registry unchanged', async () => {
  const registry = createRegistry<string, ShapeDef>('shapeDefs');
  const text = corpus('original-aliases.json');
  const first = await importIconifyLibrary(registry, text, { witness, source: 'a' });
  expect(first.ok && first.value.entries.map((e) => e.id)).toEqual([
    'fluxion-corpus:root',
    'fluxion-corpus:mirrored',
    'fluxion-corpus:nested',
    'fluxion-corpus:turned',
  ]);
  expect(first.ok && [...first.value.hidden]).toEqual(['fluxion-corpus:hidden']);
  expect((await importIconifyLibrary(registry, text, { witness, source: 'b' })).ok).toBe(false);
  expect(registry.list()).toHaveLength(5);
  if (first.ok) first.value.dispose();
  expect(registry.list()).toHaveLength(0);
  const failed = await importIconifyLibrary(registry, 'not json', { witness, source: 'a' });
  expect(failed.ok).toBe(false);
  // a refusal part way through rolls back the definitions already registered
  const held = { id: 'x:y', outline: { path: 'M 0 0 Z' }, defaultSize: { w: 1, h: 1 } } as ShapeDef;
  registry.register('x:y', held, 'held');
  let calls = 0;
  const flaky = {
    list: () => registry.list(),
    register: (k: string, v: ShapeDef, src: string) => (++calls === 3 ? registry.register('x:y', v, src) : registry.register(k, v, src)),
  } as unknown as typeof registry;
  expect((await importIconifyLibrary(flaky, text, { witness, source: 'a' })).ok).toBe(false);
  expect(calls).toBe(3);
  expect(registry.list().map(([id]) => id)).toEqual(['x:y']);
});
