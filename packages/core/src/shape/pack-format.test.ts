// FR-LIB-003 FR-LIB-009 FR-LIB-005: pack format 1.2 (ADR-0210, M18.211) is 1.1 plus category display names. The frozen fixtures
// fixtures/shape-pack/v1.2/ parse; a name is refused in 1.0 and 1.1 and when it is not a valid name; a 1.2 subset names only the
// categories its definitions use; the encoder writes a name only for a text that is neither its slug nor that slug's title form,
// so every other pack keeps its 1.0 or 1.1 bytes; and every font-bearing reader asks one predicate. Format 1.3 (icon slots) is below.
import { describe, expect, it } from 'vitest';
import {
  allowsShapePackContentLicense,
  CATEGORY_NAME_MAX,
  categoryNameProblem,
  categoryTitle,
  encodeShapePack,
  hasCategoryNames,
  hasIconSlots,
  isFontFormat,
  packHasFonts,
  parseShapePackCategory,
  parseShapePackIndex,
  parseShapePackSubset,
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

  it('FR-LIB-009: 1.1, 1.2 and 1.3 carry fonts, 1.0 and anything else do not', () => {
    expect(['1.0', '1.1', '1.2', '1.3', '1.4', undefined].map(isFontFormat)).toEqual([false, true, true, true, false, false]);
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

// FR-SHP-007: pack format 1.3 (ADR-0054, M19.34) is 1.2 plus definition `iconSlots`. A definition with icon slots parses only under a
// 1.3 envelope; the encoder writes 1.3 only for a draft that has one; and a reader of an earlier version refuses a 1.3 envelope by
// its version, never by dropping a definition. The frozen fixtures/shape-pack/v1.3/subset.json is v1.2's with a badge slot on box.
describe('pack format 1.3 icon slots (ADR-0054)', () => {
  const slot = { name: 'badge', x: 0.05, y: 0.1, w: 0.2, h: 0.8 };
  const slotted = (categories: readonly (string | undefined)[], slots: readonly unknown[] = [slot]): ShapePackDraft => {
    const base = draft(categories);
    const [first, ...rest] = base.definitions;
    if (first === undefined) throw new Error('empty draft');
    return { ...base, definitions: [{ ...first, def: { ...first.def, iconSlots: slots } as ShapeDef }, ...rest] };
  };
  const encoded = (d: ShapePackDraft) => {
    const r = encodeShapePack(d, policy);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  };
  const text = (bytes: Uint8Array | undefined) => String.fromCharCode(...(bytes ?? []));

  it('FR-SHP-007: 1.3 alone holds icon slots, 1.2 and 1.3 hold category names', () => {
    expect(['1.0', '1.1', '1.2', '1.3', undefined].map(hasIconSlots)).toEqual([false, false, false, true, false]);
    expect(['1.0', '1.1', '1.2', '1.3', undefined].map(hasCategoryNames)).toEqual([false, false, true, true, false]);
  });

  it('FR-SHP-007: a draft with an icon slot encodes as 1.3, with an empty font closure, and its category parses with the slot kept', () => {
    const pack = encoded(slotted([undefined, undefined]));
    expect(pack.index).toMatchObject({ formatVersion: '1.3', fontResources: [], fontFaces: [], definitionFonts: [], fontCredits: [] });
    const path = Object.values(pack.index.categories)[0]?.path ?? '';
    const category = parseVersionedShapePackCategory(JSON.parse(text(pack.files.get(path))), pack.index, 'uncategorized', policy);
    if (!category.ok) throw new Error(JSON.stringify(category.error));
    expect(category.value.formatVersion).toBe('1.3');
    expect(category.value.definitions[0]?.iconSlots).toEqual([slot]);
    // 1.3 keeps 1.2's names: a named category and an icon slot together stay 1.3 with the name
    const named = encoded(slotted(['Charts & Graphs']));
    expect(named.index.formatVersion).toBe('1.3');
    expect(Object.values(named.index.categories).map(nameOf)).toEqual(['Charts & Graphs']);
    // a draft without one is written exactly as before
    expect(encoded(draft([undefined])).index.formatVersion).toBe('1.0');
    expect(encoded(draft(['Charts & Graphs'])).index.formatVersion).toBe('1.2');
  });

  it('FR-SHP-007: a definition with icon slots is refused under a 1.0, 1.1 or 1.2 envelope; the 1.3 subset parses', () => {
    const subset13 = load('v1.3/subset.json');
    const parsed = parseVersionedShapePackSubset(subset13, policy);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expect(parsed.value.formatVersion).toBe('1.3');
    expect(parsed.value.definitions.find((d) => d.id === 'sample:box')?.iconSlots).toEqual([slot]);
    for (const formatVersion of ['1.1', '1.2']) {
      const r = parseVersionedShapePackSubset({ ...subset13, formatVersion, ...(formatVersion === '1.1' ? { categoryNames: undefined } : {}) }, policy);
      expect(r.ok, formatVersion).toBe(false);
      if (!r.ok)
        expect(r.error, formatVersion).toContainEqual(expect.objectContaining({ path: '/definitions/0/iconSlots', message: 'icon slots need format 1.3' }));
    }
    // a 1.0 subset and a 1.0 category with a slotted definition
    const { categoryNames: _n, fontResources: _r, fontFaces: _f, definitionFonts: _d, fontCredits: _c, ...rest } = subset13;
    const box = subset13.definitions[0];
    const subset10 = { ...rest, formatVersion: '1.0', definitions: [box] };
    expect(messages(parseShapePackSubset(subset10, policy))).toContain('icon slots need format 1.3');
    const pack = encoded(draft([undefined]));
    const category10 = { formatVersion: '1.0', definitions: [{ ...box, id: 'sample:s0', category: 'uncategorized', keywords: [] }] };
    expect(messages(parseShapePackCategory(category10, pack.index, 'uncategorized', policy))).toContain('icon slots need format 1.3');
    // a 1.2 category under a 1.2 index
    const p12 = encoded(draft(['Charts & Graphs']));
    const path12 = Object.values(p12.index.categories)[0]?.path ?? '';
    const cat12 = JSON.parse(text(p12.files.get(path12)));
    cat12.definitions[0].iconSlots = [slot];
    expect(messages(parseVersionedShapePackCategory(cat12, p12.index, 'charts-graphs', policy))).toContain('icon slots need format 1.3');
  });

  it('FR-SHP-007: a reader of 1.0 refuses a 1.3 index and subset by their version, and an icon slot is checked as a text region is', () => {
    const pack = encoded(slotted([undefined]));
    expect(parseShapePackIndex(pack.index, policy)).toMatchObject({
      ok: false,
      error: expect.arrayContaining([expect.objectContaining({ path: '/formatVersion' })]),
    });
    expect(parseShapePackSubset(load('v1.3/subset.json'), policy)).toMatchObject({
      ok: false,
      error: expect.arrayContaining([expect.objectContaining({ path: '/formatVersion' })]),
    });
    // a slot name twice, an empty list, and an expression naming an unknown param are refused
    const refused = (slots: readonly unknown[]) => {
      const r = encodeShapePack(slotted([undefined], slots), policy);
      return r.ok ? [] : r.error.map((d) => d.path);
    };
    expect(refused([slot, { ...slot, x: 0.5 }])).toContainEqual(expect.stringMatching(/iconSlots\/1\/name$/));
    expect(refused([])).toContainEqual(expect.stringMatching(/iconSlots$/));
    expect(refused([{ ...slot, x: 'nope / w' }])).toContainEqual(expect.stringMatching(/iconSlots\/0\/x$/));
    expect(refused([{ ...slot, x: '0.1 * w / w' }])).toEqual([]);
  });
});
