import { createCoreRegistries, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { describe, expect, it } from 'vitest';
import { patchJsonSchema } from '../patch/json-schema.js';
import { KEYS } from '../read/fields.js';
import { buildCatalog } from './catalog.js';
import { CHEAT_SHEET } from './cheatsheet.js';
import { formatCatalog } from './format.js';
import { catalogJsonSchema, isCatalogJson } from './json-schema.js';

const star = {
  id: 'basic:star',
  describe: 'A star with a chosen number of points.',
  params: { points: { type: 'int', min: 3, max: 64, default: 5 } },
} as unknown as ShapeDef;

function registries() {
  const r = createCoreRegistries();
  registerBuiltInLayouts(r.layouts);
  r.shapeDefs.register('basic:star', star, 'basic');
  r.markers.register('arrow', { id: 'arrow', path: 'M0 0', inset: 0, filled: true, describe: 'A filled arrowhead.' }, 'core');
  return r;
}

describe('catalog formats (FR-AI-002)', () => {
  it('FR-AI-002: the llm format is a kind header and one "id — describe" line per entry, params and options only with full detail', () => {
    const summary = formatCatalog(buildCatalog(registries()).catalog, 'llm');
    expect(summary).toBe(
      [
        'shapes:',
        'basic:star — A star with a chosen number of points.',
        'markers:',
        'arrow — A filled arrowhead.',
        'layouts:',
        ...['circular', 'force', 'grid', 'layered', 'mindmap', 'orgchart', 'packing', 'radial', 'stack', 'tree'].map(
          (id) => `${id} — ${buildCatalog(registries()).catalog.layouts.find((l) => l.id === id)?.describe}`,
        ),
        '',
      ].join('\n'),
    );
    const full = formatCatalog(buildCatalog(registries(), { detail: 'full' }).catalog, 'llm');
    expect(full).toContain('basic:star — A star with a chosen number of points.; params: points:int=5');
    expect(full).toMatch(/layered — .*; options: /);
  });

  it('FR-AI-002: the json format validates against the catalog schema, and a broken catalog does not', () => {
    const { catalog } = buildCatalog(registries(), { detail: 'full' });
    const text = formatCatalog(catalog, 'json');
    expect(isCatalogJson(JSON.parse(text))).toBe(true);
    expect(isCatalogJson({ ...JSON.parse(text), shapes: [{ id: 'x' }] })).toBe(false);
    expect(isCatalogJson({ ...JSON.parse(text), extra: [] })).toBe(false);
  });

  it('FR-AI-002: the md format has a heading per kind that has entries and a bullet per entry with its plugin', () => {
    const md = formatCatalog(buildCatalog(registries()).catalog, 'md');
    expect(md).toContain('# Fluxion catalog');
    expect(md).toContain('## Shapes\n\n- `basic:star` (basic): A star with a chosen number of points.');
    expect(md).toContain('## Layouts');
    expect(md).not.toContain('## Themes');
  });

  it('FR-AI-001: the committed specs/schema/catalog.schema.json equals the schema generated from the Zod catalog (drift test)', async () => {
    await expect(`${JSON.stringify(catalogJsonSchema(), null, 2)}\n`).toMatchFileSnapshot('../../../../specs/schema/catalog.schema.json');
  });
});

describe('the cheat sheet (FR-AI-002, NFR-AI-002)', () => {
  it('FR-AI-002: names every key the compiler reads at each level of a document', () => {
    for (const level of Object.values(KEYS)) for (const key of level.compiled) expect(CHEAT_SHEET).toContain(key);
  });

  it('FR-AI-003: names every op of the AI patch, so the sheet and the patch format cannot drift apart', () => {
    const names = [...JSON.stringify(patchJsonSchema()).matchAll(/"op":\{"type":"string","const":"([A-Za-z]+)"/g)].map((m) => m[1] ?? '');
    expect(names.length).toBe(9);
    for (const op of names) expect(CHEAT_SHEET).toContain(`- ${op}:`);
  });
});
