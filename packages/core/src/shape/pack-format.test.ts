// FR-LIB-003 FR-LIB-009 FR-LIB-005: pack format 1.2 (ADR-0210, M18.211) is 1.1 plus category display names. The frozen fixtures
// fixtures/shape-pack/v1.2/ parse; a name is refused in 1.0 and 1.1 and when it is not a valid name; a 1.2 subset names only the
// categories its definitions use; the encoder writes a name only for a text that is neither its slug nor that slug's title form,
// so every other pack keeps its 1.0 or 1.1 bytes; and every font-bearing reader asks one predicate.
import { describe, expect, it } from 'vitest';
import {
  allowsShapePackContentLicense,
  CATEGORY_NAME_MAX,
  categoryNameProblem,
  categoryTitle,
  encodeShapePack,
  isFontFormat,
  packHasFonts,
  parseVersionedShapePackCategory,
  parseVersionedShapePackIndex,
  parseVersionedShapePackSubset,
  type ShapeDef,
  type ShapePackDraft,
  type ShapePackNamedCategoryEntry,
} from '../index.js';

/** A category entry's display name: only a 1.1 or 1.2 entry types one, and only 1.2 holds it. */
const nameOf = (e: ShapePackNamedCategoryEntry | undefined) => e?.name;

const files = import.meta.glob('../../../../fixtures/shape-pack/**/*.json', { query: '?raw', import: 'default', eager: true });
const load = (name: string) => {
  const raw = files[`../../../../fixtures/shape-pack/${name}`];
  if (typeof raw !== 'string') throw Error(`missing fixture ${name}`);
  return JSON.parse(raw);
};
const policy = allowsShapePackContentLicense;
const messages = (r: { ok: boolean; error?: readonly { message: string }[] }) => (r.ok ? [] : (r.error ?? []).map((d) => d.message));

describe('category display names (ADR-0210)', () => {
  it('FR-LIB-003: a slug titles as its words, each capitalised; a name is non-empty, at most 80 characters, NFC and without controls', () => {
    expect(['arrows-pointers', 'data', 'uncategorized-2', 'bpmn-lite', '-a--b-'].map(categoryTitle)).toEqual([
      'Arrows Pointers',
      'Data',
      'Uncategorized 2',
      'Bpmn Lite',
      'A B',
    ]);
    expect(categoryNameProblem('Arrows & Pointers')).toBeUndefined();
    expect(categoryNameProblem('x'.repeat(CATEGORY_NAME_MAX))).toBeUndefined();
    expect(
      ['', '  ', 'x'.repeat(CATEGORY_NAME_MAX + 1), 'Café', 'Tab\there', 'Bell\u0007', 'C1\u0085'].map((n) => categoryNameProblem(n) !== undefined),
    ).toEqual([true, true, true, true, true, true, true]);
  });

  it('FR-LIB-009: 1.1 and 1.2 carry fonts, 1.0 and anything else do not', () => {
    expect(['1.0', '1.1', '1.2', '1.3', undefined].map(isFontFormat)).toEqual([false, true, true, false, false]);
    expect(packHasFonts({ formatVersion: '1.2' })).toBe(true);
    expect(packHasFonts({ formatVersion: '1.0' })).toBe(false);
  });
});

