import { describe, expect, it } from 'vitest';
import type { ShapeDef } from '../index.js';
import { buildShapePackFiles, checkShapePackFiles, renderShapeGolden, type ShapePackDraft } from './index.js';

const box: ShapeDef = {
  id: 'sample:box',
  outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
  defaultSize: { w: 120, h: 60 },
  keywords: ['box', 'square'],
  category: 'boxes',
};
const tri: ShapeDef = {
  id: 'sample:tri',
  outline: { polygon: { n: '3', x: 'w/2 + w/2 * sin(2 * pi * i / n)', y: 'h/2 - h/2 * cos(2 * pi * i / n)' } },
  defaultSize: { w: 80, h: 80 },
  category: 'polygons',
};
const credit = {
  id: 'fluxion',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  notice: 'MIT License',
  source: { kind: 'original', author: 'Fluxion contributors', statement: 'Original artwork.' },
} as const;
const draft: ShapePackDraft = {
  id: 'sample',
  version: '1.0.0',
  name: 'Sample',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  credits: [credit],
  definitions: [
    { name: 'Box', def: box },
    { name: 'Triangle', def: tri },
  ],
};

describe('the declarative pack suite (ADR-0193)', () => {
  it('FR-LIB-003: builds one index and one hashed file per category, deterministically', () => {
    const files = buildShapePackFiles(draft);
    expect(Object.keys(files)).toEqual(['index.json', 'categories/boxes.json', 'categories/polygons.json']);
    expect(buildShapePackFiles(draft)).toEqual(files);
    const index = JSON.parse(files['index.json'] ?? '');
    expect(index.definitions).toEqual([
      { id: 'sample:box', name: 'Box', keywords: ['box', 'square'], category: 'boxes' },
      { id: 'sample:tri', name: 'Triangle', keywords: [], category: 'polygons' },
    ]);
    expect(JSON.parse(files['categories/boxes.json'] ?? '')).toEqual({ formatVersion: '1.0', definitions: [box] });
    expect(files['index.json']?.endsWith('}\n')).toBe(true);
  });

  it('FR-LIB-003, NFR-LIC-003: a built pack checks, loading every definition in index order', async () => {
    const checked = await checkShapePackFiles(buildShapePackFiles(draft));
    if (!checked.ok) throw new Error(JSON.stringify(checked.error));
    expect(checked.value.definitions).toEqual([box, tri]);
    expect(checked.value.index.credits).toEqual([credit]);
  });

  it('FR-LIB-003, NFR-LIC-003: a changed category, a stray file, a missing index, a forbidden license and an empty pack fail', async () => {
    const files = buildShapePackFiles(draft);
    const failure = async (input: Readonly<Record<string, string>>) => {
      const r = await checkShapePackFiles(input);
      return r.ok ? [] : r.error.map((d) => `${d.path} ${d.message}`);
    };
    const edited = { ...files, 'categories/boxes.json': (files['categories/boxes.json'] ?? '').replace('120', '121') };
    expect(await failure(edited)).toEqual(['/categories/boxes category SHA-256 does not match its index']);
    expect(await failure({ ...files, 'categories/extra.json': '{}' })).toEqual(['/categories~1extra.json file is not named by the index']);
    const { 'index.json': _, ...noIndex } = files;
    expect(await failure(noIndex)).toEqual(['/index.json the pack has no index.json']);
    const gpl = buildShapePackFiles({ ...draft, credits: [{ ...credit, license: 'GPL-3.0-only' }] });
    expect(await failure(gpl)).toEqual(['/credits/0/license license is not permitted by the supplied content policy']);
    expect(await failure(buildShapePackFiles({ ...draft, definitions: [] }))).not.toEqual([]);
  });

  it('FR-LIB-007: a golden is the normalized SVG of the definition alone, at its default size, and is stable', () => {
    const svg = renderShapeGolden(box);
    expect(svg).toBe(renderShapeGolden(box));
    expect(svg).toContain('data-place="left:20px;top:20px;width:120px;height:60px');
    expect(svg).toContain('<path class="fx-outline" d="M0 0 L120 0 L120 60 L0 60 Z"');
  });

  it('FR-LIB-007: an invalid definition or one that draws no outline fails instead of giving an empty golden', () => {
    expect(() => renderShapeGolden({ ...box, outline: { path: 'M 0 0 L {nope} 0 Z' } })).toThrow(/sample:box: does not register/);
    expect(() => renderShapeGolden({ ...box, defaultSize: { w: 0, h: 0 } })).toThrow(/sample:box: does not register/);
    // registers, but its outline does not evaluate at any size: the element draws no path
    expect(() => renderShapeGolden({ ...box, outline: { path: 'M 0 0 L {w / 0} 0 L 0 {h} Z' } })).toThrow('sample:box: renders no outline');
  });
});
