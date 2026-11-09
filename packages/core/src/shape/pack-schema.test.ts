import { pathBounds } from '@fluxion/geometry';
import { describe, expect, it } from 'vitest';
import { parseShapePackCategory, parseShapePackIndex } from '../index.js';
import { evaluateOutline } from './outline.js';
import {
  category11Schema,
  categoryEnvelopeSchema,
  index11Schema,
  shapePackCategorySchema,
  shapePackIndexSchema,
  shapePackSubsetSchema,
  subset11Schema,
  subsetEnvelopeSchema,
} from './pack-schema.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const raw = import.meta.glob('../../../../fixtures/shape-pack/**/*.json', { query: '?raw', import: 'default', eager: true });
const index = () => JSON.parse(raw['../../../../fixtures/shape-pack/index.json'] ?? 'null');
const category = () => JSON.parse(raw['../../../../fixtures/shape-pack/categories/basic.json'] ?? 'null');
const policy = (license: string) => ['MIT', 'ISC', 'MIT AND ISC'].includes(license);

describe('declarative shape-pack validation', () => {
  it('FR-LIB-003 NFR-LIC-003: valid licensed wire fixtures validate unchanged and every definition has a nonempty outline', () => {
    const i = index();
    expect(parseShapePackIndex(i, policy)).toEqual({ ok: true, value: i });
    const c = category();
    const result = parseShapePackCategory(c, i, 'basic', policy);
    expect(result).toEqual({ ok: true, value: c });
    for (const def of c.definitions) {
      const outline = evaluateOutline(def, def.defaultSize);
      expect(outline.ok).toBe(true);
      if (outline.ok) {
        const bounds = pathBounds(outline.value.path);
        if (bounds === null) throw new Error('fixture outline has no bounds');
        expect(bounds.w).toBeGreaterThan(0);
        expect(bounds.h).toBeGreaterThan(0);
      }
    }
  });
  it('NFR-LIC-003: absent license, source, notice or credit coverage is refused', () => {
    for (const field of ['license', 'attribution', 'credits']) {
      const bad = index();
      delete bad[field];
      expect(parseShapePackIndex(bad, policy).ok, field).toBe(false);
    }
    for (const field of ['source', 'notice', 'attribution', 'license']) {
      const bad = index();
      delete bad.credits[0][field];
      expect(parseShapePackIndex(bad, policy).ok, field).toBe(false);
    }
    const uncovered = index();
    uncovered.credits[0].definitionIds = ['sample:box'];
    expect(parseShapePackIndex(uncovered, policy).ok).toBe(false);
  });
  it('NFR-LIC-003: scoped credits are complete, unique and point only at indexed IDs', () => {
    const valid = index();
    valid.credits[0].definitionIds = ['sample:box', 'sample:triangle'];
    expect(parseShapePackIndex(valid, policy).ok).toBe(true);
    for (const ids of [[], ['sample:box', 'sample:box'], ['sample:missing']]) {
      const bad = index();
      bad.credits[0].definitionIds = ids;
      expect(parseShapePackIndex(bad, policy).ok).toBe(false);
    }
    const duplicate = index();
    duplicate.credits.push(duplicate.credits[0]);
    expect(parseShapePackIndex(duplicate, policy).ok).toBe(false);
  });
  it('NFR-LIC-003: every source license and override is checked without trusting the wrapper', () => {
    const bad = index();
    bad.credits[0].license = 'GPL-3.0-only';
    expect(parseShapePackIndex(bad, policy).ok).toBe(false);
    for (const license of ['unknown-license', 'free text license', '']) {
      const c = category();
      c.definitions[0].license = license;
      expect(parseShapePackCategory(c, index(), 'basic', policy).ok).toBe(false);
    }
    expect(
      parseShapePackIndex(index(), () => {
        throw new Error('policy unavailable');
      }).ok,
    ).toBe(false);
  });
  it('FR-LIB-003: duplicate IDs, wrong namespaces and unindexed categories fail', () => {
    const duplicate = index();
    duplicate.definitions.push(duplicate.definitions[0]);
    expect(parseShapePackIndex(duplicate, policy).ok).toBe(false);
    for (const patch of [{ id: 'other:box' }, { category: 'missing' }]) {
      const bad = index();
      Object.assign(bad.definitions[0], patch);
      expect(parseShapePackIndex(bad, policy).ok).toBe(false);
    }
  });
  it('FR-LIB-003: version, path, hash and unknown executable index fields are rejected', () => {
    for (const patch of [{ version: '^1.0.0' }, { formatVersion: '2.0' }, { player: 'evil.js' }, { license: '  ' }]) {
      expect(parseShapePackIndex({ ...index(), ...patch }, policy).ok).toBe(false);
    }
    for (const path of ['../basic.json', 'https://host/basic.json', 'categories/basic.json?x', 'categories/other.json']) {
      const bad = index();
      bad.categories.basic.path = path;
      expect(parseShapePackIndex(bad, policy).ok, path).toBe(false);
    }
    const bad = index();
    bad.categories.basic.sha256 = 'bad';
    expect(parseShapePackIndex(bad, policy).ok).toBe(false);
    const proto = index();
    proto.categories = JSON.parse('{"__proto__":{"path":"categories/basic.json","sha256":"bad"}}');
    expect(parseShapePackIndex(proto, policy).ok).toBe(false);
  });
  it('FR-LIB-003: a category must contain exactly its assigned valid definitions atomically', () => {
    for (const definitions of [[], [category().definitions[0]], [...category().definitions, category().definitions[0]]]) {
      expect(parseShapePackCategory({ formatVersion: '1.0', definitions }, index(), 'basic', policy).ok).toBe(false);
    }
    const bad = category();
    bad.definitions[1].outline.path = 'M0 0L{unknown} 1';
    const result = parseShapePackCategory(bad, index(), 'basic', policy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((d) => d.path.startsWith('/definitions/1'))).toBe(true);
    expect(parseShapePackCategory(category(), index(), 'missing', policy).ok).toBe(false);
  });
  it('FR-LIB-003: provided definition metadata agrees with the index', () => {
    for (const patch of [{ category: 'wrong' }, { keywords: ['wrong'] }, { id: 'sample:unindexed' }]) {
      const bad = category();
      Object.assign(bad.definitions[0], patch);
      expect(parseShapePackCategory(bad, index(), 'basic', policy).ok).toBe(false);
    }
  });
  it('NFR-LIC-003: upstream provenance is pinned and original declarations cannot be empty', () => {
    const valid = index();
    valid.credits[0].source = {
      kind: 'upstream',
      reference: 'Synthetic provenance fixture',
      sha256: 'a'.repeat(64),
      revision: 'fixture-revision',
      modifications: 'Fixture only',
    };
    expect(parseShapePackIndex(valid, policy).ok).toBe(true);
    for (const patch of [{ sha256: 'bad' }, { reference: ' ' }, { kind: 'unknown' }]) {
      const bad = JSON.parse(JSON.stringify(valid));
      Object.assign(bad.credits[0].source, patch);
      expect(parseShapePackIndex(bad, policy).ok).toBe(false);
    }
    const bad = index();
    bad.credits[0].source.author = ' ';
    expect(parseShapePackIndex(bad, policy).ok).toBe(false);
  });
  it('FR-LIB-003: exact prerelease/build versions are accepted but ranges and numeric leading zeros are not', () => {
    expect(parseShapePackIndex({ ...index(), version: '1.2.3-beta.1+build.01' }, policy).ok).toBe(true);
    for (const version of ['01.0.0', '1.0.0-01', '1.0.0-', '1.0.0+', '*']) {
      expect(parseShapePackIndex({ ...index(), version }, policy).ok, version).toBe(false);
    }
  });
});

