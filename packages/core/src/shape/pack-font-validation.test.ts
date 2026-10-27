import { expect, it } from 'vitest';
import {
  allowsShapePackContentLicense,
  artworkFontProfiles,
  parseShapePackCategory,
  parseShapePackIndex,
  parseShapePackSubset,
  parseVersionedShapePackCategory,
  parseVersionedShapePackIndex,
  parseVersionedShapePackSubset,
} from '../index.js';

const files = import.meta.glob('../../../../fixtures/shape-pack/**/*.json', { query: '?raw', import: 'default', eager: true });
const load = (name: string) => {
  const raw = files[`../../../../fixtures/shape-pack/${name}`];
  if (typeof raw !== 'string') throw Error(`missing fixture ${name}`);
  return JSON.parse(raw);
};
const policy = allowsShapePackContentLicense;
const index = () => load('v1.1/index.json');
const category = () => load('v1.1/categories/labels.json');
const subset = () => load('v1.1/subset.json');
const indexOk = (value: unknown) => parseVersionedShapePackIndex(value, policy).ok;
const categoryOk = (value: unknown, meta: unknown = index()) => parseVersionedShapePackCategory(value, meta, 'labels', policy).ok;
const subsetOk = (value: unknown) => parseVersionedShapePackSubset(value, policy).ok;
type Patch = (value: ReturnType<typeof index>) => void;
const refusedIndex = (name: string, patch: Patch) => {
  const value = index();
  patch(value);
  expect(indexOk(value), name).toBe(false);
};

it('FR-LIB-004 NFR-LIC-003: pack 1.1 index, category and saved subset accept exact resource, face, binding and scoped credit closure', () => {
  const meta = index();
  expect(parseVersionedShapePackIndex(meta, policy)).toEqual({ ok: true, value: meta });
  const cat = category();
  expect(parseVersionedShapePackCategory(cat, meta, 'labels', policy)).toEqual({ ok: true, value: cat });
  const saved = subset();
  expect(parseVersionedShapePackSubset(saved, policy)).toEqual({ ok: true, value: saved });
  expect(meta.fontResources[0]).toMatchObject({ sha256: artworkFontProfiles['inter-latin-400-ascii'].sha256, size: 23664 });
});

it('FR-LIB-004: one pinned binary may back faces of different source families in different definitions', () => {
  const meta = index();
  expect(new Set(meta.fontFaces.map((f: { resource: string }) => f.resource)).size).toBe(1);
  expect(meta.fontFaces.map((f: { family: string }) => f.family)).toEqual(['Inter', 'Brand Sans']);
  expect(indexOk(meta)).toBe(true);
});

it('FR-LIB-004: an empty-font 1.1 subset stays 1.1 and text-free geometry needs no binding', () => {
  const saved = subset();
  saved.definitions = [saved.definitions[0]];
  for (const key of ['fontResources', 'fontFaces', 'definitionFonts', 'fontCredits']) saved[key] = [];
  const parsed = parseVersionedShapePackSubset(saved, policy);
  expect(parsed).toEqual({ ok: true, value: saved });
  if (parsed.ok) expect(parsed.value.formatVersion).toBe('1.1');
});

it('FR-LIB-004: 1.0 files keep their unchanged parsers and results, and the preserved 1.0 parsers refuse 1.1', () => {
  const oldIndex = load('index.json');
  const oldCategory = load('categories/basic.json');
  const oldSubset = load('subset.json');
  expect(parseVersionedShapePackIndex(oldIndex, policy)).toEqual(parseShapePackIndex(oldIndex, policy));
  expect(parseVersionedShapePackCategory(oldCategory, oldIndex, 'basic', policy)).toEqual(parseShapePackCategory(oldCategory, oldIndex, 'basic', policy));
  expect(parseVersionedShapePackSubset(oldSubset, policy)).toEqual(parseShapePackSubset(oldSubset, policy));
  expect(parseShapePackIndex(oldIndex, policy).ok).toBe(true);
  expect(parseShapePackIndex(index(), policy).ok).toBe(false);
  expect(parseShapePackCategory(category(), index(), 'labels', policy).ok).toBe(false);
  expect(parseShapePackSubset(subset(), policy).ok).toBe(false);
  for (const formatVersion of ['1.2', '2.0', undefined]) expect(indexOk({ ...index(), formatVersion }), String(formatVersion)).toBe(false);
});

it('FR-LIB-004: a category must declare the same version as its index', () => {
  expect(categoryOk({ ...category(), formatVersion: '1.0' })).toBe(false);
  expect(categoryOk(load('categories/basic.json'), index())).toBe(false);
  expect(categoryOk(category(), load('index.json'))).toBe(false);
});

it('FR-LIB-004: resources must match the supported profile exactly, with canonical distribution paths and one resource per hash', () => {
  const other = 'a'.repeat(64);
  refusedIndex('foreign hash', (v) => Object.assign(v.fontResources[0], { sha256: other, path: `fonts/${other}.woff2` }));
  refusedIndex('wrong size', (v) => (v.fontResources[0].size = 23663));
  refusedIndex('wrong mime', (v) => (v.fontResources[0].mime = 'font/ttf'));
  refusedIndex('unknown profile', (v) => (v.fontResources[0].profile = 'inter-latin-700-ascii'));
  refusedIndex('noncanonical path', (v) => (v.fontResources[0].path = '../fonts/inter.woff2'));
  refusedIndex('uppercase hash', (v) => (v.fontResources[0].sha256 = v.fontResources[0].sha256.toUpperCase()));
  refusedIndex('extra field', (v) => (v.fontResources[0].url = 'https://example.com/inter.woff2'));
  refusedIndex('duplicate hash', (v) => {
    v.fontResources.push({ ...v.fontResources[0], id: 'copy' });
    v.fontFaces[1].resource = 'copy';
    v.fontCredits[0].resourceIds.push('copy');
  });
  refusedIndex('unused resource', (v) => Object.assign(v, { fontFaces: [], definitionFonts: [], fontCredits: [] }));
  const fontless = index();
  Object.assign(fontless, { fontResources: [], fontFaces: [], definitionFonts: [], fontCredits: [] });
  expect(indexOk(fontless)).toBe(true);
  refusedIndex('missing font fields', (v) => delete v.fontCredits);
});