describe('pack format 1.2 parsers (ADR-0210)', () => {
  it('FR-LIB-009: the frozen v1.2 index, category and subset parse with their names; the category keeps its index version', () => {
    const index = parseVersionedShapePackIndex(load('v1.2/index.json'), policy);
    if (!index.ok) throw new Error(JSON.stringify(index.error));
    expect(index.value.formatVersion).toBe('1.2');
    expect(nameOf(index.value.categories['labels'])).toBe('Labels & Badges');
    const category = parseVersionedShapePackCategory(load('v1.2/categories/labels.json'), load('v1.2/index.json'), 'labels', policy);
    expect(category.ok && category.value.formatVersion).toBe('1.2');
    // a 1.1 category file under a 1.2 index is refused: a category's version is its index's
    expect(messages(parseVersionedShapePackCategory(load('v1.1/categories/labels.json'), load('v1.2/index.json'), 'labels', policy))).toEqual([
      'category version differs from its index',
    ]);
    const subset = parseVersionedShapePackSubset(load('v1.2/subset.json'), policy);
    if (!subset.ok) throw new Error(JSON.stringify(subset.error));
    expect(subset.value).toMatchObject({ formatVersion: '1.2', categoryNames: { labels: 'Labels & Badges' } });
    // fonts are still checked in 1.2: an unbound face is refused as in 1.1
    const unbound = { ...load('v1.2/subset.json'), definitionFonts: [] };
    expect(parseVersionedShapePackSubset(unbound, policy).ok).toBe(false);
  });

  it('FR-LIB-009: a name in a 1.0 or 1.1 index or subset is refused, and so is an invalid name or one for an unused category', () => {
    const named11 = load('v1.1/index.json');
    named11.categories.labels.name = 'Labels & Badges';
    expect(messages(parseVersionedShapePackIndex(named11, policy))).toEqual(['a category name needs format 1.2']);
    const named10 = load('index.json');
    const [slug] = Object.keys(named10.categories);
    named10.categories[slug as string].name = 'Basic Things';
    // the released 1.0 envelope is closed, so its own schema refuses the key
    expect(messages(parseVersionedShapePackIndex(named10, policy))).toEqual(['Unrecognized key: "name"']);
    expect(messages(parseVersionedShapePackSubset({ ...load('v1.1/subset.json'), categoryNames: { labels: 'L' } }, policy))).toEqual([
      'category names need format 1.2',
    ]);
    for (const bad of ['', 'x'.repeat(81), 'Café', 'Line\nbreak']) {
      const index = load('v1.2/index.json');
      index.categories.labels.name = bad;
      expect(parseVersionedShapePackIndex(index, policy).ok, JSON.stringify(bad)).toBe(false);
      expect(parseVersionedShapePackSubset({ ...load('v1.2/subset.json'), categoryNames: { labels: bad } }, policy).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(messages(parseVersionedShapePackSubset({ ...load('v1.2/subset.json'), categoryNames: { other: 'Other' } }, policy))).toEqual([
      'a category name must name a category of an included definition',
    ]);
  });
});

const box: ShapeDef = { id: 'sample:box', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 120, h: 60 } };
const credit = {
  id: 'fluxion',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  notice: 'MIT License',
  source: { kind: 'original', author: 'Fluxion contributors', statement: 'Original artwork.' },
} as const;
const draft = (categories: readonly (string | undefined)[]): ShapePackDraft => ({
  id: 'sample',
  version: '1.0.0',
  name: 'Sample',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  credits: [credit],
  definitions: categories.map((category, i) => ({ name: `s${i}`, def: { ...box, id: `sample:s${i}`, ...(category === undefined ? {} : { category }) } })),
});
const namesOf = (categories: readonly (string | undefined)[]) => {
  const encoded = encodeShapePack(draft(categories), policy);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
  const { index } = encoded.value;
  return { version: index.formatVersion, names: Object.fromEntries(Object.entries(index.categories).map(([slug, e]) => [slug, nameOf(e)])) };
};

describe('the encoder and category names (ADR-0210)', () => {
  it('FR-LIB-003: slug-form and title-form texts, the default category and a numbered twin keep no name, so the pack stays 1.0', () => {
    expect(namesOf(['data', 'Flow Charts', undefined, 'uncategorized', 'Charts & Graphs', 'Charts Graphs'])).toEqual({
      version: '1.2',
      names: {
        data: undefined,
        'flow-charts': undefined,
        uncategorized: undefined,
        'uncategorized-2': undefined,
        'charts-graphs': 'Charts & Graphs',
        'charts-graphs-2': undefined,
      },
    });
    expect(namesOf(['data', 'Flow Charts', undefined, 'uncategorized']).version).toBe('1.0');
  });

  it('FR-LIB-005: a source text is kept in NFC with its spaces folded, over 80 characters it is not, and a 1.2 pack without fonts has an empty closure', () => {
    const encoded = encodeShapePack(draft(['Arrows  &\tPointers', 'Café Icons', 'x'.repeat(81)]), policy);
    if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
    const { index, files } = encoded.value;
    expect(Object.values(index.categories).map(nameOf)).toEqual(['Arrows & Pointers', 'Café Icons', undefined]);
    expect(index).toMatchObject({ formatVersion: '1.2', fontResources: [], fontFaces: [], definitionFonts: [], fontCredits: [] });
    // texts alike but for spacing or normalization slug apart, and only the first keeps the name (M18.211 r1 F1)
    const alike = encodeShapePack(draft(['Arrows & Pointers', 'Arrows  & Pointers', 'Cafe\u0301 Icons', 'Café Icons']), policy);
    if (!alike.ok) throw new Error(JSON.stringify(alike.error));
    expect(Object.values(alike.value.index.categories).map(nameOf)).toEqual(['Arrows & Pointers', undefined, 'Café Icons', undefined]);
    // every category file is written in its index's version
    const text = (bytes: Uint8Array | undefined) => String.fromCharCode(...(bytes ?? []));
    for (const entry of Object.values(index.categories)) expect(JSON.parse(text(files.get(entry.path))).formatVersion).toBe('1.2');
    // the same draft gives the same bytes
    const again = encodeShapePack(draft(['Arrows  &\tPointers', 'Café Icons', 'x'.repeat(81)]), policy);
    expect(again.ok && [...again.value.files.values()].map(text)).toEqual([...files.values()].map(text));
  });
});
