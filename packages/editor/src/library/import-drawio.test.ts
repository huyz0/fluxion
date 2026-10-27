import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRegistry, type ShapeDef } from '@fluxion/core';
import type { SvgPaintWitness } from '@fluxion/format';
import { expect, it } from 'vitest';
import { importDrawioLibrary } from './import-drawio.js';
import { buildLibraryIndex } from './library-search.js';

// Pure orchestration port, not evidence of actual host paint; M18.15/E2E owns that qualification.
const witness: SvgPaintWitness = async (r) => ({ identity: r.identity, status: 'painted', fontHashes: r.fonts.map((f) => f.sha256) });
const repo = join(import.meta.dirname, '../../../..');
const manifest = JSON.parse(readFileSync(join(repo, 'specs/import/corpus/manifest.json'), 'utf8')) as {
  drawio: { path: string; entries: number; denominator: number }[];
};
const thresholds = readFileSync(join(repo, 'scripts/gates/thresholds.mjs'), 'utf8');
const MIN_PCT = Number(/DRAWIO_LIB_IMPORT_MIN_PCT: \{ value: (\d+)/.exec(thresholds)?.[1]);
// labels need an exact face; the host declares its loaded default (an identity only: the pure port loads no bytes)
const font = { family: 'Roboto', weight: 400, style: 'normal' as const, sha256: 'b'.repeat(64) };

it('FR-LIB-006: each pinned library separately imports at least DRAWIO_LIB_IMPORT_MIN_PCT of its full denominator', async () => {
  expect(MIN_PCT).toBe(90);
  expect(manifest.drawio).toHaveLength(3);
  for (const [i, library] of manifest.drawio.entries()) {
    const registry = createRegistry<string, ShapeDef>('shapeDefs');
    const text = readFileSync(join(repo, 'specs/import/corpus', library.path), 'utf8');
    const imported = await importDrawioLibrary(registry, text, { witness, namespace: `lib${i}`, fonts: [font], defaultFont: font.sha256, source: 'import' });
    expect(imported.ok, library.path).toBe(true);
    if (!imported.ok) continue;
    const { report, entries } = imported.value;
    expect(report.entryCount, library.path).toBe(library.denominator);
    expect((100 * report.acceptedCount) / library.denominator, library.path).toBeGreaterThanOrEqual(MIN_PCT);
    expect(registry.list()).toHaveLength(report.acceptedCount);
    for (const e of report.entries) if (e.status === 'refused') expect(e.diagnostics.length).toBeGreaterThan(0);
    expect(buildLibraryIndex(entries).size).toBe(report.acceptedCount);
  }
});

it('FR-LIB-006 NFR-SEC-001: a hostile library registers nothing; a held namespace is refused', async () => {
  const registry = createRegistry<string, ShapeDef>('shapeDefs');
  const hostile = '<!DOCTYPE shapes [<!ENTITY x SYSTEM "file:///etc/passwd">]><shapes><shape name="&x;"/></shapes>';
  expect((await importDrawioLibrary(registry, hostile, { witness, namespace: 'x', source: 'import' })).ok).toBe(false);
  const text = readFileSync(join(repo, 'specs/import/corpus/drawio/original-stencils.xml'), 'utf8');
  const first = await importDrawioLibrary(registry, text, { witness, namespace: 'mine', source: 'a' });
  expect(first.ok && first.value.entries.find((e) => e.id === 'mine:rectangle')).toBeTruthy();
  expect((await importDrawioLibrary(registry, text, { witness, namespace: 'mine', source: 'b' })).ok).toBe(false);
  expect(registry.list()).toHaveLength(first.ok ? first.value.report.acceptedCount : -1);
});
