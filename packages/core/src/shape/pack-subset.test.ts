import { expect, it } from 'vitest';
import { allowsShapePackContentLicense, parseShapePackSubset, shapePackSubsetSchema } from '../index.js';

const files = import.meta.glob('../../../../fixtures/shape-pack/subset.json', { query: '?raw', import: 'default', eager: true });
const subset = () => JSON.parse(Object.values(files)[0] ?? 'null');
const parse = (value: unknown) => parseShapePackSubset(value, allowsShapePackContentLicense);

it('FR-LIB-009 NFR-LIC-003: a saved geometry subset validates without an index or category metadata and retains its credits', () => {
  const saved = subset();
  expect(shapePackSubsetSchema.safeParse(saved).success).toBe(true);
  expect(parse(saved)).toEqual({ ok: true, value: saved });
  const overridden = subset();
  overridden.definitions[0].license = 'ISC';
  expect(parse(overridden).ok).toBe(true);
  const scoped = subset();
  scoped.credits[0].definitionIds = scoped.definitions.map((d: { id: string }) => d.id);
  expect(parse(scoped)).toEqual({ ok: true, value: scoped });
});

it('FR-LIB-009: unknown versions, fields, namespaces, duplicate IDs and empty geometry are refused', () => {
  for (const patch of [{ formatVersion: '2.0' }, { version: '^1.0.0' }, { entry: 'evil.js' }, { definitions: [] }, { id: 'other' }]) {
    expect(parse({ ...subset(), ...patch }).ok, JSON.stringify(patch)).toBe(false);
  }
  const duplicate = subset();
  duplicate.definitions.push(duplicate.definitions[0]);
  expect(parse(duplicate).ok).toBe(false);
});

it('FR-LIB-009 NFR-SEC-001: one invalid expression or unsafe artwork rejects the whole saved subset with its definition path', () => {
  const bad = subset();
  bad.definitions[1].outline.path = 'M0 0L{unknown} 1';
  const result = parse(bad);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.some((d) => d.path.startsWith('/definitions/1'))).toBe(true);
  bad.definitions[1] = subset().definitions[1];
  bad.definitions[0].artwork = {
    viewBox: { x: 0, y: 0, width: 10, height: 10 },
    root: { name: 'path', attributes: { d: 'M0 0H10V10Z', fill: 'red' }, children: [] },
  };
  expect(parse(bad)).toEqual({ ok: true, value: bad });
  bad.definitions[0].artwork.root.attributes.onload = 'alert(1)';
  expect(parse(bad).ok).toBe(false);
});

it('NFR-LIC-003: saved credits must cover the geometry and retain unique source declarations and notices', () => {
  for (const ids of [[], ['sample:box'], ['sample:missing'], ['sample:box', 'sample:box', 'sample:triangle']]) {
    const bad = subset();
    bad.credits[0].definitionIds = ids;
    expect(parse(bad).ok, JSON.stringify(ids)).toBe(false);
  }
  for (const key of ['source', 'notice', 'license', 'attribution']) {
    const bad = subset();
    delete bad.credits[0][key];
    expect(parse(bad).ok, key).toBe(false);
  }
  const duplicate = subset();
  duplicate.credits.push(duplicate.credits[0]);
  expect(parse(duplicate).ok).toBe(false);
  expect(parse({ ...subset(), credits: [] }).ok).toBe(false);
});

it('NFR-LIC-003: pack, credit and definition override licenses all fail closed under the explicit policy', () => {
  for (const target of ['pack', 'credit', 'definition']) {
    const bad = subset();
    (target === 'pack' ? bad : target === 'credit' ? bad.credits[0] : bad.definitions[0]).license = 'GPL-3.0-only';
    expect(parse(bad).ok, target).toBe(false);
  }
  expect(parseShapePackSubset(subset(), () => false).ok).toBe(false);
  expect(Reflect.apply(parseShapePackSubset, undefined, [subset()])).toMatchObject({ ok: false });
  expect(
    parseShapePackSubset(subset(), () => {
      throw new Error('policy unavailable');
    }).ok,
  ).toBe(false);
});
