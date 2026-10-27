import { describe, expect, it } from 'vitest';
import { buildShapePackFiles, type DeclarativeShapePack, namedShapeDefs, type ShapeDef } from '../index.js';
import { drawnPoints } from './drawn-points.js';
import { geometryProblems } from './geometry-check.js';
import { type CheckedInShapePack, checkShapePack, checkShapePackFiles, renderShapeGolden, shapePackExpectation } from './index.js';

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
const draft: DeclarativeShapePack = {
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

describe('the declarative pack suite (ADR-0193, ADR-0194)', () => {
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

  it('FR-LIB-003: definitions take their names by id, and an unnamed one gets an empty name for the schema to reject', () => {
    expect(namedShapeDefs([box, tri], { 'sample:box': 'Box' })).toEqual([
      { name: 'Box', def: box },
      { name: '', def: tri },
    ]);
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

  const checkedIn = (pack: DeclarativeShapePack, versions?: string): CheckedInShapePack => {
    const expected = shapePackExpectation(pack, versions);
    return { pack: expected.pack, goldens: expected.goldens, packageJson: `{"version":"${pack.version}"}`, versions: expected.versions };
  };
  const clean = { files: [], loading: [], brands: [], bounds: [], versions: [] };

  it('FR-LIB-007, NFR-LIC-003: checked-in files equal to their build have no problems, and the ledger records the version', async () => {
    const files = checkedIn(draft);
    expect(await checkShapePack(draft, files)).toEqual(clean);
    expect(Object.keys(JSON.parse(files.versions ?? '{}'))).toEqual(['1.0.0']);
    expect(Object.keys(files.goldens)).toEqual(['box.svg', 'tri.svg']);
  });

  it('FR-LIB-007: missing, changed and orphan files are problems; nothing is rewritten', async () => {
    const files = checkedIn(draft);
    const { 'box.svg': _, ...goldens } = files.goldens;
    const problems = await checkShapePack(draft, {
      ...files,
      goldens: { ...goldens, 'old.svg': '<svg/>' },
      pack: { ...files.pack, 'index.json': `${files.pack['index.json']} ` },
      versions: undefined,
    });
    expect(problems.files).toEqual([
      'pack/index.json differs from its build',
      '__golden__/box.svg is missing',
      '__golden__/old.svg belongs to no definition',
      'pack-versions.json differs from its build',
    ]);
  });

  it('FR-LIB-007: package and pack versions must agree, and changed geometry at a recorded version needs a new version', async () => {
    const files = checkedIn(draft);
    expect((await checkShapePack(draft, { ...files, packageJson: '{"version":"0.0.0"}' })).versions).toEqual([
      'pack version 1.0.0 differs from package version 0.0.0',
    ]);
    const wider = {
      ...draft,
      definitions: [{ name: 'Box', def: { ...box, defaultSize: { w: 130, h: 60 } } }, draft.definitions[1] as DeclarativeShapePack['definitions'][number]],
    };
    expect((await checkShapePack(wider, { ...checkedIn(wider), versions: files.versions })).versions).toEqual([
      'category hashes changed at the recorded version 1.0.0: release the change as a new pack version',
    ]);
    expect((await checkShapePack(wider, { ...checkedIn(wider), pack: files.pack })).loading).toEqual(['pack/ does not load the exported definitions']);
    // a malformed ledger is never treated as empty: the check reports it and a write run refuses to rebuild it
    for (const broken of ['{', '[]', '{"1.0.0": 3}']) {
      expect((await checkShapePack(draft, { ...files, versions: broken })).versions).toEqual([
        'pack-versions.json is not a version ledger: repair it by hand, keeping every recorded version',
      ]);
      expect(() => shapePackExpectation(draft, broken)).toThrow(/not a version ledger/);
    }
    const released = { ...wider, version: '1.1.0' };
    const next = checkedIn(released, files.versions);
    expect(Object.keys(JSON.parse(next.versions ?? '{}'))).toEqual(['1.0.0', '1.1.0']);
    expect(await checkShapePack(released, next)).toEqual(clean);
  });

  it('FR-LIB-007, NFR-LIC-003: brands, unnamed or no definitions, and drawing outside the box are problems', async () => {
    const branded = { ...draft, name: 'Azure-ish' };
    expect((await checkShapePack(branded, checkedIn(branded))).brands).toEqual(['pack/index.json names a vendor brand']);
    const unnamed = { ...draft, definitions: [{ name: ' ', def: box }] };
    expect((await checkShapePack(unnamed, checkedIn(unnamed))).loading).toEqual(['/definitions/0/name Invalid string: must match pattern /\\S/']);
    const empty = { ...draft, definitions: [] };
    expect((await checkShapePack(empty, checkedIn(empty))).loading).toContain('the pack exports no definitions');
    const escaping = { ...draft, definitions: [{ name: 'Box', def: { ...box, outline: { path: 'M 0 0 Q {w * 3} {h / 2} 0 {h} Z' } } }] };
    expect((await checkShapePack(escaping, checkedIn(escaping))).bounds).toEqual([
      'sample:box: draws outside its 120x60 box at (180, 30)',
      'sample:box at defaults: draws outside its 120x60 box at (180, 30)',
    ]);
  });

  it('FR-LIB-007: drawn points include curve midpoints, and unknown path commands are unreadable rather than skipped', () => {
    const svg = (d: string) => `<path class="fx-outline" d="${d}"/>`;
    expect(drawnPoints(svg('M0 0 Q10 0 10 10 C10 20 0 20 0 10 Z')).points).toEqual([
      [0, 0],
      [7.5, 2.5],
      [10, 10],
      [5, 17.5],
      [0, 10],
    ]);
    expect(drawnPoints(svg('M0 0 A5 5 0 0 1 10 0')).unreadable).toEqual(['A5 5 0 0 1 10 0']);
    expect(drawnPoints(svg('M0 0 L1')).unreadable).toEqual(['L1']);
  });

  it('FR-LIB-007, FR-LIB-003: geometry is checked at each number param bound and enum value: outline, handles and text regions', () => {
    const notch: ShapeDef = {
      ...box,
      params: { d: { type: 'number', min: 0, max: 2, default: 0.5 }, side: { type: 'enum', values: ['in', 'out'], default: 'in' } },
      outline: { path: 'M 0 0 L {w} 0 L {w + side * 10} {h / 2} L {w} {h} L 0 {h} Z' },
      handles: [{ param: 'd', x: 'd * w', y: '0' }],
      textRegions: [
        { name: 'body', x: 0, y: 0, w: '1 - d', h: 1 },
        { name: 'tail', x: 'd', y: 0, w: 0.5, h: 1 },
      ],
    };
    expect(geometryProblems(notch)).toEqual([
      'sample:box at d=2: handle 0 (d) leaves the box at (240, 0)',
      'sample:box at d=2: text region body has a negative size -120x60',
      'sample:box at d=2: text region 1 (tail) leaves the box',
      'sample:box at side=out: draws outside its 120x60 box at (130, 30)',
    ]);
    expect(geometryProblems({ ...box, params: { r: { type: 'number', min: 0, default: 1 } } })).toEqual([
      'sample:box: param r has no min or max, so its range cannot be checked',
    ]);
    // a curve is checked at its exact extreme (y = -44.44 at t = 1/3), which sampling at quarter steps would miss
    expect(geometryProblems({ ...box, outline: { path: 'M 0 0 C 0 -100 0 0 0 0 L {w} {h} Z' } })).toEqual([
      'sample:box at defaults: draws outside its 120x60 box at (0, -44.44)',
    ]);
    // a handle that does not evaluate at a bound is reported, not dropped
    const hidden = { ...box, params: { d: { type: 'number' as const, min: 0, max: 2, default: 1 } }, handles: [{ param: 'd', x: 'w * sqrt(d - 1)', y: '0' }] };
    expect(geometryProblems(hidden)).toEqual(['sample:box at d=0: handle 0 (d) does not evaluate']);
    expect(geometryProblems({ ...box, anchors: [{ name: 'out', x: 1.5, y: 0.5 }] })).toEqual(['sample:box: anchor out is outside the box']);
    const failing = geometryProblems({
      ...box,
      params: { k: { type: 'number', min: -1, max: 1, default: 1 } },
      outline: { path: 'M 0 0 L {w * sqrt(k)} 0 L 0 {h} Z' },
    });
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatch(/^sample:box at k=-1: outline does not evaluate: /);
  });
});