it('FR-LIB-003 FR-LIB-004 NFR-SEC-001: direct category artwork round-trips and malicious paint is rejected atomically', () => {
  const c = category();
  const paint = { viewBox: { x: 0, y: 0, width: 10, height: 10 }, root: { name: 'path', attributes: { d: 'M0 0H10V10Z', fill: 'red' }, children: [] } };
  c.definitions[0].artwork = paint;
  const parsed = parseShapePackCategory(JSON.parse(JSON.stringify(c)), index(), 'basic', policy);
  expect(parsed).toEqual({ ok: true, value: c });
  c.definitions[0].artwork.root.attributes.onload = 'alert(1)';
  expect(parseShapePackCategory(c, index(), 'basic', policy).ok).toBe(false);
});

// Each structural schema is checked directly, field by field, so a dropped field, literal, bound or
// regex anchor changes a verdict here rather than only in a parser further downstream.
describe('FR-LIB-003 NFR-SEC-001: the structural pack schemas, field by field', () => {
  const fixture = (name: string) => JSON.parse(raw[`../../../../fixtures/shape-pack/${name}`] ?? 'null');
  const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) => schema.safeParse(value).success;
  const HASH = 'a'.repeat(64);
  const withField = (base: Record<string, unknown>, key: string, value: unknown) => ({ ...base, [key]: value });
  const index10 = () => fixture('index.json');
  const index11 = () => fixture('v1.1/index.json');
  const subset10 = () => fixture('subset.json');
  const subset11 = () => fixture('v1.1/subset.json');
  const twice = <T>(xs: T[]) => [xs[0], { ...(xs[0] as object), id: `${(xs[0] as { id: string }).id}2` }];

  it('FR-LIB-003: every fixture envelope parses, and an unknown field is refused', () => {
    expect(ok(shapePackIndexSchema, index10())).toBe(true);
    expect(ok(index11Schema, index11())).toBe(true);
    expect(ok(shapePackSubsetSchema, subset10())).toBe(true);
    expect(ok(subsetEnvelopeSchema, subset10())).toBe(true);
    expect(ok(subset11Schema, subset11())).toBe(true);
    expect(ok(shapePackCategorySchema, fixture('categories/basic.json'))).toBe(true);
    expect(ok(categoryEnvelopeSchema, fixture('categories/basic.json'))).toBe(true);
    expect(ok(category11Schema, fixture('v1.1/categories/labels.json'))).toBe(true);
    for (const [schema, value] of [
      [shapePackIndexSchema, index10()],
      [index11Schema, index11()],
      [shapePackSubsetSchema, subset10()],
      [subsetEnvelopeSchema, subset10()],
      [subset11Schema, subset11()],
      [categoryEnvelopeSchema, fixture('categories/basic.json')],
      [category11Schema, fixture('v1.1/categories/labels.json')],
    ] as const)
      expect(ok(schema, { ...value, extra: 1 })).toBe(false);
  });

  it('FR-LIB-003: the format and version literals are exact', () => {
    expect(ok(shapePackIndexSchema, withField(index10(), 'format', 'fluxion'))).toBe(false);
    expect(ok(shapePackIndexSchema, withField(index10(), 'formatVersion', '1.1'))).toBe(false);
    expect(ok(subsetEnvelopeSchema, withField(subset10(), 'format', ''))).toBe(false);
    expect(ok(subsetEnvelopeSchema, withField(subset10(), 'formatVersion', ''))).toBe(false);
    expect(ok(categoryEnvelopeSchema, { formatVersion: '', definitions: [1] })).toBe(false);
    expect(ok(categoryEnvelopeSchema, { formatVersion: '1.0', definitions: [1, 2] })).toBe(true);
    expect(ok(categoryEnvelopeSchema, { formatVersion: '1.0', definitions: [] })).toBe(false);
    for (const v of ['1.1', '1.2']) {
      expect(ok(category11Schema, { formatVersion: v, definitions: [1, 2] }), v).toBe(true);
      expect(ok(subset11Schema, withField(subset11(), 'formatVersion', v)), v).toBe(true);
    }
    expect(ok(category11Schema, { formatVersion: '1.0', definitions: [1] })).toBe(false);
    expect(ok(category11Schema, { formatVersion: '1.1', definitions: [] })).toBe(false);
    expect(ok(index11Schema, withField(index11(), 'format', ''))).toBe(false);
    expect(ok(subset11Schema, withField(subset11(), 'format', ''))).toBe(false);
  });

  it('FR-LIB-003: lists take more than one entry and refuse none', () => {
    const i = index10();
    expect(ok(shapePackIndexSchema, { ...i, definitions: [...i.definitions, { ...i.definitions[0], id: 'sample:other' }] })).toBe(true);
    expect(ok(shapePackIndexSchema, { ...i, definitions: [] })).toBe(false);
    expect(ok(shapePackIndexSchema, { ...i, credits: twice(i.credits) })).toBe(true);
    expect(ok(shapePackIndexSchema, { ...i, credits: [] })).toBe(false);
    const credit = { ...i.credits[0], definitionIds: ['sample:a', 'sample:b'] };
    expect(ok(shapePackIndexSchema, { ...i, credits: [credit] })).toBe(true);
    expect(ok(shapePackIndexSchema, { ...i, credits: [{ ...credit, definitionIds: [] }] })).toBe(false);
    const s = subset10();
    expect(ok(shapePackSubsetSchema, { ...s, credits: twice(s.credits) })).toBe(true);
    expect(ok(subsetEnvelopeSchema, { ...s, credits: twice(s.credits), definitions: [1, 2] })).toBe(true);
    expect(ok(subsetEnvelopeSchema, { ...s, definitions: [] })).toBe(false);
    expect(ok(shapePackSubsetSchema, { ...s, definitions: [] })).toBe(false);
    const c = fixture('categories/basic.json');
    expect(c.definitions.length).toBeGreaterThan(1);
    expect(ok(shapePackCategorySchema, { ...c, definitions: [] })).toBe(false);
    const j = index11();
    expect(ok(index11Schema, { ...j, definitions: [] })).toBe(false);
    expect(ok(index11Schema, { ...j, credits: twice(j.credits) })).toBe(true);
    expect(ok(index11Schema, { ...j, credits: [] })).toBe(false);
    const t = subset11();
    expect(ok(subset11Schema, { ...t, credits: twice(t.credits), definitions: [1, 2] })).toBe(true);
    expect(ok(subset11Schema, { ...t, credits: [] })).toBe(false);
    expect(ok(subset11Schema, { ...t, definitions: [] })).toBe(false);
  });

  it('NFR-SEC-001: text needs a visible character; slugs and hashes are anchored at both ends', () => {
    const i = index10();
    expect(ok(shapePackIndexSchema, { ...i, name: 'a' })).toBe(true);
    expect(ok(shapePackIndexSchema, { ...i, name: ' \n' })).toBe(false);
    for (const good of ['a', 'abc-1', '0x']) expect(ok(shapePackIndexSchema, { ...i, id: good }), good).toBe(true);
    for (const bad of ['Ab', 'a!', '-a', '']) expect(ok(shapePackIndexSchema, { ...i, id: bad }), bad).toBe(false);
    const path = Object.keys(i.categories)[0] as string;
    const entry = i.categories[path];
    expect(ok(shapePackIndexSchema, { ...i, categories: { [path]: { ...entry, sha256: HASH } } })).toBe(true);
    for (const bad of [`x${HASH}`, `${HASH}x`, 'a', 'A'.repeat(64)])
      expect(ok(shapePackIndexSchema, { ...i, categories: { [path]: { ...entry, sha256: bad } } }), bad).toBe(false);
  });

  it('FR-LIB-003: versions are exact semver, with prerelease and build parts', () => {
    const i = index10();
    for (const good of '1.2.3|0.0.0|10.20.30|1.2.3-alpha.1|1.2.3-0|1.2.3-0a|1.2.3-x-y.10|1.2.3+build.5|1.2.3-rc.1+b.2|1.2.3+a-b|1.2.3-123|1.2.3-a.bcd|1.2.3-a.12b|1.2.3-a.123'.split(
      '|',
    ))
      expect(ok(shapePackIndexSchema, { ...i, version: good }), good).toBe(true);
    for (const bad of '01.2.3|1.02.3|1.2.03|1.2|v1.2.3|1.2.3-|1.2.3-01|1.2.3+|1.2.3-a..b|1.2.3+a..b| 1.2.3|1.2.3x|a.2.3|1.a.3|1.2.a'.split('|'))
      expect(ok(shapePackIndexSchema, { ...i, version: bad }), bad).toBe(false);
  });

  it('NFR-LIC-003: a credit source is original or pinned upstream, each with its own fields', () => {
    const i = index10();
    const credit = i.credits[0];
    const withSource = (source: unknown) => ok(shapePackIndexSchema, { ...i, credits: [{ ...credit, source }] });
    expect(withSource({ kind: 'original', author: 'A', statement: 'S' })).toBe(true);
    expect(withSource({ kind: 'original', author: 'A' })).toBe(false);
    expect(withSource({ kind: 'original', statement: 'S' })).toBe(false);
    expect(withSource({ kind: 'upstream', reference: 'r', sha256: HASH })).toBe(true);
    expect(withSource({ kind: 'upstream', reference: 'r', sha256: HASH, revision: 'v', modifications: 'm' })).toBe(true);
    expect(withSource({ kind: 'upstream', reference: 'r', sha256: HASH, revision: ' ' })).toBe(false);
    expect(withSource({ kind: 'upstream', reference: 'r', sha256: HASH, modifications: ' ' })).toBe(false);
    expect(withSource({ kind: 'upstream', sha256: HASH })).toBe(false);
    expect(withSource({ kind: 'upstream', reference: 'r' })).toBe(false);
    expect(withSource({ kind: '', author: 'A', statement: 'S' })).toBe(false);
    for (const field of ['id', 'license', 'attribution', 'notice', 'source'])
      expect(ok(shapePackIndexSchema, { ...i, credits: [{ ...credit, [field]: undefined }] }), field).toBe(false);
  });

  it('NFR-SEC-001: categories are a slug record that refuses a __proto__ key and a non-object', () => {
    const i = index10();
    const [path, entry] = Object.entries(i.categories)[0] as [string, Record<string, unknown>];
    const proto = JSON.parse(`{"__proto__": ${JSON.stringify(entry)}}`);
    const result = shapePackIndexSchema.safeParse({ ...i, categories: proto });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('reserved category key');
    expect(ok(index11Schema, { ...index11(), categories: proto })).toBe(false);
    for (const bad of [null, 'x', 1]) expect(ok(shapePackIndexSchema, { ...i, categories: bad }), String(bad)).toBe(false);
    expect(ok(shapePackIndexSchema, { ...i, categories: { Bad: entry } })).toBe(false);
    expect(ok(shapePackIndexSchema, { ...i, categories: { [path]: { ...entry, name: 'Basic' } } })).toBe(false);
    expect(ok(shapePackIndexSchema, { ...i, categories: { [path]: { sha256: entry['sha256'] } } })).toBe(false);
    expect(ok(shapePackIndexSchema, { ...i, categories: { [path]: { path: entry['path'] } } })).toBe(false);
  });

  it('FR-LIB-003: an index definition entry has exactly an id, name, keywords and category', () => {
    const i = index10();
    const d = i.definitions[0];
    expect(ok(shapePackIndexSchema, { ...i, definitions: [{ ...d, keywords: ['a', 'b'] }] })).toBe(true);
    expect(ok(shapePackIndexSchema, { ...i, definitions: [{ ...d, keywords: [' '] }] })).toBe(false);
    for (const field of ['id', 'name', 'keywords', 'category'])
      expect(ok(shapePackIndexSchema, { ...i, definitions: [{ ...d, [field]: undefined }] }), field).toBe(false);
    expect(ok(shapePackIndexSchema, { ...i, definitions: [{ ...d, category: 'Bad' }] })).toBe(false);
  });

  it('FR-LIB-003: 1.1 font resources, faces, bindings and credits are checked field by field', () => {
    const j = index11();
    const r = j.fontResources[0];
    const f = j.fontFaces[0];
    const b = j.definitionFonts[0];
    const c = j.fontCredits[0];
    const with11 = (patch: Record<string, unknown>) => ok(index11Schema, { ...j, ...patch });
    expect(with11({ fontResources: [r, { ...r, id: 'other' }] })).toBe(true);
    expect(with11({ fontResources: [], fontFaces: [], definitionFonts: [], fontCredits: [] })).toBe(true);
    for (const [key, value] of [
      ['id', '.a'],
      ['id', 'a!'],
      ['id', 'a'.repeat(129)],
      ['sha256', 'x'],
      ['size', 0],
      ['size', 1.5],
      ['mime', 'font/woff'],
      ['mime', ''],
      ['profile', 'inter'],
      ['profile', ''],
      ['path', ' '],
    ] as const)
      expect(with11({ fontResources: [{ ...r, [key]: value }] }), `${key}=${value}`).toBe(false);
    for (const good of ['A', 'A.b_c-1', 'a'.repeat(128), 'abc']) expect(with11({ fontResources: [{ ...r, id: good }] }), good).toBe(true);
    expect(with11({ fontResources: [{ ...r, extra: 1 }] })).toBe(false);
    expect(with11({ fontFaces: [{ ...f, family: 'x'.repeat(256) }] })).toBe(true);
    expect(with11({ fontFaces: [{ ...f, family: 'Inter' }] })).toBe(true);
    for (const [key, value] of [
      ['family', 'x'.repeat(257)],
      ['family', ' '],
      ['weight', 700],
      ['style', 'italic'],
      ['style', ''],
      ['id', '.x'],
      ['resource', '.x'],
    ] as const)
      expect(with11({ fontFaces: [{ ...f, [key]: value }] }), `${key}=${value}`).toBe(false);
    expect(with11({ fontFaces: [{ ...f, extra: 1 }] })).toBe(false);
    expect(with11({ definitionFonts: [{ ...b, faceIds: ['inter', 'brand'] }] })).toBe(true);
    expect(with11({ definitionFonts: [{ ...b, faceIds: [] }] })).toBe(false);
    expect(with11({ definitionFonts: [{ ...b, definitionId: 'no namespace!' }] })).toBe(false);
    expect(with11({ definitionFonts: [{ ...b, extra: 1 }] })).toBe(false);
    expect(with11({ fontCredits: [{ ...c, resourceIds: ['inter-400', 'other'], definitionIds: ['sample:label', 'sample:badge'] }] })).toBe(true);
    expect(with11({ fontCredits: [{ ...c, resourceIds: [] }] })).toBe(false);
    expect(with11({ fontCredits: [{ ...c, definitionIds: [] }] })).toBe(false);
    for (const field of ['id', 'license', 'attribution', 'notice', 'source', 'resourceIds', 'definitionIds'])
      expect(with11({ fontCredits: [{ ...c, [field]: undefined }] }), field).toBe(false);
    for (const field of ['fontResources', 'fontFaces', 'definitionFonts', 'fontCredits']) expect(with11({ [field]: undefined }), field).toBe(false);
  });

  it('FR-LIB-003: a 1.1 subset resource has no path, and category names wait for 1.2', () => {
    const t = subset11();
    const r = t.fontResources[0];
    expect(ok(subset11Schema, { ...t, fontResources: [{ ...r, path: 'fonts/a.woff2' }] })).toBe(false);
    expect(ok(subset11Schema, { ...t, formatVersion: '1.2', categoryNames: { basic: 'Basic' } })).toBe(true);
    expect(ok(subset11Schema, { ...t, formatVersion: '1.1', categoryNames: { basic: 'Basic' } })).toBe(false);
    expect(ok(subset11Schema, { ...t, formatVersion: '1.2', categoryNames: { Bad: 'Basic' } })).toBe(false);
    const j = index11();
    const [path, entry] = Object.entries(j.categories)[0] as [string, Record<string, unknown>];
    expect(ok(index11Schema, { ...j, formatVersion: '1.2', categories: { [path]: { ...entry, name: 'Labels' } } })).toBe(true);
    expect(ok(index11Schema, { ...j, formatVersion: '1.1', categories: { [path]: { ...entry, name: 'Labels' } } })).toBe(false);
    const paths = (schema: { safeParse(v: unknown): { error?: { issues: { path: PropertyKey[] }[] } } }, value: unknown) =>
      schema.safeParse(value).error?.issues.map((i) => i.path);
    expect(paths(index11Schema, { ...j, formatVersion: '1.1', categories: { [path]: { ...entry, name: 'Labels' } } })).toEqual([['categories', path, 'name']]);
    expect(paths(subset11Schema, { ...t, formatVersion: '1.1', categoryNames: { basic: 'Basic' } })).toEqual([['categoryNames']]);
    for (const field of ['id', 'version', 'license', 'attribution']) {
      expect(ok(subset11Schema, { ...t, [field]: undefined }), field).toBe(false);
      expect(ok(subsetEnvelopeSchema, { ...subset10(), [field]: undefined }), field).toBe(false);
      expect(ok(index11Schema, { ...j, [field]: undefined }), field).toBe(false);
    }
    expect(ok(index11Schema, { ...j, name: undefined })).toBe(false);
  });
});