it('FR-LIB-004: faces must name known resources, unique identities and the profile weight and style, and must be reachable', () => {
  refusedIndex('dangling resource', (v) => (v.fontFaces[0].resource = 'missing'));
  refusedIndex('duplicate face ID', (v) => (v.fontFaces[1].id = 'inter'));
  refusedIndex('duplicate family key', (v) => (v.fontFaces[1].family = 'INTER'));
  refusedIndex('bold weight', (v) => (v.fontFaces[0].weight = 700));
  refusedIndex('italic style', (v) => (v.fontFaces[0].style = 'italic'));
  refusedIndex('blank family', (v) => (v.fontFaces[0].family = '  '));
  refusedIndex('unreachable face', (v) => v.fontFaces.push({ ...v.fontFaces[0], id: 'spare', family: 'Spare' }));
});

it('FR-LIB-004: bindings must name indexed definitions once, known faces once and distinct bytes', () => {
  refusedIndex('unknown definition', (v) => (v.definitionFonts[0].definitionId = 'sample:missing'));
  refusedIndex('foreign namespace', (v) => (v.definitionFonts[0].definitionId = 'other:label'));
  refusedIndex('rebound definition', (v) => (v.definitionFonts[1].definitionId = 'sample:label'));
  refusedIndex('unknown face', (v) => (v.definitionFonts[0].faceIds = ['missing']));
  refusedIndex('duplicate face', (v) => (v.definitionFonts[0].faceIds = ['inter', 'inter']));
  refusedIndex('empty binding', (v) => (v.definitionFonts[0].faceIds = []));
  refusedIndex('two faces one binary', (v) => (v.definitionFonts[0].faceIds = ['inter', 'brand']));
});

it('NFR-LIC-003: font credits require an artwork font license, complete metadata and exact resource-definition coverage', () => {
  refusedIndex('shape-only license', (v) => (v.fontCredits[0].license = 'MIT'));
  refusedIndex('unknown expression', (v) => (v.fontCredits[0].license = 'OFL-1.1 OR GPL-3.0'));
  for (const key of ['notice', 'attribution', 'source', 'license']) refusedIndex(`missing ${key}`, (v) => delete v.fontCredits[0][key]);
  refusedIndex('no credit', (v) => (v.fontCredits = []));
  refusedIndex('partial definition scope', (v) => (v.fontCredits[0].definitionIds = ['sample:label']));
  refusedIndex('unbound definition scope', (v) => v.fontCredits[0].definitionIds.push('sample:box'));
  refusedIndex('unknown resource scope', (v) => v.fontCredits[0].resourceIds.push('missing'));
  refusedIndex('duplicate credit ID', (v) => v.fontCredits.push({ ...v.fontCredits[0], definitionIds: ['sample:badge'] }));
  const split = index();
  split.fontCredits = [
    { ...split.fontCredits[0], id: 'label', definitionIds: ['sample:label'] },
    { ...split.fontCredits[0], id: 'badge', definitionIds: ['sample:badge'] },
  ];
  expect(indexOk(split)).toBe(true);
  const rejecting = parseVersionedShapePackIndex(index(), (license) => license !== 'OFL-1.1');
  expect(rejecting.ok).toBe(false);
  const throwing = parseVersionedShapePackIndex(index(), (license) => {
    if (license === 'OFL-1.1') throw Error('policy failed');
    return true;
  });
  expect(throwing.ok).toBe(false);
});

it('FR-LIB-004: category and subset artwork text closure must equal each binding exactly, without fallback', () => {
  const wrongFamily = index();
  wrongFamily.definitionFonts = [
    { definitionId: 'sample:label', faceIds: ['brand'] },
    { definitionId: 'sample:badge', faceIds: ['inter'] },
  ];
  expect(indexOk(wrongFamily)).toBe(true);
  expect(categoryOk(category(), wrongFamily)).toBe(false);
  const textless = category();
  textless.definitions[1].artwork.root.children = [];
  expect(categoryOk(textless)).toBe(false);
  const unbound = subset();
  unbound.definitionFonts = [];
  unbound.fontFaces = [];
  unbound.fontResources = [];
  unbound.fontCredits = [];
  const result = parseVersionedShapePackSubset(unbound, policy);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.map((d) => d.path)).toContain('/definitions/1/artwork');
  const unicode = subset();
  unicode.definitions[1].artwork.root.children[0].children = ['Ünïcode'];
  expect(subsetOk(unicode)).toBe(false);
  const geometryOnly = subset();
  geometryOnly.definitionFonts[0].definitionId = 'sample:box';
  geometryOnly.fontCredits[0].definitionIds = ['sample:box'];
  expect(subsetOk(geometryOnly)).toBe(false);
});

it('FR-LIB-004: saved subsets refuse bindings or credits for definitions they do not include, and invalid geometry fails atomically', () => {
  const extra = subset();
  extra.definitions = [extra.definitions[0]];
  expect(subsetOk(extra)).toBe(false);
  const bad = subset();
  bad.definitions[1].artwork.root.attributes.onload = 'alert(1)';
  const result = parseVersionedShapePackSubset(bad, policy);
  expect(result.ok).toBe(false);
  expect('value' in result).toBe(false);
});
